import type { Request, Response } from "express";
import config from "../../../gleaptracker.config";
import { getGleapClient } from "../../integrations/gleap/client";
import { processTrackerTicket } from "../../integrations/gleap/tracker";
import {
  handleOnSlack,
  handleTicketDone,
  handleTicketReopened,
  handleTypeChange,
  sendToSlackAndSave,
  slackSentTickets,
  SLACK_DEDUP_TTL_MS,
} from "./slack";
import type { GleapWebhookPayload, GleapWebhookTicket } from "./types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const ONSLACK_STATUSES = config.gleap.onSlackStatuses;
const ONSLACK_STATUS_VALUES = Object.values(ONSLACK_STATUSES) as string[];

// ---------------------------------------------------------------------------
// "send-to-slack" tag handler
// ---------------------------------------------------------------------------

const handleSendToSlackTag = async (
  ticket: GleapWebhookTicket,
): Promise<boolean> => {
  if (!ticket.tags?.includes("send-to-slack")) return false;

  const gleap = getGleapClient();
  const onSlackStatus =
    ONSLACK_STATUSES[ticket.type as keyof typeof ONSLACK_STATUSES];
  if (!onSlackStatus) {
    console.warn(
      `[Gleap] "send-to-slack" tag on ticket ${ticket.id} but type "${ticket.type}" has no onSlackStatus configured — skipping`,
    );
    return true;
  }

  const tagsWithoutFlag = (ticket.tags ?? []).filter(
    (t) => t !== "send-to-slack",
  );

  if (ticket.formData?.slack_thread) {
    console.log(
      `[Gleap] Ticket ${ticket.id} already on Slack — removing "send-to-slack" tag`,
    );
    await gleap.tickets.update(ticket.id, { tags: tagsWithoutFlag });
    return true;
  }

  // Add to dedup set BEFORE the API update so the resulting webhook is ignored
  slackSentTickets.add(ticket.id);
  setTimeout(() => slackSentTickets.delete(ticket.id), SLACK_DEDUP_TTL_MS);

  // Single atomic update: remove tag + set the correct "on Slack" status
  await gleap.tickets.update(ticket.id, {
    tags: tagsWithoutFlag,
    status: onSlackStatus,
  });
  ticket.status = onSlackStatus;
  ticket.tags = tagsWithoutFlag;

  const threadUrl = await sendToSlackAndSave(ticket);
  if (threadUrl)
    console.log(
      `[Gleap] Ticket ${ticket.id} "send-to-slack" tag processed → ${threadUrl} ✓`,
    );
  return true;
};

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

const hasSendToSlackTag = (t: GleapWebhookTicket) =>
  !!t.tags?.includes("send-to-slack");
const isDone = (t: GleapWebhookTicket) =>
  t.status === config.gleap.doneStatus && !!t.formData?.slack_thread_ts;
const isOnSlackStatus = (t: GleapWebhookTicket) =>
  ONSLACK_STATUS_VALUES.includes(t.status);
const isActionableStatus = (t: GleapWebhookTicket) =>
  ["OPEN", "INPROGRESS", ...ONSLACK_STATUS_VALUES].includes(t.status);
const hasSlackThread = (t: GleapWebhookTicket) => !!t.formData?.slack_thread_ts;
const isLinkedToTracker = (t: GleapWebhookTicket) =>
  !!(t.formData?.linearIssueId || t.formData?.jiraIssueId);
const isUnconfirmed = (t: GleapWebhookTicket) =>
  hasSlackThread(t) && !isLinkedToTracker(t);
const isTrackerTicket = (t: GleapWebhookTicket) =>
  !hasSlackThread(t) && !isLinkedToTracker(t);
const isStatusMismatch = (t: GleapWebhookTicket) =>
  (t.type === "BUG" && t.status === ONSLACK_STATUSES.INQUIRY) ||
  (t.type === "INQUIRY" && t.status === ONSLACK_STATUSES.BUG);

// ---------------------------------------------------------------------------
// Status mismatch correction
// ---------------------------------------------------------------------------

const correctOnSlackStatusMismatch = async (ticket: GleapWebhookTicket) => {
  if (ticket.type === "BUG" && ticket.status === ONSLACK_STATUSES.INQUIRY) {
    await getGleapClient().tickets.update(ticket.id, {
      status: ONSLACK_STATUSES.BUG,
    });
    ticket.status = ONSLACK_STATUSES.BUG;
  } else if (
    ticket.type === "INQUIRY" &&
    ticket.status === ONSLACK_STATUSES.BUG
  ) {
    await getGleapClient().tickets.update(ticket.id, {
      status: ONSLACK_STATUSES.INQUIRY,
    });
    ticket.status = ONSLACK_STATUSES.INQUIRY;
  }
};

// ---------------------------------------------------------------------------
// ticket.updated routing
// ---------------------------------------------------------------------------

const handleTicketUpdated = async (ticket: GleapWebhookTicket) => {
  if (hasSendToSlackTag(ticket)) return handleSendToSlackTag(ticket);

  if (isStatusMismatch(ticket)) await correctOnSlackStatusMismatch(ticket);
  if (isDone(ticket)) return handleTicketDone(ticket);
  if (!isActionableStatus(ticket)) {
    console.log(
      `[Gleap] Ticket ${ticket.id} skipped — status "${ticket.status}" not actionable`,
    );
    return;
  }
  if (isOnSlackStatus(ticket))
    return hasSlackThread(ticket)
      ? handleTicketReopened(ticket)
      : handleOnSlack(ticket);
  if (isUnconfirmed(ticket)) return handleTypeChange(ticket);
  if (isLinkedToTracker(ticket)) return;
  if (isTrackerTicket(ticket)) return processTrackerTicket(ticket);
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
