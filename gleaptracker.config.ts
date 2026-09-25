import "./src/env"
import { parseEnvList, parseEnvNumber, type GleapTrackerConfig } from "./src/types/config"

const issueTracker = process.env.ISSUE_TRACKER || "none"
if (!["none", "linear", "jira", "both"].includes(issueTracker)) {
  throw new Error("ISSUE_TRACKER must be none, linear, jira, or both")
}

/** Non-secret settings can be customized here; credentials belong in .env.local. */
const config: GleapTrackerConfig = {
  gleap: {
    projectId: process.env.GLEAP_PROJECT_ID || "",
    trackerTicketType: process.env.GLEAP_TRACKER_TICKET_TYPE || "FOR-RELEASE",
    doneStatus: process.env.GLEAP_DONE_STATUS || "DONE",
    inProgressType: "INPROGRESS",
    onSlackStatuses: {
      BUG: process.env.GLEAP_ON_SLACK_BUG_STATUS || "",
      INQUIRY: process.env.GLEAP_ON_SLACK_INQUIRY_STATUS || "",
    },
    waitingStatus: process.env.GLEAP_WAITING_STATUS || "",
    workflowId: process.env.GLEAP_CLOSE_WORKFLOW_ID || undefined,
    webhookSecret: process.env.GLEAP_WEBHOOK_SECRET || undefined,
    bugFixedMessage: process.env.GLEAP_BUG_FIXED_MESSAGE ??
      "Thank you for your patience. This issue has been resolved. We're closing this ticket, but you can reply to reopen it if you still need help.",
  },
  slack: {
    channelId: process.env.SLACK_CHANNEL_ID || "",
  },
  issueTracker: issueTracker as GleapTrackerConfig["issueTracker"],
  github: {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
    // Preserve the original release branch; opt into main or other branches explicitly.
    closeBranches: parseEnvList(process.env.GITHUB_CLOSE_BRANCHES, ["master"]),
  },
  linear: {
    teamId: process.env.LINEAR_TEAM_ID || "",
    labelIds: parseEnvList(process.env.LINEAR_LABEL_IDS),
    stateId: process.env.LINEAR_STATE_ID || "",
    trackerLabel: process.env.LINEAR_TRACKER_LABEL || "gleap-tracker-ticket",
    webhookSecret: process.env.LINEAR_WEBHOOK_SECRET || "",
  },
  jira: {
    host: process.env.JIRA_HOST || "",
    projectKey: process.env.JIRA_PROJECT_KEY || "",
    issueType: process.env.JIRA_ISSUE_TYPE || "Bug",
    doneStatusName: process.env.JIRA_DONE_STATUS || "Done",
    doneStatusNames: parseEnvList(process.env.JIRA_DONE_STATUSES),
    webhookSecret: process.env.JIRA_WEBHOOK_SECRET || "",
    labels: parseEnvList(process.env.JIRA_LABELS),
    // Projects requiring extra fields can configure them here, for example:
    // additionalFields: { customfield_10001: "value", priority: { name: "Medium" } },
  },
  followUp: {
    cron: process.env.FOLLOWUP_CRON || "0 8 * * *",
    timezone: process.env.FOLLOWUP_TZ || "UTC",
    followUpAfterDays: parseEnvNumber(process.env.FOLLOWUP_AFTER_DAYS, 3),
    closeAfterDays: parseEnvNumber(process.env.FOLLOWUP_CLOSE_AFTER_DAYS, 7),
    workflows: {
      bugFollowUp: process.env.FOLLOWUP_BUG_FOLLOWUP_WORKFLOW_ID || "",
      bugClose: process.env.FOLLOWUP_BUG_CLOSE_WORKFLOW_ID || "",
      inquiryClose: process.env.FOLLOWUP_INQUIRY_CLOSE_WORKFLOW_ID || "",
    },
  },
}

export default config
