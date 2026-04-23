import { KnownBlock } from "@slack/web-api";
import config from "../../../gleaptracker.config";
import { getGleapClient, getGleapTicketUrl } from "../../integrations/gleap/client";
import { getSlackClient } from "../../integrations/slack/client";
import type { GleapWebhookTicket } from "./types";

const SLACK_CHANNEL_ID = config.slack.channelId;

// ---------------------------------------------------------------------------
// Dedup guard — prevents duplicate Slack posts on concurrent webhooks
// ---------------------------------------------------------------------------

const slackSentTickets = new Set<string>();
const SLACK_DEDUP_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

export const buildActionsBlock = (ticketId: string, gleapUrl: string, showConfirmReject: boolean) => ({
  type: "actions" as const,
  elements: [
    ...(showConfirmReject
      ? [
          { type: "button", text: { type: "plain_text", text: "Confirm" }, style: "primary", action_id: "confirm", value: ticketId },
          { type: "button", text: { type: "plain_text", text: "Reject" }, action_id: "reject", value: ticketId },
        ]
      : []),
    { type: "button", text: { type: "plain_text", text: "Open in Gleap ↗" }, action_id: "open_gleap", url: gleapUrl, value: ticketId },
  ],
});

// ---------------------------------------------------------------------------
// Send to Slack
// ---------------------------------------------------------------------------

export const sendToSlack = async (
  ticket: GleapWebhookTicket,
): Promise<{ threadUrl: string; threadTs: string } | null> => {
  const slack = getSlackClient();
  const gleapUrl = getGleapTicketUrl(ticket.id, ticket.type);

  const user = ticket.session;
  const customerLine = [user?.name, user?.email].filter(Boolean).join("  ");
  const titleLine = `\`#${ticket.bugId}\`  *${ticket.title}*`;
  const headerText = customerLine ? `${titleLine}\n\n${customerLine}\n` : `${titleLine}\n`;

  const msg = await slack.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    text: `#${ticket.bugId} ${ticket.title}`,
    metadata: {
      event_type: "gleap_ticket",
      event_payload: { gleap_ticket_id: ticket.id },
    },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: headerText } },
      { type: "section", block_id: "status_block", text: { type: "mrkdwn", text: " " } },
      buildActionsBlock(ticket.id, gleapUrl, ticket.type === "BUG"),
    ],
  });

  if (!msg.ok || !msg.ts) {
    console.error(`[Gleap] Slack postMessage failed: ${msg.error}`);
    return null;
  }

  const permalink = await slack.chat.getPermalink({ channel: SLACK_CHANNEL_ID, message_ts: msg.ts });
  if (!permalink.ok || !permalink.permalink) return null;
  return { threadUrl: permalink.permalink, threadTs: msg.ts };
};

const sendToSlackAndSave = async (ticket: GleapWebhookTicket): Promise<string | null> => {
  const gleap = getGleapClient();
  const result = await sendToSlack(ticket);
  if (!result?.threadUrl) return null;

  await Promise.all([
    gleap.tickets.update(ticket.id, {
      formData: { slack_thread: result.threadUrl, slack_thread_ts: result.threadTs },
    }),
    gleap.messages.addNote(ticket.id, `Sent to Slack: ${result.threadUrl}`),
  ]);

  return result.threadUrl;
};

// ---------------------------------------------------------------------------
// Thread update handlers
// ---------------------------------------------------------------------------

export const handleOnSlack = async (ticket: GleapWebhookTicket) => {
  if (ticket.formData?.slack_thread) {
    console.log(`[Gleap] Ticket ${ticket.id} already on Slack: ${ticket.formData.slack_thread}`);
    return;
  }
  if (slackSentTickets.has(ticket.id)) {
    console.log(`[Gleap] Duplicate ONSLACK webhook for ticket ${ticket.id} — skipping`);
    return;
  }
  slackSentTickets.add(ticket.id);
  setTimeout(() => slackSentTickets.delete(ticket.id), SLACK_DEDUP_TTL_MS);

  const threadUrl = await sendToSlackAndSave(ticket);
  if (threadUrl) console.log(`[Gleap] Ticket ${ticket.id} sent to Slack: ${threadUrl} ✓`);
};

