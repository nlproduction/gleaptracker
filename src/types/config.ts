export interface GleapConfig {
  /** Your Gleap project ID (from Gleap dashboard URL) */
  projectId: string;
  /** Gleap workflow ID to run on linked tickets when issue is marked done */
  workflowId?: string;
  /** Ticket type used for tracker/release tickets */
  trackerTicketType: string;
  /** Gleap status ID(s) that mean "needs Slack discussion" */
  onSlackStatuses: string[];
  /** Status value for closed/done tickets */
  doneStatus: string;
  /** Status value for "waiting for update" (applied to linked tickets) */
  waitingStatus: string;
  /** Type applied to rejected tickets */
  inProgressType: string;
  /** Message to the customers who were waiting for the bugfix */
  bugFixedMessage?: string;
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

export interface GleapTrackerConfig {
  gleap: GleapConfig;
  slack: SlackConfig;
  /** Which issue tracker(s) to use */
  issueTracker: "linear" | "jira" | "both";
  linear?: LinearConfig;
  jira?: JiraConfig;
}
