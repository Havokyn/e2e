---
"e2e": minor
"@e2e-dev/web": minor
---

Privacy-first fork defaults: anonymous TesterArmy/PostHog telemetry is disabled until explicitly enabled, `e2e feedback` shares that consent gate, and the web engine defaults top-level navigation to the target app's site. Set `web({ navigationPolicy: 'any' })` only for intentional cross-site flows such as third-party OAuth.