export const handleTicketDone = async (ticket: GleapWebhookTicket) => {
  const threadTs = ticket.formData?.slack_thread_ts;
  if (!threadTs) return;

  const slack = getSlackClient();
  const replies = await slack.conversations.replies({ channel: SLACK_CHANNEL_ID, ts: threadTs, limit: 1 });
  const root = replies.messages?.[0];
  if (!root) return;

  const existingBlocks = (root.blocks ?? []) as Array<Record<string, unknown>>;
  const statusBlock = existingBlocks.find((b) => b.block_id === "status_block");
  const statusText = ((statusBlock?.text as Record<string, unknown>)?.text as string) ?? "";

  if (statusText.includes("Closed")) {
    console.log(`[Gleap] Ticket ${ticket.id} already marked as closed on Slack — skipping`);
    return;
  }

  await slack.chat.postMessage({ channel: SLACK_CHANNEL_ID, thread_ts: threadTs, text: "✅ Closed" });

  const updatedBlocks = existingBlocks
    .filter((b) => b.block_id !== "status_block")
    .map((b) => {
      if (b.type !== "actions") return b;
      const elements = (b.elements as Array<Record<string, unknown>> | undefined) ?? [];
      const kept = elements.filter((e) => !["confirm", "reject"].includes(e.action_id as string));
      return kept.length ? { ...b, elements: kept } : null;
    })
    .filter(Boolean) as unknown as KnownBlock[];

  await slack.chat.update({
    channel: SLACK_CHANNEL_ID,
    ts: threadTs,
    text: "✅ Closed",
    blocks: [
      updatedBlocks[0],
      { type: "section", block_id: "status_block", text: { type: "mrkdwn", text: "✅ *Closed*" } },
      ...updatedBlocks.slice(1),
    ],
  });

  console.log(`[Gleap] Ticket ${ticket.id} marked as closed on Slack ✓`);
};

export const handleTicketReopened = async (ticket: GleapWebhookTicket) => {
  const threadTs = ticket.formData?.slack_thread_ts;
  if (!threadTs) return;

  const slack = getSlackClient();
  const replies = await slack.conversations.replies({ channel: SLACK_CHANNEL_ID, ts: threadTs, limit: 1 });
  const root = replies.messages?.[0];
  if (!root?.blocks) return;

  const statusBlock = (root.blocks as Array<Record<string, unknown>>).find((b) => b.block_id === "status_block");
  if (!statusBlock) return;

  const statusText = ((statusBlock.text as Record<string, unknown>)?.text as string) ?? "";
  if (!statusText.includes("Closed")) return;

  const updatedBlocks = (root.blocks as Array<Record<string, unknown>>).filter(
    (b) => b.block_id !== "status_block",
  ) as unknown as KnownBlock[];

  await Promise.all([
    slack.chat.update({
      channel: SLACK_CHANNEL_ID,
      ts: threadTs,
      text: "🔄 Reopened",
      blocks: [
        updatedBlocks[0],
        { type: "section", block_id: "status_block", text: { type: "mrkdwn", text: "🔄 *Reopened*" } },
        ...updatedBlocks.slice(1),
      ],
    }),
    slack.chat.postMessage({ channel: SLACK_CHANNEL_ID, thread_ts: threadTs, text: "🔄 Ticket reopened" }),
  ]);

  console.log(`[Gleap] Ticket ${ticket.id} reopened — Slack thread updated ✓`);
};

export const handleTypeChange = async (ticket: GleapWebhookTicket) => {
  const threadTs = ticket.formData?.slack_thread_ts;
  if (!threadTs) return;

  const slack = getSlackClient();
  const replies = await slack.conversations.replies({ channel: SLACK_CHANNEL_ID, ts: threadTs, limit: 1 });
  const root = replies.messages?.[0];
  if (!root) return;

  const existingBlocks = (root.blocks ?? []) as Array<Record<string, unknown>>;
  const actionsBlock = existingBlocks.find((b) => b.type === "actions");
  if (!actionsBlock) return;

  const elements = ((actionsBlock as Record<string, unknown>).elements as Array<Record<string, unknown>> | undefined) ?? [];
  const hasConfirmReject = elements.some((e) => e.action_id === "confirm" || e.action_id === "reject");
  const isBug = ticket.type === "BUG";

  if (isBug === hasConfirmReject) return; // already in correct state

  const gleapUrl = getGleapTicketUrl(ticket.id, ticket.type);
  const newActionsBlock = buildActionsBlock(ticket.id, gleapUrl, isBug);
  const updatedBlocks = existingBlocks.map((b) =>
    b.type === "actions" ? newActionsBlock : b,
  ) as unknown as KnownBlock[];

  await slack.chat.update({
    channel: SLACK_CHANNEL_ID,
    ts: threadTs,
    text: (root.text as string) ?? "",
    blocks: updatedBlocks,
  });

  console.log(`[Gleap] Ticket ${ticket.id} type → "${ticket.type}" — Slack buttons ${isBug ? "added" : "removed"} ✓`);
};
