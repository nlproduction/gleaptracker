import config from "../../../gleaptracker.config"
import { getGleapClient, isTrackerDone, type GleapTicket } from "./client"
import { patchTicketFormData, readTrackerForm, TRACKER_FORM } from "./formData"
import { linkedIds, loadCustomerTickets, loadTicket } from "./linked"
import { markTrackerSlackClosed } from "../../handlers/gleapWebhook/slack"

export interface CloseTrackerOpts {
  silent?: boolean
  /** When set, sent to each linked customer ticket instead of workflow / default message */
  message?: string
  source?: string
}

const notifyLinkedCustomers = async (
  customerIds: string[],
  message?: string,
): Promise<void> => {
  const gleap = getGleapClient()
  const source = "close"

  if (!customerIds.length) return

  if (message?.trim()) {
    await Promise.all(
      customerIds.map(async (id) => {
        const ok = await gleap.messages.sendMessage(id, message)
        if (ok) console.log(`[${source}] Bug-fixed message sent to ticket ${id} ✓`)
      }),
    )
    return
  }

  if (config.gleap.workflowId) {
    await Promise.all(
      customerIds.map(async (id) => {
        const ok = await gleap.tickets.runWorkflow(id, config.gleap.workflowId!)
        if (ok) console.log(`[${source}] Workflow applied to ticket ${id} ✓`)
      }),
    )
    return
  }

  if (config.gleap.bugFixedMessage) {
    const msg = config.gleap.bugFixedMessage
    await Promise.all(
      customerIds.map(async (id) => {
        const ok = await gleap.messages.sendMessage(id, msg)
        if (ok) console.log(`[${source}] Bug-fixed message sent to ticket ${id} ✓`)
      }),
    )
    return
  }

  console.log(
    `[${source}] No workflowId or bugFixedMessage configured — skipping customer notification`,
  )
}

export const closeTracker = async (
  trackerHint: GleapTicket,
  opts: CloseTrackerOpts = {},
): Promise<void> => {
  const tracker = (await loadTicket(trackerHint.id)) ?? trackerHint
  const state = readTrackerForm(tracker.formData)
  const alreadyDone = isTrackerDone(tracker)
  const source = opts.source ?? "close"

  if (alreadyDone && state.closeProcessed) {
    console.log(`[${source}] Tracker ${tracker.id} already closed — skipping notify`)
    return
  }

  // Manual DONE in the Gleap UI must not fan out bugFixedMessage / workflow.
  const silent = Boolean(
    opts.silent || state.closeSilent || opts.source === "gleap",
  )
  const customers = await loadCustomerTickets(tracker)
  const customerIds = customers.length ? customers.map((c) => c.id) : linkedIds(tracker)

  if (!silent && !state.closeProcessed) {
    await notifyLinkedCustomers(customerIds, opts.message)
  } else if (silent) {
    console.log(`[${source}] Silent close — no customer messages for tracker ${tracker.id}`)
  }

  await patchTicketFormData(tracker.id, tracker.formData, {
    [TRACKER_FORM.closeProcessed]: "true",
    [TRACKER_FORM.closeSilent]: silent ? "true" : "false",
  })

  if (!alreadyDone) {
    const ok = await getGleapClient().tickets.update(tracker.id, {
      status: config.gleap.doneStatus,
    })
    if (ok) console.log(`[${source}] Tracker ticket ${tracker.id} marked as DONE ✓`)
  }

  const latest = (await loadTicket(tracker.id)) ?? tracker
  await markTrackerSlackClosed({
    ...latest,
    status: config.gleap.doneStatus,
    formData: { ...(tracker.formData ?? {}), ...(latest.formData ?? {}) },
  })
}
