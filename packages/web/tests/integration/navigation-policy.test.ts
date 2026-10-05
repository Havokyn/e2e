import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installNavigationPolicy } from '../../src/protected-app.ts';

describe('navigation policy in Chromium', () => {
  let server: Server;
  let browser: Browser;
  let context: BrowserContext;
  let site: string;
  let otherSite: string;
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      hits.push(`${request.headers.host}${request.url}`);
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Navigation policy</title>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    site = `http://127.0.0.1:${port}`;
    otherSite = `http://localhost:${port}`;
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    hits.length = 0;
    context = await browser.newContext({ serviceWorkers: 'block' });
    await installNavigationPolicy(context, '127.0.0.1', 'same-site');
  });

  afterEach(async () => {
    await context.close();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('blocks the first off-site popup request before it has a frame', async () => {
    const page = await context.newPage();
    await page.goto(site);
    const destination = `${otherSite}/popup`;
    const attempted = context.waitForEvent('request', (request) => request.url() === destination);
    const failed = context.waitForEvent('requestfailed', (request) => request.url() === destination);
    await page.evaluate((url) => { window.open(url); }, destination);
    const request = await attempted;
    expect(request.isNavigationRequest()).toBe(true);
    expect(() => request.frame()).toThrow();
    expect((await failed).failure()?.errorText).toContain('ERR_BLOCKED_BY_CLIENT');
    expect(hits).not.toContain(`${new URL(otherSite).host}/popup`);
  });

  it('allows the first same-site popup request', async () => {
    const page = await context.newPage();
    await page.goto(site);
    const opened = context.waitForEvent('page');
    await page.evaluate((url) => { window.open(url); }, `${site}/popup`);
    const popup = await opened;
    await popup.waitForLoadState();
    expect(popup.url()).toBe(`${site}/popup`);
    expect(hits).toContain(`${new URL(site).host}/popup`);
  });
});
