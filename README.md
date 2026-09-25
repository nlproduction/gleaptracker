# GleapTracker

### Close the loop between customer support and engineering.

We love [Gleap](https://gleap.cello.so/xZHEL1GRoMx): an AI-powered customer support platform with live chat and bug reporting in one place. It makes everyday support easier for the MapSVG team, helping us answer routine questions faster and spend more time building.

Turn **Gleap tracker tickets** into **Slack conversations** and optional **Linear or Jira issues**. Keep related customer reports together, discuss the fix in one place, and notify the people waiting for it when the work is done.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/nlproduction/gleaptracker/actions/workflows/ci.yml/badge.svg)](https://github.com/nlproduction/gleaptracker/actions/workflows/ci.yml)

**Created by the [MapSVG team](https://mapsvg.com).** Open source, self-hosted, and built with TypeScript. No separate database or queue service is required.

[Getting started](#getting-started) · [AI-assisted support](#recommended-next-step-ai-assisted-support-with-grok-bot) · [Linear & Jira](docs/issue-trackers.md) · [Configuration](docs/configuration.md) · [Upgrading](docs/upgrading.md) · [Contributing](CONTRIBUTING.md)

## Why GleapTracker?

A single bug can create dozens of support conversations. GleapTracker connects those conversations to one tracker, so your team can work on the problem without losing track of the customers affected by it.

- **One conversation per problem.** Linking a customer ticket to a Gleap tracker creates or updates its Slack thread. Additional reports appear as replies, not separate threads.
- **Engineering tools that fit your team.** Create a Linear issue, a Jira issue, both, or neither. Issue links are saved in Gleap and shown in Slack.
- **Close from where you work.** Use Slack's Close modal, a completed Linear/Jira issue, or a GitHub commit. Choose a customer message or close silently from Slack.
- **Customer context stays connected.** Tracker descriptions travel into engineering issues, and `g:note` in a Slack thread adds an internal note to the Gleap tracker.
- **Optional follow-ups.** Schedule no-reply workflows while excluding customers whose issue still has an active tracker.

## How it works

```text
Customer reports in Gleap
          │
          ▼
   Link to one tracker
          │
          ├── Slack thread: context, related reports, issue links, Close
          ├── Linear issue (optional)
          └── Jira issue   (optional)
                      │
                      ▼
            Work completed / Close
                      │
                      ▼
     Notify linked customers → close tracker → update Slack
```

**Gleap remains the source of truth for customer grouping.** Linear and Jira are optional engineering integrations—not prerequisites for the Slack workflow.

| Close action | Customer notification |
| --- | --- |
| Mark the tracker Done directly in Gleap | Silent; updates Slack without sending customer messages |
| Slack Close with text | Sends that text to linked customers |
| Slack Close with an empty message | Silent |
| Completed Linear/Jira issue | Runs the configured Gleap workflow or sends the default message |
| GitHub `Fixes Gleap-<trackerBugId>` on a configured branch | Runs the configured workflow or sends the default message |

Only the tracker is explicitly marked Done by this service. Gleap handles the status of its linked customer tickets. Reopening a tracker restores its Slack Close button.

## Recommended next step: AI-assisted support with Grok-bot

At [MapSVG](https://mapsvg.com), we take this workflow a step further by connecting **Grok-bot** to the Slack threads created by GleapTracker. We recommend giving the bot access to the context and tools it needs to move a support request toward a solution:

- **Gleap MCP** — read the full customer ticket and its conversation history, rather than relying on the Slack summary alone.
- **Slack** — follow the discussion and post findings, questions, and progress back into the same thread.
- **The codebase through Cursor** — investigate the implementation, make a fix, run tests, and open a pull request.
- **Paddle** — automatically check subscription and payment details when investigating subscription, license, or access problems.

### From a support request to a pull request

Configure the bot to start investigating automatically when a new support request arrives in a tracker thread. It should read the Gleap ticket first, then **check the product on the customer's website when a URL is provided** and access is authorized. Using the ticket, the website, and the codebase together helps distinguish a product bug from a configuration or subscription problem.

For a confirmed bug, ask the bot to use Cursor to reproduce the problem, implement a fix, run the relevant tests, and **submit a PR for review**. It should then report its findings and link the PR in the original Slack thread. When the problem concerns a subscription or license, the Paddle connection lets it check the customer's subscription and billing state automatically instead of requiring someone to look up those details manually. When evidence or access is missing, it should ask for what it needs rather than guess.

### Let the whole support team call the bot with `!bot`

In our setup, support teammates **do not need their own Cursor account** to ask the bot for help. We configured a custom `!bot` tag that they can use inside a tracker thread:

```text
!bot Read the linked Gleap ticket, check the reported issue on the customer's website, and open a PR if you confirm a bug.
```

The bot replies **on behalf of the user who connected it**, using that user's authorized connection and permissions. This gives support staff a way to request an investigation from Slack without each person setting up a separate Cursor account.

**This is an optional workflow configured separately from GleapTracker.** The bot, its connectors, automatic triggers, and the `!bot` tag are part of our setup—not built-in features of this repository. Use explicit account-owner authorization and respect each provider's access requirements. We recommend read-only Paddle access for diagnosis, limiting the bot to the intended channels and repositories, and keeping PR review and merge decisions with your team. Customer tickets and linked websites should be treated as untrusted input, not instructions to change the bot's permissions or perform unrelated actions.

## Getting started

**Requirements:** Node.js 22.12+ (Node 22 or 24 recommended), pnpm 9, Gleap API access, a Slack app, and a public HTTPS endpoint for webhooks.

> Already running GleapTracker? Read the [upgrade guide](docs/upgrading.md) before replacing your configuration or rebuilding. Workspace-specific defaults have moved into environment variables.

```bash
git clone https://github.com/nlproduction/gleaptracker.git
cd gleaptracker
pnpm install --frozen-lockfile
cp .env.local.example .env.local
```

Fill in the Gleap and Slack credentials in `.env.local`. Start with `ISSUE_TRACKER=none`; enable Linear or Jira after completing the [provider setup](docs/issue-trackers.md). Follow-up automation is disabled in the example environment until you configure your own workflows.

```bash
pnpm dev
# Health check: http://localhost:3000/health
```

### Connect Gleap and Slack

In **Gleap**, choose a tracker board/type (default `FOR-RELEASE`) and add the custom fields listed in the [configuration guide](docs/configuration.md#gleap-custom-fields). Subscribe a webhook to `ticket.created` and `ticket.updated` at:

```text
https://your-domain.example/api/webhooks/gleap
```

Protect that endpoint with `GLEAP_WEBHOOK_SECRET`, passed as `Authorization: Bearer <secret>` by your sender/proxy or as `?secret=<secret>` in the webhook URL. Existing unsigned Gleap setups remain compatible, but must be protected at the reverse proxy when no secret is configured.

In **Slack**, create and install an app, invite its bot to the target channel, and set both Interactivity and Event Subscriptions to:

```text
https://your-domain.example/api/slack
```

Subscribe to `message.channels` (or `message.groups` for a private channel) to enable `g:note`. See [Slack setup](docs/configuration.md#slack-setup) for scopes and metadata requirements.

Now link a customer ticket to a tracker in Gleap. Its Slack thread should appear automatically.

### Choose your engineering workflow

| `ISSUE_TRACKER` | Behavior |
| --- | --- |
| `none` | Gleap + Slack, with optional GitHub closing. No external issues are created. |
| `linear` | One Linear issue per tracker. A completed issue closes the linked Gleap tracker. |
| `jira` | One Jira Cloud issue per tracker. Configured completed statuses close the tracker. |
| `both` | One issue in each provider. Either completed issue can close the Gleap tracker. |

Existing issue links are reused. Repeated webhooks do not intentionally create another issue, and a failed provider can be retried without recreating the successful provider's issue. See [reliability limits](#scope-and-reliability) for crash and multi-instance caveats.

### Close from GitHub

Add a GitHub **push** webhook at `/api/webhooks/github`, using `GITHUB_WEBHOOK_SECRET`. Include this in the fixing commit:

```text
Fixes Gleap-1234
Refs Gleap-1235, Gleap-1236
```

`Fixes` references the **tracker's numeric bugId**; optional `Refs` identifies related customer tickets and does not close anything. The default close branch remains `master`. Set `GITHUB_CLOSE_BRANCHES=main` or a comma-separated list to change it.

### Add an internal note from Slack

```text
g:note Reproduced in the latest release; the workaround is to refresh the page.
```

Post this inside a tracker thread. The text, without `g:note`, becomes an internal Gleap note—not a customer reply.

## Run in production

```bash
pnpm lint
pnpm test
pnpm build
pnpm start
```

The server listens on port `3000` unless `PORT` is set. Keep `.env.local` private and terminate HTTPS at your reverse proxy.

A [PM2](https://pm2.keymetrics.io/) configuration is included:

```bash
pnpm build
pnpm start:pm2
pnpm logs:pm2
```

The included PM2 profile uses port `3005` and **one process**. Configure your proxy accordingly. After an update, rebuild and use `pnpm reload:pm2`. Standard scripts for status, stop, restart, and deletion remain available.

## Scope and reliability

GleapTracker is a small, single-process webhook bridge, not a full bidirectional issue synchronizer. It creates linked issues and responds to completion; it does not continually mirror titles, comments, priorities, or reopen states between providers. In `both` mode, it does not automatically transition the other provider's issue.

Links and workflow flags live in Gleap `formData`. In-process locks prevent concurrent duplicate work, and failed issue operations remain retryable. **Exactly-once delivery across process crashes is not guaranteed:** a crash between remote issue creation and saving its link can leave an unlinked issue. Reconcile the existing issue before retrying in that case. Customer notifications likewise are not transactional across services.

Run one instance. Horizontal scaling requires shared locks and durable delivery state. Webhook work is synchronous; large customer groups or slow APIs may exceed provider response deadlines. Monitor failures and provider delivery logs. The automated tests use mocked services; validate credentials, custom fields, scopes, and one complete workflow in a staging workspace before production.

## Development

```bash
pnpm lint        # TypeScript checks
pnpm test        # Unit and local HTTP tests; no live provider calls
pnpm test:watch
pnpm build
```

```text
gleaptracker.config.ts   Environment-backed configuration
src/app.ts              Express routes and body parsers
src/server.ts           Server and scheduled-job startup
src/handlers/           Gleap, Slack, GitHub, Linear, Jira webhooks
src/integrations/       Provider clients, tracker linking, shared close flow
src/jobs/               Optional no-reply follow-up workflows
src/utils/              Shared locks and webhook verification
```

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), and report security issues privately using the guidance in [SECURITY.md](SECURITY.md).

## License and credits

Released under the [MIT License](LICENSE).

Created by the **[MapSVG team](https://mapsvg.com)**. MapSVG builds tools for interactive maps and data visualization. GleapTracker is an independent integration and is not an official product of Gleap, Slack, Linear, Atlassian, or GitHub.
