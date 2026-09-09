import type { Request, Response } from "express"
import crypto from "crypto"
import config from "../../gleaptracker.config"
import { parseFixesFromCommits } from "../integrations/commits"
import { closeTracker } from "../integrations/gleap/close"
import { findTrackerByBugId } from "../integrations/gleap/linked"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Hub-Signature-256, X-GitHub-Event, X-GitHub-Delivery",
}

const recentlyProcessed = new Set<string>()
const DEDUP_TTL_MS = 60_000

interface GitHubPushPayload {
  ref?: string
  commits?: Array<{ id?: string; message?: string }>
}

function rawBodyToString(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString("utf8")
  if (typeof body === "string") return body
  return ""
}

const verifySignature = (signature: string, rawBody: string): boolean => {
  const secret = config.github?.webhookSecret || ""
  if (!secret || !signature) return false
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`
  try {
    return crypto.timingSafeEqual(
      new Uint8Array(Buffer.from(expected)),
      new Uint8Array(Buffer.from(signature)),
    )
  } catch {
    return false
  }
}

const branchFromRef = (ref: string): string => ref.replace(/^refs\/heads\//, "")

const processPush = async (payload: GitHubPushPayload): Promise<void> => {
  const branches = config.github?.closeBranches?.length
    ? config.github.closeBranches
    : ["master"]
  const branch = branchFromRef(payload.ref ?? "")
  if (!branches.includes(branch)) {
    console.log(`[GitHub] Push to "${branch}" ignored (close branches: ${branches.join(", ")})`)
    return
  }

  const bugIds = parseFixesFromCommits(payload.commits ?? [])
  if (!bugIds.length) {
    console.log(`[GitHub] Push to ${branch} has no Fixes Gleap-<id> tokens`)
    return
  }

  for (const bugId of bugIds) {
    const dedupKey = `fixes:${bugId}`
    if (recentlyProcessed.has(dedupKey)) {
      console.log(`[GitHub] Duplicate Fixes Gleap-${bugId} — skipping`)
      continue
    }
    recentlyProcessed.add(dedupKey)
    setTimeout(() => recentlyProcessed.delete(dedupKey), DEDUP_TTL_MS)

    const tracker = await findTrackerByBugId(bugId)
    if (!tracker) {
      console.error(`[GitHub] No tracker ticket for Gleap-${bugId}`)
      continue
    }
    console.log(`[GitHub] Closing tracker ${tracker.id} from Fixes Gleap-${bugId}`)
    await closeTracker(tracker, { source: "github" })
  }
}

export function githubOptions(_req: Request, res: Response): void {
  res.set(corsHeaders).status(200).end()
}

export async function githubPost(req: Request, res: Response): Promise<void> {
  const rawBody = rawBodyToString(req.body)
  const event = req.get("x-github-event") || ""
  const signature = req.get("x-hub-signature-256") || ""

  if (event === "ping") {
    res.status(200).set(corsHeaders).json({ ok: true })
    return
  }

  if (!verifySignature(signature, rawBody)) {
    res.status(401).set(corsHeaders).send("Invalid signature")
    return
  }

  if (event && event !== "push") {
    res.status(200).set(corsHeaders).send("Event not tracked")
    return
  }

  let payload: GitHubPushPayload
  try {
    payload = JSON.parse(rawBody) as GitHubPushPayload
  } catch {
    res.status(400).set(corsHeaders).send("Invalid JSON")
    return
  }

  try {
    await processPush(payload)
  } catch (e) {
    console.error("[GitHub webhook] Error:", e)
    res.status(500).set(corsHeaders).json({ error: String(e) })
    return
  }

  res.status(200).set(corsHeaders).end()
}
