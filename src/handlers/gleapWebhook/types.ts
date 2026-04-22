export interface GleapReporter {
  name?: string;
  email?: string;
}

export interface GleapWebhookTicket {
  id: string;
  title: string;
  bugId: number;
  status: string;
  type: string;
  trackerTicket: boolean;
  plainContent?: string;
  tags?: string[];
  reporter?: GleapReporter;
  contact?: GleapReporter;
  linkedTickets?: string[];
  session: {
    id: string;
    name?: string;
    email: string;
  };
  formData?: {
    linearIssueId?: string;
    linearIssueUrl?: string;
    jiraIssueId?: string;
    jiraIssueUrl?: string;
    slack_thread?: string;
    slack_thread_ts?: string;
    [key: string]: unknown;
  };
}

export interface GleapWebhookPayload {
  event: string;
  projectId: string;
  data: GleapWebhookTicket;
}
