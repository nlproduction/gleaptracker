import config from "../../../gleaptracker.config"
import { createKeyedLock } from "../../utils/async"
import { createJiraIssue } from "../jira/client"
import { createLinearIssue } from "../linear/client"
import { getGleapClient, isTrackerDone, isTrackerTicket, linkedTicketId, type GleapTicket } from "./client"
import { patchTicketFormData } from "./formData"

export type GleapTrackerTicket = Pick<GleapTicket,
  "id" | "title" | "bugId" | "type" | "trackerTicket" | "linkedTickets" | "formData" | "plainContent"
> & { status?: string }

type Provider = "linear" | "jira"
interface IssueLink { id: string; identifier: string; url: string }
const lock = createKeyedLock()
// Keep successful remote creates if writing their links fails. Recovery is
// bounded and process-local; it cannot guarantee exactly-once across crashes.
const pendingLinks = new Map<string, IssueLink>()
const MAX_PENDING_LINKS = 1_000

const fieldsFor = (provider: Provider) => ({
  identifier: `${provider}IssueId`,
  url: `${provider}IssueUrl`,
  id: provider === "linear" ? "linearIssueUuid" : "jiraIssueInternalId",
})

const readLink = (form: Record<string, unknown> | undefined, provider: Provider): IssueLink | undefined => {
  const fields = fieldsFor(provider)
  const identifier = form?.[fields.identifier]
  if (typeof identifier !== "string" || !identifier) return undefined
  return {
    identifier,
    id: typeof form?.[fields.id] === "string" ? form[fields.id] as string : "",
    url: typeof form?.[fields.url] === "string" ? form[fields.url] as string : "",
  }
}

const linkPatch = (provider: Provider, link: IssueLink): Record<string, unknown> => {
  const fields = fieldsFor(provider)
  return {
    [fields.identifier]: link.identifier,
    [fields.url]: link.url,
    ...(link.id ? { [fields.id]: link.id } : {}),
  }
}

const saveForm = async (ticketId: string, patch: Record<string, unknown>): Promise<void> => {
  const latest = await getGleapClient().tickets.get(ticketId)
  if (!await patchTicketFormData(ticketId, latest.formData, patch)) {
    throw new Error(`[Tracker] Failed to persist issue link on ${ticketId}`)
  }
}

/** Moves trackers to their configured board; customer ticket types never change. */
export const ensureTrackerTicketType = async (
  ticket: Pick<GleapTrackerTicket, "id" | "type">,
): Promise<void> => {
  const expected = config.gleap.trackerTicketType
  if (ticket.type === expected) return
  if (!await getGleapClient().tickets.update(ticket.id, { type: expected })) {
    throw new Error(`[Tracker] Failed to correct ticket type for ${ticket.id}`)
  }
  ticket.type = expected
}

const ensureIssue = async (ticket: GleapTicket, provider: Provider): Promise<IssueLink> => {
  const existing = readLink(ticket.formData, provider)
  if (existing) return existing
  const key = `${provider}:${ticket.id}`
  let result = pendingLinks.get(key)
  if (!result) {
    result = provider === "linear" ? await createLinearIssue(ticket) : await createJiraIssue(ticket)
    if (pendingLinks.size >= MAX_PENDING_LINKS) {
      const oldest = pendingLinks.keys().next().value
      if (oldest) pendingLinks.delete(oldest)
    }
    pendingLinks.set(key, result)
  }
  const patch = linkPatch(provider, result)
  await saveForm(ticket.id, patch)
  ticket.formData = { ...(ticket.formData ?? {}), ...patch }
  pendingLinks.delete(key)
  return result
}

const syncCustomerLinks = async (
  tracker: GleapTicket,
  links: Partial<Record<Provider, IssueLink>>,
): Promise<void> => {
  const gleap = getGleapClient()
  const primary = links.linear ?? links.jira
  if (!primary) return
  const ids = new Set((tracker.linkedTickets ?? []).map(linkedTicketId))
  for (const id of ids) {
    const customer = await gleap.tickets.get(id)
    if (isTrackerTicket(customer)) continue
    const patch: Record<string, unknown> = {}
    for (const provider of ["linear", "jira"] as const) {
      const link = links[provider]
      if (link && !readLink(customer.formData, provider)) Object.assign(patch, linkPatch(provider, link))
    }
    // Older consumers still use the generic pair. Never replace an existing link.
    if (!customer.formData?.issueId) Object.assign(patch, { issueId: primary.identifier, issueUrl: primary.url })
    if (Object.keys(patch).length) await saveForm(id, patch)
    if (customer.status === "OPEN" && !await gleap.tickets.update(id, { status: "INPROGRESS" })) {
      throw new Error(`[Tracker] Failed to update linked customer ${id}`)
    }
  }
}

export const processTrackerTicket = async (hint: GleapTrackerTicket): Promise<void> => {
  if (config.issueTracker === "none" || !isTrackerTicket(hint)) return
  await lock(hint.id, async () => {
    // Webhook snapshots can predate our own formData writes.
    const tracker = await getGleapClient().tickets.get(hint.id)
    if (!isTrackerTicket(tracker) || isTrackerDone(tracker)) return
    await ensureTrackerTicketType(tracker)
    const links: Partial<Record<Provider, IssueLink>> = {}
    const failures: unknown[] = []
    for (const provider of ["linear", "jira"] as const) {
      if (config.issueTracker !== provider && config.issueTracker !== "both") continue
      try {
        links[provider] = await ensureIssue(tracker, provider)
      } catch (error) {
        failures.push(error)
      }
    }
    await syncCustomerLinks(tracker, links)
    if (failures.length) throw new AggregateError(failures, "Issue tracker synchronization failed")
  })
}
