import type { KnownBlock } from "@slack/web-api"
import config from "../../../gleaptracker.config"
import { customerDisplay, getGleapTicketUrl, type GleapTicket } from "../gleap/client"

const STATUS_LABELS: Record<string, string> = { OPEN: "Open", INPROGRESS: "In progress", TOTEST: "To test" }
const customerTicketLink = (ticket: GleapTicket): string => `<${getGleapTicketUrl(ticket.id, ticket.type)}|#${ticket.bugId}>`

export const trackerStatusBadge = (status: string, statusLabel?: string): string => {
  const label = statusLabel?.trim()
  if (status === config.gleap.doneStatus) return "✅ Closed"
  if (status === "OPEN") return `🔵 ${label || "Open"}`
  return `🟡 ${label || STATUS_LABELS[status] || "In progress"}`
}
export const formatFixesLine = (trackerBugId: number): string => `Fixes Gleap-${trackerBugId}`
export const formatRefsLine = (customerBugIds: number[]): string => `Refs ${customerBugIds.map((id) => `Gleap-${id}`).join(", ")}`

export const buildHeaderText = (opts: {
  tracker: GleapTicket; primary: GleapTicket; extras: GleapTicket[]; closed?: boolean
}): string => {
  const { tracker, primary, extras, closed } = opts
  const { email } = customerDisplay(primary)
  const customers = [primary, ...extras]
  const status = closed ? config.gleap.doneStatus : tracker.status
  const lines = [`\`#${tracker.bugId}\`  *${tracker.title}*`, ""]
  if (customers.length === 1) {
    if (email) lines.push(email)
    lines.push(`Ticket: ${customerTicketLink(primary)}`)
  } else {
    lines.push(`Tickets: ${customers.map(customerTicketLink).join(" ")}`)
  }
  lines.push("", trackerStatusBadge(status, closed ? undefined : tracker.statusLabel))
  return `${lines.join("\n")}\n`
}

const safeIssueUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  try {
    const url = new URL(value)
    if (url.protocol === "https:" && !url.username && !url.password) return value
  } catch { /* Omit malformed stored links instead of breaking the Slack card. */ }
  return undefined
}

export const buildActionsBlock = (opts: {
  trackerId: string; gleapUrl: string; closed: boolean; linearUrl?: string; jiraUrl?: string
}) => {
  const elements: Array<Record<string, unknown>> = []
  if (!opts.closed) {
    elements.push({ type: "button", text: { type: "plain_text", text: "Close" }, style: "danger", action_id: "close_tracker", value: opts.trackerId })
  }
  elements.push({ type: "button", text: { type: "plain_text", text: "Open in Gleap ↗" }, action_id: "open_gleap", url: opts.gleapUrl, value: opts.trackerId })
  for (const [provider, value] of [["Linear", opts.linearUrl], ["Jira", opts.jiraUrl]] as const) {
    const url = safeIssueUrl(value)
    if (url) elements.push({ type: "button", text: { type: "plain_text", text: `Open in ${provider} ↗` }, action_id: `open_${provider.toLowerCase()}`, url })
  }
  // Preserve this ID: older Slack interactive bindings used actions_block.
  return { type: "actions" as const, block_id: "tracker_actions", elements }
}

export const buildTrackerRootBlocks = (opts: {
  tracker: GleapTicket; primary: GleapTicket; extras: GleapTicket[]; closed?: boolean
}): KnownBlock[] => {
  const closed = opts.closed ?? opts.tracker.status === config.gleap.doneStatus
  const customers = [opts.primary, ...opts.extras]
  const openTarget = customers.length === 1 ? customers[0] : opts.tracker
  return [
    { type: "section", block_id: "header_block", text: { type: "mrkdwn", text: buildHeaderText({ ...opts, closed }) } },
    buildActionsBlock({
      trackerId: opts.tracker.id,
      gleapUrl: getGleapTicketUrl(openTarget.id, openTarget.type),
      closed,
      linearUrl: safeIssueUrl(opts.tracker.formData?.linearIssueUrl),
      jiraUrl: safeIssueUrl(opts.tracker.formData?.jiraIssueUrl),
    }) as unknown as KnownBlock,
  ]
}

export const buildNewRelatedTicketText = (ticket: GleapTicket): string => {
  const { email } = customerDisplay(ticket)
  return ["*New related ticket*", `#${ticket.bugId} ${ticket.title}`, email ?? "", `<${getGleapTicketUrl(ticket.id, ticket.type)}|Open in Gleap>`]
    .filter((line, i) => i !== 2 || line).join("\n")
}

export const buildCloseModalView = (opts: { privateMetadata: string; initialMessage: string }) => ({
  type: "modal" as const,
  callback_id: "close_modal",
  private_metadata: opts.privateMetadata,
  title: { type: "plain_text" as const, text: "Close tracker" },
  submit: { type: "plain_text" as const, text: "Close" },
  close: { type: "plain_text" as const, text: "Cancel" },
  blocks: [{
    type: "input" as const, block_id: "message_block", optional: true,
    label: { type: "plain_text" as const, text: "Message to customers" },
    hint: { type: "plain_text" as const, text: "Edit or clear this text. An empty message closes silently — no customer reply is sent." },
    element: { type: "plain_text_input" as const, action_id: "message_input", multiline: true, initial_value: opts.initialMessage },
  }],
})
