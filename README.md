# GleapTracker

An **Express** (Node.js) service that connects **Gleap** (customer support) with **Slack** and your issue tracker (**Linear** and/or **Jira**). When a support ticket needs dev attention, it flows through Slack for team review and automatically creates a tracked issue.

---

## Workflow

Click to watch the demo on YouTube:

[![Watch the demo](https://img.youtube.com/vi/Vpwf07QsIrI/maxresdefault.jpg)](https://youtu.be/Vpwf07QsIrI)

```
Customer reports bug in Gleap
         │
         ▼
Agent applies a template "Send to Slack" on Gleap
The template adds a message "..." and sets ticket status → ONSLACK.
Special status "ONSLACK" allows agents seeing which tickets are "on pause"
and also it prevents Gleap bot from automatically closing them.
         │
         ▼
GleapTracker > Slack API: add message to #gleap-tickets channel on Slack.
Developers and agents discuss it in a nested thread.
At the bottom of the message there are 3 buttons:
  ┌──────────────────────────────┐
  │  `#12345`  *Ticket title*    │
  │  Customer Name / email       │
  │  [Confirm] [Reject] [Gleap↗] │
  └──────────────────────────────┘
         │
         |
Once devs get enough information, they click "Confirm" or "Reject" in the original message:
         |
    ┌────┴─────┐
    ▼          ▼
Confirm      Reject
    │          │
    │          └─ 1. A modal is shown on Slack, asking to enter
    |             the reason of the rejection;
    |             2. GleapTracker > Gleap API: Note with the reason added to Gleap ticket
    |             4. GleapTracker > Gleap API: Ticket status set to INPROGRESS
    |             5. Support agent resumes conversation with the customer
    |             6. GleapTracker > Slack API: Add "❌ Rejected" status to initial thread message
    |             7. GleapTracker > Slack API: add comment to the thread: "❌ Rejected: <Reason>"
    │
    ▼
A modal is shown on Slack, asking to enter a title of a new tracker ticket on Gleap,
or pick up an existing tracker ticket from a drop-down
         |
    ┌────┴──────────────────────────────────────────────┐
    ▼                                                   ▼
New Tracker ticket                      Connect to existing Tracker ticket
    |                                                   │
    |                                                   ▼
"Tracker ticket" created in Gleap,      Send request to Gleap API: connect
with <GleapTackerBugId>, on the         current ticket to the selected tracker ticket ID
FOR-RELEASE board                                       |
    └───────────────┬───────────────────────────────────┘
                    │
                    ▼
        Get <GlearTrackerTicketBugId>
                    │
                    ▼
GleapTracker > Slack API: Add "⏳ Confirmed" label on the Slack thread initial message
(so it's visible when you scroll messages on the channel)
    │
    ▼
GleapTracker > Slack API: add message in the thread:
"⏳ Confirmed, will be fixed soon. Open in Gleap: <TicketUrl>"
- so suppot agents sees an update notification
    │
    ▼
GleapTracker sends a request to Linear/Jira API - to ceate an issue:
________________________________________________
Title: [<GleapTackerBugId>] <GleapTicketTitle>
Description: "Open in Gleap: <GleapTicketUl>"
________________________________________________
    │
    ▼
GleapTracker > Gleap API: for the customer's ticket, set status to "Waiting for update"
This special ticket status helps prevent the bot from automatically closing those tickets
when there's no reply from the customer for >7 days; also it helps putting aside tickets
that at the moment don't need any attention.
    │
    ▼
Once the bug is confirmed, developers create a bugfix/... branch and start working on it.
Commit that fixes the issue can contain "Fixes: <ISSUE-ID>" in its commit message
    |
    ▼
Devs git push commit to master, upload .zip to license server, push master to remote git
    │
    ▼
Linear/Jira track commits with "Fixes ..." on the master branch.
When they see it, the issue gets automatically closed
    │
    ▼
Linear/Jira > GleapTracker Webhook (issue:updated)
    │
    ▼
Linear/Jira issue title parsed to get <GlearTrackerTicketBugId>
    │
    ▼
GleapTracker > Gleap API: get tracker ticket with <GlearTrackerTicketBugId>
Tracker Ticket contains `string[]` array of IDs of linked tickets on Gleap
    │
    ▼
GleapTracker > Gleap API: run a workflow for each of the linked tickets.
The worklow sends a message to the customer (you can set yours on Gleap)
Example:
________________________________________________
Thank you for your patience. We've fixed the bug
and released a new version. Please update the
plugin to the latest version.

We’re closing the ticket. Feel free to reply to
reopen it if the issue persists. If you have any
other questions, please open a new ticket 🙂
________________________________________________
    │
    ▼
`GleapTracker > Gleap API`: update tracker ticket, set status=`DONE`
    │
    ▼
When tracker ticket is closed, Gleap automatically closes all linked tickets.
    │
    ▼
GleapTracker > Slack API: Add "✅ Closed" label on the Slack thread initial message
(so it's visible when you scroll messages on the channel)
    │
    ▼
GleapTracker > Slack API: Add "✅ Closed" message in the thread,
so suppot agents see an update notification
    │
    ▼
EXTRA: If customer replies back saying that the issue wasn't fixed for them
Support agent changes ticket status to "In progress" on Gleap, and asks for more details
If support agent is able to resolve on their own, they do it and change ticket status to "Done".
If support agent need dev help again: they manually change status to "On slack" -
Gleap ticket already has Slack Thread ID and Slack Thread URL
    │
    ▼
Gleap > GleapTracker webhook (ticket:updated)
    │
    ▼
GleapTracker checks if the ticket has "On Slack" status
and if Slack Thread ID is already set; if true, then:
    │
    ▼
GleapTracker > Slack API: update initial thread message,
change status from "✅ Closed" to "🔄 Reopened"
GleapTracker > Slack API: add message to the thread: "🔄 Reopened"
(so developer who worked on the ticket gets notified)
    │
    ▼
When issue is resolved, support agent changes ticket status on Gleap to "Done"
Status on Slack thread message changes to "✅ Closed" again
```

## Adding internal notes to Gleap ticket from Slack thread

Inside any ticket thread on Slack, team members can post an internal note directly to the linked Gleap ticket by including `g:note` anywhere in their message:

```
g:note Customer confirmed they're on v3.2, still reproducible
```

GleapTracker strips the `g:note` tag and adds the rest of the message as an internal note on the Gleap ticket (visible to agents only, not the customer). Useful for capturing context from Slack discussions without switching to Gleap.

---

## Prerequisites

- Node.js 18+
- pnpm
- A [Gleap](https://gleap.io) account with API access
- A [Slack App](https://api.slack.com/apps) with the scopes below
- A [Linear](https://linear.app) workspace and/or [Jira](https://www.atlassian.com/software/jira) project

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

Edit `gleaptracker.ts` in the project root. This file controls all non-secret settings:

| Field                     | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `gleap.workflowId`        | Gleap workflow ID run on linked tickets when issue is closed  |
| `gleap.trackerTicketType` | Type used for tracker tickets (default: `FOR-RELEASE`)        |
| `gleap.onSlackStatus`     | Status value that triggers posting to Slack                   |
| `gleap.waitingStatus`     | Status applied to linked tickets while fix is pending         |
| `issueTracker`            | `"linear"` \| `"jira"` \| `"both"`                            |
| `linear.teamId`           | Your Linear team ID                                           |
| `linear.labelIds`         | Label IDs applied to created Linear issues                    |
| `linear.stateId`          | Initial state ID for new Linear issues (e.g. "Todo")          |
| `linear.trackerLabel`     | Label name identifying Gleap-linked issues in Linear webhooks |
| `jira.host`               | Your Jira hostname, e.g. `yourteam.atlassian.net`             |
| `jira.projectKey`         | Jira project key, e.g. `MAP`                                  |
| `jira.issueType`          | Issue type name, e.g. `Bug`                                   |
| `jira.doneStatusName`     | Jira status name that means "done", e.g. `Done`               |

#### Finding Gleap status IDs

Several fields in `gleaptracker.ts` require internal Gleap status IDs (e.g. `"cz2qz"`) rather than the human-readable names shown in the UI (`"On Slack"`). To find them:

1. Open your Gleap project → **Bugs**
2. Open the browser DevTools → **Network** tab
3. Reload the page or click on a status to edit it
4. Find the API request to `appapi.gleap.io/v3/tickets?type=...` the "type" contains the string you need
5. Alternatively: open any ticket in Gleap and change its status while watching the Network tab — the PATCH/PUT request body will contain the raw status ID

Fields that need these IDs:

| Field                 | What it maps to in Gleap                          |
| --------------------- | ------------------------------------------------- |
| `gleap.onSlackStatus` | Your custom "Send to Slack" / "On Slack" status   |
| `gleap.waitingStatus` | Your "Waiting for Update" status                  |
| `gleap.doneStatus`    | Your "Done / Closed" status (often just `"DONE"`) |

### 4. Gleap workspace setup

Before the integration can work, a few things need to be configured in Gleap itself.

#### Custom ticket statuses

Go to **Gleap → Settings → Ticket statuses** and create two custom statuses:

| Purpose                                     | Suggested name                  | Used in config        |
| ------------------------------------------- | ------------------------------- | --------------------- |
| Ticket sent to Slack, awaiting dev decision | "On Slack" (any name)           | `gleap.onSlackStatus` |
| Bug confirmed, fix in progress              | "Waiting for Update" (any name) | `gleap.waitingStatus` |

These must be **custom** statuses (not the built-in ones) because Gleap's workflows that automatically close tickets without reply only trigger for "Open"/"In progress" statuses — custom statuses are excluded from automatic closing. This means tickets sitting in "On Slack" or "Waiting for Update" won't get auto-closed while the team is working on them.

See [Finding Gleap status IDs](#finding-gleap-status-ids) below to get the raw ID strings to put in `gleaptracker.config.ts`.

#### Follow-up workflows

Gleap can automatically follow up with customers who haven't replied after an agent response. Set up two workflows under **Gleap → Automations → Workflows**:

- **3-day follow-up**: trigger when no customer reply 3 days after agent reply, for tickets in `OPEN` or `INPROGRESS` status
- **5-day follow-up / close**: trigger when no customer reply 5 days after agent reply, same statuses, closes the ticket.

Make sure these workflows target **only** `OPEN` and `INPROGRESS` — do **not** include your custom "On Slack" or "Waiting for Update" statuses. Tickets in those statuses are intentionally on hold and should not receive follow-ups.

#### "Send to Slack" message template

In **Gleap → Settings → Message templates**, create a new template (e.g. "Send to Slack") that:

1. Sends a message to the customer, e.g.:
   > We've received your report and our team is reviewing it. We'll get back to you soon!
2. Changes the ticket status to your custom "On Slack" status

Support agents apply this template when a ticket needs dev attention. GleapTracker detects the status change via webhook and automatically posts the ticket to Slack.

#### Tracker ticket board

Tracker tickets (created when a dev confirms a bug) are internal-only and not meant to be opened or managed by support agents — they exist purely for automation. It's recommended to create a **dedicated board** in Gleap (e.g. "Trackers" or "For Release") to keep them out of the regular support queue.

In `gleaptracker.config.ts`, set `gleap.trackerTicketType` to the type/board name you created (default is `"FOR-RELEASE"`).

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

This enables the `g:note` feature — type `g:note your note text` in any ticket thread to add an internal note to the linked Gleap ticket.

#### Install the app

After setting up scopes, install the app to your workspace. Copy the **Bot User OAuth Token** to `SLACK_BOT_TOKEN` and the **Signing Secret** to `SLACK_SIGNING_SECRET` in `.env.local`.

### 6. Gleap Webhook

In Gleap: **Settings → Integrations → Webhooks → Add Webhook**

- URL: `https://your-domain/api/webhooks/gleap`
- Events: `ticket.created`, `ticket.updated`

### 7. Linear Webhook

In Linear: **Settings → API → Webhooks → New Webhook**

- URL: `https://your-domain/api/webhooks/linear`
- Data change events: **Issue**
- Copy the signing secret to `LINEAR_WEBHOOK_SECRET` in `.env.local`

The webhook fires when an issue is marked Done. GleapTracker looks for issues with the `gleap-tracker-ticket` label (configurable in `gleaptracker.config.ts`) and a title matching `[bugId] Title`.

### 8. Jira Webhook

In Jira: **Settings → System → WebHooks → Create a WebHook**

- URL: `https://your-domain/api/webhooks/jira?secret=<your JIRA_WEBHOOK_SECRET>`
- Events: **Issue → updated**

The webhook fires on every issue update. GleapTracker filters for status transitions to your configured `doneStatusName` and issues with a title matching `[bugId] Title`.

---

## Project Structure

```
gleaptracker/
├── gleaptracker.ts              # All non-secret configuration
├── .env.local                   # Secrets (gitignored)
├── .env.local.example
├── src/
│   ├── server.ts                # Express app entry (routes + morgan)
│   ├── types/config.ts          # Types for gleaptracker.ts
│   ├── handlers/                # Webhook / Slack HTTP handlers
│   │   ├── gleapWebhook.ts
│   │   ├── linearWebhook.ts
│   │   ├── jiraWebhook.ts
│   │   └── slack.ts
│   └── integrations/
│       ├── gleap/{client.ts,tracker.ts}
│       ├── slack/client.ts
│       ├── linear/client.ts
│       └── jira/client.ts
```

HTTP routes (same paths as before, for easy migration):

| Method | Path                            | Body                                   |
| ------ | ------------------------------- | -------------------------------------- |
| POST   | `/api/webhooks/gleap`           | JSON                                   |
| POST   | `/api/webhooks/linear`          | raw JSON (signature)                   |
| POST   | `/api/webhooks/jira?secret=...` | JSON                                   |
| POST   | `/api/slack`                    | raw (Slack URL-encoded or JSON events) |
| GET    | `/health`                       | —                                      |

---

## Run locally

```bash
pnpm dev
```

This starts Express on port **3000** (override with `PORT=3001 pnpm dev`).

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

- **`node_args: "-r dotenv/config"`** — preloads dotenv before any module is imported, so `.env.local` is read before `gleaptracker.ts` evaluates `process.env.*`
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
pnpm reload:pm2  # restart after code change
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

## License

MIT
