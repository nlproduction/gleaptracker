import { LinearClient } from "@linear/sdk"
import config from "../../../gleaptracker.config"
import { getGleapTicketUrl } from "../gleap/client"

export interface LinearIssueResult {
  id: string
  url: string
  identifier: string
}

export interface LinearTrackerTicket {
  id: string
  title: string
  bugId: number
  type: string
  plainContent?: string
}

let _linear: LinearClient | null = null
const getLinearClient = (): LinearClient => {
  if (!_linear) _linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY || "" })
  return _linear
}

export const createLinearIssue = async (ticket: LinearTrackerTicket): Promise<LinearIssueResult> => {
  const cfg = config.linear
  if (!cfg?.teamId || !process.env.LINEAR_API_KEY) {
    throw new Error("Configure LINEAR_API_KEY and linear.teamId before enabling Linear")
  }
  const payload = await getLinearClient().createIssue({
    teamId: cfg.teamId,
    title: `[${ticket.bugId}] ${ticket.title}`,
    description: [
      ticket.plainContent?.trim(),
      `Gleap tracker: Gleap-${ticket.bugId}`,
      `Open in Gleap: ${getGleapTicketUrl(ticket.id, ticket.type)}`,
    ].filter(Boolean).join("\n\n"),
    labelIds: cfg.labelIds,
    stateId: cfg.stateId || undefined,
  })
  if (!payload.success) throw new Error(`Linear issue creation failed for ticket ${ticket.id}`)
  const issue = await payload.issue
  if (!issue) throw new Error(`Linear issue not returned for ticket ${ticket.id}`)
  return { id: issue.id, url: issue.url, identifier: issue.identifier }
}
