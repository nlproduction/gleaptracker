export interface GleapConfig {
  projectId: string;
  workflowId?: string;
  /** Optional inbound shared secret. Keep unset only behind trusted ingress. */
  webhookSecret?: string;
  trackerTicketType: string;
  /** Existing parked lanes are retained for follow-up exclusions only. */
  onSlackStatuses: { BUG: string; INQUIRY: string };
  doneStatus: string;
  waitingStatus: string;
  /** Compatibility setting; no longer applied by tracker linking. */
  inProgressType: string;
  bugFixedMessage?: string;
}

/** Empty/invalid values use the fallback; explicit zero is retained. */
export const parseEnvNumber = (raw: string | undefined, fallback: number): number => {
  if (raw == null || raw.trim() === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export const parseEnvList = (raw: string | undefined, fallback: string[] = []): string[] =>
  raw === undefined ? fallback : raw.split(",").map((value) => value.trim()).filter(Boolean)

export interface FollowUpWorkflowIds {
  bugFollowUp: string;
  bugClose: string;
  inquiryClose: string;
}

export interface FollowUpConfig {
  /** Cron expression or "off". */
  cron: string;
  timezone: string;
  followUpAfterDays: number;
  closeAfterDays: number;
  workflows: FollowUpWorkflowIds;
  /** Compatibility fields; customer copy lives in the Gleap workflows. */
  followUpMessage?: string;
  closeMessage?: string;
}

export interface SlackConfig {
  channelId: string;
}

export interface LinearConfig {
  teamId: string;
  labelIds: string[];
  /** Empty uses the team's default issue state. */
  stateId: string;
  /** Fallback for older issues without a persisted issue identity. */
  trackerLabel: string;
  webhookSecret: string;
}

export interface JiraConfig {
  /** Hostname or HTTPS origin. Jira Cloud REST API v3 is used. */
  host: string;
  projectKey: string;
  issueType: string;
  doneStatusName: string;
  /** Optional alternative completed status names; overrides doneStatusName. */
  doneStatusNames?: string[];
  webhookSecret: string;
  labels?: string[];
  /** Required custom fields, components, priority, etc. Core linkage fields are protected. */
  additionalFields?: Record<string, unknown>;
}

export interface GitHubConfig {
  webhookSecret: string;
  closeBranches: string[];
}

export interface GleapTrackerConfig {
  gleap: GleapConfig;
  slack: SlackConfig;
  /** Optional issue creation on tracker create/update and customer-link events. */
  issueTracker: "linear" | "jira" | "both" | "none";
  linear?: LinearConfig;
  jira?: JiraConfig;
  github?: GitHubConfig;
  followUp: FollowUpConfig;
}
