import type { Request, Response } from "express"
import crypto from "crypto"
import config from "../../gleaptracker"
import { getGleapClient } from "../integrations/gleap/client"

const recentlyProcessed = new Set<string>()
const DEDUP_TTL_MS = 30_000

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, linear-signature",
}

interface LinearLabel {
  id: string
  name: string
}

interface LinearState {
  name: string
  type: string
}

interface LinearIssueData {
  id: string
  title: string
  state?: LinearState
  labels?: LinearLabel[]
}

const verifySignature = (headerSignature: string, rawBody: string): boolean => {
  if (!headerSignature) return false
  const secret = config.linear!.webhookSecret
  const headerBuf = new Uint8Array(Buffer.from(headerSignature, "hex"))
  const computed = new Uint8Array(
    crypto.createHmac("sha256", secret).update(rawBody).digest(),
  )
  return crypto.timingSafeEqual(computed, headerBuf)
}

const processIssueUpdate = async (data: Record<string, unknown>) => {
  const issue = data as unknown as LinearIssueData
  const cfg = config.linear!

  const hasTrackerLabel = issue.labels?.some(
    (l) => l.name.toLowerCase() === cfg.trackerLabel.toLowerCase(),
  )
  if (!hasTrackerLabel) {
    console.log(`[Linear] Issue ${issue.id} skipped — missing label "${cfg.trackerLabel}"`)
    return
  }

  if (issue.state?.type !== "completed") {
    console.log(
      `[Linear] Issue ${issue.id} skipped — state type "${issue.state?.type}" is not completed`,
    )
    return
  }

  const bugIdMatch = issue.title?.match(/^\[(\d+)\]/)
  if (!bugIdMatch) {
    console.warn(
      `[Linear] Issue ${issue.id} skipped — title has no leading [bugId]: "${issue.title}"`,
    )
    return
  }

  const bugId = bugIdMatch[1]
  const dedupKey = `${issue.id}:${bugId}`
  if (recentlyProcessed.has(dedupKey)) {
    console.log(`[Linear] Duplicate webhook for issue ${issue.id} — skipping`)
    return
  }
  recentlyProcessed.add(dedupKey)
  setTimeout(() => recentlyProcessed.delete(dedupKey), DEDUP_TTL_MS)

  console.log(`[Linear] Processing done issue ${issue.id}, Gleap bugId: ${bugId}`)

  const gleap = getGleapClient()
  const { tickets } = await gleap.tickets.list({ bugId })

  const ticket = tickets[0]
  if (!ticket) {
    console.warn(`[Linear] No Gleap ticket found for bugId ${bugId}`)
    return
  }

  const linkedTickets = (ticket.linkedTickets ?? []) as string[]
  if (linkedTickets.length) {
    if (config.gleap.workflowId) {
      await Promise.all(
        linkedTickets.map(async (id) => {
          const ok = await gleap.tickets.runWorkflow(id, config.gleap.workflowId!)
          if (ok) console.log(`[Linear] Workflow applied to ticket ${id} ✓`)
        }),
      )
    } else if (config.gleap.bugFixedMessage) {
      const msg = config.gleap.bugFixedMessage
      await Promise.all(
        linkedTickets.map(async (id) => {
          const ok = await gleap.messages.sendMessage(id, msg)
          if (ok) console.log(`[Linear] Bug-fixed message sent to ticket ${id} ✓`)
        }),
      )
    } else {
      console.warn("[Linear] No workflowId or bugFixedMessage configured — skipping customer notification")
    }
  }

  const ok = await gleap.tickets.update(ticket.id, { status: config.gleap.doneStatus })
  if (ok) console.log(`[Linear] Tracker ticket ${ticket.id} marked as DONE ✓`)
}

export function linearOptions(_req: Request, res: Response): void {
  res.set(corsHeaders).status(200).end()
}

function rawBodyToString(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString("utf8")
  if (typeof body === "string") return body
  return ""
}

export async function linearPost(req: Request, res: Response): Promise<void> {
  const rawBody = rawBodyToString(req.body)
  const signature = req.get("linear-signature") || ""

  if (!verifySignature(signature, rawBody)) {
    res.status(401).set(corsHeaders).send("Invalid signature")
    return
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    res.status(400).set(corsHeaders).send("Invalid JSON")
    return
  }

  const { type, action, data } = payload as {
    type: string
    action: string
    data: Record<string, unknown>
  }

  if (type !== "Issue" || action !== "update") {
    res.status(200).set(corsHeaders).send("Event not tracked")
    return
  }

  try {
    await processIssueUpdate(data)
  } catch (e) {
    console.error("[Linear webhook] Error:", e)
    res.status(500).set(corsHeaders).json({ error: String(e) })
    return
  }

  res.status(200).set(corsHeaders).end()
}
