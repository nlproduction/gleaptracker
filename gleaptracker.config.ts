/**
 * GleapTracker configuration
 *
 * This file controls all non-secret settings for the integration.
 * Secrets (API keys, tokens) belong in .env.local — see .env.local.example.
 *
 * Fields that reference process.env must be set in .env.local.
 */
import type { GleapTrackerConfig } from "./src/types/config";

const config: GleapTrackerConfig = {
  // -------------------------------------------------------------------------
  // Gleap
  // -------------------------------------------------------------------------
  gleap: {
    projectId: process.env.GLEAP_PROJECT_ID!,
    /** Ticket type for "for release" tracker tickets */
    trackerTicketType: "FOR-RELEASE",
    /** Legacy: type applied when Slack Reject was used (unused in the tracker-SoT flow) */
    inProgressType: "INPROGRESS",
    /** Status value Gleap uses for closed/done tickets */
    doneStatus: "DONE",

    /** SEE README.md on how to get custom status IDs from Gleap */
    /** Legacy On Slack lanes — not applied on Link to tracker; cron may still ignore them */
    onSlackStatuses: { BUG: "cz2qz", INQUIRY: "lm7lx3" },
    /** Legacy Waiting for Update — not applied on Link to tracker / Slack sync */
    waitingStatus: "9oyq7h",

    /** Optional: Workflow run on linked tickets when the tracker issue is marked Done */
    // workflowId: "your-gleap-workflow-id",

    /**
     * Optional: Message to the customers who were waiting for the bugfix
     * It's recommended to use either the bugFixedMessage or a workflowId
     */
    bugFixedMessage: `Thank you for your patience. We've fixed the bug and released a new version. Please update the plugin.

We're closing the ticket. Feel free to reply to reopen it if the issue persists. If you have any other questions, please open a new ticket 🙂`,
  },

  // -------------------------------------------------------------------------
  // Daily no-reply follow-up / close (node-cron in the Express/PM2 process)
  // Replaces Gleap-native 3-day / 5-day workflows so linked trackers can be
  // checked. Default schedule: 08:00 UTC. Set FOLLOWUP_CRON=off to disable.
  // -------------------------------------------------------------------------
  followUp: {
    cron: process.env.FOLLOWUP_CRON || "0 8 * * *",
    timezone: process.env.FOLLOWUP_TZ || "UTC",
    followUpAfterDays: Number(process.env.FOLLOWUP_AFTER_DAYS) || 3,
    closeAfterDays: Number(process.env.FOLLOWUP_CLOSE_AFTER_DAYS) || 5,
    followUpMessage: `Just checking in — do you have any updates on this?

If we don't hear back, we'll close the ticket. Reply anytime and we'll pick it up.`,
    closeMessage: `Since we haven't heard back, we're closing this ticket. Feel free to reply to reopen it if you still need help. If you have any other questions, please open a new ticket 🙂`,
  },

  // -------------------------------------------------------------------------
  // Slack
  // -------------------------------------------------------------------------
  slack: {
    channelId: process.env.SLACK_CHANNEL_ID!,
  },

  // -------------------------------------------------------------------------
  // Issue tracker selection
  // "none" (tracker-SoT; no Linear/Jira create) | "linear" | "jira" | "both"
  // -------------------------------------------------------------------------
  issueTracker: "none",

  // -------------------------------------------------------------------------
  // GitHub (Fixes Gleap-<trackerBugId> on push)
  // -------------------------------------------------------------------------
  github: {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
    closeBranches: ["master"],
  },

  // -------------------------------------------------------------------------
  // Linear (required when issueTracker is "linear" or "both")
  // -------------------------------------------------------------------------
  linear: {
    teamId: "2fae8c28-5255-4e47-8f4d-00bee3fb118a",
    /** Label IDs applied to every created issue */
    labelIds: [
      "6eba01d2-186e-4e8a-8b79-170f9abebeb4",
      "cacec15c-04c1-4b0f-9d7d-626b78b19246",
    ],
    /** Workflow state ID for newly created issues (e.g. "Todo" / unstarted) */
    stateId: "f5cfd3be-1b9b-490a-b044-4cfd294ec040",
    /** Label name on Linear issues used to identify Gleap-linked ones */
    trackerLabel: "gleap-tracker-ticket",
    webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
  },

  // -------------------------------------------------------------------------
  // Jira (required when issueTracker is "jira" or "both")
  // -------------------------------------------------------------------------
  jira: {
    host: process.env.JIRA_HOST!,
    projectKey: process.env.JIRA_PROJECT_KEY!,
    issueType: "Bug",
    doneStatusName: "Done",
    webhookSecret: process.env.JIRA_WEBHOOK_SECRET!,
  },
};

export default config;
