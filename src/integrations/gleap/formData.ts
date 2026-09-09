import { getGleapClient } from "./client"

export const FOLLOWUP_FORM = {
  followUpSentAt: "noreply_followup_sent_at",
  closeSentAt: "noreply_close_sent_at",
} as const

export const TRACKER_FORM = {
  slackThread: "slack_thread",
  slackThreadTs: "slack_thread_ts",
  primaryTicketId: "primary_ticket_id",
  notifiedIds: "slack_notified_ids",
  closeProcessed: "close_processed",
  closeSilent: "close_silent",
} as const

const asString = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value)

const asFlag = (value: unknown): boolean => value === true || value === "true"

export interface TrackerFormState {
  slackThread: string
  slackThreadTs: string
  primaryTicketId: string
  notifiedIds: string[]
  closeProcessed: boolean
  closeSilent: boolean
}

export interface FollowUpFormState {
  followUpSentAt: string
  closeSentAt: string
}

export const readFollowUpForm = (
  formData?: Record<string, unknown>,
): FollowUpFormState => ({
  followUpSentAt: asString(formData?.[FOLLOWUP_FORM.followUpSentAt]),
  closeSentAt: asString(formData?.[FOLLOWUP_FORM.closeSentAt]),
})

export const readTrackerForm = (
  formData?: Record<string, unknown>,
): TrackerFormState => ({
  slackThread: asString(formData?.[TRACKER_FORM.slackThread]),
  slackThreadTs: asString(formData?.[TRACKER_FORM.slackThreadTs]),
  primaryTicketId: asString(formData?.[TRACKER_FORM.primaryTicketId]),
  notifiedIds: asString(formData?.[TRACKER_FORM.notifiedIds])
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  closeProcessed: asFlag(formData?.[TRACKER_FORM.closeProcessed]),
  closeSilent: asFlag(formData?.[TRACKER_FORM.closeSilent]),
})

export const patchTicketFormData = async (
  ticketId: string,
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Promise<boolean> => {
  const gleap = getGleapClient()
  return gleap.tickets.update(ticketId, {
    formData: { ...(current ?? {}), ...patch },
  })
}
