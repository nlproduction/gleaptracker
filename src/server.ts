import dotenv from "dotenv"
import express from "express"
import morgan from "morgan"
import { gleapOptions, gleapPost } from "./handlers/gleapWebhook"
import { jiraOptions, jiraPost } from "./handlers/jiraWebhook"
import { linearOptions, linearPost } from "./handlers/linearWebhook"
import { slackOptions, slackPost } from "./handlers/slack"

dotenv.config({ path: ".env.local" })
dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 3000

app.use(morgan(":date[iso] :method :url :status", { immediate: true }))

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
app.post("/api/webhooks/jira", jsonBody, (req, res) => void jiraPost(req, res))

app.listen(PORT, () => {
  console.log(`GleapTracker listening on http://localhost:${PORT}`)
})

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason)
})

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err)
})
