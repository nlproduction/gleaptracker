import crypto from "node:crypto"
import type { AddressInfo } from "node:net"
import type { Server } from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import config from "../gleaptracker.config"
import { createApp } from "./app"
let server: Server
let origin: string
beforeAll(async () => {
  server = createApp().listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) })
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body })

describe("HTTP routing and parsers", () => {
  it("serves health without exposing secrets or framework headers", async () => {
    const response = await fetch(`${origin}/health`)
    expect(await response.json()).toEqual({ ok: true, service: "gleaptracker" })
    expect(response.headers.get("x-powered-by")).toBeNull()
  })
  it("passes original bytes to Jira HMAC verification", async () => {
    const raw = '{ "webhookEvent": "ping", "text": "café ☕" }'
    const signature = crypto.createHmac("sha256", config.jira!.webhookSecret).update(raw).digest("hex")
    expect((await post("/api/webhooks/jira", raw, { "X-Hub-Signature": `sha256=${signature}` })).status).toBe(200)
  })
  it("keeps the legacy Jira URL route", async () => {
    expect((await post(`/api/webhooks/jira?secret=${config.jira!.webhookSecret}`, '{"webhookEvent":"ping"}')).status).toBe(200)
  })
  it("verifies Linear raw bodies", async () => {
    const raw = JSON.stringify({ type: "Comment", action: "create", webhookTimestamp: Date.now() })
    const signature = crypto.createHmac("sha256", config.linear!.webhookSecret).update(raw).digest("hex")
    expect((await post("/api/webhooks/linear", raw, { "linear-signature": signature })).status).toBe(200)
  })
  it("rejects malformed Gleap JSON without leaking a stack trace", async () => {
    const response = await post("/api/webhooks/gleap", "{")
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid JSON" })
  })
  it("rejects unauthenticated Jira requests", async () => {
    expect((await post("/api/webhooks/jira", '{"webhookEvent":"ping"}')).status).toBe(401)
  })
})
