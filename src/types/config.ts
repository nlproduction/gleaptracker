export interface GleapConfig {
  /** Your Gleap project ID (from Gleap dashboard URL) */
  projectId: string;
  /** Gleap workflow ID to run on linked tickets when issue is marked done */
  workflowId?: string;
  /** Ticket type used for tracker/release tickets */
  trackerTicketType: string;
  /** Legacy parked / on-hold status IDs (On Slack). Not applied on Link to tracker. */
  onSlackStatuses: { BUG: string; INQUIRY: string };
  /** Status value for closed/done tickets */
  doneStatus: string;
  /** Legacy "Waiting for Update" status — not applied on Link to tracker / Slack sync */
  waitingStatus: string;
  /** Type applied to rejected tickets (legacy; unused in the tracker-SoT flow) */
  inProgressType: string;
  /** Message to the customers who were waiting for the bugfix */
  bugFixedMessage?: string;
}

/** Parse a numeric env var. Empty/invalid → fallback; explicit `0` is kept. */
export const parseEnvNumber = (raw: string | undefined, fallback: number): number => {
  if (raw == null || raw.trim() === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export interface FollowUpWorkflowIds {
  /** BUG no-reply nudge (default 3 days). Gleap: "Follow-up 3 days". */
  bugFollowUp: string;
  /** BUG no-reply close (default 7 days). Gleap: "Follow-up 7 days". */
  bugClose: string;
  /**
   * INQUIRY no-reply close (default 7 days). Gleap: "Close Inbox Ticket - 7 days no reply".
   * INQUIRY has no soft 3-day follow-up.
   */
  inquiryClose: string;
}

export interface FollowUpConfig {
  /** node-cron expression; default `0 8 * * *` (08:00 every day). Set `off` to disable. */
  cron: string;
  /** IANA timezone for the cron expression (default UTC) */
  timezone: string;
  /** Days after the last human agent reply with no customer reply before the first BUG nudge */
  followUpAfterDays: number;
  /** Days after the last human agent reply with no customer reply before close-no-reply */
  closeAfterDays: number;
  /** Gleap workflow IDs invoked by the cron (not auto-triggered in Gleap) */
  workflows: FollowUpWorkflowIds;
  /**
   * Unused by the cron — customer copy lives in the Gleap workflows.
   * Kept as a reference for the old bot-message path.
   */
  followUpMessage?: string;
  /**
   * Unused by the cron — customer copy / DONE live in the Gleap workflows.
   * Kept as a reference for the old bot-message path.
   */
  closeMessage?: string;
}

export interface SlackConfig {
  /** Slack channel ID where ticket threads are created */
  channelId: string;
}

export interface LinearConfig {
  /** Linear team ID */
  teamId: string;
  /** Label IDs to apply to created Linear issues */
  labelIds: string[];
  /** Workflow state ID for new issues (e.g. "Todo" / unstarted) */
  stateId: string;
  /** Label name used to identify Gleap-linked issues in Linear webhooks */
  trackerLabel: string;
  /** Linear webhook signing secret */
  webhookSecret: string;
}

export interface JiraConfig {
  /** Jira host, e.g. "yourteam.atlassian.net" */
  host: string;
  /** Jira project key, e.g. "MAP" */
  projectKey: string;
  /** Issue type name, e.g. "Bug" or "Task" */
  issueType: string;
  /** Status name that means the issue is done, e.g. "Done" */
  doneStatusName: string;
  /** Secret used to verify incoming Jira webhooks */
  webhookSecret: string;
}

export interface GitHubConfig {
  /** Secret used to verify incoming GitHub webhooks (`X-Hub-Signature-256`) */
  webhookSecret: string;
  /** Branch names whose pushes close trackers via `Fixes Gleap-<bugId>` */
  closeBranches: string[];
}

export interface GleapTrackerConfig {
  gleap: GleapConfig;
  slack: SlackConfig;
  /**
   * Which issue tracker(s) to create issues in when a tracker ticket is processed.
   * The Slack / close flow does not require Linear or Jira — use `"none"` for the
   * tracker-SoT path. `"linear"` / `"jira"` / `"both"` remain for the legacy creator.
   */
  issueTracker: "linear" | "jira" | "both" | "none";
  linear?: LinearConfig;
  jira?: JiraConfig;
  github?: GitHubConfig;
  /** Daily no-reply follow-up / close job (node-cron, same PM2 process) */
  followUp: FollowUpConfig;
}
