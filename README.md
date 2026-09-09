# GleapTracker

An **Express** (Node.js) service that connects **Gleap** (customer support) with **Slack**. The **Gleap tracker ticket** is the issue-group source of truth (not Linear). When an agent uses Gleap **Link to tracker**, gleaptracker opens a Slack thread for that tracker. Closing the tracker notifies linked customers.

Linear and Jira remain optional/legacy. The new close path does not require them.

---

## Workflow

The Slack thread is created when a tracker is created or a customer ticket is linked — **not** after a Confirm click. There are no Confirm or Reject buttons.

```
Customer reports a bug in Gleap
         │
         ▼
Agent uses native Gleap “Link to tracker”
(create a new tracker, or link to an existing one)
         │
         ▼
Gleap → GleapTracker webhook (ticket.created / ticket.updated)
GleapTracker detects the tracker (or the new link) and:
         │
         ▼
If the tracker has no Slack thread yet:
  1. Post a Slack root card:
       `#<trackerBugId>`  *tracker title*
       <primary customer email>
       Tickets: #<cust1>, #<cust2>   ← always; mrkdwn links to each customer ticket
       🟡 In progress                ← text/emoji for TRACKER status (not a button)
       [Close]  [Open in Gleap ↗]    ← Open in Gleap is the TRACKER ticket
     Close is hidden when the tracker is already DONE.
     `Fixes Gleap-…` / `Refs Gleap-…` are **not** shown on Slack (git only).
  2. First in-thread message = tracker ticket description
     (Gleap-generated tracker description).
  3. Persist slack_thread / slack_thread_ts on the **tracker**.
         │
         ▼
If another customer ticket is linked to the same tracker:
  • Refresh the Slack root (Tickets:, status, Close visibility)
  • Post in the thread:
        *New related ticket*
        #<bugId> <title>
        <email>
        [Open in Gleap]
         │
         ▼
Developers use the commit convention below and work as usual.
         │
         ▼
Close the tracker via any of three paths (same pipeline):
  A. Gleap: tracker status → DONE
  B. Git: push to master containing `Fixes Gleap-<trackerBugId>`
  C. Slack: Close button → modal (prefilled bug-fixed message)
         │
         ▼
Shared close pipeline:
  • If the Close modal (or caller) has text → send that message to each
    linked **customer** ticket (or run gleap.workflowId / bugFixedMessage
    when no custom text was provided).
  • If the Close modal is submitted empty → **silent** close: no customer
    messages.
  • Set the tracker to DONE (skip if already DONE).
  • Do **not** status-update children in code — Gleap closes linked
    tickets when the tracker is DONE.
  • Update the Slack header to closed (no Close button) and post ✅ Closed.
         │
         ▼
If the tracker leaves DONE, Slack shows the live status + Close again
and posts 🔄 Reopened.
```

### Commit convention

Use these tokens in the fixing commit (they are **not** rendered on the Slack card):

```
Fixes Gleap-237650
Refs Gleap-237536, Gleap-237537
```

- **`Fixes Gleap-<id>`** — tracker bugId only. A push to `master` that contains this token closes that tracker (path B).
- **`Refs Gleap-<id>, …`** — all linked **customer** bugIds. Optional in the commit; not used to close anything.

### Slack Close modal (path C)

The Close button opens a modal prefilled with `gleap.bugFixedMessage` (English thank-you / please update the plugin).

- Edit the text and submit → that message is sent to each linked customer ticket, then the tracker is set DONE.
- Clear the text and submit → silent close (DONE, no customer messages).

### Adding internal notes to the tracker from Slack

Inside any tracker thread on Slack, include `g:note` anywhere in a message:

```
g:note Customer confirmed they're on v3.2, still reproducible
```

GleapTracker strips the tag and adds the rest as an internal note on the **tracker** ticket (the thread owner).

---

## Prerequisites

- Node.js 18+
- pnpm
- A [Gleap](https://gleap.io) account with API access
- A [Slack App](https://api.slack.com/apps) with the scopes below
- Optional: a [Linear](https://linear.app) workspace and/or [Jira](https://www.atlassian.com/software/jira) project (legacy issue-create path only)
- A GitHub repo webhook if you want path B (`Fixes Gleap-<id>` on push to `master`)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/nlproduction/gleaptracker.git
cd gleaptracker
pnpm install
```

