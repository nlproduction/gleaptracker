import crypto from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../gleaptracker.config"
import { trackerTicket } from "../test/fixtures"
import { mockReq, mockRes } from "../test/http"

const mocks = vi.hoisted(() => ({ close: vi.fn(), find: vi.fn() }))
vi.mock("../integrations/gleap/close", () => ({ closeTracker: mocks.close }))
vi.mock("../integrations/gleap/linked", () => ({ findTrackerByBugId: mocks.find }))
import { linearPost } from "./linearWebhook"
import { jiraPost } from "./jiraWebhook"

const originalLinear = config.linear
const originalJira = config.jira
let serial = 0
const sign = (raw: string, secret: string) => crypto.createHmac("sha256", secret).update(raw).digest("hex")
const linearEvent = () => ({
  type: "Issue", action: "update", webhookTimestamp: Date.now(), updatedFrom: { stateId: "open-state" },
  data: {
    id: `linear-${++serial}`, identifier: "DEMO-1", title: "[237650] Fix checkout", teamId: "test-team",
    description: "", state: { type: "completed" }, labels: [{ name: "gleap-tracker-ticket" }],
  },
})
const jiraEvent = () => ({
  webhookEvent: "jira:issue_updated", timestamp: Date.now(),
  issue: {
    id: String(++serial), key: "DEMO-1",
    fields: { summary: "[237650] Fix checkout", description: "", project: { key: "DEMO" }, labels: [] as string[] },
  },
  changelog: { id: String(serial), items: [{ field: "status", fromString: "In Progress", toString: "Done" }] },
})

const postLinear = async (payload: unknown, signature?: string) => {
  const raw = JSON.stringify(payload)
  const res = mockRes()
  await linearPost(mockReq({ body: Buffer.from(raw), headers: { "linear-signature": signature ?? sign(raw, "linear-secret") } }), res)
  return res
}
const postJira = async (payload: unknown, opts: { legacy?: boolean; signature?: string; query?: unknown } = {}) => {
  const raw = JSON.stringify(payload)
  const headers = opts.legacy ? {} : { "X-Hub-Signature": opts.signature ?? `sha256=${sign(raw, "jira-secret")}` }
  const req = mockReq({ body: Buffer.from(raw), headers })
  Object.assign(req, { query: opts.query ?? (opts.legacy ? { secret: "jira-secret" } : {}) })
  const res = mockRes()
  await jiraPost(req, res)
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.close.mockResolvedValue(undefined)
  mocks.find.mockResolvedValue(trackerTicket())
  config.linear = { ...originalLinear!, teamId: "test-team", webhookSecret: "linear-secret" }
  config.jira = { ...originalJira!, projectKey: "DEMO", webhookSecret: "jira-secret", doneStatusName: "Done", doneStatusNames: [] }
})
afterEach(() => { config.linear = originalLinear; config.jira = originalJira })

