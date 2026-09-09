import config from "../../gleaptracker.config"
import {
  isTrackerDone,
  isTrackerTicket,
  type GleapMessage,
  type GleapTicket,
} from "../integrations/gleap/client"
import { readFollowUpForm } from "../integrations/gleap/formData"
import type { FollowUpWorkflowIds } from "../types/config"

export type FollowUpKind = "none" | "follow_up" | "close"

export type SkipReason =
  | "tracker_ticket"
  | "parked_status"
  | "linked_active_tracker"
  | "waiting_on_us"
  | "no_agent_reply"
  | "already_acted"
  | "too_soon"
  | "stale"

export type FollowUpDecision =
  | { action: FollowUpKind; reason?: undefined }
  | { action: "none"; reason: SkipReason }

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const parkedCustomerStatuses = (): Set<string> => {
  const cfg = config.gleap
  return new Set([
    cfg.doneStatus,
    cfg.waitingStatus,
    ...Object.values(cfg.onSlackStatuses),
    "SNOOZED",
  ])
}

export const isParkedCustomerStatus = (status: string): boolean =>
  parkedCustomerStatuses().has(status)

/** Skip when a linked tracker exists and is not DONE (OPEN / INPROGRESS / anything else). */
export const shouldSkipLinkedActiveTracker = (
  tracker: Pick<GleapTicket, "status"> | null | undefined,
): boolean => !!tracker && !isTrackerDone(tracker)

export const shouldSkipCustomerTicket = (
  ticket: Pick<GleapTicket, "status" | "type" | "trackerTicket">,
  tracker: Pick<GleapTicket, "status"> | null | undefined,
): SkipReason | null => {
  if (isTrackerTicket(ticket)) return "tracker_ticket"
  if (isParkedCustomerStatus(ticket.status)) return "parked_status"
  if (shouldSkipLinkedActiveTracker(tracker)) return "linked_active_tracker"
  return null
}

/** INQUIRY goes straight to the close workflow — no 3-day nudge. */
export const ticketAllowsSoftFollowUp = (ticketType?: string): boolean =>
  (ticketType ?? "BUG").toUpperCase() !== "INQUIRY"

export const resolveFollowUpWorkflowId = (
  ticketType: string,
  action: Exclude<FollowUpKind, "none">,
  workflows: FollowUpWorkflowIds = config.followUp.workflows,
): string => {
  if (action === "follow_up") return workflows.bugFollowUp
  return ticketType.toUpperCase() === "INQUIRY" ? workflows.inquiryClose : workflows.bugClose
}

export const normalizeMessageText = (text: string): string =>
  text.replace(/\s+/g, " ").trim()

const flattenRichText = (node: unknown): string => {
  if (!node) return ""
  if (typeof node === "string") return node
  if (typeof node !== "object") return ""
  const value = node as { text?: unknown; content?: unknown[] }
  if (typeof value.text === "string") return value.text
  if (Array.isArray(value.content)) return value.content.map(flattenRichText).join("")
  return ""
}

export const messagePlainText = (message: GleapMessage): string => {
  if (typeof message.text === "string" && message.text.trim()) return message.text
  if (typeof message.comment === "string" && message.comment.trim()) return message.comment
  return flattenRichText(message.data?.content)
}

export type MessageRole = "customer" | "agent" | "bot" | "ignore"

export const classifyMessage = (message: GleapMessage): MessageRole => {
  const type = (message.type ?? "").toUpperCase()
  if (type === "NOTE") return "ignore"
  if (message.senderType === "system") return "ignore"
  if (message.senderType === "user" || type === "USER_TEXT") return "customer"
  if (message.senderType === "agent") return "agent"
  // BOT_REPLY without senderType=user is the bot/AI turn, not a customer reply.
  if (
    message.senderType === "bot" ||
    type === "BOT" ||
    type === "BOT_REPLY" ||
    message.bot === true
  ) {
    return "bot"
  }
  if (type === "SHARED_COMMENT") return "customer"
  if (message.user && !message.bot) return "agent"
  if (message.session) return "customer"
  return "ignore"
}