### 2. Configure secrets

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in all values. See [.env.local.example](.env.local.example) for the full list.

### 3. Configure the integration

Edit `gleaptracker.config.ts` in the project root. This file controls all non-secret settings:

| Field                     | Description                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `gleap.workflowId`        | _(optional)_ Gleap workflow ID run on each linked **customer** ticket when the tracker is closed without a custom Slack message — use this **or** `bugFixedMessage`, not both |
| `gleap.bugFixedMessage`   | _(optional)_ Default customer message (also the Slack Close modal prefill). Used when `workflowId` is not set and the close is not silent |
| `gleap.trackerTicketType` | Type used for tracker tickets (default: `FOR-RELEASE`)                                                                               |
| `gleap.onSlackStatuses`   | Legacy "On Slack" lane IDs (not applied on Link to tracker; cron may still ignore leftover tickets in these lanes)                 |
| `gleap.waitingStatus`     | Legacy "Waiting for Update" ID — **not** applied after link / Slack sync. Newly linked `OPEN` customers go to `INPROGRESS`         |
| `issueTracker`            | `"none"` (default tracker-SoT path; no Linear/Jira create) \| `"linear"` \| `"jira"` \| `"both"`                                     |
| `github.closeBranches`    | Branches whose pushes close trackers via `Fixes Gleap-<trackerBugId>` (default: `["master"]`)                                        |
| `followUp.cron`           | node-cron expression for the daily no-reply job (default `0 8 * * *`, or `FOLLOWUP_CRON`; set `off` to disable)                      |
| `followUp.timezone`       | IANA timezone for that expression (default `UTC`, or `FOLLOWUP_TZ`)                                                                  |
| `followUp.followUpAfterDays` | Days after the last **human** agent reply with no customer reply before the BUG nudge (default `3`, or `FOLLOWUP_AFTER_DAYS`)   |
| `followUp.closeAfterDays` | Days after that same agent reply before close-no-reply (default `7`, or `FOLLOWUP_CLOSE_AFTER_DAYS`)                                 |
| `followUp.workflows.bugFollowUp` | Gleap workflow ID for the BUG 3-day nudge (`FOLLOWUP_BUG_FOLLOWUP_WORKFLOW_ID`) |
| `followUp.workflows.bugClose` | Gleap workflow ID for the BUG 7-day close (`FOLLOWUP_BUG_CLOSE_WORKFLOW_ID`) |
| `followUp.workflows.inquiryClose` | Gleap workflow ID for the INQUIRY 7-day close (`FOLLOWUP_INQUIRY_CLOSE_WORKFLOW_ID`). INQUIRY has no 3-day nudge. |
| `linear.teamId`           | Your Linear team ID                                                                                                                  |
| `linear.labelIds`         | Label IDs applied to created Linear issues                                                                                           |
| `linear.stateId`          | Initial state ID for new Linear issues (e.g. "Todo")                                                                                 |
| `linear.trackerLabel`     | Label name identifying Gleap-linked issues in Linear webhooks                                                                        |
| `jira.host`               | Your Jira hostname, e.g. `yourteam.atlassian.net`                                                                                    |
| `jira.projectKey`         | Jira project key, e.g. `MAP`                                                                                                         |
| `jira.issueType`          | Issue type name, e.g. `Bug`                                                                                                          |
| `jira.doneStatusName`     | Jira status name that means "done", e.g. `Done`                                                                                      |

#### Finding Gleap status IDs

