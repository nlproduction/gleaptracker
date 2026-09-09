import config from "../../../gleaptracker.config"
import { getGleapClient, isTrackerDone } from "../../integrations/gleap/client"
import { extractDescription } from "../../integrations/gleap/linked"
import {
  patchTicketFormData,
  readTrackerForm,
  TRACKER_FORM,
} from "../../integrations/gleap/formData"
import {
  markLinkedInProgress,
  loadCustomerTickets,
  loadTicket,
  pickPrimaryCustomer,
} from "../../integrations/gleap/linked"
import { getSlackClient } from "../../integrations/slack/client"
import {
  buildNewRelatedTicketText,
  buildTrackerRootBlocks,
} from "../../integrations/slack/blocks"
import type { GleapTicket } from "../../integrations/gleap/client"

const SLACK_CHANNEL_ID = config.slack.channelId

const slackCreating = new Set<string>()
const SLACK_DEDUP_TTL_MS = 30_000

const withCreateDedup = async (
  trackerId: string,
  fn: () => Promise<void>,
): Promise<void> => {
  if (slackCreating.has(trackerId)) {
    console.log(`[Gleap] Already creating Slack thread for tracker ${trackerId} — skipping`)
    return
  }
  slackCreating.add(trackerId)
  setTimeout(() => slackCreating.delete(trackerId), SLACK_DEDUP_TTL_MS)
  await fn()
}

const extrasFor = (primary: GleapTicket, customers: GleapTicket[]): GleapTicket[] =>
  customers.filter((c) => c.id !== primary.id)

export const refreshTrackerHeader = async (
  tracker: GleapTicket,
  customers: GleapTicket[],
  primary: GleapTicket,
  threadTs: string,
  closed?: boolean,
): Promise<void> => {
  const slack = getSlackClient()
  const extras = extrasFor(primary, customers)
  const isClosed = closed ?? isTrackerDone(tracker)
  await slack.chat.update({
    channel: SLACK_CHANNEL_ID,
    ts: threadTs,
    text: `#${primary.bugId} ${primary.title}`,
    blocks: buildTrackerRootBlocks({ tracker, primary, extras, closed: isClosed }),
  })
}

export const postInTrackerThread = async (
  threadTs: string,
  text: string,
): Promise<void> => {
  const slack = getSlackClient()
  await slack.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    thread_ts: threadTs,
    text,
  })
}

const createTrackerThread = async (
  tracker: GleapTicket,
  customers: GleapTicket[],
  primary: GleapTicket,
): Promise<void> => {
  await withCreateDedup(tracker.id, async () => {
    const latest = (await loadTicket(tracker.id)) ?? tracker
    if (readTrackerForm(latest.formData).slackThreadTs) {
      console.log(`[Gleap] Tracker ${tracker.id} already has a Slack thread — skipping create`)
      return
    }

    const slack = getSlackClient()
    const extras = extrasFor(primary, customers)
    const msg = await slack.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: `#${primary.bugId} ${primary.title}`,
      metadata: {
        event_type: "gleap_ticket",
        event_payload: { gleap_ticket_id: tracker.id },
      },
      blocks: buildTrackerRootBlocks({ tracker: latest, primary, extras }),
    })

    if (!msg.ok || !msg.ts) {
      console.error(`[Gleap] Slack postMessage failed: ${msg.error}`)
      return
    }

    const permalink = await slack.chat.getPermalink({
      channel: SLACK_CHANNEL_ID,
      message_ts: msg.ts,
    })
    const threadUrl = permalink.ok ? (permalink.permalink ?? "") : ""

    const description = extractDescription(latest)
    if (description) {
      await postInTrackerThread(msg.ts, description)
    }

    await patchTicketFormData(latest.id, latest.formData, {
      [TRACKER_FORM.slackThread]: threadUrl,
      [TRACKER_FORM.slackThreadTs]: msg.ts,
      [TRACKER_FORM.primaryTicketId]: primary.id,
      [TRACKER_FORM.notifiedIds]: customers.map((c) => c.id).join(","),
    })

    if (threadUrl) {
      await getGleapClient().messages.addNote(latest.id, `Slack thread: ${threadUrl}`)
    }

    await Promise.all(customers.map((c) => markLinkedInProgress(c)))

    console.log(
      `[Gleap] Tracker ${latest.id} Slack thread created (${threadUrl || msg.ts}) ✓`,
    )
  })
}

export const syncTrackerSlack = async (
  trackerHint: GleapTicket,
  opts: { triggerTicketId?: string } = {},
): Promise<void> => {
  const tracker = (await loadTicket(trackerHint.id)) ?? trackerHint
  const customers = await loadCustomerTickets(tracker)
  if (!customers.length) {
    console.log(
      `[Gleap] Tracker ${tracker.id} has no linked customer tickets — skipping Slack`,
    )
    return
  }

  const state = readTrackerForm(tracker.formData)
  const primary = pickPrimaryCustomer(
    customers,
    state.primaryTicketId,
    opts.triggerTicketId,
  )
  if (!primary) return

  if (!state.slackThreadTs) {
    await createTrackerThread(tracker, customers, primary)
    return
  }

  if (
    opts.triggerTicketId &&
    state.notifiedIds.includes(opts.triggerTicketId) &&
    !isTrackerDone(tracker) &&
    !state.closeProcessed
  ) {
    return
  }

  await refreshTrackerHeader(tracker, customers, primary, state.slackThreadTs)

  const newcomers = customers.filter((c) => !state.notifiedIds.includes(c.id))
  for (const ticket of newcomers) {
    await postInTrackerThread(state.slackThreadTs, buildNewRelatedTicketText(ticket))
    await markLinkedInProgress(ticket)
    console.log(
      `[Gleap] Tracker ${tracker.id} — new related ticket ${ticket.id} (#${ticket.bugId}) ✓`,
    )
  }

  const formPatch: Record<string, unknown> = {}
  if (!state.primaryTicketId) formPatch[TRACKER_FORM.primaryTicketId] = primary.id
  if (newcomers.length) {
    formPatch[TRACKER_FORM.notifiedIds] = customers.map((c) => c.id).join(",")
  }

  if (state.closeProcessed && !isTrackerDone(tracker)) {
    formPatch[TRACKER_FORM.closeProcessed] = "false"
    formPatch[TRACKER_FORM.closeSilent] = "false"
    await postInTrackerThread(state.slackThreadTs, "🔄 Reopened")
    console.log(`[Gleap] Tracker ${tracker.id} reopened — Slack thread updated ✓`)
  }

  if (Object.keys(formPatch).length) {
    await patchTicketFormData(tracker.id, tracker.formData, formPatch)
  }
}

export const markTrackerSlackClosed = async (tracker: GleapTicket): Promise<void> => {
  const state = readTrackerForm(tracker.formData)
  if (!state.slackThreadTs) return

  const customers = await loadCustomerTickets(tracker)
  const primary = pickPrimaryCustomer(customers, state.primaryTicketId)
  if (!primary) return

  await refreshTrackerHeader(
    { ...tracker, status: config.gleap.doneStatus },
    customers,
    primary,
    state.slackThreadTs,
    true,
  )
  await postInTrackerThread(state.slackThreadTs, "✅ Closed")
  console.log(`[Gleap] Tracker ${tracker.id} marked as closed on Slack ✓`)
}
