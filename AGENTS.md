# GleapTracker — contributor and agent instructions

GleapTracker is an Express/TypeScript webhook bridge created by the MapSVG team: https://mapsvg.com. It connects Gleap tracker tickets to Slack threads, optional Linear/Jira issues, and GitHub commit-based closing. It is MIT licensed.

## Architecture and compatibility

- `gleaptracker.config.ts` holds typed, environment-backed configuration. `src/env.ts` loads environment files before settings are evaluated; tests must not load real environment files.
- `src/app.ts` owns HTTP routes and parsers; `src/server.ts` starts the listener and optional follow-up cron.
- The Gleap tracker owns `slack_thread` / `slack_thread_ts`. Do not move thread ownership to a customer ticket.
- Gleap create/update and customer-link events invoke `processTrackerTicket()` only effectively when `issueTracker` is `linear`, `jira`, or `both`. `none` must make no external issue-creation calls.
- Re-read persisted links before creating issues. Preserve existing provider IDs, generic `issueId`/`issueUrl`, and unrelated `formData` fields. Both providers are independent; a retry must not recreate a successful issue.
- All close paths use `closeTracker()` in `src/integrations/gleap/close.ts`. Direct Gleap DONE is silent. Slack empty-message close is silent. Nonempty Slack text overrides workflow/default messaging. GitHub/Linear/Jira use the configured notification behavior.
- Mark only the tracker DONE. Gleap handles linked customer status propagation. Only OPEN customers move to INPROGRESS on linking; preserve other statuses.
- Preserve the Slack Close modal, old `tracker_status` callback alias, and `tracker_actions` block ID. Do not restore Confirm/Reject buttons.
- Commit tokens are `Fixes Gleap-<trackerBugId>` and optional `Refs Gleap-<customerBugId>`. Default close branch remains `master`; tokens are not rendered on Slack cards.
- Run one process. Process-local locks and Gleap flags do not provide distributed exactly-once delivery. Document limits rather than claiming stronger guarantees.

## Security

Never commit `.env.local`, `.env.migration`, credentials, or real customer payloads. Preserve raw-body parsing for Slack, GitHub, Linear, and Jira HMAC validation. A supplied invalid native signature must not fall back to weaker authentication. Empty Jira secrets must never authenticate.

Gleap shared-secret authentication is optional only for backwards compatibility; public installations need a secret or trusted ingress. Never log secret query strings. Preserve Slack message metadata and configure necessary permissions in the app manifest rather than removing metadata to work around an API error.

## Commands

```bash
pnpm dev
pnpm lint
pnpm test
pnpm build
pnpm start
pnpm start:pm2
```

Tests are colocated in `src/**/*.test.ts`. Mock provider APIs; HTTP route tests use loopback only. Run lint, tests, and build before merging. Never edit generated `dist/`. Use `console.error` for errors, `console.log` for information, and `void` for intentional fire-and-forget promises.

Public-facing documentation belongs in README and docs/. Keep workspace-specific settings out of defaults. Update docs/upgrading.md for configuration changes and retain existing settings through the previous-build export procedure when upgrading deployments. Do not rebuild or restart a live deployment merely to modify repository source.
