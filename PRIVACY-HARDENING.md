# Privacy hardening in this fork

This fork intentionally differs from upstream `tester-army/e2e` in a few security-sensitive defaults.

## No TesterArmy/PostHog egress by default

Anonymous usage telemetry is disabled until you explicitly opt in:

```bash
npx e2e telemetry enable
```

For ephemeral CI or fleet runs, opt in explicitly with:

```bash
E2E_TELEMETRY_ENABLED=1 npx e2e run
```

Hard opt-outs remain available:

```bash
E2E_TELEMETRY_DISABLED=1 npx e2e run
DO_NOT_TRACK=1 npx e2e run
```

A saved `e2e telemetry disable` remains authoritative locally.

`e2e feedback` uses the same consent gate. When telemetry is disabled, feedback is not sent. Use `e2e feedback --dry-run` to inspect the payload locally.

## Same-site browser navigation by default

The web engine defaults to:

```ts
web({ navigationPolicy: 'same-site' })
```

This blocks off-site **top-level document navigation** whether it comes from a typed URL, agent navigation, a click, or a popup. HTTP redirect destinations bypass Playwright routing and are not checked, so an allowed same-site URL can redirect the browser off-site. Off-site subresources and child frames remain allowed.

For a deliberate cross-site flow such as third-party OAuth:

```ts
web({ navigationPolicy: 'any' })
```

The site check is registrable-site based rather than exact-origin based. Shared-hosting domains can therefore be broader than an exact allowlist.

## What this does not prevent

Agent-backed steps still send the observations required by the test to the model provider configured in `e2e.config.ts`. If that provider is OpenAI, GitHub Copilot, OpenRouter, or another remote model service, those model requests leave the machine.

For the strongest isolation, use deterministic tests or a local/self-hosted model.

The framework and its tests/configuration execute with the operating system authority of the user running them. Treat test files, config, custom tools, dependencies, and replay cache entries as trusted code.

## Recommended credential posture

Use dedicated test or staging identities and least-privilege secrets. Do not expose production wallet keys, seed phrases, withdrawal-enabled exchange keys, root cloud credentials, or production administrator credentials to automated tests.

Keep application stdout/stderr free of secrets because configured `command.log` output is not redacted.
