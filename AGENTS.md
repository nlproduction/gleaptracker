# GleapTracker — Agent Instructions

## What this project is

An Express (Node.js/TypeScript) webhook bridge that connects:

- **Gleap** (customer support tickets) ↔ **Slack** (tracker threads + Close)
- **Gleap tracker tickets** as the issue-group source of truth
- Optional / legacy **Linear** or **Jira** issue create + done webhooks

When an agent uses Gleap **Link to tracker**, gleaptracker opens (or updates) a Slack thread for that tracker. Closing the tracker — from Gleap (DONE), Slack (Close modal), or git (`Fixes Gleap-<trackerBugId>` on `master`) — notifies linked customers and updates Slack. Linear/Jira are not required for the new close path.

## Architecture

```
gleaptracker.config.ts     # All non-secret config (edit this to customise)
.env.local                 # Secrets — never commit, never read directly in code
src/
  server.ts                # Express entry point, routes
  handlers/                # One file per webhook / Slack interactions
  integrations/            # API clients: gleap/, slack/, linear/, jira/
  types/config.ts          # TypeScript types for gleaptracker.config.ts
```

## Key conventions

- **Config is read at import time** — `gleaptracker.config.ts` is required before `dotenv.config()` runs in CJS output. Dotenv must be preloaded via `node -r dotenv/config` (see `ecosystem.config.cjs`). Never call `dotenv.config()` and expect it to work for config values.
- **Secrets** live only in `.env.local` and are accessed via `process.env.*` — never hardcode them.
- **`dist/`** is gitignored build output — never edit files there, always edit `src/`.
- Use `console.error` for errors, `console.log` for info. Never use `console.warn` for real errors.
- Never add comments that just narrate what the code does. Comments should explain non-obvious intent only.
- Prefer `void asyncFn()` over floating promises when fire-and-forget is intentional.
- **The tracker ticket owns the Slack thread** (`formData.slack_thread` / `slack_thread_ts`). Do not store the thread only on the customer ticket.
- Shared close path: `closeTracker()` in `src/integrations/gleap/close.ts` (notify linked customers → DONE tracker → Slack header). Children are not status-updated in code; Gleap closes them when the tracker is DONE.
- Commit convention in Slack headers: `Fixes Gleap-<trackerBugId>` and `Refs Gleap-<customerBugId>, …`.

## Commands

```bash
pnpm dev        # run with tsx watch (no build needed)
pnpm build      # tsc compile to dist/
pnpm lint       # tsc --noEmit (type-check only, no output)
pnpm start      # run compiled dist/ (requires build first)
pnpm start:pm2  # start via PM2 using ecosystem.config.cjs
```

Always run `pnpm lint` after making changes to verify no TypeScript errors.

## What NOT to do

- Don't touch `dist/` — it's generated
- Don't add `metadata.message:write` scope workarounds — it must be registered in the Slack app manifest
- Don't use `express.json()` for the Slack handler — it needs raw body for signature verification
- Don't use `express.json()` for the GitHub handler — it needs raw body for `X-Hub-Signature-256`
- Don't import `gleaptracker.config.ts` before dotenv is loaded (see above)
- Don't bring back Slack Confirm/Reject — linking to a tracker is what creates Slack
- Don't create Linear/Jira issues on the new path (`issueTracker: "none"`)
