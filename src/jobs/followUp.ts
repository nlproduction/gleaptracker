import cron from "node-cron"
import config from "../../gleaptracker.config"
import { getGleapClient, isTrackerTicket, type GleapTicket } from "../integrations/gleap/client"
import { FOLLOWUP_FORM, patchTicketFormData } from "../integrations/gleap/formData"
import { findLinkedTracker } from "../integrations/gleap/linked"
import {
  analyzeConversation,
  composeCloseMessage,
  composeFollowUpMessage,
  decideFollowUpAction,
  shouldSkipCustomerTicket,
  type FollowUpDecision,
  type FollowUpKind,
  type SkipReason,
} from "./followUpDecision"

const LOG = "[follow-up]"
const LIST_PAGE_SIZE = 100
const MESSAGE_PAGE_SIZE = 100
const MESSAGE_PAGE_CAP = 10
const DEFAULT_DELAY_MS = 200

/**
 * Gleap documents CSV filters (`status=OPEN,INPROGRESS`, `type=BUG,INQUIRY`)
 * and a live GET accepted that form. We still list each (status, type) pair
 * and dedupe by id so a board without INPROGRESS cannot drop the other lane.
 */
export const CANDIDATE_STATUSES = ["OPEN", "INPROGRESS"] as const
export const CUSTOMER_TYPES = ["BUG", "INQUIRY"] as const

export interface FollowUpSummary {
  scanned: number
  skippedLinkedTracker: number
  skippedParked: number
  skippedWaitingOnUs: number
  skippedTooSoon: number
  skippedAlreadyActed: number
  skippedStale: number
  skippedOverlap: number
  followedUp: number
  closed: number
  errors: number
}

export const emptyFollowUpSummary = (): FollowUpSummary => ({
  scanned: 0,
  skippedLinkedTracker: 0,
  skippedParked: 0,
  skippedWaitingOnUs: 0,
  skippedTooSoon: 0,
  skippedAlreadyActed: 0,
  skippedStale: 0,
  skippedOverlap: 0,
  followedUp: 0,
  closed: 0,
  errors: 0,
})

export const isFollowUpCronEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (env.NODE_ENV === "test" || env.VITEST) return false
  const raw = (env.FOLLOWUP_CRON ?? config.followUp.cron).trim().toLowerCase()
  return raw !== "off" && raw !== "false" && raw !== "disabled"
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const recordSkip = (summary: FollowUpSummary, reason: SkipReason | string): void => {
  if (reason === "linked_active_tracker") summary.skippedLinkedTracker += 1
  else if (reason === "parked_status" || reason === "tracker_ticket") summary.skippedParked += 1
  else if (reason === "waiting_on_us") summary.skippedWaitingOnUs += 1
  else if (reason === "too_soon") summary.skippedTooSoon += 1
  else if (reason === "already_acted") summary.skippedAlreadyActed += 1
  else if (reason === "stale") summary.skippedStale += 1
}

const listOneLane = async (
  status: string,
  type: string,
  delayMs: number,
): Promise<GleapTicket[]> => {
  const gleap = getGleapClient()
  const all: GleapTicket[] = []
  let skip = 0

  for (;;) {
    const page = await gleap.tickets.list({
      status,
      type,
      skip,
      limit: LIST_PAGE_SIZE,
      sort: "updatedAt",
    })
    const tickets = page.tickets ?? []
    all.push(...tickets)
    skip += tickets.length
    if (tickets.length === 0 || skip >= page.totalCount || tickets.length < LIST_PAGE_SIZE) {
      break
    }
    await sleep(delayMs)
  }

  return all
}

const listCandidateTickets = async (delayMs: number): Promise<GleapTicket[]> => {
  const byId = new Map<string, GleapTicket>()
  for (const status of CANDIDATE_STATUSES) {
    for (const type of CUSTOMER_TYPES) {
      const page = await listOneLane(status, type, delayMs)
      for (const ticket of page) {
        if (!isTrackerTicket(ticket)) byId.set(ticket.id, ticket)
      }
      await sleep(delayMs)
    }
  }
  return [...byId.values()]
}

const listTicketMessages = async (ticketId: string, delayMs: number) => {
  const gleap = getGleapClient()
  const messages = []
  let skip = 0

  for (let page = 0; page < MESSAGE_PAGE_CAP; page += 1) {
    const batch = await gleap.messages.list({
      ticket: ticketId,
      limit: MESSAGE_PAGE_SIZE,
      skip,
    })
    messages.push(...batch)
    if (batch.length < MESSAGE_PAGE_SIZE) break
    skip += batch.length
    await sleep(delayMs)
  }

  return messages
}

const inspectTicket = async (
  ticket: GleapTicket,
  now: Date,
  delayMs: number,
): Promise<{
  ticket: GleapTicket
  skip: SkipReason | null
  decision: FollowUpDecision
  alreadySentClose: boolean
}> => {
  const followUp = config.followUp
  const latest = (await getGleapClient().tickets.get(ticket.id)) ?? ticket
  await sleep(delayMs)

  const tracker = await findLinkedTracker(latest)
  await sleep(delayMs)

  const skip = shouldSkipCustomerTicket(latest, tracker)
  if (skip) {
    return { ticket: latest, skip, decision: { action: "none", reason: skip }, alreadySentClose: false }
  }

  const messages = await listTicketMessages(latest.id, delayMs)
  const cursor = analyzeConversation(messages, followUp, latest.formData)
  const decision = decideFollowUpAction({
    now,
    lastCustomerAt: cursor.lastCustomerAt,
    lastAgentAt: cursor.lastAgentAt,
    alreadySentFollowUp: cursor.alreadySentFollowUp,
    alreadySentClose: cursor.alreadySentClose,
    followUpAfterDays: followUp.followUpAfterDays,
    closeAfterDays: followUp.closeAfterDays,
  })
  return { ticket: latest, skip: null, decision, alreadySentClose: cursor.alreadySentClose }
}

