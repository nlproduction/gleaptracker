import {
  getGleapClient,
  isTrackerTicket,
  linkedTicketId,
  type GleapLinkedRef,
  type GleapTicket,
} from "./client"

export const linkedRefs = (
  ticket: Pick<GleapTicket, "linkedTickets">,
): GleapLinkedRef[] => ticket.linkedTickets ?? []

export const linkedIds = (ticket: Pick<GleapTicket, "linkedTickets">): string[] =>
  linkedRefs(ticket).map(linkedTicketId)

export const loadTicket = async (ticketId: string): Promise<GleapTicket | null> => {
  try {
    return await getGleapClient().tickets.get(ticketId)
  } catch (e) {
    console.error(`[Gleap] Failed to fetch ticket ${ticketId}:`, e)
    return null
  }
}

export const findLinkedTracker = async (
  ticket: GleapTicket,
): Promise<GleapTicket | null> => {
  if (isTrackerTicket(ticket)) return ticket

  for (const ref of linkedRefs(ticket)) {
    if (typeof ref !== "string" && isTrackerTicket(ref)) {
      return (await loadTicket(ref.id)) ?? null
    }
  }

  for (const id of linkedIds(ticket)) {
    const linked = await loadTicket(id)
    if (linked && isTrackerTicket(linked)) return linked
  }

  return null
}

export const loadCustomerTickets = async (
  tracker: GleapTicket,
): Promise<GleapTicket[]> => {
  const customers: GleapTicket[] = []
  for (const ref of linkedRefs(tracker)) {
    if (typeof ref !== "string" && isTrackerTicket(ref)) continue
    const id = linkedTicketId(ref)
    const ticket = await loadTicket(id)
    if (ticket && !isTrackerTicket(ticket)) customers.push(ticket)
  }
  return customers
}

export const pickPrimaryCustomer = (
  customers: GleapTicket[],
  storedPrimaryId?: string,
  triggerTicketId?: string,
): GleapTicket | undefined => {
  if (storedPrimaryId) {
    const stored = customers.find((c) => c.id === storedPrimaryId)
    if (stored) return stored
  }
  if (triggerTicketId) {
    const triggered = customers.find((c) => c.id === triggerTicketId)
    if (triggered) return triggered
  }
  return customers[0]
}

/** After Link to tracker / Slack sync: OPEN → INPROGRESS. Any other status is left alone. */
export const markLinkedInProgress = async (ticket: GleapTicket): Promise<void> => {
  if (ticket.status !== "OPEN") return
  const ok = await getGleapClient().tickets.update(ticket.id, { status: "INPROGRESS" })
  if (ok) console.log(`[Gleap] Linked ticket ${ticket.id} → INPROGRESS ✓`)
}

export const findTrackerByBugId = async (
  bugId: string | number,
): Promise<GleapTicket | null> => {
  const gleap = getGleapClient()
  const { tickets } = await gleap.tickets.list({ bugId })
  const match =
    tickets.find((t) => String(t.bugId) === String(bugId) && isTrackerTicket(t)) ??
    tickets.find((t) => String(t.bugId) === String(bugId))
  if (!match) return null
  if (!isTrackerTicket(match)) {
    console.log(`[Gleap] Ticket bugId ${bugId} is not a tracker — skipping`)
    return null
  }
  return (await loadTicket(match.id)) ?? match
}

export const extractDescription = (ticket: GleapTicket): string => {
  if (ticket.plainContent?.trim()) return ticket.plainContent.trim()
  const desc = ticket.formData?.description
  if (typeof desc === "string") return desc.trim()
  if (desc && typeof desc === "object") return flattenRichText(desc).trim()
  return ""
}

const flattenRichText = (node: unknown): string => {
  if (!node) return ""
  if (typeof node === "string") return node
  if (typeof node !== "object") return ""
  const value = node as { text?: unknown; content?: unknown[] }
  if (typeof value.text === "string") return value.text
  if (Array.isArray(value.content)) return value.content.map(flattenRichText).join("")
  return ""
}