Several fields in `gleaptracker.config.ts` require internal Gleap status IDs (e.g. `"cz2qz"`) rather than the human-readable names shown in the UI (`"On Slack"`). To find them:

1. Open your Gleap project → **Bugs**
2. Open the browser DevTools → **Network** tab
3. Reload the page or click on a status to edit it
4. Find the API request to `appapi.gleap.io/v3/tickets?type=...` the "type" contains the string you need
5. Alternatively: open any ticket in Gleap and change its status while watching the Network tab — the PATCH/PUT request body will contain the raw status ID

Fields that need these IDs:

| Field                 | What it maps to in Gleap                          |
| --------------------- | ------------------------------------------------- |
| `gleap.onSlackStatuses.BUG` | Legacy "On Slack" lane for Bug tickets |
| `gleap.onSlackStatuses.INQUIRY` | Legacy "On Slack" lane for Inquiry tickets |
| `gleap.waitingStatus` | Legacy "Waiting for Update" (no longer applied on link) |
| `gleap.doneStatus`    | Your "Done / Closed" status (often just `"DONE"`) |

### 4. Gleap workspace setup

Before the integration can work, a few things need to be configured in Gleap itself.

#### Custom ticket statuses

**Waiting for Update is legacy.** After **Link to tracker** (and when a new related ticket is announced in Slack), gleaptracker only changes customer status when it is `OPEN` — it sets `INPROGRESS`. Already-`INPROGRESS` tickets and any other lane (On Slack, Waiting, Done, …) are left as-is. This path never writes Waiting for Update or On Slack.

Older "On Slack" / "Waiting for Update" custom lanes may still exist in Gleap. They are no longer required for the tracker-SoT flow. If leftover tickets sit in those lanes, the daily no-reply job ignores them; the **primary** skip is a linked tracker that is not `DONE`.