const applyAction = async (
  ticket: GleapTicket,
  action: FollowUpKind,
  alreadySentClose: boolean,
  now: Date,
): Promise<FollowUpKind> => {
  if (action === "none") return "none"
  const gleap = getGleapClient()
  const { followUpMessage, closeMessage } = config.followUp
  const sentAt = now.toISOString()

  if (action === "follow_up") {
    await patchTicketFormData(ticket.id, ticket.formData, {
      [FOLLOWUP_FORM.followUpSentAt]: sentAt,
    })
    const ok = await gleap.messages.sendMessage(ticket.id, composeFollowUpMessage(followUpMessage))
    if (!ok) throw new Error(`follow-up send failed for ${ticket.id}`)
    console.log(`${LOG} Follow-up sent to ticket ${ticket.id} (bugId ${ticket.bugId}) ✓`)
    return "follow_up"
  }

  if (!alreadySentClose) {
    await patchTicketFormData(ticket.id, ticket.formData, {
      [FOLLOWUP_FORM.closeSentAt]: sentAt,
    })
    const ok = await gleap.messages.sendMessage(ticket.id, composeCloseMessage(closeMessage))
    if (!ok) throw new Error(`close message send failed for ${ticket.id}`)
  }
  const closed = await gleap.tickets.update(ticket.id, { status: config.gleap.doneStatus })
  if (!closed) throw new Error(`close status update failed for ${ticket.id}`)
  console.log(`${LOG} Closed ticket ${ticket.id} (bugId ${ticket.bugId}) — no reply ✓`)
  return "close"
}

let jobRunning = false

export const runFollowUpJob = async (
  now: Date = new Date(),
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<FollowUpSummary> => {
  const summary = emptyFollowUpSummary()
  if (jobRunning) {
    summary.skippedOverlap = 1
    console.log(`${LOG} Already running — skipping overlapping start (single-process mutex)`)
    logSummary(summary)
    return summary
  }

  jobRunning = true
  console.log(`${LOG} Starting no-reply job`)

  try {
    let tickets: GleapTicket[]
    try {
      tickets = await listCandidateTickets(delayMs)
    } catch (e) {
      summary.errors += 1
      console.error(`${LOG} Failed to list candidate tickets:`, e)
      logSummary(summary)
      return summary
    }

    for (const listed of tickets) {
      summary.scanned += 1
      try {
        const first = await inspectTicket(listed, now, delayMs)
        if (first.decision.action === "none") {
          if (first.decision.reason) recordSkip(summary, first.decision.reason)
          continue
        }

        // Re-read tracker + messages immediately before send (TOCTOU):
        // an agent may have Linked to tracker, or the customer may have replied.
        const second = await inspectTicket(first.ticket, now, delayMs)
        if (second.decision.action !== first.decision.action) {
          recordSkip(summary, second.decision.reason ?? "stale")
          console.log(
            `${LOG} Ticket ${listed.id} decision changed on re-check (${first.decision.action} → ${second.decision.action}${second.decision.reason ? `/${second.decision.reason}` : ""}) — skip`,
          )
          continue
        }

        const applied = await applyAction(
          second.ticket,
          second.decision.action,
          second.alreadySentClose,
          now,
        )
        if (applied === "follow_up") summary.followedUp += 1
        if (applied === "close") summary.closed += 1
        await sleep(delayMs)
      } catch (e) {
        summary.errors += 1
        console.error(`${LOG} Ticket ${listed.id} failed:`, e)
      }
    }

    logSummary(summary)
    return summary
  } finally {
    jobRunning = false
  }
}

const logSummary = (summary: FollowUpSummary): void => {
  console.log(
    `${LOG} scanned=${summary.scanned} skipped-linked-tracker=${summary.skippedLinkedTracker} skipped-parked=${summary.skippedParked} skipped-waiting-on-us=${summary.skippedWaitingOnUs} skipped-too-soon=${summary.skippedTooSoon} skipped-already-acted=${summary.skippedAlreadyActed} skipped-stale=${summary.skippedStale} skipped-overlap=${summary.skippedOverlap} followed-up=${summary.followedUp} closed=${summary.closed} errors=${summary.errors}`,
  )
}

let scheduled: ReturnType<typeof cron.schedule> | undefined

export const startFollowUpCron = (): ReturnType<typeof cron.schedule> | undefined => {
  if (!isFollowUpCronEnabled()) {
    console.log(`${LOG} Cron not started (test env or FOLLOWUP_CRON=off)`)
    return undefined
  }

  const { cron: expression, timezone } = config.followUp
  if (!cron.validate(expression)) {
    console.error(`${LOG} Invalid cron expression "${expression}" — job not scheduled`)
    return undefined
  }

  scheduled = cron.schedule(
    expression,
    () => {
      void runFollowUpJob().catch((e) => {
        console.error(`${LOG} Uncaught job error:`, e)
      })
    },
    {
      name: "gleap-noreply-followup",
      timezone,
      noOverlap: true,
    },
  )

  console.log(
    `${LOG} Scheduled "${expression}" (${timezone}). Single PM2 process only — multi-instance deploy is unsupported.`,
  )
  return scheduled
}
