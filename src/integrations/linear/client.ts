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
}

let _linear: LinearClient | null = null

const getLinearClient = (): LinearClient => {
  if (!_linear) {
    _linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY || "" })
  }
  return _linear
}

export const createLinearIssue = async (
  ticket: LinearTrackerTicket,
): Promise<LinearIssueResult> => {
  const linear = getLinearClient()
  const cfg = config.linear!

  const payload = await linear.createIssue({
    teamId: cfg.teamId,
    title: `[${ticket.bugId}] ${ticket.title}`,
    description: `Open in Gleap: ${getGleapTicketUrl(ticket.id, ticket.type)}`,
    labelIds: cfg.labelIds,
    stateId: cfg.stateId,
  })

  if (!payload.success) throw new Error(`Linear issue creation failed for ticket ${ticket.id}`)

  const issue = await payload.issue
  if (!issue) throw new Error(`Linear issue not returned for ticket ${ticket.id}`)

  console.log(`[Linear] Issue created: ${issue.identifier} — ${issue.url}`)
  return { id: issue.id, url: issue.url, identifier: issue.identifier }
}
