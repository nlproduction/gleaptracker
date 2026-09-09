import cron from "node-cron"
import config from "../../gleaptracker.config"
import { getGleapClient, isTrackerTicket, type GleapTicket } from "../integrations/gleap/client"
import { findLinkedTracker } from "../integrations/gleap/linked"
import {
  analyzeConversation,
  decideFollowUpAction,
  shouldSkipCustomerTicket,
  type FollowUpKind,
} from "./followUpDecision"

const LOG = "[follow-up]"
const LIST_PAGE_SIZE = 100
const MESSAGE_PAGE_SIZE = 100
const MESSAGE_PAGE_CAP = 10
const DEFAULT_DELAY_MS = 200
const CUSTOMER_TYPES = "BUG,INQUIRY"
const CANDIDATE_STATUSES = "OPEN,INPROGRESS"

export interface FollowUpSummary {
  scanned: number
  skippedLinkedTracker: number
  skippedParked: number
  followedUp: number
  closed: number
  errors: number
}

export const emptyFollowUpSummary = (): FollowUpSummary => ({
  scanned: 0,
  skippedLinkedTracker: 0,
  skippedParked: 0,
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

const recordSkip = (summary: FollowUpSummary, reason: string): void => {
  if (reason === "linked_active_tracker") summary.skippedLinkedTracker += 1
  else if (reason === "parked_status" || reason === "tracker_ticket") summary.skippedParked += 1
}

const listCandidateTickets = async (delayMs: number): Promise<GleapTicket[]> => {
  const gleap = getGleapClient()
  const all: GleapTicket[] = []
  let skip = 0

  for (;;) {
    const page = await gleap.tickets.list({
      status: CANDIDATE_STATUSES,
      type: CUSTOMER_TYPES,
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

  return all.filter((t) => !isTrackerTicket(t))
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

const applyAction = async (
  ticket: GleapTicket,
  action: FollowUpKind,
  alreadySentClose: boolean,
): Promise<FollowUpKind> => {
  if (action === "none") return "none"
  const gleap = getGleapClient()
  const { followUpMessage, closeMessage } = config.followUp

  if (action === "follow_up") {
    const ok = await gleap.messages.sendMessage(ticket.id, followUpMessage)
    if (!ok) throw new Error(`follow-up send failed for ${ticket.id}`)
    console.log(`${LOG} Follow-up sent to ticket ${ticket.id} (bugId ${ticket.bugId}) ✓`)
    return "follow_up"
  }

  if (!alreadySentClose) {
    const ok = await gleap.messages.sendMessage(ticket.id, closeMessage)
    if (!ok) throw new Error(`close message send failed for ${ticket.id}`)
  }
  const closed = await gleap.tickets.update(ticket.id, { status: config.gleap.doneStatus })
  if (!closed) throw new Error(`close status update failed for ${ticket.id}`)
  console.log(`${LOG} Closed ticket ${ticket.id} (bugId ${ticket.bugId}) — no reply ✓`)
  return "close"
}

export const runFollowUpJob = async (
  now: Date = new Date(),
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<FollowUpSummary> => {
  const summary = emptyFollowUpSummary()
  const followUp = config.followUp
  console.log(`${LOG} Starting no-reply job`)

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
      const ticket =
        listed.linkedTickets !== undefined
          ? listed
          : ((await getGleapClient().tickets.get(listed.id)) ?? listed)
      if (listed.linkedTickets === undefined) await sleep(delayMs)

      const tracker = await findLinkedTracker(ticket)
      await sleep(delayMs)

      const skip = shouldSkipCustomerTicket(ticket, tracker)
      if (skip) {
        recordSkip(summary, skip)
        continue
      }

      const messages = await listTicketMessages(ticket.id, delayMs)
      const cursor = analyzeConversation(messages, followUp)
      const decision = decideFollowUpAction({
        now,
        lastCustomerAt: cursor.lastCustomerAt,
        lastAgentAt: cursor.lastAgentAt,
        alreadySentFollowUp: cursor.alreadySentFollowUp,
        alreadySentClose: cursor.alreadySentClose,
        followUpAfterDays: followUp.followUpAfterDays,
        closeAfterDays: followUp.closeAfterDays,
      })

      if (decision.action === "none") continue

      const applied = await applyAction(ticket, decision.action, cursor.alreadySentClose)
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
}

const logSummary = (summary: FollowUpSummary): void => {
  console.log(
    `${LOG} scanned=${summary.scanned} skipped-linked-tracker=${summary.skippedLinkedTracker} followed-up=${summary.followedUp} closed=${summary.closed} errors=${summary.errors}`,
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
    `${LOG} Scheduled "${expression}" (${timezone}). Assumes a single PM2 process.`,
  )
  return scheduled
}
