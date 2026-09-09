import { isTrackerDone, isTrackerTicket, type GleapTicket } from "./client"
import { readTrackerForm } from "./formData"

export const ticket = {
  isTracker: (t: GleapTicket) => isTrackerTicket(t),
  isDone: (t: GleapTicket) => isTrackerDone(t),
  hasSlackThread: (t: GleapTicket) => !!readTrackerForm(t.formData).slackThreadTs,
}