describe("Linear webhooks", () => {
  it("closes a legacy labeled [bugId] issue", async () => {
    expect((await postLinear(linearEvent())).statusCode).toBe(200)
    expect(mocks.close).toHaveBeenCalledWith(expect.anything(), { source: "linear" })
  })
  it.each(["", "bad", "a".repeat(64), "a".repeat(64) + "zz"])("rejects malformed or incorrect signature %s", async (signature) => {
    expect((await postLinear(linearEvent(), signature)).statusCode).toBe(401)
    expect(mocks.find).not.toHaveBeenCalled()
  })
  it("fails closed without a configured signing secret", async () => {
    config.linear!.webhookSecret = ""
    expect((await postLinear(linearEvent())).statusCode).toBe(401)
  })
  it.each([-61_000, 61_000])("rejects timestamps outside the replay window (%d)", async (offset) => {
    const event = linearEvent(); event.webhookTimestamp += offset
    expect((await postLinear(event)).statusCode).toBe(401)
  })
  it("rejects a missing timestamp", async () => {
    const { webhookTimestamp: _timestamp, ...event } = linearEvent()
    expect((await postLinear(event)).statusCode).toBe(401)
  })
  it.each([null, [], { type: "Issue", action: "update", webhookTimestamp: Date.now(), data: null }])("validates payloads before reading fields", async (event) => {
    expect((await postLinear(event)).statusCode).toBe(400)
  })
  it("rejects signed invalid JSON", async () => {
    const raw = "{"; const res = mockRes()
    await linearPost(mockReq({ body: raw, headers: { "linear-signature": sign(raw, "linear-secret") } }), res)
    expect(res.statusCode).toBe(400)
  })
  it("ignores cancellations and other teams", async () => {
    const event = linearEvent(); event.data.state.type = "canceled"
    expect((await postLinear(event)).statusCode).toBe(200)
    event.data.state.type = "completed"; event.data.teamId = "another-team"
    await postLinear(event)
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it("does not close again when only the title changes", async () => {
    const event = { ...linearEvent(), updatedFrom: { title: "Old title" } }
    expect((await postLinear(event)).statusCode).toBe(200)
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it("uses stored identity and the description marker after a title/label change", async () => {
    const event = linearEvent(); event.data.title = "Renamed issue"; event.data.labels = []
    event.data.description = "Customer context\n\nGleap tracker: Gleap-237650\n\nOpen in Gleap: ..."
    mocks.find.mockResolvedValue(trackerTicket({ formData: { linearIssueUuid: event.data.id } }))
    expect((await postLinear(event)).statusCode).toBe(200)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })
  it("ignores another issue referencing the same tracker", async () => {
    mocks.find.mockResolvedValue(trackerTicket({ formData: { linearIssueUuid: "different-issue" } }))
    await postLinear(linearEvent())
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it("preserves older stored issue identifiers", async () => {
    mocks.find.mockResolvedValue(trackerTicket({ formData: { linearIssueId: "DEMO-1" } }))
    const event = linearEvent(); event.data.labels = []
    await postLinear(event)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })
  it("does not suppress a retry after failure", async () => {
    const event = linearEvent()
    mocks.close.mockRejectedValueOnce(new Error("temporary failure"))
    expect((await postLinear(event)).statusCode).toBe(500)
    expect((await postLinear(event)).statusCode).toBe(200)
    expect(mocks.close).toHaveBeenCalledTimes(2)
  })
  it("coalesces concurrent and repeated successful deliveries", async () => {
    const event = linearEvent()
    await Promise.all([postLinear(event), postLinear(event)])
    await postLinear(event)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })
})

describe("Jira webhooks", () => {
  it("verifies native HMAC over the original UTF-8 body", async () => {
    const event = jiraEvent(); event.issue.fields.summary += " — café ☕"
    expect((await postJira(event)).statusCode).toBe(200)
    expect(mocks.close).toHaveBeenCalledWith(expect.anything(), { source: "jira" })
  })
  it("keeps legacy secret URLs working", async () => {
    expect((await postJira(jiraEvent(), { legacy: true })).statusCode).toBe(200)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })
  it("never authenticates an empty configured and supplied secret", async () => {
    config.jira!.webhookSecret = ""
    expect((await postJira(jiraEvent(), { legacy: true, query: {} })).statusCode).toBe(401)
    expect(mocks.find).not.toHaveBeenCalled()
  })
  it("rejects a wrong legacy secret", async () => {
    expect((await postJira(jiraEvent(), { legacy: true, query: { secret: "wrong" } })).statusCode).toBe(401)
  })
  it("cannot downgrade an invalid signature to a valid query secret", async () => {
    expect((await postJira(jiraEvent(), { signature: "sha256=bad", query: { secret: "jira-secret" } })).statusCode).toBe(401)
  })
  it.each([null, [], { webhookEvent: "jira:issue_updated", issue: null }])("validates payload shapes", async (event) => {
    expect((await postJira(event)).statusCode).toBe(400)
  })
  it("ignores another project even with a matching [bugId]", async () => {
    const event = jiraEvent(); event.issue.fields.project.key = "OTHER"
    await postJira(event)
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it("ignores non-status edits and non-completed transitions", async () => {
    const event = jiraEvent(); event.changelog.items[0].field = "summary"
    await postJira(event)
    event.changelog.items[0].field = "status"; event.changelog.items[0].toString = "In Progress"
    await postJira(event)
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it("supports multiple configured completion statuses", async () => {
    config.jira!.doneStatusNames = ["Released", "Resolved"]
    const event = jiraEvent(); event.changelog.items[0].toString = "Released"
    await postJira(event)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })
  it("uses a stable label after renaming a linked issue", async () => {
    const event = jiraEvent(); event.issue.fields.summary = "Renamed"; event.issue.fields.labels = ["gleap-237650"]
    mocks.find.mockResolvedValue(trackerTicket({ formData: { jiraIssueInternalId: event.issue.id, jiraIssueId: event.issue.key } }))
    await postJira(event)
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })
  it("ignores a different stored issue identity", async () => {
    mocks.find.mockResolvedValue(trackerTicket({ formData: { jiraIssueId: "DEMO-99" } }))
    await postJira(jiraEvent())
    expect(mocks.close).not.toHaveBeenCalled()
  })
  it("leaves a failed delivery retryable", async () => {
    const event = jiraEvent(); mocks.close.mockRejectedValueOnce(new Error("temporary failure"))
    expect((await postJira(event)).statusCode).toBe(500)
    expect((await postJira(event)).statusCode).toBe(200)
    expect(mocks.close).toHaveBeenCalledTimes(2)
  })
  it("coalesces repeated completed deliveries", async () => {
    const event = jiraEvent()
    await Promise.all([postJira(event), postJira(event)])
    expect(mocks.close).toHaveBeenCalledTimes(1)
  })
})
