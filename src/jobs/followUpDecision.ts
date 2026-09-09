import config from "../../gleaptracker.config"
import {
  isTrackerDone,
  isTrackerTicket,
  type GleapMessage,
  type GleapTicket,
} from "../integrations/gleap/client"

export type FollowUpKind = "none" | "follow_up" | "close"

export type SkipReason =
  | "tracker_ticket"
  | "parked_status"
  | "linked_active_tracker"
  | "waiting_on_us"
  | "no_agent_reply"
  | "already_acted"
  | "too_soon"

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
  if (message.senderType === "user" || type === "USER_TEXT" || type === "BOT_REPLY") {
    return "customer"
  }
  if (message.senderType === "agent") return "agent"
  if (message.senderType === "bot" || type === "BOT" || message.bot === true) return "bot"
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

export const analyzeConversation = (
  messages: GleapMessage[],
  templates: { followUpMessage: string; closeMessage: string },
): ConversationCursor => {
  const followUpNorm = normalizeMessageText(templates.followUpMessage)
  const closeNorm = normalizeMessageText(templates.closeMessage)
  const cursor: ConversationCursor = {
    alreadySentFollowUp: false,
    alreadySentClose: false,
  }

  for (const message of messages) {
    const created = new Date(message.createdAt)
    if (Number.isNaN(created.getTime())) continue
    const role = classifyMessage(message)
    const text = normalizeMessageText(messagePlainText(message))

    if (role === "customer") {
      cursor.lastCustomerAt = created
      continue
    }
    if (role === "agent") {
      cursor.lastAgentAt = created
      cursor.alreadySentFollowUp = false
      cursor.alreadySentClose = false
      continue
    }
    if (role !== "bot") continue

    if (text && text === followUpNorm) cursor.alreadySentFollowUp = true
    if (text && text === closeNorm) cursor.alreadySentClose = true
  }

  return cursor
}

export interface DecideFollowUpInput {
  now: Date
  lastCustomerAt?: Date
  lastAgentAt?: Date
  alreadySentFollowUp: boolean
  alreadySentClose: boolean
  followUpAfterDays: number
  closeAfterDays: number
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
    return { action: "close" }
  }

  if (waited >= input.followUpAfterDays) {
    if (input.alreadySentFollowUp) return { action: "none", reason: "already_acted" }
    return { action: "follow_up" }
  }

  return { action: "none", reason: "too_soon" }
}

export const decideForTicket = (
  ticket: Pick<GleapTicket, "status" | "type" | "trackerTicket">,
  tracker: Pick<GleapTicket, "status"> | null | undefined,
  messages: GleapMessage[],
  now: Date,
  followUp = config.followUp,
): FollowUpDecision => {
  const skip = shouldSkipCustomerTicket(ticket, tracker)
  if (skip) return { action: "none", reason: skip }

  const cursor = analyzeConversation(messages, followUp)
  return decideFollowUpAction({
    now,
    lastCustomerAt: cursor.lastCustomerAt,
    lastAgentAt: cursor.lastAgentAt,
    alreadySentFollowUp: cursor.alreadySentFollowUp,
    alreadySentClose: cursor.alreadySentClose,
    followUpAfterDays: followUp.followUpAfterDays,
    closeAfterDays: followUp.closeAfterDays,
  })
}
