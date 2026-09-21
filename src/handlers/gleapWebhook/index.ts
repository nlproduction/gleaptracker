import type { Request, Response } from "express"
import { closeTracker } from "../../integrations/gleap/close"
import { isTrackerDone, isTrackerTicket } from "../../integrations/gleap/client"
import { findLinkedTracker } from "../../integrations/gleap/linked"
import { ensureTrackerTicketType } from "../../integrations/gleap/tracker"
import { syncTrackerSlack } from "./slack"
import type { GleapWebhookPayload, GleapWebhookTicket } from "./types"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const handleTrackerEvent = async (ticket: GleapWebhookTicket): Promise<void> => {
  await ensureTrackerTicketType(ticket)
  if (isTrackerDone(ticket)) {
    await closeTracker(ticket, { silent: true, source: "gleap" })
    return
  }
  await syncTrackerSlack(ticket)
}

const handleCustomerEvent = async (ticket: GleapWebhookTicket): Promise<void> => {
  const tracker = await findLinkedTracker(ticket)
  if (!tracker) {
    console.log(
      `[Gleap] Ticket ${ticket.id} has no linked tracker — Slack is created on Link to tracker`,
    )
    return
  }
  await syncTrackerSlack(tracker, { triggerTicketId: ticket.id })
}

const handleTicket = async (ticket: GleapWebhookTicket): Promise<void> => {
  if (isTrackerTicket(ticket)) return handleTrackerEvent(ticket)
  return handleCustomerEvent(ticket)
}

export function gleapOptions(_req: Request, res: Response): void {
  res.set(corsHeaders).status(200).end()
}

export async function gleapPost(req: Request, res: Response): Promise<void> {
  let payload: GleapWebhookPayload
  try {
    payload = req.body as GleapWebhookPayload
  } catch {
    res.status(400).set(corsHeaders).send("Invalid JSON")
    return
  }

  const { event, data: ticket } = payload

  try {
    console.log(
      `[Gleap webhook] ${event} — ticket ${ticket?.id} (bugId: ${ticket?.bugId})`,
    )

    if (!ticket) {
      console.error("[Gleap webhook] Payload missing 'data' field — skipping")
      res.status(200).set(corsHeaders).end()
      return
    }

    if (event === "ticket.created" || event === "ticket.updated") {
      await handleTicket(ticket)
    } else {
      console.log(`[Gleap webhook] Event "${event}" not handled`)
    }
  } catch (e) {
    console.error("[Gleap webhook] Error:", e)
    res.status(500).set(corsHeaders).json({ error: String(e) })
    return
  }

  res.status(200).set(corsHeaders).end()
}
