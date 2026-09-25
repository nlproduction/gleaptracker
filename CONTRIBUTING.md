# Contributing

Thanks for helping improve GleapTracker, created by the [MapSVG team](https://mapsvg.com).

Open an issue with a reproducible example before proposing a large architectural change. Pull requests should be focused, explain the user-visible behavior, and include regression tests. Remove credentials and customer information from logs and payloads before sharing them.

## Local development

Use Node.js 22.12+ and pnpm 9. Install with `pnpm install --frozen-lockfile`. Copy `.env.local.example` only when testing against your own staging workspace; the automated test suite needs no live credentials.

```bash
pnpm lint
pnpm test
pnpm build
```

Tests are colocated as `src/**/*.test.ts`. Mock provider SDKs and HTTP calls. Tests that exercise HTTP routes bind only to loopback and must not call live providers. Do not edit `dist/` or remove existing tests to make a change pass.

## Compatibility expectations

Keep `ISSUE_TRACKER=none` free of Linear/Jira creation. Preserve ticket field names, tracker-owned Slack threads, the default GitHub branch behavior, and silent closes from Gleap. A failed optional provider must not make Slack unusable. Never replace raw-body parsing on signed webhook routes with `express.json()`.

When changing configuration, document migration steps. Run one process unless a change explicitly introduces shared locking and durable delivery state. Do not claim exactly-once delivery for a multi-service workflow that cannot provide it.

Contributions are provided under the repository's [MIT License](LICENSE). For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
