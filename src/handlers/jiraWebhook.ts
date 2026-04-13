import type { Request, Response } from "express"
import config from "../../gleaptracker"
import { getGleapClient } from "../integrations/gleap/client"

const recentlyProcessed = new Set<string>()
const DEDUP_TTL_MS = 30_000

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

interface JiraIssueWebhookPayload {
  webhookEvent: string
  issue: {
    id: string
    key: string
    fields: {
      summary: string
      status: {
        name: string
      }
    }
  }
  changelog?: {
    items: Array<{
      field: string
      fromString: string
      toString: string
    }>
  }
}

const verifySecret = (req: Request): boolean => {
  const secret = (req.query.secret as string) || ""
  return secret === (config.jira!.webhookSecret || "")
}

const processJiraIssueUpdate = async (payload: JiraIssueWebhookPayload) => {
  const { issue, changelog } = payload
  const cfg = config.jira!

  const statusChange = changelog?.items.find((item) => item.field === "status")
  if (!statusChange) {
    console.log(`[Jira] Issue ${issue.key} — no status change in changelog, skipping`)
    return
  }

  if (statusChange.toString !== cfg.doneStatusName) {
    console.log(
      `[Jira] Issue ${issue.key} — status changed to "${statusChange.toString}", not "${cfg.doneStatusName}", skipping`,
    )
    return
  }

  const bugIdMatch = issue.fields.summary?.match(/^\[(\d+)\]/)
  if (!bugIdMatch) {
    console.warn(
      `[Jira] Issue ${issue.key} skipped — summary has no leading [bugId]: "${issue.fields.summary}"`,
    )
    return
  }

  const bugId = bugIdMatch[1]
  const dedupKey = `${issue.key}:${bugId}`
  if (recentlyProcessed.has(dedupKey)) {
    console.log(`[Jira] Duplicate webhook for issue ${issue.key} — skipping`)
    return
  }
  recentlyProcessed.add(dedupKey)
  setTimeout(() => recentlyProcessed.delete(dedupKey), DEDUP_TTL_MS)

  console.log(`[Jira] Processing done issue ${issue.key}, Gleap bugId: ${bugId}`)

  const gleap = getGleapClient()
  const { tickets } = await gleap.tickets.list({ bugId })

  const ticket = tickets[0]
  if (!ticket) {
    console.warn(`[Jira] No Gleap ticket found for bugId ${bugId}`)
    return
  }

  const linkedTickets = (ticket.linkedTickets ?? []) as string[]
  if (linkedTickets.length) {
    if (config.gleap.workflowId) {
      await Promise.all(
        linkedTickets.map(async (id) => {
          const ok = await gleap.tickets.runWorkflow(id, config.gleap.workflowId!)
          if (ok) console.log(`[Jira] Workflow applied to Gleap ticket ${id} ✓`)
        }),
      )
    } else if (config.gleap.bugFixedMessage) {
      const msg = config.gleap.bugFixedMessage
      await Promise.all(
        linkedTickets.map(async (id) => {
          const ok = await gleap.messages.sendMessage(id, msg)
          if (ok) console.log(`[Jira] Bug-fixed message sent to Gleap ticket ${id} ✓`)
        }),
      )
    } else {
      console.warn("[Jira] No workflowId or bugFixedMessage configured — skipping customer notification")
    }
  }

  const ok = await gleap.tickets.update(ticket.id, { status: config.gleap.doneStatus })
  if (ok) console.log(`[Jira] Tracker ticket ${ticket.id} marked as DONE ✓`)
}

export function jiraOptions(_req: Request, res: Response): void {
  res.set(corsHeaders).status(200).end()
}

export async function jiraPost(req: Request, res: Response): Promise<void> {
  if (!verifySecret(req)) {
    res.status(401).set(corsHeaders).send("Invalid secret")
    return
  }

  let payload: JiraIssueWebhookPayload
  try {
    payload = req.body as JiraIssueWebhookPayload
  } catch {
    res.status(400).set(corsHeaders).send("Invalid JSON")
    return
  }

  console.log(`[Jira webhook] ${payload.webhookEvent} — issue ${payload.issue?.key}`)

  if (payload.webhookEvent !== "jira:issue_updated") {
    res.status(200).set(corsHeaders).send("Event not tracked")
    return
  }

  try {
    await processJiraIssueUpdate(payload)
  } catch (e) {
    console.error("[Jira webhook] Error:", e)
    res.status(500).set(corsHeaders).json({ error: String(e) })
    return
  }

  res.status(200).set(corsHeaders).end()
}
