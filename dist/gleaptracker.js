"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config = {
    // -------------------------------------------------------------------------
    // Gleap
    // -------------------------------------------------------------------------
    gleap: {
        projectId: process.env.GLEAP_PROJECT_ID,
        /** Workflow run on linked tickets when the tracker issue is marked Done */
        workflowId: "your-gleap-workflow-id",
        /** Ticket type for "for release" tracker tickets */
        trackerTicketType: "FOR-RELEASE",
        /** Status values that trigger sending the ticket to the Slack channel */
        onSlackStatuses: ["ONSLACK"],
        /** Status value Gleap uses for closed/done tickets */
        doneStatus: "DONE",
        /** Status value applied to linked customer tickets while fix is pending */
        waitingStatus: "WAITINGFORUPDATE",
        /** Type applied to tickets when they are rejected by the dev team */
        inProgressType: "INPROGRESS",
    },
    // -------------------------------------------------------------------------
    // Slack
    // -------------------------------------------------------------------------
    slack: {
        channelId: process.env.SLACK_CHANNEL_ID,
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
        webhookSecret: process.env.LINEAR_WEBHOOK_SECRET,
    },
    // -------------------------------------------------------------------------
    // Jira (required when issueTracker is "jira" or "both")
    // -------------------------------------------------------------------------
    jira: {
        host: process.env.JIRA_HOST,
        projectKey: process.env.JIRA_PROJECT_KEY,
        issueType: "Bug",
        doneStatusName: "Done",
        webhookSecret: process.env.JIRA_WEBHOOK_SECRET,
    },
};
exports.default = config;
//# sourceMappingURL=gleaptracker.js.map