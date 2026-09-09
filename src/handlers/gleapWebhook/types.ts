import type { GleapTicket } from "../../integrations/gleap/client"

export interface GleapWebhookTicket extends GleapTicket {
  tags?: string[]
}

export interface GleapWebhookPayload {
  event: string
  projectId: string
  data: GleapWebhookTicket
}
