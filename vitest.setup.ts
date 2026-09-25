/** Config evaluates during imports. Never inherit live workspace credentials. */
for (const key of Object.keys(process.env)) {
  if (/^(GLEAP_|SLACK_|LINEAR_|JIRA_|FOLLOWUP_|ISSUE_TRACKER$|GITHUB_(WEBHOOK_SECRET|CLOSE_BRANCHES)$)/.test(key)) {
    delete process.env[key]
  }
}
Object.assign(process.env, {
  GLEAP_PROJECT_ID: "test-project",
  GLEAP_API_KEY: "test-gleap-key",
  SLACK_CHANNEL_ID: "C123TEST",
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_SIGNING_SECRET: "slack-signing-secret",
  GITHUB_WEBHOOK_SECRET: "gh-webhook-secret",
  GITHUB_CLOSE_BRANCHES: "master",
  ISSUE_TRACKER: "none",
  LINEAR_API_KEY: "test-linear-key",
  LINEAR_WEBHOOK_SECRET: "linear-secret",
  JIRA_HOST: "example.atlassian.net",
  JIRA_PROJECT_KEY: "MAP",
  JIRA_EMAIL: "test@example.com",
  JIRA_API_TOKEN: "test-jira-key",
  JIRA_WEBHOOK_SECRET: "jira-secret",
  FOLLOWUP_BUG_FOLLOWUP_WORKFLOW_ID: "test-bug-followup",
  FOLLOWUP_BUG_CLOSE_WORKFLOW_ID: "test-bug-close",
  FOLLOWUP_INQUIRY_CLOSE_WORKFLOW_ID: "test-inquiry-close",
})
