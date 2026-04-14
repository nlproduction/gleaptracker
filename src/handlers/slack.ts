import type { Request, Response } from "express";
import { KnownBlock } from "@slack/web-api";
import crypto from "crypto";
import config from "../../gleaptracker.config";
import {
  getGleapClient,
  getGleapTicketUrl,
  type GleapTicket,
} from "../integrations/gleap/client";
import { processTrackerTicket } from "../integrations/gleap/tracker";
import { getSlackClient } from "../integrations/slack/client";

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";
const SLACK_CHANNEL_ID = config.slack.channelId;

const verifySlackSignature = (
  signature: string,
  timestamp: string,
  rawBody: string,
): boolean => {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const computed = `v0=${crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(base).digest("hex")}`;

  try {
    return crypto.timingSafeEqual(
      new Uint8Array(Buffer.from(computed)),
      new Uint8Array(Buffer.from(signature)),
    );
  } catch {
    return false;
  }
};

interface SlackActionContext {
  channelId: string;
  threadTs: string;
  userId: string;
}

interface ModalMetadata {
  gleapTicketId: string;
  channelId: string;
  threadTs: string;
  userId: string;
}

const postActionMessage = async (ctx: SlackActionContext, text: string) => {
  const slack = getSlackClient();
  await slack.chat.postMessage({
    channel: ctx.channelId,
    thread_ts: ctx.threadTs,
    text,
  });
};

const updateThreadStatus = async (
  ctx: SlackActionContext,
  statusText: string,
) => {
  const slack = getSlackClient();
  const replies = await slack.conversations.replies({
    channel: ctx.channelId,
    ts: ctx.threadTs,
    limit: 1,
  });
  const root = replies.messages?.[0];
  if (!root) return;

  const existingBlocks = (root.blocks ?? []) as Array<Record<string, unknown>>;

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
    channel: ctx.channelId,
    ts: ctx.threadTs,
    text: statusText,
    blocks: [
      updatedBlocks[0],
      {
        type: "section",
        block_id: "status_block",
        text: { type: "mrkdwn", text: statusText },
      },
      ...updatedBlocks.slice(1),
    ],
  });
};

const getGleapTicketIdFromThread = async (
  channelId: string,
  threadTs: string,
): Promise<string | null> => {
  const slack = getSlackClient();
  const replies = await slack.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 1,
    include_all_metadata: true,
  });
  const root = replies.messages?.[0];
  const payload = (root?.metadata as Record<string, unknown>)?.event_payload as
    | Record<string, string>
    | undefined;
  return payload?.gleap_ticket_id ?? null;
};

interface ConfirmOpts {
  existingTrackerId?: string;
  customTitle?: string;
  description?: string;
}

const handleConfirm = async (
  gleapTicketId: string,
  opts: ConfirmOpts = {},
  ctx?: SlackActionContext,
) => {
  const gleap = getGleapClient();
  const ticket = await gleap.tickets.get(gleapTicketId);

  if (opts.existingTrackerId) {
    const tracker = await gleap.tickets.get(opts.existingTrackerId);
    const currentIds = (tracker.linkedTickets ?? []).map((t) =>
      typeof t === "string" ? t : (t as { id: string }).id,
    );
    if (!currentIds.includes(gleapTicketId)) {
      await gleap.tickets.update(opts.existingTrackerId, {
        linkedTicketIds: [...currentIds, gleapTicketId],
      });
    }
    await gleap.messages.addNote(
      gleapTicketId,
      `⏳ Confirmed — linked to tracker`,
    );
    console.log(
      `[Slack] Ticket ${gleapTicketId} linked to existing tracker ${opts.existingTrackerId} ✓`,
    );
  } else {
    const title = opts.customTitle?.trim() || ticket.title;
    await gleap.messages.addNote(
      gleapTicketId,
      "⏳ Confirmed — creating tracker ticket",
    );
    const created = await gleap.tickets.createTracker({
      title,
      type: config.gleap.trackerTicketType,
      ...(opts.description ? { description: opts.description } : {}),
      linkedTicketIds: [gleapTicketId],
    });
    console.log(`[Slack] Tracker ticket created: ${created.id} ("${title}") ✓`);
    void processTrackerTicket({
      id: created.id,
      title: created.title,
      bugId: created.bugId,
      type: created.type,
      trackerTicket: true,
      linkedTickets: [gleapTicketId],
      formData: created.formData as Record<string, unknown> | undefined,
    });
  }

  if (ctx) {
    await Promise.all([
      updateThreadStatus(ctx, "⏳ Confirmed"),
      postActionMessage(
        ctx,
        `⏳ Confirmed, will be fixed soon. <${getGleapTicketUrl(gleapTicketId, ticket.type)}|Open in Gleap>`,
      ),
    ]);
  }
};

