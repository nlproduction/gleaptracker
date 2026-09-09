import config from "../../../gleaptracker.config"
import { createJiraIssue } from "../jira/client"
import { createLinearIssue } from "../linear/client"
import { getGleapClient } from "./client"

export interface GleapTrackerTicket {
  id: string
  title: string
  bugId: number
  type: string
  trackerTicket: boolean
  linkedTickets?: string[]
  formData?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Dedup guards — prevent duplicate issue creation on concurrent webhooks
// ---------------------------------------------------------------------------

const creatingTrackers = new Set<string>()
const creatingLinked = new Set<string>()

const withDedup = async (
  set: Set<string>,
  id: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<void> => {
  if (set.has(id)) {
    console.log(`[Tracker] Already processing ${id} — skipping duplicate`)
    return
  }
  set.add(id)
  setTimeout(() => set.delete(id), ttlMs)
  await fn()
}

// ---------------------------------------------------------------------------
// Linked ticket processing
// ---------------------------------------------------------------------------

const processLinkedTickets = async (
  linkedTicketIds: string[],
  issueIdentifier: string,
  issueUrl: string,
) => {
  const gleap = getGleapClient()
  const cfg = config.gleap

  await Promise.all(
    linkedTicketIds.map(async (ticketId) => {
      let ticket: Awaited<ReturnType<typeof gleap.tickets.get>>
      try {
        ticket = await gleap.tickets.get(ticketId)
      } catch (e) {
        console.error(`[Tracker] Failed to fetch linked ticket ${ticketId}:`, e)
        return
      }

      const ops: Promise<unknown>[] = []

      if (["OPEN", "INPROGRESS", ...Object.values(cfg.onSlackStatuses)].includes(ticket.status)) {
        ops.push(
          gleap.tickets.update(ticket.id, { status: cfg.waitingStatus }).then((ok) => {
            if (ok) console.log(`[Tracker] Linked ticket ${ticket.id} → waiting status ✓`)
          }),
        )
      }

      const formData = ticket.formData as Record<string, unknown> | undefined
      if (!formData?.issueId && !creatingLinked.has(ticket.id)) {
        creatingLinked.add(ticket.id)
        setTimeout(() => creatingLinked.delete(ticket.id), 60_000)
        ops.push(
          gleap.messages.addNote(
            ticket.id,
            `Created issue ${issueIdentifier}\nURL: ${issueUrl}`,
          ),
        )
        ops.push(
          gleap.tickets
            .update(ticket.id, {
              formData: { issueId: issueIdentifier, issueUrl },
            })
            .then((ok) => {
              if (ok) console.log(`[Tracker] Linked ticket ${ticket.id} updated with issue ✓`)
            }),
        )
      }

      try {
        await Promise.all(ops)
      } catch (e) {
        console.error(`[Tracker] Failed processing linked ticket ${ticket.id}:`, e)
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Core: process a tracker ticket → create issue(s) in configured tracker(s)
// ---------------------------------------------------------------------------

export const processTrackerTicket = async (ticket: GleapTrackerTicket): Promise<void> => {
  const gleap = getGleapClient()
  const cfg = config

  if (!ticket.trackerTicket) {
    console.log(`[Tracker] Ticket ${ticket.id} skipped — not a tracker ticket`)
    return
  }

  await withDedup(creatingTrackers, ticket.id, 60_000, async () => {
    if (ticket.type !== cfg.gleap.trackerTicketType) {
      await gleap.tickets.update(ticket.id, { type: cfg.gleap.trackerTicketType })
      console.log(`[Tracker] Ticket ${ticket.id} type corrected to "${cfg.gleap.trackerTicketType}"`)
    }
    const useLinear = cfg.issueTracker === "linear" || cfg.issueTracker === "both"
    const useJira = cfg.issueTracker === "jira" || cfg.issueTracker === "both"

    if (!useLinear && !useJira) {
      console.log(`[Tracker] issueTracker is "${cfg.issueTracker}" — not creating Linear/Jira issues`)
      return
    }

    let linearResult: Awaited<ReturnType<typeof createLinearIssue>> | undefined
    let jiraResult: Awaited<ReturnType<typeof createJiraIssue>> | undefined

    if (useLinear) {
      linearResult = await createLinearIssue(ticket)
      await gleap.tickets.update(ticket.id, {
        formData: {
          linearIssueId: linearResult.identifier,
          linearIssueUrl: linearResult.url,
        },
      })
      console.log(`[Tracker] Linear issue ${linearResult.identifier} linked to Gleap ${ticket.id}`)
    }

    if (useJira) {
      jiraResult = await createJiraIssue(ticket)
      await gleap.tickets.update(ticket.id, {
        formData: {
          jiraIssueId: jiraResult.identifier,
          jiraIssueUrl: jiraResult.url,
        },
      })
      console.log(`[Tracker] Jira issue ${jiraResult.identifier} linked to Gleap ${ticket.id}`)
    }

    // Use the primary tracker's identifier for linked tickets
    const primaryResult = linearResult ?? jiraResult
    if (primaryResult && ticket.linkedTickets?.length) {
      await processLinkedTickets(ticket.linkedTickets, primaryResult.identifier, primaryResult.url)
    }
  })
}
