# GleapTracker — Agent Instructions

## What this project is

An Express (Node.js/TypeScript) webhook bridge that connects:

- **Gleap** (customer support tickets) ↔ **Slack** (team review + buttons)
- **Gleap** ↔ **Linear** or **Jira** (issue tracking)

When a support ticket is escalated, it appears in Slack with Confirm/Reject buttons. Confirming creates a Linear/Jira issue. When the issue is closed, customers are notified automatically.

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
- Don't import `gleaptracker.config.ts` before dotenv is loaded (see above)