const handleReject = async (
  gleapTicketId: string,
  reason: string,
  ctx?: SlackActionContext,
) => {
  const gleap = getGleapClient();

  const [ticket] = await Promise.all([
    gleap.tickets.get(gleapTicketId),
    gleap.messages.addNote(gleapTicketId, `Dev team rejected: ${reason}`),
    gleap.tickets.update(gleapTicketId, {
      type: config.gleap.inProgressType,
      notificationsUnread: true,
    }),
  ]);

  console.log(`[Slack] Reject processed for Gleap ticket ${gleapTicketId} ✓`);

  if (ctx) {
    await Promise.all([
      updateThreadStatus(ctx, "❌ Rejected"),
      postActionMessage(
        ctx,
        `❌ Rejected: ${reason} <${getGleapTicketUrl(gleapTicketId, ticket.type)}|Open in Gleap>`,
      ),
    ]);
  }
};

const openConfirmModal = async (
  triggerId: string,
  gleapTicketId: string,
  defaultTitle: string,
  ctx: SlackActionContext,
  trackerTickets: GleapTicket[],
) => {
  const slack = getSlackClient();
  const metadata: ModalMetadata = { gleapTicketId, ...ctx };

  const selectBlock =
    trackerTickets.length > 0
      ? [
          {
            type: "input",
            block_id: "existing_tracker_block",
            optional: true,
            label: {
              type: "plain_text",
              text: "Link to existing tracker (optional)",
            },
            hint: {
              type: "plain_text",
              text: "If selected, the ticket will be linked to this tracker instead of creating a new one.",
            },
            element: {
              type: "static_select",
              action_id: "tracker_select",
              placeholder: { type: "plain_text", text: "Select a tracker..." },
              options: trackerTickets.slice(0, 100).map((t) => ({
                text: {
                  type: "plain_text" as const,
                  text: `#${t.bugId} ${t.title}`.slice(0, 75),
                },
                value: t.id,
              })),
            },
          },
          { type: "divider" },
        ]
      : [];

  const res = await slack.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "confirm_modal",
      private_metadata: JSON.stringify(metadata),
      title: { type: "plain_text", text: "Confirm issue" },
      submit: { type: "plain_text", text: "Confirm" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        ...selectBlock,
        {
          type: "input",
          block_id: "title_block",
          optional: true,
          label: {
            type: "plain_text",
            text:
              trackerTickets.length > 0
                ? "Or create new tracker"
                : "Tracker title",
          },
          element: {
            type: "plain_text_input",
            action_id: "title_input",
            initial_value: defaultTitle,
          },
        },
        {
          type: "input",
          block_id: "desc_block",
          optional: true,
          label: { type: "plain_text", text: "Description (optional)" },
          element: {
            type: "plain_text_input",
            action_id: "desc_input",
            multiline: true,
            placeholder: { type: "plain_text", text: "Additional context..." },
          },
        },
      ],
    },
  });
  if (!res.ok)
    console.error(`[Slack] views.open (confirm) failed: ${res.error}`);
};

const openRejectModal = async (
  triggerId: string,
  gleapTicketId: string,
  ctx: SlackActionContext,
) => {
  const slack = getSlackClient();
  const metadata: ModalMetadata = { gleapTicketId, ...ctx };
  const res = await slack.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "reject_modal",
      private_metadata: JSON.stringify(metadata),
      title: { type: "plain_text", text: "Reject Ticket" },
      submit: { type: "plain_text", text: "Send" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "reason_block",
          label: { type: "plain_text", text: "Rejection reason" },
          element: {
            type: "plain_text_input",
            action_id: "reason_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Explain why this ticket is being rejected...",
            },
          },
        },
      ],
    },
  });
  if (!res.ok)
    console.error(`[Slack] views.open (reject) failed: ${res.error}`);
};


function rawBodyToString(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "string") return body;
  return "";
}

export function slackOptions(_req: Request, res: Response): void {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, x-slack-signature, x-slack-request-timestamp",
  });
  res.status(200).end();
}

