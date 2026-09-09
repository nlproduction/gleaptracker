/**
 * Config is evaluated at import time. Seed deterministic env before any
 * `gleaptracker.config.ts` import so tests never hit live services.
 */
process.env.GLEAP_PROJECT_ID ??= "test-project"
process.env.GLEAP_API_KEY ??= "test-gleap-key"
process.env.SLACK_CHANNEL_ID ??= "C123TEST"
process.env.SLACK_BOT_TOKEN ??= "xoxb-test"
process.env.SLACK_SIGNING_SECRET ??= "slack-signing-secret"
process.env.GITHUB_WEBHOOK_SECRET ??= "gh-webhook-secret"
process.env.LINEAR_WEBHOOK_SECRET ??= "linear-secret"
process.env.JIRA_HOST ??= "example.atlassian.net"
process.env.JIRA_PROJECT_KEY ??= "MAP"
process.env.JIRA_WEBHOOK_SECRET ??= "jira-secret"