See [Finding Gleap status IDs](#finding-gleap-status-ids) below to get the raw ID strings to put in `gleaptracker.config.ts`.

#### Daily follow-up / close-no-reply (in-process cron)

Link to tracker does **not** set the old "On Slack" status, so Gleap-native "no customer reply" automations are no longer a reliable skip for tracker-path tickets. gleaptracker runs the **schedule** itself and then invokes Gleap workflows for the customer-facing step.

The Express process (the single PM2 instance) schedules a **node-cron** job — not BullMQ, not Redis, not a second worker.

| | Default |
| --- | --- |
| Schedule | `0 8 * * *` (08:00 every day) |
| Timezone | `UTC` (override with `FOLLOWUP_TZ`, e.g. `Asia/Makassar` / WITA) |
| BUG first nudge | 3 days after the last **human** agent reply → workflow `followUp.workflows.bugFollowUp` ("Follow-up 3 days") |
| BUG close no-reply | 7 days after that same agent reply → workflow `followUp.workflows.bugClose` ("Follow-up 7 days") |
| INQUIRY | no 3-day nudge; at 7 days → workflow `followUp.workflows.inquiryClose` ("Close Inbox Ticket - 7 days no reply") |

Override with env (see `.env.local.example`):

- `FOLLOWUP_CRON` — cron expression, or `off` / `false` / `disabled` to skip scheduling
- `FOLLOWUP_TZ` — IANA timezone (default `UTC`; WITA is `Asia/Makassar`)
- `FOLLOWUP_AFTER_DAYS` / `FOLLOWUP_CLOSE_AFTER_DAYS` — thresholds
- `FOLLOWUP_BUG_FOLLOWUP_WORKFLOW_ID` / `FOLLOWUP_BUG_CLOSE_WORKFLOW_ID` / `FOLLOWUP_INQUIRY_CLOSE_WORKFLOW_ID` — workflow IDs

The job lists each `(status, type)` pair separately (`OPEN`/`INPROGRESS` × `BUG`/`INQUIRY`) and dedupes by id (Gleap also accepts CSV filters; we do not depend on that). Then for each:

1. **Skip** if the ticket has a linked tracker whose status is **not** `DONE` (OPEN and INPROGRESS trackers both count as active).
2. **Skip** leftover parked lanes if they still appear (`On Slack`, `Waiting for Update`, snoozed). The job never writes Waiting.
3. **Skip** when the last customer message is newer than the last human agent message, or when no human agent has replied yet (AI/bot greetings do not start the clock).
4. Otherwise call `tickets.runWorkflow(ticketId, workflowId)` for the matching workflow. The cron does **not** `sendMessage` hardcoded bot text, and it does **not** set `DONE` itself — the workflow owns customer messaging and status.
5. Same-day re-runs are idempotent via `formData.noreply_followup_workflow_sent_at` / `noreply_close_workflow_sent_at` (legacy `noreply_*_sent_at` flags from the old bot-message path still count as already-acted). The flag is written before `runWorkflow`.
6. Immediately before invoke, the job re-fetches the ticket, linked tracker, and messages and re-runs the decision. If an agent just linked a tracker or the customer replied, the workflow is skipped.

Each run logs `scanned / skipped-linked-tracker / skipped-parked / skipped-waiting-on-us / skipped-too-soon / skipped-already-acted / skipped-stale / skipped-overlap / followed-up / closed / errors`. Gleap API calls are sequential with a short delay. A second `runFollowUpJob` in the same process no-ops (`skipped-overlap`) while one is running.

**PM2:** run **one** process (`instances: 1` in `ecosystem.config.cjs`). Multi-instance deploy is **unsupported** for this cron — both `noOverlap` and the in-process mutex are single-process only.

**Gleap dashboard:** keep these three workflows on trigger **none** (publish draft → live without an on-ticket-no-response auto trigger). Only this cron should start them. Do not also enable Gleap-native "no reply" automations for the same tickets, or customers will be double-messaged.

`followUp.followUpMessage` / `followUp.closeMessage` are unused on this path (left in config as a reference). The job does not start when `NODE_ENV=test` or Vitest is running.

#### Link to tracker (creates Slack)

Support agents use native Gleap **Link to tracker** (create or attach) when a customer ticket needs a Slack discussion. GleapTracker listens for `ticket.created` / `ticket.updated` and treats a new tracker or a new `linkedTickets` entry as the trigger — **not** an "On Slack" status change.

Linking to the tracker is what opens Slack. Newly linked `OPEN` customers are set to `INPROGRESS` (already-`INPROGRESS` tickets are left alone). Auto follow-up / close-no-reply is skipped while a linked tracker is not `DONE`.

#### Tracker ticket board

Tracker tickets are the issue-group source of truth. Create a **dedicated board** in Gleap (e.g. "For Release") so they stay out of the regular support queue.

In `gleaptracker.config.ts`, set `gleap.trackerTicketType` to that type (default `"FOR-RELEASE"`).

Add these custom text fields on the tracker board so Slack state survives (the BUG board already has the Slack pair):

| Field                 | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `slack_thread`        | Permalink to the Slack root message                  |
| `slack_thread_ts`     | Slack thread timestamp                               |
| `primary_ticket_id`   | Original customer ticket (email + first Tickets: link) |
| `slack_notified_ids`  | Customer ticket IDs already announced in the thread  |
| `close_processed`     | Dedup flag so DONE webhooks do not re-notify         |
| `close_silent`        | Set when Slack Close was submitted with empty text   |

### 5. Slack App

Create a new app at [api.slack.com/apps](https://api.slack.com/apps).

#### Required Bot Token Scopes (OAuth & Permissions)

| Scope                    | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `chat:write`             | Post messages                                   |
| `chat:write.customize`   | Custom username/icon (optional)                 |
| `channels:history`       | Read channel messages for g:note                |
| `conversations:history`  | Read thread replies                             |
| `metadata.message:write` | Attach ticket ID metadata when posting messages |
| `metadata.message:read`  | Read message metadata (ticket ID lookup)        |
| `users:read`             | Resolve user display names                      |

#### Interactivity & Shortcuts

Enable **Interactivity** and set the Request URL to:

```
https://your-domain/api/slack
```

#### Event Subscriptions

Enable **Event Subscriptions**, set Request URL to `https://your-domain/api/slack`, then subscribe to bot event:

- `message.channels`

This enables the `g:note` feature — type `g:note your note text` in a tracker thread to add an internal note on the tracker ticket.

#### Install the app

After setting up scopes, install the app to your workspace. Copy the **Bot User OAuth Token** to `SLACK_BOT_TOKEN` and the **Signing Secret** to `SLACK_SIGNING_SECRET` in `.env.local`.

### 6. Gleap Webhook

In Gleap: **Settings → Integrations → Webhooks → Add Webhook**

- URL: `https://your-domain/api/webhooks/gleap`
- Events: `ticket.created`, `ticket.updated`

### 7. GitHub Webhook (close path B)

In the product repo (or a release repo): **Settings → Webhooks → Add webhook**

- Payload URL: `https://your-domain/api/webhooks/github`
- Content type: `application/json`
- Secret: the same value as `GITHUB_WEBHOOK_SECRET` in `.env.local`
- Events: **Just the push event**

GleapTracker handles `push` to branches listed in `github.closeBranches` (default `master`). Each commit message is scanned for `Fixes Gleap-<trackerBugId>`. Matching open trackers run the same close/notify pipeline as a Gleap DONE (deduped if the tracker is already DONE).

A GitHub Actions “release” workflow can use the same hook by pushing the annotated commit to `master`, or by pointing an additional webhook at this URL. `ping` events return 200.

### 8. Linear Webhook (legacy)

Optional. Only needed if you still close via Linear issues created by the old path (`issueTracker` `"linear"` or `"both"`).

In Linear: **Settings → API → Webhooks → New Webhook**

- URL: `https://your-domain/api/webhooks/linear`
- Data change events: **Issue**
- Copy the signing secret to `LINEAR_WEBHOOK_SECRET` in `.env.local`

The webhook fires when an issue is marked Done. GleapTracker looks for issues with the `gleap-tracker-ticket` label and a title matching `[bugId] Title`, then runs the shared tracker close pipeline.

### 9. Jira Webhook (legacy)

Optional. Same as Linear for the old Jira create path.

In Jira: **Settings → System → WebHooks → Create a WebHook**

- URL: `https://your-domain/api/webhooks/jira?secret=<your JIRA_WEBHOOK_SECRET>`
- Events: **Issue → updated**

GleapTracker filters for status transitions to `doneStatusName` and titles matching `[bugId] Title`.

---

## Run locally

```bash
pnpm dev
```

This starts Express on port **3000** (override with `PORT=3001 pnpm dev`).

### Tests

```bash
pnpm test        # vitest run
pnpm test:watch  # re-run on change
```

Tests are colocated as `src/**/*.test.ts` (close pipeline, Slack blocks, link/thread sync, GitHub `Fixes Gleap-<id>`, Slack close modal). Slack / Gleap / GitHub clients are mocked — no live network. Dummy env vars are set in `vitest.setup.ts` so `gleaptracker.config.ts` can load.

Use [ngrok](https://ngrok.com) to expose your local server for webhook testing:

```bash
ngrok http 3000
```

---

## Deployment

Build and run the compiled server:

```bash
pnpm build
pnpm start
```

`pnpm start` runs `node dist/src/server.js`. Set the same variables you use in `.env.local` as environment variables on the host (or ship a `.env.local` next to the app).

**PM2**

[PM2](https://pm2.keymetrics.io) is a process manager for Node.js. It keeps your app running after you log out of the server, automatically restarts it if it crashes, and survives server reboots (via `pm2 startup`).

Install globally on the server:

```bash
pnpm add -g pm2
```

The repo includes `ecosystem.config.cjs` which tells PM2 how to start the app:

- **`instances: 1`** — a single always-up process; the daily follow-up cron lives in this process and must not be duplicated
- **`node_args: "-r dotenv/config"`** — preloads dotenv before any module is imported, so `.env.local` is read before `gleaptracker.config.ts` evaluates `process.env.*`
- **`DOTENV_CONFIG_PATH`** — points dotenv to `.env.local` instead of the default `.env`
- **`PORT`** — the port Express listens on (must match your Apache `ProxyPass` port)

Build and start with PM2:

```bash
pnpm build
pnpm start:pm2  # runs: pm2 start ecosystem.config.cjs
```

Useful PM2 commands (also available as `pnpm` scripts):

```bash
pnpm logs:pm2     # tail live logs
pnpm reload:pm2   # restart after code change
pnpm status:pm2   # show process status
pnpm stop:pm2     # stop without removing
pnpm delete:pm2   # remove from PM2 process list
```

Make PM2 survive reboots:

```bash
pm2 save          # save current process list
pm2 startup       # print and run the systemd command
```

**Docker / VPS:** any Node 18+ host works; put a reverse proxy (Apache, nginx, Caddy) in front for HTTPS — webhooks require a public HTTPS URL.

### Apache reverse proxy setup

Enable the required modules:

```bash
sudo a2enmod proxy proxy_http rewrite
sudo systemctl reload apache2
```

Create a virtual host config, e.g. `/etc/apache2/sites-available/gleaptracker.example.com.conf`:

```apache
<VirtualHost *:80>
    ServerName gleaptracker.example.com

    ProxyPreserveHost On
    ProxyPass / http://localhost:3005/
    ProxyPassReverse / http://localhost:3005/

    ErrorLog ${APACHE_LOG_DIR}/gleaptracker.error.log
    CustomLog ${APACHE_LOG_DIR}/gleaptracker.access.log combined
</VirtualHost>
```

Enable the site and reload:

```bash
sudo a2ensite gleaptracker.example.com.conf
sudo systemctl reload apache2
```

Add HTTPS with Certbot:

```bash
sudo certbot --apache -d gleaptracker.example.com
```

Certbot will automatically add the HTTPS virtual host and redirect HTTP → HTTPS.

---

## Project Structure

```
gleaptracker/
├── gleaptracker.config.ts       # All non-secret configuration
├── vitest.config.mts            # Unit test runner (`pnpm test`)
├── .env.local                   # Secrets (gitignored)
├── .env.local.example
├── src/
│   ├── server.ts                # Express app entry (routes + morgan + cron)
│   ├── types/config.ts          # Types for gleaptracker.config.ts
│   ├── jobs/                    # In-process node-cron (daily no-reply follow-up)
│   ├── handlers/                # Webhook / Slack HTTP handlers
│   │   ├── gleapWebhook/
│   │   ├── githubWebhook.ts
│   │   ├── linearWebhook.ts
│   │   ├── jiraWebhook.ts
│   │   └── slack.ts
│   └── integrations/
│       ├── gleap/{client.ts,close.ts,tracker.ts,…}
│       ├── slack/{client.ts,blocks.ts}
│       └── commits.ts
│   # colocated `*.test.ts` files — mocked Slack / Gleap / GitHub, no network
│       ├── linear/client.ts
│       └── jira/client.ts
```

---

## HTTP routes

| Method | Path                            | Body                                   |
| ------ | ------------------------------- | -------------------------------------- |
| POST   | `/api/webhooks/gleap`           | JSON                                   |
| POST   | `/api/webhooks/github`          | raw JSON (`X-Hub-Signature-256`)       |
| POST   | `/api/webhooks/linear`          | raw JSON (signature)                   |
| POST   | `/api/webhooks/jira?secret=...` | JSON                                   |
| POST   | `/api/slack`                    | raw (Slack URL-encoded or JSON events) |
| GET    | `/health`                       | -                                      |

---

## License

MIT
