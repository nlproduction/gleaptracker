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
  DONE: "✅ Closed",
}

export const trackerStatusLabel = (status: string): string => {
  if (status === config.gleap.doneStatus) return "✅ Closed"
  return STATUS_LABELS[status] ?? status
}

export const formatFixesLine = (trackerBugId: number): string =>
  `Fixes Gleap-${trackerBugId}`

export const formatRefsLine = (customerBugIds: number[]): string =>
  `Refs ${customerBugIds.map((id) => `Gleap-${id}`).join(", ")}`

export const buildHeaderText = (opts: {
  primary: GleapTicket
  extras: GleapTicket[]
  trackerBugId: number
}): string => {
  const { primary, extras, trackerBugId } = opts
  const { name, email } = customerDisplay(primary)
  const customerLine = [name, email].filter(Boolean).join("  ")
  const titleLine = `\`#${primary.bugId}\`  *${primary.title}*`

  const lines = [titleLine, ""]
  if (customerLine) lines.push(customerLine)

  if (extras.length) {
    const linked = extras
      .map((t) => `<${getGleapTicketUrl(t.id, t.type)}|#${t.bugId}>`)
      .join(", ")
    lines.push(`Linked: ${linked}`)
  }

  const allCustomerBugIds = [primary, ...extras].map((t) => t.bugId)
  lines.push("")
  lines.push(`\`${formatFixesLine(trackerBugId)}\``)
  lines.push(`\`${formatRefsLine(allCustomerBugIds)}\``)

  return `${lines.join("\n")}\n`
}

export const buildActionsBlock = (opts: {
  trackerId: string
  gleapUrl: string
  status: string
  closed: boolean
}) => {
  const elements: Array<Record<string, unknown>> = [
    {
      type: "button",
      text: { type: "plain_text", text: trackerStatusLabel(opts.status) },
      action_id: "tracker_status",
      value: opts.trackerId,
    },
  ]

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
  const gleapUrl = getGleapTicketUrl(opts.primary.id, opts.primary.type)
  return [
    {
      type: "section",
      block_id: "header_block",
      text: {
        type: "mrkdwn",
        text: buildHeaderText({
          primary: opts.primary,
          extras: opts.extras,
          trackerBugId: opts.tracker.bugId,
        }),
      },
    },
    buildActionsBlock({
      trackerId: opts.tracker.id,
      gleapUrl,
      status: opts.tracker.status,
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
