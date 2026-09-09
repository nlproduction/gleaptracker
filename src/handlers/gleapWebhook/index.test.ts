import { beforeEach, describe, expect, it, vi } from "vitest"
import { trackerTicket } from "../../test/fixtures"
import { mockReq, mockRes } from "../../test/http"

const mocks = vi.hoisted(() => ({
  closeTracker: vi.fn().mockResolvedValue(undefined),
  syncTrackerSlack: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../integrations/gleap/close", () => ({
  closeTracker: mocks.closeTracker,
}))

vi.mock("./slack", () => ({
  syncTrackerSlack: mocks.syncTrackerSlack,
}))

import { gleapPost } from "./index"

describe("gleap webhook tracker events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("closes silently when a tracker is updated to DONE", async () => {
    const tracker = trackerTicket({ status: "DONE" })
    const res = mockRes()

    await gleapPost(
      mockReq({
        body: {
          event: "ticket.updated",
          projectId: "test-project",
          data: tracker,
        },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(mocks.closeTracker).toHaveBeenCalledWith(tracker, {
      silent: true,
      source: "gleap",
    })
    expect(mocks.syncTrackerSlack).not.toHaveBeenCalled()
  })

  it("syncs Slack when a tracker is updated but not DONE", async () => {
    const tracker = trackerTicket({ status: "OPEN" })
    const res = mockRes()

    await gleapPost(
      mockReq({
        body: {
          event: "ticket.updated",
          projectId: "test-project",
          data: tracker,
        },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(mocks.closeTracker).not.toHaveBeenCalled()
    expect(mocks.syncTrackerSlack).toHaveBeenCalledWith(tracker)
  })
})
