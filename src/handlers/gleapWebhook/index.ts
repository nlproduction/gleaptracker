import type { Request, Response } from "express";
import { ticket as gleapTicket } from "../../integrations/gleap/predicates";
import { processTrackerTicket } from "../../integrations/gleap/tracker";
import {
  handleOnSlack,
  handleTicketDone,
  handleTicketReopened,
  handleTypeChange,
} from "./slack";
import type { GleapWebhookPayload, GleapWebhookTicket } from "./types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ---------------------------------------------------------------------------
// ticket.updated routing
// ---------------------------------------------------------------------------

const handleTicketUpdated = async (t: GleapWebhookTicket) => {
  if (gleapTicket.isDone(t)) return handleTicketDone(t);
  if (!gleapTicket.isActionableStatus(t)) {
    console.log(
      `[Gleap] Ticket ${t.id} skipped — status "${t.status}" not actionable`,
    );
    return;
  }
  if (gleapTicket.isOnSlackStatus(t))
    return gleapTicket.hasSlackThread(t)
      ? handleTicketReopened(t)
      : handleOnSlack(t);
  if (gleapTicket.isUnconfirmed(t)) return handleTypeChange(t);
  if (gleapTicket.isLinkedToTracker(t)) return;
  if (gleapTicket.isTrackerTicket(t)) return processTrackerTicket(t);
};

// ---------------------------------------------------------------------------
// Express route handlers
// ---------------------------------------------------------------------------

export function gleapOptions(_req: Request, res: Response): void {
  res.set(corsHeaders).status(200).end();
}

export async function gleapPost(req: Request, res: Response): Promise<void> {
  let payload: GleapWebhookPayload;
  try {
    payload = req.body as GleapWebhookPayload;
  } catch {
    res.status(400).set(corsHeaders).send("Invalid JSON");
    return;
  }

  const { event, data: ticket } = payload;

  try {
    console.log(
      `[Gleap webhook] ${event} — ticket ${ticket?.id} (bugId: ${ticket?.bugId})`,
    );

    if (!ticket) {
      console.error("[Gleap webhook] Payload missing 'data' field — skipping");
      res.status(200).set(corsHeaders).end();
      return;
    }

    if (event === "ticket.created") {
      await processTrackerTicket(ticket);
    } else if (event === "ticket.updated") {
      await handleTicketUpdated(ticket);
    } else {
      console.log(`[Gleap webhook] Event "${event}" not handled`);
    }
  } catch (e) {
    console.error("[Gleap webhook] Error:", e);
    res
      .status(500)
      .set(corsHeaders)
      .json({ error: String(e) });
    return;
  }

  res.status(200).set(corsHeaders).end();
}
