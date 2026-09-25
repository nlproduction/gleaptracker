import { beforeEach, describe, expect, it, vi } from "vitest"
import { customerTicket, trackerTicket } from "../../test/fixtures"
import type { GleapTicket } from "./client"
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), send: vi.fn(), customers: vi.fn(), slack: vi.fn() }))
vi.mock("./client", async (importOriginal) => ({
  ...await importOriginal<typeof import("./client")>(),
  getGleapClient: () => ({ tickets: { update: mocks.update }, messages: { sendMessage: mocks.send } }),
}))
vi.mock("./linked", async (importOriginal) => ({
  ...await importOriginal<typeof import("./linked")>(), loadTicket: mocks.get, loadCustomerTickets: mocks.customers,
}))
vi.mock("../../handlers/gleapWebhook/slack", () => ({ markTrackerSlackClosed: mocks.slack }))
import { closeTracker } from "./close"
let state: GleapTicket
beforeEach(() => {
  vi.clearAllMocks()
  state = trackerTicket()
  mocks.get.mockImplementation(async () => structuredClone(state))
  mocks.update.mockImplementation(async (_id: string, patch: Partial<GleapTicket>) => { state = { ...state, ...patch }; return true })
  mocks.send.mockResolvedValue(true)
  mocks.customers.mockResolvedValue([customerTicket()])
  mocks.slack.mockResolvedValue(undefined)
})
describe("shared close coordination", () => {
  it("does not double-notify when Linear and Jira close concurrently", async () => {
    await Promise.all([closeTracker(trackerTicket(), { source: "linear" }), closeTracker(trackerTicket(), { source: "jira" })])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.slack).toHaveBeenCalledTimes(1)
    expect(state.status).toBe("DONE")
  })
  it("reports notification failure instead of silently closing the tracker", async () => {
    mocks.send.mockResolvedValueOnce(false)
    await expect(closeTracker(trackerTicket(), { source: "linear" })).rejects.toThrow("notification/workflow failed")
    expect(state.status).toBe("OPEN")
    expect(mocks.update).not.toHaveBeenCalled()
    await closeTracker(trackerTicket(), { source: "linear" })
    expect(state.status).toBe("DONE")
  })
  it("reports failed state writes", async () => {
    mocks.update.mockResolvedValueOnce(false)
    await expect(closeTracker(trackerTicket(), { silent: true })).rejects.toThrow("save close state")
    expect(state.status).toBe("OPEN")
  })
})
