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
    /** Type applied to tickets when they are rejected by the dev team */
    inProgressType: "INPROGRESS",
    /** Status value Gleap uses for closed/done tickets */
    doneStatus: "DONE",

    /** SEE README.md on how to get custom status IDs from Gleap */
    /** CUSTOM status value that trigger sending the ticket to the Slack channel */
    onSlackStatuses: ["cz2qz"],
    /** CUSTOM status values applied to linked customer tickets while fix is pending */
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
  // Slack
  // -------------------------------------------------------------------------
  slack: {
    channelId: process.env.SLACK_CHANNEL_ID!,
  },

  // -------------------------------------------------------------------------
  // Issue tracker selection
  // "linear" | "jira" | "both"
  // -------------------------------------------------------------------------
  issueTracker: "linear",

  // -------------------------------------------------------------------------
  // Linear (required when issueTracker is "linear" or "both")
  // -------------------------------------------------------------------------
  linear: {
    teamId: "your-linear-team-id",
    /** Label IDs applied to every created issue */
    labelIds: ["label-id-1", "label-id-2"],
    /** Workflow state ID for newly created issues (e.g. "Todo" / unstarted) */
    stateId: "your-linear-state-id",
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