export async function slackPost(req: Request, res: Response): Promise<void> {
  const rawBody = rawBodyToString(req.body);

  let jsonBody: Record<string, unknown> | null = null;
  try {
    jsonBody = JSON.parse(rawBody);
  } catch {}

  if (jsonBody?.type === "url_verification") {
    res.json({ challenge: jsonBody.challenge });
    return;
  }

  const signature = req.get("x-slack-signature") || "";
  const timestamp = req.get("x-slack-request-timestamp") || "";

  if (!verifySlackSignature(signature, timestamp, rawBody)) {
    res.status(401).send("Invalid signature");
    return;
  }

  if (jsonBody) {

    if (jsonBody.type === "event_callback") {
      const event = jsonBody.event as Record<string, unknown>;
      if (
        event.type === "message" &&
        !event.subtype &&
        event.channel === SLACK_CHANNEL_ID &&
        event.thread_ts
      ) {
        const text = (event.text as string) ?? "";
        if (text.includes("g:note")) {
          const content = text.replace(/g:note/g, "").trim();
          if (content) {
            const gleapTicketId = await getGleapTicketIdFromThread(
              SLACK_CHANNEL_ID,
              event.thread_ts as string,
            );
            if (gleapTicketId) {
              await getGleapClient().messages.addNote(gleapTicketId, content);
              console.log(`[Slack] g:note → Gleap ticket ${gleapTicketId}`);
            }
          }
        }
      }
      res.status(200).end();
      return;
    }
  }

  const params = new URLSearchParams(rawBody);

  try {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(params.get("payload") || "{}");
    } catch {
      res.status(400).send("Invalid payload");
      return;
    }

    if (payload.type === "block_actions") {
      const actions = payload.actions as
        | Array<{ action_id: string; value: string }>
        | undefined;
      const action = actions?.[0];
      const triggerId = payload.trigger_id as string;
      const channelId = (payload.channel as { id: string }).id;
      const threadTs = (payload.message as { ts: string }).ts;
      const userId = (payload.user as { id: string }).id;
      const ctx: SlackActionContext = { channelId, threadTs, userId };

      const gleapTicketId =
        (await getGleapTicketIdFromThread(channelId, threadTs)) ?? "";

      if (action?.action_id === "confirm") {
        const gleap = getGleapClient();
        const [ticket, { tickets: trackerTickets }] = await Promise.all([
          gleap.tickets.get(gleapTicketId),
          gleap.tickets.list({
            type: config.gleap.trackerTicketType,
            trackerTicket: true,
          }),
        ]);
        await openConfirmModal(
          triggerId,
          gleapTicketId,
          ticket.title,
          ctx,
          trackerTickets,
        );
        res.status(200).end();
        return;
      }

      if (action?.action_id === "reject") {
        await openRejectModal(triggerId, gleapTicketId, ctx);
        res.status(200).end();
        return;
      }

      res.status(200).end();
      return;
    }

    if (payload.type === "view_submission") {
      const view = payload.view as Record<string, unknown>;
      const values = (view.state as Record<string, unknown>)?.values as Record<
        string,
        unknown
      >;
      const { gleapTicketId, channelId, threadTs, userId } = JSON.parse(
        view.private_metadata as string,
      ) as ModalMetadata;
      const ctx: SlackActionContext = { channelId, threadTs, userId };

      if (view.callback_id === "confirm_modal") {
        const existingTrackerId = (
          (
            (values?.existing_tracker_block as Record<string, unknown>)
              ?.tracker_select as Record<string, unknown>
          )?.selected_option as Record<string, unknown> | undefined
        )?.value as string | undefined;

        const customTitle = (
          (values?.title_block as Record<string, unknown>)
            ?.title_input as Record<string, unknown>
        )?.value as string | undefined;

        const description = (
          (values?.desc_block as Record<string, unknown>)?.desc_input as Record<
            string,
            unknown
          >
        )?.value as string | undefined;

        if (!existingTrackerId && !customTitle?.trim()) {
          res.status(200).json({
            response_action: "errors",
            errors: {
              title_block:
                "Please select an existing tracker or enter a title to create a new one.",
            },
          });
          return;
        }

        void handleConfirm(
          gleapTicketId,
          { existingTrackerId, customTitle, description },
          ctx,
        );
        res.status(200).end();
        return;
      }

      if (view.callback_id === "reject_modal") {
        const reason =
          ((
            (values?.reason_block as Record<string, unknown>)
              ?.reason_input as Record<string, unknown>
          )?.value as string) ?? "";
        void handleReject(gleapTicketId, reason, ctx);
        res.status(200).end();
        return;
      }
    }
  } catch (e) {
    console.error("[Slack] Error processing interaction:", e);
  }

  res.status(200).end();
}
