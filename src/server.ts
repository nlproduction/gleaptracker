import "./env"
import config from "../gleaptracker.config"
import { createApp } from "./app"
import { startFollowUpCron } from "./jobs/followUp"

const PORT = Number(process.env.PORT) || 3000
const app = createApp()

app.listen(PORT, () => {
  console.log(`GleapTracker listening on http://localhost:${PORT}`)
  if (!config.gleap.webhookSecret) {
    console.log("[Security] Gleap webhook has no shared secret. Restrict ingress or configure GLEAP_WEBHOOK_SECRET before exposing it publicly.")
  }
  startFollowUpCron()
})

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason)
})

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err)
})
