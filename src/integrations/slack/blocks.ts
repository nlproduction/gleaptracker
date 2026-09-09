import type { KnownBlock } from "@slack/web-api"
import config from "../../../gleaptracker.config"
import {
  customerDisplay,
  getGleapTicketUrl,
  type GleapTicket,
} from "../gleap/client"

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  INPROGRESS: "In progress",
  TOTEST: "To test",
}

const customerTicketLink = (ticket: GleapTicket): string =>
  `<${getGleapTicketUrl(ticket.id, ticket.type)}|#${ticket.bugId}>`

/** Emoji + label for the tracker status. Never rendered as a button. */
export const trackerStatusBadge = (
  status: string,
  statusLabel?: string,
): string => {
  const label = statusLabel?.trim()
  if (status === config.gleap.doneStatus) return "✅ Closed"
  if (status === "OPEN") return `🔵 ${label || "Open"}`
  return `🟡 ${label || STATUS_LABELS[status] || "In progress"}`
}

export const formatFixesLine = (trackerBugId: number): string =>
  `Fixes Gleap-${trackerBugId}`

export const formatRefsLine = (customerBugIds: number[]): string =>
  `Refs ${customerBugIds.map((id) => `Gleap-${id}`).join(", ")}`

export const buildHeaderText = (opts: {
  tracker: GleapTicket
  primary: GleapTicket
  extras: GleapTicket[]
  closed?: boolean
}): string => {
  const { tracker, primary, extras, closed } = opts
  const { email } = customerDisplay(primary)
  const customers = [primary, ...extras]
  const status = closed ? config.gleap.doneStatus : tracker.status
  const statusLabel = closed ? undefined : tracker.statusLabel

  const lines = [`\`#${tracker.bugId}\`  *${tracker.title}*`, ""]
  if (email) lines.push(email)
  lines.push(`Tickets: ${customers.map(customerTicketLink).join(", ")}`)
  lines.push("")
  lines.push(trackerStatusBadge(status, statusLabel))

  return `${lines.join("\n")}\n`
}

export const buildActionsBlock = (opts: {
  trackerId: string
  gleapUrl: string
  closed: boolean
}) => {
  const elements: Array<Record<string, unknown>> = []

  if (!opts.closed) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "Close" },
      style: "danger",
      action_id: "close_tracker",
      value: opts.trackerId,
    })
  }

  elements.push({
    type: "button",
    text: { type: "plain_text", text: "Open in Gleap ↗" },
    action_id: "open_gleap",
    url: opts.gleapUrl,
    value: opts.trackerId,
  })

  return {
    type: "actions" as const,
    block_id: "actions_block",
    elements,
  }
}

export const buildTrackerRootBlocks = (opts: {
  tracker: GleapTicket
  primary: GleapTicket
  extras: GleapTicket[]
  closed?: boolean
}): KnownBlock[] => {
  const closed = opts.closed ?? opts.tracker.status === config.gleap.doneStatus
  return [
    {
      type: "section",
      block_id: "header_block",
      text: {
        type: "mrkdwn",
        text: buildHeaderText({
          tracker: opts.tracker,
          primary: opts.primary,
          extras: opts.extras,
          closed,
        }),
      },
    },
    buildActionsBlock({
      trackerId: opts.tracker.id,
      gleapUrl: getGleapTicketUrl(opts.tracker.id, opts.tracker.type),
      closed,
    }) as unknown as KnownBlock,
  ]
}

export const buildNewRelatedTicketText = (ticket: GleapTicket): string => {
  const { email } = customerDisplay(ticket)
  const url = getGleapTicketUrl(ticket.id, ticket.type)
  return [
    "*New related ticket*",
    `#${ticket.bugId} ${ticket.title}`,
    email ?? "",
    `<${url}|Open in Gleap>`,
  ]
    .filter((line, i) => i !== 2 || line)
    .join("\n")
}

export const buildCloseModalView = (opts: {
  privateMetadata: string
  initialMessage: string
}) => ({
  type: "modal" as const,
  callback_id: "close_modal",
  private_metadata: opts.privateMetadata,
  title: { type: "plain_text" as const, text: "Close tracker" },
  submit: { type: "plain_text" as const, text: "Close" },
  close: { type: "plain_text" as const, text: "Cancel" },
  blocks: [
    {
      type: "input" as const,
      block_id: "message_block",
      optional: true,
      label: { type: "plain_text" as const, text: "Message to customers" },
      hint: {
        type: "plain_text" as const,
        text: "Edit or clear this text. An empty message closes silently — no customer reply is sent.",
      },
      element: {
        type: "plain_text_input" as const,
        action_id: "message_input",
        multiline: true,
        initial_value: opts.initialMessage,
      },
    },
  ],
})
