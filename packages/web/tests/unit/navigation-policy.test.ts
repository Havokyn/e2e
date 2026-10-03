import type { BrowserContext, Frame, Request, Route } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { installNavigationPolicy } from '../../src/protected-app.ts';

interface CapturedRoute {
  readonly predicate: (url: URL) => boolean;
  readonly handler: (route: Route) => Promise<void>;
}

/** Installs the policy on a mock context and captures any registered route predicate and handler. */
async function capture(site: string | undefined, policy: 'same-site' | 'any'): Promise<{
  readonly context: BrowserContext;
  readonly route: ReturnType<typeof vi.fn>;
  readonly captured: CapturedRoute | undefined;
}> {
  let captured: CapturedRoute | undefined;
  const route = vi.fn(async (predicate: unknown, handler: unknown) => {
    captured = {
      predicate: predicate as (url: URL) => boolean,
      handler: handler as (route: Route) => Promise<void>,
    };
  });
  const context = { route } as unknown as BrowserContext;
  await installNavigationPolicy(context, site, policy);
  return { context, route, captured };
}

/** Creates a route with the requested navigation and frame state, plus spies for abort and fallback. */
function requestRoute(options: { navigation: boolean; topLevel: boolean }): {
  readonly route: Route;
  readonly abort: ReturnType<typeof vi.fn>;
  readonly fallback: ReturnType<typeof vi.fn>;
} {
  const parent = {} as Frame;
  const frame = { parentFrame: () => (options.topLevel ? null : parent) } as unknown as Frame;
  const request = {
    isNavigationRequest: () => options.navigation,
    frame: () => frame,
  } as unknown as Request;
  const abort = vi.fn(async () => undefined);
  const fallback = vi.fn(async () => undefined);
  return {
    route: { request: () => request, abort, fallback } as unknown as Route,
    abort,
    fallback,
  };
}

describe('privacy-first navigation policy', () => {
  it('does not install a route for unrestricted navigation or an app without a site', async () => {
    expect((await capture('example.com', 'any')).route).not.toHaveBeenCalled();
    expect((await capture(undefined, 'same-site')).route).not.toHaveBeenCalled();
  });

  it('matches only URLs outside the app site', async () => {
    const { captured } = await capture('example.com', 'same-site');
    expect(captured).toBeDefined();
    expect(captured!.predicate(new URL('https://app.example.com/settings'))).toBe(false);
    expect(captured!.predicate(new URL('https://auth.example.com/login'))).toBe(false);
    expect(captured!.predicate(new URL('https://evil.test/phish'))).toBe(true);
  });

  it('reinstalls itself at highest route precedence without stacking guards', async () => {
    const registrations: CapturedRoute[] = [];
    const unroute = vi.fn(async () => undefined);
    const route = vi.fn(async (predicate: unknown, handler: unknown) => {
      registrations.push({
        predicate: predicate as (url: URL) => boolean,
        handler: handler as (route: Route) => Promise<void>,
      });
    });
    const context = { route, unroute } as unknown as BrowserContext;

    await installNavigationPolicy(context, 'example.com', 'same-site');
    await installNavigationPolicy(context, 'example.com', 'same-site');

    expect(route).toHaveBeenCalledTimes(2);
    expect(unroute).toHaveBeenCalledTimes(1);
    expect(unroute).toHaveBeenCalledWith(registrations[0]!.predicate, registrations[0]!.handler);
    expect(route.mock.invocationCallOrder[1]).toBeLessThan(unroute.mock.invocationCallOrder[0]!);
  });

  it('keeps the existing guard when replacement registration fails', async () => {
    const route = vi.fn(async () => undefined);
    const unroute = vi.fn(async () => undefined);
    const context = { route, unroute } as unknown as BrowserContext;
    await installNavigationPolicy(context, 'example.com', 'same-site');
    const previous = route.mock.calls[0];
    route.mockRejectedValueOnce(new Error('registration failed'));

    await expect(installNavigationPolicy(context, 'example.com', 'same-site')).rejects.toThrow('registration failed');
    expect(unroute).not.toHaveBeenCalled();

    await installNavigationPolicy(context, 'example.com', 'any');
    expect(unroute.mock.calls[0]).toEqual(previous);
  });

  it('keeps the replacement available for cleanup when removing the previous guard fails', async () => {
    const route = vi.fn(async () => undefined);
    const unroute = vi.fn(async () => undefined);
    const context = { route, unroute } as unknown as BrowserContext;
    await installNavigationPolicy(context, 'example.com', 'same-site');
    unroute.mockRejectedValueOnce(new Error('removal failed'));

    await installNavigationPolicy(context, 'example.com', 'same-site');
    await installNavigationPolicy(context, 'example.com', 'any');
    expect(unroute.mock.calls[1]).toEqual(route.mock.calls[1]);
  });

  it.each([
    ['example.com', 'any'],
    [undefined, 'same-site'],
  ] as const)('removes the guard for site %s and policy %s', async (site, policy) => {
    const route = vi.fn(async () => undefined);
    const unroute = vi.fn(async () => undefined);
    const context = { route, unroute } as unknown as BrowserContext;
    await installNavigationPolicy(context, 'example.com', 'same-site');

    await installNavigationPolicy(context, site, policy);
    expect(unroute.mock.calls[0]).toEqual(route.mock.calls[0]);
    expect(route).toHaveBeenCalledOnce();

    await installNavigationPolicy(context, site, policy);
    expect(unroute).toHaveBeenCalledOnce();
  });

  it('blocks an off-site top-level document navigation', async () => {
    const { captured } = await capture('example.com', 'same-site');
    const attempted = requestRoute({ navigation: true, topLevel: true });
    await captured!.handler(attempted.route);
    expect(attempted.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(attempted.fallback).not.toHaveBeenCalled();
  });

  it('allows off-site subresources and child-frame navigations', async () => {
    const { captured } = await capture('example.com', 'same-site');

    const subresource = requestRoute({ navigation: false, topLevel: true });
    await captured!.handler(subresource.route);
    expect(subresource.fallback).toHaveBeenCalledOnce();
    expect(subresource.abort).not.toHaveBeenCalled();

    const childNavigation = requestRoute({ navigation: true, topLevel: false });
    await captured!.handler(childNavigation.route);
    expect(childNavigation.fallback).toHaveBeenCalledOnce();
    expect(childNavigation.abort).not.toHaveBeenCalled();
  });
});
