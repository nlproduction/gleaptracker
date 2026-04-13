import { WebClient } from "@slack/web-api"

let _instance: WebClient | null = null

export const getSlackClient = (): WebClient => {
  if (!_instance) {
    _instance = new WebClient(process.env.SLACK_BOT_TOKEN || "")
  }
  return _instance
}
