import type { Request, Response } from "express";
import { KnownBlock } from "@slack/web-api";
import config from "../../gleaptracker";
import {
  getGleapClient,
  getGleapTicketUrl,
} from "../integrations/gleap/client";
import { processTrackerTicket } from "../integrations/gleap/tracker";
import { getSlackClient } from "../integrations/slack/client";

const SLACK_CHANNEL_ID = config.slack.channelId;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface GleapReporter {
  name?: string;
  email?: string;
}

interface GleapWebhookTicket {
  id: string;
  title: string;
  bugId: number;
  status: string;
  type: string;
  trackerTicket: boolean;
  plainContent?: string;
  reporter?: GleapReporter;
  contact?: GleapReporter;
  linkedTickets?: string[];
  session: {
    id: string;
    name?: string;
    email: string;
  };
  formData?: {
    linearIssueId?: string;
    linearIssueUrl?: string;
    jiraIssueId?: string;
    jiraIssueUrl?: string;
    slack_thread?: string;
    slack_thread_ts?: string;
    [key: string]: unknown;
  };
}

interface GleapWebhookPayload {
  event: string;
  projectId: string;
  data: GleapWebhookTicket;
}

const slackSentTickets = new Set<string>();
const SLACK_DEDUP_TTL_MS = 30_000;

const sendToSlack = async (
  ticket: GleapWebhookTicket,
): Promise<{ threadUrl: string; threadTs: string } | null> => {
  const slack = getSlackClient();
  const gleapUrl = getGleapTicketUrl(ticket.id, ticket.type);

  const user = ticket.session;
  const customerLine = [user?.name, user?.email].filter(Boolean).join("  ");
  const titleLine = `\`#${ticket.bugId}\`  *${ticket.title}*`;
  const headerText = customerLine
    ? `${titleLine}\n\n${customerLine}\n`
    : `${titleLine}\n`;

  const msg = await slack.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    text: `#${ticket.bugId} ${ticket.title}`,
    metadata: {
      event_type: "gleap_ticket",
      event_payload: { gleap_ticket_id: ticket.id },
    },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: headerText } },
      {
        type: "section",
        block_id: "status_block",
        text: { type: "mrkdwn", text: " " },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Confirm" },
            style: "primary",
            action_id: "confirm",
            value: ticket.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Reject" },
            action_id: "reject",
            value: ticket.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Open in Gleap ↗" },
            action_id: "open_gleap",
            url: gleapUrl,
            value: ticket.id,
          },
        ],
      },
    ],
  });

  if (!msg.ok || !msg.ts) {
    console.error(`[Gleap] Slack postMessage failed: ${msg.error}`);
    return null;
  }

  const permalink = await slack.chat.getPermalink({
    channel: SLACK_CHANNEL_ID,
    message_ts: msg.ts,
  });
  if (!permalink.ok || !permalink.permalink) return null;
  return { threadUrl: permalink.permalink, threadTs: msg.ts };
};

const handleTicketDone = async (ticket: GleapWebhookTicket) => {
  const threadTs = ticket.formData?.slack_thread_ts;
  if (!threadTs) return;

  const slack = getSlackClient();

  const replies = await slack.conversations.replies({
    channel: SLACK_CHANNEL_ID,
    ts: threadTs,
    limit: 1,
  });
  const root = replies.messages?.[0];
  if (!root) return;

  const existingBlocks = (root.blocks ?? []) as Array<Record<string, unknown>>;

  const statusBlock = existingBlocks.find((b) => b.block_id === "status_block");
  const statusText =
    ((statusBlock?.text as Record<string, unknown>)?.text as string) ?? "";
  if (statusText.includes("Closed")) {
    console.log(
      `[Gleap] Ticket ${ticket.id} already marked as closed on Slack — skipping`,
    );
    return;
  }

  await slack.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    thread_ts: threadTs,
    text: "✅ Closed",
  });

  const updatedBlocks = existingBlocks
    .filter((b) => b.block_id !== "status_block")
    .map((b) => {
      if (b.type !== "actions") return b;
      const elements =
        (b.elements as Array<Record<string, unknown>> | undefined) ?? [];
      const kept = elements.filter(
        (e) => !["confirm", "reject"].includes(e.action_id as string),
      );
      return kept.length ? { ...b, elements: kept } : null;
    })
    .filter(Boolean) as unknown as KnownBlock[];

  await slack.chat.update({
    channel: SLACK_CHANNEL_ID,
    ts: threadTs,
    text: "✅ Closed",
    blocks: [
      updatedBlocks[0],
      {
        type: "section",
        block_id: "status_block",
        text: { type: "mrkdwn", text: "✅ *Closed*" },
      },
      ...updatedBlocks.slice(1),
    ],
  });

  console.log(`[Gleap] Ticket ${ticket.id} marked as closed on Slack ✓`);
};

