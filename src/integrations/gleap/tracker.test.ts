import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../../gleaptracker.config"
import { customerTicket, trackerTicket } from "../../test/fixtures"
import type { GleapTicket } from "./client"

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), linear: vi.fn(), jira: vi.fn() }))
vi.mock("../linear/client", () => ({ createLinearIssue: mocks.linear }))
vi.mock("../jira/client", () => ({ createJiraIssue: mocks.jira }))
vi.mock("./client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./client")>(),
  getGleapClient: () => ({ tickets: { get: mocks.get, update: mocks.update } }),
}))
import { ensureTrackerTicketType, processTrackerTicket } from "./tracker"

const originalMode = config.issueTracker
let serial = 0
let tracker: GleapTicket
let store: Map<string, GleapTicket>
beforeEach(() => {
  vi.clearAllMocks()
  config.issueTracker = "none"
  tracker = trackerTicket({ id: `tracker-${++serial}`, formData: { slack_thread_ts: "thread-ts", custom: "keep" } })
  store = new Map([[tracker.id, structuredClone(tracker)], ["cust-1", customerTicket({ formData: { custom: "customer" } })]])
  mocks.get.mockImplementation(async (id: string) => {
    const ticket = store.get(id)
    if (!ticket) throw new Error(`Unknown fixture ${id}`)
    return structuredClone(ticket)
  })
  mocks.update.mockImplementation(async (id: string, patch: Partial<GleapTicket>) => {
    store.set(id, { ...store.get(id)!, ...structuredClone(patch) })
    return true
  })
  mocks.linear.mockResolvedValue({ id: "linear-uuid", identifier: "TEAM-1", url: "https://linear.app/team/issue/TEAM-1" })
  mocks.jira.mockResolvedValue({ id: "1001", key: "DEMO-1", identifier: "DEMO-1", url: "https://example.atlassian.net/browse/DEMO-1" })
})
afterEach(() => { config.issueTracker = originalMode })

