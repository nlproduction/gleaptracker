# Linear and Jira

Both integrations use the same lifecycle: a Gleap tracker creates an engineering issue, the issue link is persisted, and a completion webhook closes the Gleap tracker through the existing customer-notification pipeline.

Enable a provider with `ISSUE_TRACKER=linear`, `jira`, or `both`. `none` disables new issue creation without disabling previously configured completion webhooks.

## Linear

Set these environment variables:

```dotenv
ISSUE_TRACKER=linear
LINEAR_API_KEY=your-api-key
LINEAR_TEAM_ID=your-team-uuid
LINEAR_WEBHOOK_SECRET=your-webhook-signing-secret
# Optional:
# LINEAR_LABEL_IDS=label-uuid-1,label-uuid-2
# LINEAR_STATE_ID=initial-workflow-state-uuid
```

The API key must be able to create issues in the selected team. Team, label, and state values are internal IDs, not their display names. Leave `LINEAR_STATE_ID` empty to use Linear's default state; labels are optional for newly created issues.

In Linear's API settings, create a webhook for **Issue** events for the relevant team:

```text
https://your-domain.example/api/webhooks/linear
```

Copy that webhook's signing secret to `LINEAR_WEBHOOK_SECRET`. GleapTracker verifies the raw-body `Linear-Signature` and the signed `webhookTimestamp` within a 60-second window; keep the server clock synchronized. Completion means `state.type === "completed"`, not cancellation. Updates with `updatedFrom` that do not include `stateId` are ignored.

New issues include the tracker description, a Gleap link, and this stable marker:

```text
Gleap tracker: Gleap-1234
```

Keep the marker when editing a description. It lets the integration recognize a renamed issue. The stored issue UUID/identifier must still match before a tracker is closed. Older `[1234] Title` issues remain supported; when no stored identity exists, the legacy `gleap-tracker-ticket` label is required (`LINEAR_TRACKER_LABEL` can override it).

## Jira Cloud

Set:

```dotenv
ISSUE_TRACKER=jira
JIRA_HOST=your-team.atlassian.net
JIRA_PROJECT_KEY=DEMO
JIRA_EMAIL=your-account-email
JIRA_API_TOKEN=your-api-token
JIRA_WEBHOOK_SECRET=your-webhook-secret
JIRA_ISSUE_TYPE=Bug
JIRA_DONE_STATUS=Done
```

`JIRA_HOST` accepts a hostname or HTTPS origin, with an optional trailing slash. It must not contain a path, query, or credentials. The integration uses Jira Cloud REST API v3 and Basic authentication with your account email and API token. Jira Data Center and alternate authentication schemes are not implemented.

Your account needs permission to create the configured issue type in that project. Projects with required custom fields can use `jira.additionalFields` in `gleaptracker.config.ts`:

```ts
additionalFields: {
  customfield_10001: "your-required-value",
  priority: { name: "Medium" },
},
```

These fields cannot override the integration's project, summary, description, issue type, or labels. Use `JIRA_LABELS=customer-reported,support` for additional labels. Every new issue also receives `gleap-<bugId>` and an Atlassian Document Format description with context and a stable tracker marker.

### Native signed webhooks (recommended)

Create a Jira admin webhook for **Issue updated**, scoped to the configured project, at:

```text
https://your-domain.example/api/webhooks/jira
```

Set its webhook **secret** to `JIRA_WEBHOOK_SECRET`. GleapTracker validates the `X-Hub-Signature: sha256=<digest>` header against the original request bytes. Ensure your reverse proxy preserves that header and body.

### Existing secret-URL webhooks

The previous URL format continues to work:

```text
https://your-domain.example/api/webhooks/jira?secret=<JIRA_WEBHOOK_SECRET>
```

Senders such as automation rules may alternatively use `X-Gleaptracker-Secret`. Empty secrets are always rejected. A request containing an invalid native signature is rejected even when it also supplies a correct legacy secret. Prefer native signatures and remove secret query strings from reverse-proxy/access logs.

### Completion statuses and renamed issues

The handler requires an actual status change in the changelog and a matching project. Set `JIRA_DONE_STATUS=Released` for a single alternative, or `JIRA_DONE_STATUSES=Done,Released` for several; a nonempty list overrides the singular setting.

Keep the `Gleap tracker: Gleap-1234` description marker or the `gleap-1234` label when renaming an issue. Stored Jira IDs/keys are checked to avoid closing a different tracker. Existing `[1234] Title` issues also work.

## State and recovery

Configure the [custom fields](configuration.md#gleap-custom-fields) on tracker and customer boards. The tracker stores both a human issue identifier and a provider's immutable issue ID. Existing `linearIssueId`, `jiraIssueId`, `issueId`, and URL fields are preserved.

In `both` mode, each provider is attempted independently. A successful provider link is saved before the other provider is retried. A small process-local recovery cache also retains newly created issue IDs when Gleap rejects the link write. It is not durable across a restart. No API calls are made to live workspaces by the unit tests.

Issue titles and descriptions are copied on creation, not continuously mirrored. Do not remove linkage fields as a way to refresh an existing issue: that can create a duplicate. To recover an unlinked issue after a crash, restore its existing identifier, ID, and URL in the tracker's custom fields.

## Provider references

- [Linear webhook payloads, signatures, timestamps, and retries](https://linear.app/developers/webhooks)
- [Jira Cloud webhooks and secret-token signing](https://developer.atlassian.com/cloud/jira/platform/webhooks/)
- [Jira Cloud issue creation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post)
