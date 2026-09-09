export interface GleapConfig {
  /** Your Gleap project ID (from Gleap dashboard URL) */
  projectId: string;
  /** Gleap workflow ID to run on linked tickets when issue is marked done */
  workflowId?: string;
  /** Ticket type used for tracker/release tickets */
  trackerTicketType: string;
  /** Status IDs that mean a ticket is parked / on hold (used when applying waitingStatus) */
  onSlackStatuses: { BUG: string; INQUIRY: string };
  /** Status value for closed/done tickets */
  doneStatus: string;
  /** Status value for "waiting for update" (applied to linked tickets) */
  waitingStatus: string;
  /** Type applied to rejected tickets (legacy; unused in the tracker-SoT flow) */
  inProgressType: string;
  /** Message to the customers who were waiting for the bugfix */
  bugFixedMessage?: string;
}

export interface FollowUpConfig {
  /** node-cron expression; default `0 8 * * *` (08:00 every day). Set `off` to disable. */
  cron: string;
  /** IANA timezone for the cron expression (default UTC) */
  timezone: string;
  /** Days after the last human agent reply with no customer reply before the first nudge */
  followUpAfterDays: number;
  /** Days after the last human agent reply with no customer reply before close-no-reply */
  closeAfterDays: number;
  /** Customer-visible 3-day (or configured) follow-up text */
  followUpMessage: string;
  /** Customer-visible close-no-reply text (sent immediately before DONE) */
  closeMessage: string;
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
