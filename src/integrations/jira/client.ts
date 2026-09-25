import config from "../../../gleaptracker.config"
import { getGleapTicketUrl } from "../gleap/client"

export interface JiraIssueResult {
  id: string
  key: string
  url: string
  identifier: string
}
export interface JiraTrackerTicket {
  id: string
  title: string
  bugId: number
  type: string
  plainContent?: string
}

export const getJiraOrigin = (host: string): string => {
  const url = new URL(host.includes("://") ? host : `https://${host}`)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new Error("JIRA_HOST must be a hostname or HTTPS origin without credentials or a path")
  }
  return url.origin
}

export const createJiraIssue = async (ticket: JiraTrackerTicket): Promise<JiraIssueResult> => {
  const cfg = config.jira
  const email = process.env.JIRA_EMAIL
  const token = process.env.JIRA_API_TOKEN
  if (!cfg?.host || !cfg.projectKey || !email || !token) {
    throw new Error("Configure JIRA_HOST, JIRA_PROJECT_KEY, JIRA_EMAIL and JIRA_API_TOKEN before enabling Jira")
  }
  const origin = getJiraOrigin(cfg.host)
  const gleapUrl = getGleapTicketUrl(ticket.id, ticket.type)
  const paragraphs = [ticket.plainContent?.trim(), `Gleap tracker: Gleap-${ticket.bugId}`].filter(Boolean)
  const body = {
    fields: {
      ...cfg.additionalFields,
      project: { key: cfg.projectKey },
      summary: `[${ticket.bugId}] ${ticket.title}`.slice(0, 255),
      description: {
        type: "doc", version: 1,
        content: [
          ...paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
          { type: "paragraph", content: [
            { type: "text", text: "Open in Gleap: " },
            { type: "text", text: gleapUrl, marks: [{ type: "link", attrs: { href: gleapUrl } }] },
          ] },
        ],
      },
      issuetype: { name: cfg.issueType },
      labels: [...new Set([...(cfg.labels ?? []), `gleap-${ticket.bugId}`])],
    },
  }
  const res = await fetch(`${origin}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      "Content-Type": "application/json", Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`[Jira] POST issue failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { id?: string; key?: string }
  if (!data?.id || !data.key) throw new Error("[Jira] Create response is missing issue id or key")
  const url = `${origin}/browse/${data.key}`
  return { id: data.id, key: data.key, url, identifier: data.key }
}
