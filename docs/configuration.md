# Configuration

Copy `.env.local.example` to `.env.local`. Process environment variables take precedence over the file; `.env.local` takes precedence over `.env`. Environment loading happens before the configuration module evaluates, including with `pnpm dev`. Tests do not load local environment files.

All settings remain editable in `gleaptracker.config.ts`; the typed configuration is in `src/types/config.ts`. Never commit credentials or real customer payloads.

## Gleap custom fields

Create text fields using these exact keys on the tracker board:

| Fields | Purpose |
| --- | --- |
| `slack_thread`, `slack_thread_ts` | Slack permalink and root message timestamp |
| `primary_ticket_id`, `slack_notified_ids` | Primary customer ID and already-announced customer IDs |
| `close_processed`, `close_silent` | Close bookkeeping, stored as `true`/`false` strings |
| `linearIssueId`, `linearIssueUuid`, `linearIssueUrl` | Linear issue identifier, immutable ID, and URL, when enabled |
| `jiraIssueId`, `jiraIssueInternalId`, `jiraIssueUrl` | Jira key, immutable ID, and URL, when enabled |

On customer boards, add the relevant provider fields plus `issueId` and `issueUrl` for the primary engineering issue. These generic fields remain supported for compatibility.

When enabling follow-ups, add `noreply_followup_workflow_sent_at` and `noreply_close_workflow_sent_at` on customer boards. Older `noreply_followup_sent_at` and `noreply_close_sent_at` values continue to be recognized.

The tracker owns the Slack thread. Do not move its thread fields to a customer ticket. Linking changes a customer from `OPEN` to `INPROGRESS` only; any other status is preserved. Tracker types are corrected to `GLEAP_TRACKER_TICKET_TYPE` (default `FOR-RELEASE`).

## Slack setup

Create a Slack app and install its bot in your workspace. Set `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, and `SLACK_CHANNEL_ID`, then invite the bot to that channel.

Enable Interactivity at `/api/slack`. For `g:note`, enable Event Subscriptions at the same URL and subscribe to `message.channels`; private channels use `message.groups` instead.

The app posts and edits messages (`chat:write`), reads thread roots (`channels:history`, or `groups:history` for private channels), and reads/writes message metadata containing the tracker ID. Preserve the existing app's metadata permissions; when creating an app, configure message metadata access in its manifest as required by your Slack app configuration. Do not silently strip metadata to work around a permissions error: `g:note` relies on it. Reinstall the app after changing permissions.

There is no `conversations:history` OAuth scope; use the channel-type scopes above. See Slack's [thread retrieval](https://docs.slack.dev/reference/methods/conversations.replies/) and [message metadata](https://docs.slack.dev/messaging/message-metadata/) documentation for current requirements.

The root card shows a single customer's email when there is one report, or ticket links without emails when several reports are grouped. **Open in Gleap** targets the customer for a single report and the tracker for multiple reports. Optional Linear/Jira buttons open their saved issue URLs. Closing or reopening updates the existing card rather than starting another thread.

## Customer notifications

`GLEAP_CLOSE_WORKFLOW_ID` takes priority over `GLEAP_BUG_FIXED_MESSAGE` when the caller does not provide custom text. Configure either a workflow or a default message according to your support process. An explicitly empty `GLEAP_BUG_FIXED_MESSAGE` disables the default message.

The Slack Close modal is prefilled with the default message. Submitting text sends it to linked customers. Clearing the text closes silently. Direct Gleap Done events are always silent. GitHub, Linear, and Jira completion paths use the configured workflow or message.

## Optional no-reply automation

New installs leave `FOLLOWUP_CRON=off`. To enable it, create and publish three Gleap workflows, with automatic triggers disabled, and set their IDs:

```dotenv
FOLLOWUP_CRON=0 8 * * *
FOLLOWUP_TZ=UTC
FOLLOWUP_AFTER_DAYS=3
FOLLOWUP_CLOSE_AFTER_DAYS=7
FOLLOWUP_BUG_FOLLOWUP_WORKFLOW_ID=your-bug-followup-workflow
FOLLOWUP_BUG_CLOSE_WORKFLOW_ID=your-bug-close-workflow
FOLLOWUP_INQUIRY_CLOSE_WORKFLOW_ID=your-inquiry-close-workflow
```

The schedule runs in the same Node process. BUG tickets get a first nudge after three days and a close workflow after seven; INQUIRY tickets only get the close workflow. The clock starts from the last human agent reply, not an AI greeting. A newer customer reply or an active linked tracker suppresses automation. The job rechecks the conversation before invoking a workflow.

Gleap workflows own customer copy and status changes. Do not also enable a Gleap-native no-reply automation for the same tickets. The service retains existing processed flags. Because flags are written before invoking workflows, inspect the flag and provider delivery before retrying a failed workflow; this is not a transactional queue.

Existing parked lanes can be excluded with `GLEAP_ON_SLACK_BUG_STATUS`, `GLEAP_ON_SLACK_INQUIRY_STATUS`, and `GLEAP_WAITING_STATUS`. These are internal status IDs, not display names. The integration never assigns these lanes when linking tickets.

Run a single process. Missing workflow IDs prevent scheduling and produce a configuration error in logs; other webhook routes remain available. Cron values `off`, `false`, and `disabled` all disable scheduling.

## HTTP routes

| Method | Route | Authentication / parser |
| --- | --- | --- |
| GET | `/health` | Public health check |
| POST | `/api/webhooks/gleap` | JSON; optional configured Bearer/query shared secret |
| POST | `/api/slack` | Raw JSON/form body; Slack signature and timestamp |
| POST | `/api/webhooks/github` | Raw JSON; GitHub `X-Hub-Signature-256` |
| POST | `/api/webhooks/linear` | Raw JSON; Linear signature and signed timestamp |
| POST | `/api/webhooks/jira` | Raw JSON; native Jira signature or legacy shared secret |

The application omits query strings from access logs. Configure the same policy on your HTTPS proxy when using legacy secret URLs. Keep `/health` available to monitoring without including configuration or credentials in the response.