export interface ConversationCursor {
  lastCustomerAt?: Date
  lastAgentAt?: Date
  alreadySentFollowUp: boolean
  alreadySentClose: boolean
}

const later = (current: Date | undefined, next: Date): Date =>
  !current || next.getTime() > current.getTime() ? next : current

const sentAfterAgent = (sentAt: Date | undefined, lastAgentAt?: Date): boolean => {
  if (!sentAt) return false
  if (!lastAgentAt) return true
  return sentAt.getTime() >= lastAgentAt.getTime()
}

const parseFormDate = (raw: string): Date | undefined => {
  if (!raw) return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export const analyzeConversation = (
  messages: GleapMessage[],
  formData?: Record<string, unknown>,
): ConversationCursor => {
  const flags = readFollowUpForm(formData)

  let lastCustomerAt: Date | undefined
  let lastAgentAt: Date | undefined

  for (const message of messages) {
    const created = new Date(message.createdAt)
    if (Number.isNaN(created.getTime())) continue
    const role = classifyMessage(message)

    if (role === "customer") {
      lastCustomerAt = later(lastCustomerAt, created)
      continue
    }
    if (role === "agent") {
      lastAgentAt = later(lastAgentAt, created)
    }
  }

  return {
    lastCustomerAt,
    lastAgentAt,
    alreadySentFollowUp: sentAfterAgent(parseFormDate(flags.followUpSentAt), lastAgentAt),
    alreadySentClose: sentAfterAgent(parseFormDate(flags.closeSentAt), lastAgentAt),
  }
}

export interface DecideFollowUpInput {
  now: Date
  lastCustomerAt?: Date
  lastAgentAt?: Date
  alreadySentFollowUp: boolean
  alreadySentClose: boolean
  followUpAfterDays: number
  closeAfterDays: number
  ticketType?: string
}

export const daysBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / MS_PER_DAY

export const decideFollowUpAction = (input: DecideFollowUpInput): FollowUpDecision => {
  if (!input.lastAgentAt) return { action: "none", reason: "no_agent_reply" }

  const customerRepliedAfterAgent =
    !!input.lastCustomerAt && input.lastCustomerAt.getTime() > input.lastAgentAt.getTime()
  if (customerRepliedAfterAgent) return { action: "none", reason: "waiting_on_us" }

  const waited = daysBetween(input.lastAgentAt, input.now)

  if (waited >= input.closeAfterDays) {
    if (input.alreadySentClose) return { action: "none", reason: "already_acted" }
    return { action: "close" }
  }

  if (!ticketAllowsSoftFollowUp(input.ticketType)) {
    return { action: "none", reason: "too_soon" }
  }

  if (waited >= input.followUpAfterDays) {
    if (input.alreadySentFollowUp) return { action: "none", reason: "already_acted" }
    return { action: "follow_up" }
  }

  return { action: "none", reason: "too_soon" }
}

export const decideForTicket = (
  ticket: Pick<GleapTicket, "status" | "type" | "trackerTicket" | "formData">,
  tracker: Pick<GleapTicket, "status"> | null | undefined,
  messages: GleapMessage[],
  now: Date,
  followUp = config.followUp,
): FollowUpDecision => {
  const skip = shouldSkipCustomerTicket(ticket, tracker)
  if (skip) return { action: "none", reason: skip }

  const cursor = analyzeConversation(messages, ticket.formData)
  return decideFollowUpAction({
    now,
    lastCustomerAt: cursor.lastCustomerAt,
    lastAgentAt: cursor.lastAgentAt,
    alreadySentFollowUp: cursor.alreadySentFollowUp,
    alreadySentClose: cursor.alreadySentClose,
    followUpAfterDays: followUp.followUpAfterDays,
    closeAfterDays: followUp.closeAfterDays,
    ticketType: ticket.type,
  })
}
