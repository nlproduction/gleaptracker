import config from "../../../gleaptracker.config"
import { createKeyedLock } from "../../utils/async"
import { getGleapClient, isTrackerDone, type GleapTicket } from "./client"
import { patchTicketFormData, readTrackerForm, TRACKER_FORM } from "./formData"
import { linkedIds, loadCustomerTickets, loadTicket } from "./linked"
import { markTrackerSlackClosed } from "../../handlers/gleapWebhook/slack"

export interface CloseTrackerOpts {
  silent?: boolean
  /** Custom text overrides the configured workflow/default message. */
  message?: string
  source?: string
}

const notifyLinkedCustomers = async (customerIds: string[], message?: string): Promise<void> => {
  if (!customerIds.length) return
  const gleap = getGleapClient()
  let notify: ((id: string) => Promise<boolean>) | undefined
  if (message?.trim()) notify = (id) => gleap.messages.sendMessage(id, message)
  else if (config.gleap.workflowId) {
    const workflowId = config.gleap.workflowId
    notify = (id) => gleap.tickets.runWorkflow(id, workflowId)
  } else if (config.gleap.bugFixedMessage) {
    const text = config.gleap.bugFixedMessage
    notify = (id) => gleap.messages.sendMessage(id, text)
  }
  if (!notify) {
    console.log("[close] No workflow or customer message configured — skipping notification")
    return
  }
  const send = notify
  await Promise.all(customerIds.map(async (id) => {
    if (!await send(id)) throw new Error(`[close] Customer notification/workflow failed for ${id}`)
    console.log(`[close] Customer ${id} notified ✓`)
  }))
}

const closeTrackerUnlocked = async (trackerHint: GleapTicket, opts: CloseTrackerOpts): Promise<void> => {
  const tracker = (await loadTicket(trackerHint.id)) ?? trackerHint
  const state = readTrackerForm(tracker.formData)
  const alreadyDone = isTrackerDone(tracker)
  const source = opts.source ?? "close"
  if (alreadyDone && state.closeProcessed) {
    console.log(`[${source}] Tracker ${tracker.id} already closed — skipping notify`)
    return
  }

  // Manual DONE in Gleap must never send customer notifications.
  const silent = Boolean(opts.silent || state.closeSilent || source === "gleap")
  const customers = await loadCustomerTickets(tracker)
  const customerIds = customers.length ? customers.map((c) => c.id) : linkedIds(tracker)
  if (!silent && !state.closeProcessed) await notifyLinkedCustomers(customerIds, opts.message)

  const saved = await patchTicketFormData(tracker.id, tracker.formData, {
    [TRACKER_FORM.closeProcessed]: "true",
    [TRACKER_FORM.closeSilent]: silent ? "true" : "false",
  })
  if (!saved) throw new Error(`[${source}] Failed to save close state for ${tracker.id}`)
  if (!alreadyDone) {
    if (!await getGleapClient().tickets.update(tracker.id, { status: config.gleap.doneStatus })) {
      throw new Error(`[${source}] Failed to close tracker ${tracker.id}`)
    }
  }
  const latest = (await loadTicket(tracker.id)) ?? tracker
  await markTrackerSlackClosed({
    ...latest, status: config.gleap.doneStatus,
    formData: { ...(tracker.formData ?? {}), ...(latest.formData ?? {}) },
  })
}

const closeLock = createKeyedLock()
/** Serialize closes from all providers, not just retries of one delivery. */
export const closeTracker = (tracker: GleapTicket, opts: CloseTrackerOpts = {}): Promise<void> =>
  closeLock(tracker.id, () => closeTrackerUnlocked(tracker, opts))
