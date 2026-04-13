import config from "../../../gleaptracker"
import { getGleapTicketUrl } from "../gleap/client"

export interface JiraIssueResult {
  id: string
  key: string
  url: string
  /** Formatted as "PROJECT-123" — used as the identifier stored in Gleap formData */
  identifier: string
}

export interface JiraTrackerTicket {
  id: string
  title: string
  bugId: number
  type: string
}

const getAuthHeader = (): string => {
  const email = process.env.JIRA_EMAIL || ""
  const token = process.env.JIRA_API_TOKEN || ""
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`
}

const getBaseUrl = (): string => {
  const host = config.jira!.host
  return `https://${host}/rest/api/3`
}

export const createJiraIssue = async (ticket: JiraTrackerTicket): Promise<JiraIssueResult> => {
  const cfg = config.jira!
  const gleapUrl = getGleapTicketUrl(ticket.id, ticket.type)

  const body = {
    fields: {
      project: { key: cfg.projectKey },
      summary: `[${ticket.bugId}] ${ticket.title}`,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Open in Gleap: " },
              {
                type: "text",
                text: gleapUrl,
                marks: [{ type: "link", attrs: { href: gleapUrl } }],
              },
            ],
          },
        ],
      },
      issuetype: { name: cfg.issueType },
    },
  }

  const res = await fetch(`${getBaseUrl()}/issue`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[Jira] POST issue failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { id: string; key: string; self: string }
  const url = `https://${cfg.host}/browse/${data.key}`

  console.log(`[Jira] Issue created: ${data.key} — ${url}`)
  return { id: data.id, key: data.key, url, identifier: data.key }
}
