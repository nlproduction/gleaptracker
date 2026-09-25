import type { Request, Response } from "express"
import config from "../../gleaptracker.config"
import { closeTracker } from "../integrations/gleap/close"
import { findTrackerByBugId } from "../integrations/gleap/linked"
import { createDeliveryDedup } from "../utils/async"
import { isRecord, rawBodyToString, trackerBugId, verifyHmac } from "../utils/webhooks"

const dedup = createDeliveryDedup()
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, linear-signature, linear-delivery",
}

export function linearOptions(_req: Request, res: Response): void {
  res.set(corsHeaders).status(200).end()
}

export async function linearPost(req: Request, res: Response): Promise<void> {
  const rawBody = rawBodyToString(req.body)
  const cfg = config.linear
  if (!verifyHmac(req.get("linear-signature") || "", rawBody, cfg?.webhookSecret)) {
    res.status(401).set(corsHeaders).send("Invalid signature")
    return
  }
  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    res.status(400).set(corsHeaders).send("Invalid JSON")
    return
  }
  if (!isRecord(payload)) {
    res.status(400).set(corsHeaders).send("Invalid payload")
    return
  }
  // Linear signs a millisecond timestamp inside every webhook payload.
  if (typeof payload.webhookTimestamp !== "number" || !Number.isFinite(payload.webhookTimestamp) ||
      Math.abs(Date.now() - payload.webhookTimestamp) > 60_000) {
    res.status(401).set(corsHeaders).send("Invalid webhook timestamp")
    return
  }
  if (payload.type !== "Issue" || payload.action !== "update") {
    res.status(200).set(corsHeaders).send("Event not tracked")
    return
  }
  const issue = payload.data
  if (!isRecord(issue) || typeof issue.id !== "string" || !issue.id || typeof issue.title !== "string") {
    res.status(400).set(corsHeaders).send("Invalid issue payload")
    return
  }
  // Edits to an already-completed issue must not re-close a reopened tracker.
  if (isRecord(payload.updatedFrom) && !("stateId" in payload.updatedFrom)) {
    res.status(200).set(corsHeaders).send("No state transition")
    return
  }
  if (!isRecord(issue.state) || issue.state.type !== "completed" ||
      (cfg?.teamId && typeof issue.teamId === "string" && issue.teamId !== cfg.teamId)) {
    res.status(200).set(corsHeaders).send("State or team not tracked")
    return
  }
  const bugId = trackerBugId(issue.title, issue.description)
  if (!bugId) {
    res.status(200).set(corsHeaders).send("No Gleap tracker reference")
    return
  }
  try {
    const tracker = await findTrackerByBugId(bugId)
    if (!tracker) {
      res.status(200).set(corsHeaders).send("Tracker not found")
      return
    }
    const savedUuid = tracker.formData?.linearIssueUuid
    const savedIdentifier = tracker.formData?.linearIssueId
    const linked = savedUuid ? savedUuid === issue.id
      : savedIdentifier ? savedIdentifier === issue.identifier || savedIdentifier === issue.id
      : Array.isArray(issue.labels) && issue.labels.some((label) =>
          isRecord(label) && typeof label.name === "string" &&
          label.name.toLowerCase() === cfg?.trackerLabel?.toLowerCase())
    if (!linked) {
      res.status(200).set(corsHeaders).send("Issue is not linked to this tracker")
      return
    }
    const delivery = req.get("linear-delivery") || `${issue.id}:${issue.updatedAt ?? payload.webhookTimestamp}`
    await dedup(`linear:${delivery}:${bugId}`, () => closeTracker(tracker, { source: "linear" }))
    res.status(200).set(corsHeaders).end()
  } catch (error) {
    console.error("[Linear webhook] Error:", error)
    res.status(500).set(corsHeaders).json({ error: "Tracker close failed; retry this delivery" })
  }
}
