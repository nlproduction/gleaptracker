import config from "../../../gleaptracker.config"

const BASE_URL = "https://api.gleap.io/v3"
const APP_BASE = "https://app.gleap.io/projects"

const TYPE_PATH: Record<string, string> = {
  BUG: "bugs",
  INQUIRY: "inquiries",
  "FOR-RELEASE": "for-release",
}

export const getGleapTicketUrl = (
  ticketId: string,
  ticketType?: string,
): string => {
  const projectId = config.gleap.projectId
  const segment = ticketType ? (TYPE_PATH[ticketType] ?? ticketType.toLowerCase()) : "tickets"
  return `${APP_BASE}/${projectId}/${segment}/${ticketId}`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GleapLinkedTicketStub {
  id: string
  title: string
  bugId: number
  shareToken?: string
  trackerTicket?: boolean
  type?: string
  status?: string
}

export interface GleapSession {
  id?: string
  name?: string
  email?: string
}

export interface GleapTicket {
  id: string
  title: string
  bugId: number
  status: string
  type: string
  trackerTicket: boolean
  plainContent?: string
  tags?: string[]
  linkedTickets?: string[] | GleapLinkedTicketStub[]
  formData?: Record<string, unknown>
  session?: GleapSession
  reporter?: GleapSession
  contact?: GleapSession
}

export type GleapLinkedRef = string | GleapLinkedTicketStub

export const linkedTicketId = (ref: GleapLinkedRef): string =>
  typeof ref === "string" ? ref : ref.id

export const isTrackerTicket = (t: {
  trackerTicket?: boolean
  type?: string
}): boolean => !!t.trackerTicket || t.type === config.gleap.trackerTicketType

export const isTrackerDone = (t: { status?: string }): boolean =>
  t.status === config.gleap.doneStatus

export const customerDisplay = (
  ticket: Pick<GleapTicket, "session" | "reporter" | "contact">,
): { name?: string; email?: string } => {
  const src = ticket.session ?? ticket.reporter ?? ticket.contact ?? {}
  return { name: src.name, email: src.email }
}

export interface GleapTicketsResponse {
  tickets: GleapTicket[]
  count: number
  totalCount: number
}

export interface CreateTicketInput {
  title: string
  type: string
  trackerTicket?: boolean
  linkedTickets?: string[]
  status?: string
  [key: string]: unknown
}

export interface CreateTrackerTicketInput {
  title: string
  type: string
  description?: string
  linkedTicketIds?: string[]
}

export type UpdateTicketInput = Partial<
  Pick<GleapTicket, "status" | "type" | "tags" | "formData">
> &
  Record<string, unknown>

export interface ListTicketsParams {
  bugId?: number | string
  type?: string
  status?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Tickets resource
// ---------------------------------------------------------------------------

class GleapTicketsResource {
  constructor(private readonly headers: Record<string, string>) {}

  async get(ticketId: string): Promise<GleapTicket> {
    const res = await fetch(`${BASE_URL}/tickets/${ticketId}`, { headers: this.headers })
    if (!res.ok) throw new Error(`[Gleap] GET ticket ${ticketId} failed: ${res.status}`)
    return (await res.json()) as GleapTicket
  }

  async list(params: ListTicketsParams = {}): Promise<GleapTicketsResponse> {
    const query = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ).toString()
    const url = `${BASE_URL}/tickets${query ? `?${query}` : ""}`
    const res = await fetch(url, { headers: this.headers })
    if (!res.ok) throw new Error(`[Gleap] GET tickets failed: ${res.status}`)
    return (await res.json()) as GleapTicketsResponse
  }

  async create(data: CreateTicketInput): Promise<GleapTicket> {
    const res = await fetch(`${BASE_URL}/tickets`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`[Gleap] POST ticket failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as GleapTicket
  }

  async createTracker(data: CreateTrackerTicketInput): Promise<GleapTicket> {
    const res = await fetch(`${BASE_URL}/tickets/tracker-tickets`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(data),
    })
    if (!res.ok)
      throw new Error(`[Gleap] POST tracker ticket failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as GleapTicket
  }

  async update(ticketId: string, data: UpdateTicketInput): Promise<boolean> {
    const res = await fetch(`${BASE_URL}/tickets/${ticketId}`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      console.error(`[Gleap] PUT ticket ${ticketId} failed: ${res.status} ${await res.text()}`)
    }
    return res.ok
  }

  async runWorkflow(ticketId: string, workflowId: string): Promise<boolean> {
    const res = await fetch(`${BASE_URL}/tickets/${ticketId}/workflow`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ workflowId }),
    })
    if (!res.ok) {
      console.error(
        `[Gleap] Workflow ${workflowId} on ticket ${ticketId} failed: ${res.status} ${await res.text()}`,
      )
    }
    return res.ok
  }
}

// ---------------------------------------------------------------------------
// Messages resource
// ---------------------------------------------------------------------------

class GleapMessagesResource {
  constructor(private readonly headers: Record<string, string>) {}

  async addNote(ticketId: string, text: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        ticket: ticketId,
        type: "NOTE",
        isNote: true,
        bot: false,
        comment: { type: "paragraph", content: [{ type: "text", text }] },
      }),
    })
    if (!res.ok) {
      console.error(
        `[Gleap] addNote on ticket ${ticketId} failed: ${res.status} ${await res.text()}`,
      )
    }
  }

  async sendMessage(ticketId: string, text: string): Promise<boolean> {
    const res = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        ticket: ticketId,
        type: "BOT",
        isNote: false,
        bot: true,
        comment: { type: "paragraph", content: [{ type: "text", text }] },
      }),
    })
    if (!res.ok) {
      console.error(
        `[Gleap] sendMessage on ticket ${ticketId} failed: ${res.status} ${await res.text()}`,
      )
    }
    return res.ok
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GleapClient {
  readonly tickets: GleapTicketsResource
  readonly messages: GleapMessagesResource

  constructor(apiKey: string, projectId: string) {
    const headers = {
      project: projectId,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }
    this.tickets = new GleapTicketsResource(headers)
    this.messages = new GleapMessagesResource(headers)
  }
}

let _instance: GleapClient | null = null

export const getGleapClient = (): GleapClient => {
  if (!_instance) {
    _instance = new GleapClient(
      process.env.GLEAP_API_KEY || "",
      config.gleap.projectId,
    )
  }
  return _instance
}
