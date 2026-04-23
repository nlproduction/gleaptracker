import config from "../../../gleaptracker.config";
import type { GleapWebhookTicket } from "../../handlers/gleapWebhook/types";

const ONSLACK_STATUS_VALUES = Object.values(config.gleap.onSlackStatuses) as string[];

// prettier-ignore
export const ticket = {
  isDone:             (t: GleapWebhookTicket) => t.status === config.gleap.doneStatus && !!t.formData?.slack_thread_ts,
  isOnSlackStatus:    (t: GleapWebhookTicket) => ONSLACK_STATUS_VALUES.includes(t.status),
  isActionableStatus: (t: GleapWebhookTicket) => ["OPEN", "INPROGRESS", ...ONSLACK_STATUS_VALUES].includes(t.status),
  hasSlackThread:     (t: GleapWebhookTicket) => !!t.formData?.slack_thread_ts,
  isLinkedToTracker:  (t: GleapWebhookTicket) => !!(t.formData?.linearIssueId || t.formData?.jiraIssueId),
  isUnconfirmed:      (t: GleapWebhookTicket) => !!t.formData?.slack_thread_ts && !(t.formData?.linearIssueId || t.formData?.jiraIssueId),
  isTrackerTicket:    (t: GleapWebhookTicket) => !t.formData?.slack_thread_ts && !(t.formData?.linearIssueId || t.formData?.jiraIssueId),
};
