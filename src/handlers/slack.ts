import type { Request, Response } from "express"
import crypto from "crypto"
import config from "../../gleaptracker.config"
import { getGleapClient } from "../integrations/gleap/client"
import { closeTracker } from "../integrations/gleap/close"
import { loadTicket } from "../integrations/gleap/linked"
import { getSlackClient } from "../integrations/slack/client"
import { buildCloseModalView } from "../integrations/slack/blocks"

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || ""
const SLACK_CHANNEL_ID = config.slack.channelId

const verifySlackSignature = (
  signature: string,
  timestamp: string,
  rawBody: string,
): boolean => {
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp)) > 300) return false

  const base = `v0:${timestamp}:${rawBody}`
  const computed = `v0=${crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(base).digest("hex")}`

  try {
    return crypto.timingSafeEqual(
      new Uint8Array(Buffer.from(computed)),
      new Uint8Array(Buffer.from(signature)),
    )
  } catch {
    return false
  }
}

interface SlackActionContext {
  channelId: string
  threadTs: string
  userId: string
}

interface ModalMetadata {
  gleapTicketId: string
  channelId: string
  threadTs: string
  userId: string
}

const getGleapTicketIdFromThread = async (
  channelId: string,
  threadTs: string,
): Promise<string | null> => {
  const slack = getSlackClient()
  const replies = await slack.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 1,
    include_all_metadata: true,
  })
  const root = replies.messages?.[0]
  const payload = (root?.metadata as Record<string, unknown>)?.event_payload as
    | Record<string, string>
    | undefined
  return payload?.gleap_ticket_id ?? null
}

const openCloseModal = async (
  triggerId: string,
  gleapTicketId: string,
  ctx: SlackActionContext,
) => {
  const slack = getSlackClient()
  const metadata: ModalMetadata = { gleapTicketId, ...ctx }
  const res = await slack.views.open({
    trigger_id: triggerId,
    view: buildCloseModalView({
      privateMetadata: JSON.stringify(metadata),
      initialMessage: config.gleap.bugFixedMessage ?? "",
    }),
  })
  if (!res.ok) console.error(`[Slack] views.open (close) failed: ${res.error}`)
}

function rawBodyToString(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString("utf8")
  if (typeof body === "string") return body
  return ""
}

export function slackOptions(_req: Request, res: Response): void {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, x-slack-signature, x-slack-request-timestamp",
  })
  res.status(200).end()
}

export async function slackPost(req: Request, res: Response): Promise<void> {
  const rawBody = rawBodyToString(req.body)

  let jsonBody: Record<string, unknown> | null = null
  try {
    jsonBody = JSON.parse(rawBody)
  } catch {}

  if (jsonBody?.type === "url_verification") {
    res.json({ challenge: jsonBody.challenge })
    return
  }

  const signature = req.get("x-slack-signature") || ""
  const timestamp = req.get("x-slack-request-timestamp") || ""

  if (!verifySlackSignature(signature, timestamp, rawBody)) {
    res.status(401).send("Invalid signature")
    return
  }

  if (jsonBody) {
    if (jsonBody.type === "event_callback") {
      const event = jsonBody.event as Record<string, unknown>
      if (
        event.type === "message" &&
        !event.subtype &&
        event.channel === SLACK_CHANNEL_ID &&
        event.thread_ts
      ) {
        const text = (event.text as string) ?? ""
        if (text.includes("g:note")) {
          const content = text.replace(/g:note/g, "").trim()
          if (content) {
            const gleapTicketId = await getGleapTicketIdFromThread(
              SLACK_CHANNEL_ID,
              event.thread_ts as string,
            )
            if (gleapTicketId) {
              await getGleapClient().messages.addNote(gleapTicketId, content)
              console.log(`[Slack] g:note → Gleap ticket ${gleapTicketId}`)
            }
          }
        }
      }
      res.status(200).end()
      return
    }
  }

  const params = new URLSearchParams(rawBody)

  try {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(params.get("payload") || "{}")
    } catch {
      res.status(400).send("Invalid payload")
      return
    }

    if (payload.type === "block_actions") {
      const actions = payload.actions as
        | Array<{ action_id: string; value: string }>
        | undefined
      const action = actions?.[0]
      const triggerId = payload.trigger_id as string
      const channelId = (payload.channel as { id: string }).id
      const threadTs = (payload.message as { ts: string }).ts
      const userId = (payload.user as { id: string }).id
      const ctx: SlackActionContext = { channelId, threadTs, userId }

      const gleapTicketId =
        action?.value ||
        (await getGleapTicketIdFromThread(channelId, threadTs)) ||
        ""

      if (action?.action_id === "close_tracker") {
        await openCloseModal(triggerId, gleapTicketId, ctx)
        res.status(200).end()
        return
      }

      res.status(200).end()
      return
    }

    if (payload.type === "view_submission") {
      const view = payload.view as Record<string, unknown>
      const values = (view.state as Record<string, unknown>)?.values as Record<
        string,
        unknown
      >
      const { gleapTicketId } = JSON.parse(
        view.private_metadata as string,
      ) as ModalMetadata

      if (view.callback_id === "close_modal") {
        const raw =
          ((
            (values?.message_block as Record<string, unknown>)
              ?.message_input as Record<string, unknown>
          )?.value as string | undefined) ?? ""
        const message = raw.trim()
        const tracker = await loadTicket(gleapTicketId)
        if (!tracker) {
          console.error(`[Slack] Close: tracker ${gleapTicketId} not found`)
          res.status(200).end()
          return
        }
        void closeTracker(tracker, {
          silent: !message,
          message: message || undefined,
          source: "slack",
        })
        res.status(200).end()
        return
      }
    }
  } catch (e) {
    console.error("[Slack] Error processing interaction:", e)
  }

  res.status(200).end()
}
