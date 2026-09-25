import express from "express"
import morgan from "morgan"
import { githubOptions, githubPost } from "./handlers/githubWebhook"
import { gleapOptions, gleapPost } from "./handlers/gleapWebhook"
import { jiraOptions, jiraPost } from "./handlers/jiraWebhook"
import { linearOptions, linearPost } from "./handlers/linearWebhook"
import { slackOptions, slackPost } from "./handlers/slack"

// Legacy webhook URLs can contain secrets. Never log their query strings.
morgan.token("safe-path", (req) => req.url?.split("?")[0] || "/")

export const createApp = () => {
  const app = express()
  app.disable("x-powered-by")
  app.use(morgan(":date[iso] :method :safe-path :status"))
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "gleaptracker" })
  })

  const rawBody = express.raw({ type: "*/*", limit: "5mb" })
  const jsonBody = express.json({ limit: "2mb" })

  app.options("/api/slack", slackOptions)
  app.post("/api/slack", rawBody, (req, res) => void slackPost(req, res))
  app.options("/api/webhooks/linear", linearOptions)
  app.post("/api/webhooks/linear", rawBody, (req, res) => void linearPost(req, res))
  app.options("/api/webhooks/gleap", gleapOptions)
  app.post("/api/webhooks/gleap", jsonBody, (req, res) => void gleapPost(req, res))
  app.options("/api/webhooks/jira", jiraOptions)
  app.post("/api/webhooks/jira", rawBody, (req, res) => void jiraPost(req, res))
  app.options("/api/webhooks/github", githubOptions)
  app.post("/api/webhooks/github", rawBody, (req, res) => void githubPost(req, res))

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number(error.status) : 500
    if (status === 400 || status === 413) {
      res.status(status).json({ error: status === 413 ? "Payload too large" : "Invalid JSON" })
      return
    }
    console.error("[HTTP] Request failed:", error)
    res.status(500).json({ error: "Internal server error" })
  })
  return app
}