const handleOnSlack = async (ticket: GleapWebhookTicket) => {
  const gleap = getGleapClient();

  if (ticket.formData?.slack_thread) {
    console.log(
      `[Gleap] Ticket ${ticket.id} already on Slack: ${ticket.formData.slack_thread}`,
    );
    return;
  }
  if (slackSentTickets.has(ticket.id)) {
    console.log(
      `[Gleap] Duplicate ONSLACK webhook for ticket ${ticket.id} — skipping`,
    );
    return;
  }
  slackSentTickets.add(ticket.id);
  setTimeout(() => slackSentTickets.delete(ticket.id), SLACK_DEDUP_TTL_MS);

  const result = await sendToSlack(ticket);
  if (!result?.threadUrl) return;

  await Promise.all([
    gleap.tickets.update(ticket.id, {
      formData: {
        slack_thread: result.threadUrl,
        slack_thread_ts: result.threadTs,
      },
    }),
    gleap.messages.addNote(ticket.id, `Sent to Slack: ${result.threadUrl}`),
  ]);

  console.log(
    `[Gleap] Ticket ${ticket.id} sent to Slack: ${result.threadUrl} ✓`,
  );
};

const handleTicketReopened = async (ticket: GleapWebhookTicket) => {
  const threadTs = ticket.formData?.slack_thread_ts;
  if (!threadTs) return;

  const slack = getSlackClient();
  const replies = await slack.conversations.replies({
    channel: SLACK_CHANNEL_ID,
    ts: threadTs,
    limit: 1,
  });
  const root = replies.messages?.[0];
  if (!root?.blocks) return;

  const statusBlock = (root.blocks as Array<Record<string, unknown>>).find(
    (b) => b.block_id === "status_block",
  );
  if (!statusBlock) return;

  const statusText =
    ((statusBlock.text as Record<string, unknown>)?.text as string) ?? "";
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
        {
          type: "section",
          block_id: "status_block",
          text: { type: "mrkdwn", text: "🔄 *Reopened*" },
        },
        ...updatedBlocks.slice(1),
      ],
    }),
    slack.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      thread_ts: threadTs,
      text: "🔄 Ticket reopened",
    }),
  ]);

  console.log(`[Gleap] Ticket ${ticket.id} reopened — Slack thread updated ✓`);
};

const ONSLACK_STATUSES = config.gleap.onSlackStatuses;

const handleTicketUpdated = async (ticket: GleapWebhookTicket) => {
  if (
    ticket.status === config.gleap.doneStatus &&
    ticket.formData?.slack_thread_ts
  ) {
    await handleTicketDone(ticket);
    return;
  }

  const actionableStatuses = ["OPEN", "INPROGRESS", ...ONSLACK_STATUSES];
  if (!actionableStatuses.includes(ticket.status)) {
    console.log(
      `[Gleap] Ticket ${ticket.id} skipped — status "${ticket.status}" not actionable`,
    );
    return;
  }

  if (ONSLACK_STATUSES.includes(ticket.status)) {
    if (ticket.formData?.slack_thread_ts) {
      await handleTicketReopened(ticket);
    } else {
      await handleOnSlack(ticket);
    }
    return;
  }

  if (ticket.formData?.linearIssueId || ticket.formData?.jiraIssueId) {
    return;
  }

  await processTrackerTicket(ticket);
};

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
