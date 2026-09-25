#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" })
require("dotenv").config()

try {
  const source = path.resolve(process.argv[2] || "dist/gleaptracker.config.js")
  const output = path.resolve(process.argv[3] || ".env.migration")
  if (!fs.existsSync(source)) throw new Error("Previous compiled configuration not found. Build the old revision before upgrading, or use docs/upgrading.md.")
  const config = require(source).default
  if (!config?.gleap || !config?.followUp) throw new Error("Not a GleapTracker configuration module")
  const values = {
    ISSUE_TRACKER: config.issueTracker,
    GLEAP_TRACKER_TICKET_TYPE: config.gleap.trackerTicketType,
    GLEAP_DONE_STATUS: config.gleap.doneStatus,
    GLEAP_ON_SLACK_BUG_STATUS: config.gleap.onSlackStatuses?.BUG,
    GLEAP_ON_SLACK_INQUIRY_STATUS: config.gleap.onSlackStatuses?.INQUIRY,
    GLEAP_WAITING_STATUS: config.gleap.waitingStatus,
    GLEAP_CLOSE_WORKFLOW_ID: config.gleap.workflowId,
    GLEAP_BUG_FIXED_MESSAGE: config.gleap.bugFixedMessage,
    LINEAR_TEAM_ID: config.linear?.teamId,
    LINEAR_LABEL_IDS: config.linear?.labelIds?.join(","),
    LINEAR_STATE_ID: config.linear?.stateId,
    LINEAR_TRACKER_LABEL: config.linear?.trackerLabel,
    JIRA_HOST: config.jira?.host,
    JIRA_PROJECT_KEY: config.jira?.projectKey,
    JIRA_ISSUE_TYPE: config.jira?.issueType,
    JIRA_DONE_STATUS: config.jira?.doneStatusName,
    GITHUB_CLOSE_BRANCHES: config.github?.closeBranches?.join(","),
    FOLLOWUP_CRON: config.followUp.cron,
    FOLLOWUP_TZ: config.followUp.timezone,
    FOLLOWUP_AFTER_DAYS: config.followUp.followUpAfterDays,
    FOLLOWUP_CLOSE_AFTER_DAYS: config.followUp.closeAfterDays,
    FOLLOWUP_BUG_FOLLOWUP_WORKFLOW_ID: config.followUp.workflows?.bugFollowUp,
    FOLLOWUP_BUG_CLOSE_WORKFLOW_ID: config.followUp.workflows?.bugClose,
    FOLLOWUP_INQUIRY_CLOSE_WORKFLOW_ID: config.followUp.workflows?.inquiryClose,
  }
  const lines = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
  fs.writeFileSync(output, "# Previous non-secret settings. Review and merge into .env.local.\n" + lines.join("\n") + "\n", { flag: "wx", mode: 0o600 })
  console.log(`Exported ${lines.length} non-secret settings to ${output}. Existing environment and running services were not changed.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : "Configuration export failed")
  process.exitCode = 1
}
