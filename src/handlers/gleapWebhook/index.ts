import type { Request, Response } from "express"
import config from "../../../gleaptracker.config"
import { closeTracker } from "../../integrations/gleap/close"
import { isTrackerDone, isTrackerTicket } from "../../integrations/gleap/client"
import { findLinkedTracker } from "../../integrations/gleap/linked"
import { ensureTrackerTicketType, processTrackerTicket } from "../../integrations/gleap/tracker"
import { isRecord, verifySharedSecret } from "../../utils/webhooks"
import { syncTrackerSlack } from "./slack"
import type { GleapWebhookTicket } from "./types"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const syncActiveTracker = async (ticket: GleapWebhookTicket, triggerTicketId?: string): Promise<void> => {
  // Keep Slack usable when an optional provider is temporarily unavailable.
  try {
    await processTrackerTicket(ticket)
  } finally {
    if (triggerTicketId) await syncTrackerSlack(ticket, { triggerTicketId })
    else await syncTrackerSlack(ticket)
  }
}

const handleTicket = async (ticket: GleapWebhookTicket): Promise<void> => {
  if (isTrackerTicket(ticket)) {
    await ensureTrackerTicketType(ticket)
    if (isTrackerDone(ticket)) {
      await closeTracker(ticket, { silent: true, source: "gleap" })
      return
    }
    await syncActiveTracker(ticket)
    return
  }
  const tracker = await findLinkedTracker(ticket)
  if (!tracker) return
  await syncActiveTracker(tracker, ticket.id)
}

export function gleapOptions(_req: Request, res: Response): void {
  res.set(corsHeaders).status(200).end()
}

export async function gleapPost(req: Request, res: Response): Promise<void> {
  if (config.gleap.webhookSecret) {
    const authorization = req.get("Authorization") || ""
    const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : req.query?.secret
    if (!verifySharedSecret(supplied, config.gleap.webhookSecret)) {
      res.status(401).set(corsHeaders).send("Invalid webhook authentication")
      return
    }
  }
  const payload: unknown = req.body
  if (!isRecord(payload)) {
    res.status(400).set(corsHeaders).send("Invalid payload")
    return
  }
  if (payload.event !== "ticket.created" && payload.event !== "ticket.updated") {
    res.status(200).set(corsHeaders).send("Event not tracked")
    return
  }
  if (!isRecord(payload.data) || typeof payload.data.id !== "string" || !payload.data.id ||
      typeof payload.data.type !== "string" || typeof payload.data.title !== "string" ||
      typeof payload.data.bugId !== "number") {
    res.status(400).set(corsHeaders).send("Invalid ticket payload")
    return
  }
  try {
    await handleTicket(payload.data as unknown as GleapWebhookTicket)
    res.status(200).set(corsHeaders).end()
  } catch (error) {
    console.error("[Gleap webhook] Error:", error)
    res.status(500).set(corsHeaders).json({ error: "Tracker synchronization failed; retry this delivery" })
  }
}