describe("optional issue tracking", () => {
  it("does not touch provider APIs or ticket data in none mode", async () => {
    await processTrackerTicket(tracker)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.linear).not.toHaveBeenCalled()
    expect(mocks.jira).not.toHaveBeenCalled()
  })
  it("does not create issues for customers", async () => {
    config.issueTracker = "both"
    await processTrackerTicket(customerTicket())
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it("re-reads persisted state rather than duplicating issues on stale webhooks", async () => {
    config.issueTracker = "linear"
    await processTrackerTicket(tracker)
    await processTrackerTicket(tracker)
    expect(mocks.linear).toHaveBeenCalledTimes(1)
    expect(store.get(tracker.id)?.formData).toMatchObject({ linearIssueId: "TEAM-1", linearIssueUuid: "linear-uuid", slack_thread_ts: "thread-ts", custom: "keep" })
    expect(store.get("cust-1")?.formData).toMatchObject({ issueId: "TEAM-1", linearIssueId: "TEAM-1", custom: "customer" })
  })
  it("serializes concurrent tracker events", async () => {
    config.issueTracker = "linear"
    await Promise.all([processTrackerTicket(tracker), processTrackerTicket(tracker), processTrackerTicket(tracker)])
    expect(mocks.linear).toHaveBeenCalledTimes(1)
  })
  it("preserves both provider links and unrelated formData", async () => {
    config.issueTracker = "both"
    await processTrackerTicket(tracker)
    expect(store.get(tracker.id)?.formData).toMatchObject({ linearIssueId: "TEAM-1", jiraIssueId: "DEMO-1", jiraIssueInternalId: "1001", slack_thread_ts: "thread-ts", custom: "keep" })
    expect(store.get("cust-1")?.formData).toMatchObject({ issueId: "TEAM-1", linearIssueId: "TEAM-1", jiraIssueId: "DEMO-1", custom: "customer" })
  })
  it("retries only the failed provider after a partial success", async () => {
    config.issueTracker = "both"
    mocks.jira.mockRejectedValueOnce(new Error("Jira unavailable"))
    await expect(processTrackerTicket(tracker)).rejects.toThrow("synchronization failed")
    await processTrackerTicket(tracker)
    expect(mocks.linear).toHaveBeenCalledTimes(1)
    expect(mocks.jira).toHaveBeenCalledTimes(2)
    expect(store.get(tracker.id)?.formData?.jiraIssueId).toBe("DEMO-1")
  })
  it("does not let a Linear outage block Jira creation", async () => {
    config.issueTracker = "both"
    mocks.linear.mockRejectedValueOnce(new Error("Linear unavailable"))
    await expect(processTrackerTicket(tracker)).rejects.toThrow()
    expect(mocks.jira).toHaveBeenCalledTimes(1)
    await processTrackerTicket(tracker)
    expect(mocks.jira).toHaveBeenCalledTimes(1)
    expect(mocks.linear).toHaveBeenCalledTimes(2)
  })
  it("retains a successful create when persisting the link fails", async () => {
    config.issueTracker = "linear"
    mocks.update.mockResolvedValueOnce(false)
    await expect(processTrackerTicket(tracker)).rejects.toThrow()
    await processTrackerTicket(tracker)
    expect(mocks.linear).toHaveBeenCalledTimes(1)
    expect(store.get(tracker.id)?.formData?.linearIssueId).toBe("TEAM-1")
  })
  it("keeps pre-existing provider and generic customer links", async () => {
    config.issueTracker = "linear"
    store.get(tracker.id)!.formData = { linearIssueId: "OLD-7", linearIssueUrl: "https://linear.app/old" }
    store.get("cust-1")!.formData = { issueId: "EXISTING-9", issueUrl: "https://example.com/existing" }
    await processTrackerTicket(tracker)
    expect(mocks.linear).not.toHaveBeenCalled()
    expect(store.get("cust-1")?.formData).toMatchObject({ issueId: "EXISTING-9", linearIssueId: "OLD-7" })
  })
  it("supports linked object references and deduplicates them", async () => {
    config.issueTracker = "jira"
    store.get(tracker.id)!.linkedTickets = [{ id: "cust-1", title: "Customer", bugId: 1 }, { id: "cust-1", title: "Customer", bugId: 1 }]
    await processTrackerTicket(tracker)
    expect(store.get("cust-1")?.formData?.jiraIssueId).toBe("DEMO-1")
    expect(store.get("cust-1")?.status).toBe("INPROGRESS")
  })
  it("does not overwrite non-OPEN customer statuses", async () => {
    config.issueTracker = "jira"
    store.get("cust-1")!.status = "CUSTOM-WAITING"
    await processTrackerTicket(tracker)
    expect(store.get("cust-1")?.status).toBe("CUSTOM-WAITING")
  })
  it("does not create issues for a tracker already closed in Gleap", async () => {
    config.issueTracker = "both"
    store.get(tracker.id)!.status = "DONE"
    await processTrackerTicket(tracker)
    expect(mocks.linear).not.toHaveBeenCalled()
    expect(mocks.jira).not.toHaveBeenCalled()
  })
  it("fails safely when a fresh read fails instead of trusting stale data", async () => {
    config.issueTracker = "linear"
    mocks.get.mockRejectedValueOnce(new Error("Gleap unavailable"))
    await expect(processTrackerTicket(tracker)).rejects.toThrow("Gleap unavailable")
    expect(mocks.linear).not.toHaveBeenCalled()
    await processTrackerTicket(tracker)
    expect(mocks.linear).toHaveBeenCalledTimes(1)
  })
  it("does not claim a ticket type changed when the API rejected it", async () => {
    const hint = trackerTicket({ type: "BUG" })
    mocks.update.mockResolvedValueOnce(false)
    await expect(ensureTrackerTicketType(hint)).rejects.toThrow("Failed to correct")
    expect(hint.type).toBe("BUG")
  })
})
