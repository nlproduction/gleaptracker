# Upgrading an existing installation

The Gleap/Slack workflow, commit convention, default `master` close branch, silent Gleap Done handling, Slack modal behavior, and persisted ticket-field names are retained. Linear and Jira issue creation remains opt-in: `ISSUE_TRACKER=none` is the default.

## Preserve deployment-specific configuration

Earlier versions included one workspace's Linear team/label/state IDs, custom Gleap status IDs, and follow-up workflow IDs directly in `gleaptracker.config.ts`. The public version does not use those IDs as defaults. It also ships a product-neutral default customer message.

**Before upgrading**, keep a private copy of your customized configuration and build the previous revision so its effective non-secret settings can be exported:

```bash
# In the previous checkout, with the previous configuration:
pnpm build
# Now update the source, but do not rebuild or restart yet.
git pull --ff-only
pnpm config:export-previous
```

The export command reads the previous `dist/gleaptracker.config.js` and writes a new, gitignored `.env.migration` file with restrictive permissions. It does not print values, overwrite an existing export, change `.env.local`, or restart the service. Review it and merge the settings into your existing `.env.local`, preserving your credentials. Do not commit either file.

If the previous build is unavailable, copy values from your saved configuration using this mapping:

| Previous configuration | Environment variable |
| --- | --- |
| `issueTracker` | `ISSUE_TRACKER` |
| `gleap.trackerTicketType`, `gleap.doneStatus` | `GLEAP_TRACKER_TICKET_TYPE`, `GLEAP_DONE_STATUS` |
| `gleap.onSlackStatuses.BUG`, `.INQUIRY` | `GLEAP_ON_SLACK_BUG_STATUS`, `GLEAP_ON_SLACK_INQUIRY_STATUS` |
| `gleap.waitingStatus` | `GLEAP_WAITING_STATUS` |
| `gleap.workflowId`, `gleap.bugFixedMessage` | `GLEAP_CLOSE_WORKFLOW_ID`, `GLEAP_BUG_FIXED_MESSAGE` |
| `linear.teamId`, `.labelIds`, `.stateId` | `LINEAR_TEAM_ID`, `LINEAR_LABEL_IDS` (comma-separated), `LINEAR_STATE_ID` |
| `linear.trackerLabel` | `LINEAR_TRACKER_LABEL` |
| `github.closeBranches` | `GITHUB_CLOSE_BRANCHES` (comma-separated) |
| `followUp.cron`, `.timezone` | `FOLLOWUP_CRON`, `FOLLOWUP_TZ` |
| `followUp.followUpAfterDays`, `.closeAfterDays` | `FOLLOWUP_AFTER_DAYS`, `FOLLOWUP_CLOSE_AFTER_DAYS` |
| `followUp.workflows.bugFollowUp` | `FOLLOWUP_BUG_FOLLOWUP_WORKFLOW_ID` |
| `followUp.workflows.bugClose` | `FOLLOWUP_BUG_CLOSE_WORKFLOW_ID` |
| `followUp.workflows.inquiryClose` | `FOLLOWUP_INQUIRY_CLOSE_WORKFLOW_ID` |

Do not overwrite an existing `.env.local` with the example file. Keep any additional code-level configuration customizations when resolving changes. Without configured workflow IDs, no-reply automation will not be scheduled; webhook processing continues.

## Optional provider activation

Set `ISSUE_TRACKER=linear`, `jira`, or `both` only after configuring the corresponding API credentials, project/team, webhook signing secret, and custom fields. Open trackers encountered on subsequent events may acquire new engineering issues. Existing `linearIssueId` and `jiraIssueId` values are reused rather than recreated. Existing generic customer `issueId`/`issueUrl` fields are not overwritten.

New immutable identity fields are `linearIssueUuid` and `jiraIssueInternalId`. Add those custom fields, plus the provider URLs, before enabling creation. New descriptions contain a stable tracker marker; preserve it when renaming issues.

## Webhooks

Existing Jira `?secret=...` URLs remain supported. An empty secret is no longer accepted. Native signed Jira webhooks are recommended. Linear webhooks must include the signed `webhookTimestamp` that Linear sends; custom replay tools must generate a fresh timestamp and valid signature.

Unsigned Gleap webhooks remain supported for existing deployments. Restrict network ingress or configure `GLEAP_WEBHOOK_SECRET` before exposing the endpoint publicly. The service logs a warning when no secret is configured.

## Validate and restart

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm reload:pm2
```

Check `/health`, then exercise one staging tracker through linking, Slack notes, silent close, reopening, and the provider completion path you enable. The repository test suite uses mocks and cannot validate your workspace-specific permissions or workflows.
