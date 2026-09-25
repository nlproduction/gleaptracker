import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../../gleaptracker.config"
import { customerTicket, trackerTicket } from "../../test/fixtures"
import { mockReq, mockRes } from "../../test/http"
const mocks = vi.hoisted(() => ({ process: vi.fn(), ensure: vi.fn(), sync: vi.fn(), close: vi.fn(), find: vi.fn() }))
vi.mock("../../integrations/gleap/tracker", () => ({ processTrackerTicket: mocks.process, ensureTrackerTicketType: mocks.ensure }))
vi.mock("../../integrations/gleap/close", () => ({ closeTracker: mocks.close }))
vi.mock("../../integrations/gleap/linked", () => ({ findLinkedTracker: mocks.find }))
vi.mock("./slack", () => ({ syncTrackerSlack: mocks.sync }))
import { gleapPost } from "./index"
const originalSecret = config.gleap.webhookSecret
beforeEach(() => {
  vi.clearAllMocks()
  config.gleap.webhookSecret = undefined
  mocks.process.mockResolvedValue(undefined)
  mocks.ensure.mockResolvedValue(undefined)
  mocks.sync.mockResolvedValue(undefined)
  mocks.close.mockResolvedValue(undefined)
  mocks.find.mockResolvedValue(trackerTicket())
})
afterEach(() => { config.gleap.webhookSecret = originalSecret })
const post = async (ticket: object, headers?: Record<string, string>) => {
  const res = mockRes()
  await gleapPost(mockReq({ body: { event: "ticket.updated", projectId: "test-project", data: ticket }, headers }), res)
  return res
}
describe("Gleap engineering integration routing", () => {
  it("runs issue synchronization before refreshing the tracker Slack card", async () => {
    const tracker = trackerTicket()
    expect((await post(tracker)).statusCode).toBe(200)
    expect(mocks.process).toHaveBeenCalledWith(tracker)
    expect(mocks.sync).toHaveBeenCalledWith(tracker)
    expect(mocks.process.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0])
  })
  it("also synchronizes when a new customer is linked to an existing tracker", async () => {
    expect((await post(customerTicket())).statusCode).toBe(200)
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ id: "tracker-1" }))
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ id: "tracker-1" }), { triggerTicketId: "cust-1" })
  })
  it("keeps Slack usable and returns a retryable error when a provider fails", async () => {
    mocks.process.mockRejectedValueOnce(new Error("Provider unavailable"))
    expect((await post(trackerTicket())).statusCode).toBe(500)
    expect(mocks.sync).toHaveBeenCalledTimes(1)
  })
  it("does not create issues when the tracker has already been closed", async () => {
    await post(trackerTicket({ status: "DONE" }))
    expect(mocks.process).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledWith(expect.anything(), { source: "gleap", silent: true })
  })
  it("enforces the optional shared secret without affecting legacy unsigned mode", async () => {
    config.gleap.webhookSecret = "test-shared-secret"
    expect((await post(trackerTicket())).statusCode).toBe(401)
    expect(mocks.process).not.toHaveBeenCalled()
    expect((await post(trackerTicket(), { Authorization: "Bearer test-shared-secret" })).statusCode).toBe(200)
  })
})
