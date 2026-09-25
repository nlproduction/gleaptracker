import type { Request, Response } from "express"
import config from "../../gleaptracker.config"
import { closeTracker } from "../integrations/gleap/close"
import { findTrackerByBugId } from "../integrations/gleap/linked"
import { createDeliveryDedup } from "../utils/async"
import { isRecord, rawBodyToString, trackerBugId, verifyHmac, verifySharedSecret } from "../utils/webhooks"

const dedup = createDeliveryDedup()
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Hub-Signature, X-Gleaptracker-Secret",
}

export function jiraOptions(_req: Request, res: Response): void {
  res.set(corsHeaders).status(200).end()
}

export async function jiraPost(req: Request, res: Response): Promise<void> {
  const cfg = config.jira
  const rawBody = rawBodyToString(req.body)
  const signature = req.get("X-Hub-Signature")
  // A bad native signature can never downgrade to legacy shared-secret auth.
  const authenticated = signature !== undefined
    ? signature.startsWith("sha256=") && !!rawBody && verifyHmac(signature.slice(7), rawBody, cfg?.webhookSecret)
    : verifySharedSecret(req.get("X-Gleaptracker-Secret") || req.query?.secret, cfg?.webhookSecret)
  if (!authenticated) {
    res.status(401).set(corsHeaders).send("Invalid webhook authentication")
    return
  }
  let payload: unknown
  try {
    payload = rawBody ? JSON.parse(rawBody) : req.body
  } catch {
    res.status(400).set(corsHeaders).send("Invalid JSON")
    return
  }
  if (!isRecord(payload)) {
    res.status(400).set(corsHeaders).send("Invalid payload")
    return
  }
  if (payload.webhookEvent !== "jira:issue_updated") {
    res.status(200).set(corsHeaders).send("Event not tracked")
    return
  }
  const issue = payload.issue
  if (!isRecord(issue) || typeof issue.key !== "string" || !isRecord(issue.fields) ||
      typeof issue.fields.summary !== "string" || !isRecord(payload.changelog) ||
      !Array.isArray(payload.changelog.items)) {
    res.status(400).set(corsHeaders).send("Invalid issue or changelog payload")
    return
  }
  const statusChange = payload.changelog.items.find((item) => isRecord(item) && item.field === "status")
  const doneNames = cfg?.doneStatusNames?.length ? cfg.doneStatusNames : [cfg?.doneStatusName]
  if (!isRecord(statusChange) || typeof statusChange.toString !== "string" ||
      !doneNames.includes(statusChange.toString) || statusChange.fromString === statusChange.toString) {
    res.status(200).set(corsHeaders).send("No completed status transition")
    return
  }
  const projectKey = isRecord(issue.fields.project) ? issue.fields.project.key : issue.key.split("-")[0]
  if (cfg?.projectKey && projectKey !== cfg.projectKey) {
    res.status(200).set(corsHeaders).send("Project not tracked")
    return
  }
  const bugId = trackerBugId(issue.fields.summary, issue.fields.description) ??
    (Array.isArray(issue.fields.labels)
      ? issue.fields.labels.find((label): label is string => typeof label === "string" && /^gleap-\d+$/.test(label))?.slice(6)
      : undefined)
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
    const savedId = tracker.formData?.jiraIssueInternalId
    const savedKey = tracker.formData?.jiraIssueId
    if ((savedId && String(savedId) !== String(issue.id)) || (savedKey && savedKey !== issue.key)) {
      res.status(200).set(corsHeaders).send("Issue is not linked to this tracker")
      return
    }
    const delivery = req.get("X-Atlassian-Webhook-Identifier") ||
      `${issue.key}:${payload.changelog.id ?? payload.timestamp ?? issue.fields.updated ?? "done"}`
    await dedup(`jira:${delivery}:${bugId}`, () => closeTracker(tracker, { source: "jira" }))
    res.status(200).set(corsHeaders).end()
  } catch (error) {
    console.error("[Jira webhook] Error:", error)
    res.status(500).set(corsHeaders).json({ error: "Tracker close failed; retry this delivery" })
  }
}
