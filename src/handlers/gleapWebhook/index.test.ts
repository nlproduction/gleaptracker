import { beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../../gleaptracker.config"
import { customerTicket, trackerTicket } from "../../test/fixtures"
import { mockReq, mockRes } from "../../test/http"

const mocks = vi.hoisted(() => ({
  closeTracker: vi.fn().mockResolvedValue(undefined),
  syncTrackerSlack: vi.fn().mockResolvedValue(undefined),
  findLinkedTracker: vi.fn().mockResolvedValue(null),
  ticketUpdate: vi.fn().mockResolvedValue(true),
}))

vi.mock("../../integrations/gleap/close", () => ({
  closeTracker: mocks.closeTracker,
}))

vi.mock("./slack", () => ({
  syncTrackerSlack: mocks.syncTrackerSlack,
}))

vi.mock("../../integrations/gleap/linked", () => ({
  findLinkedTracker: mocks.findLinkedTracker,
}))

vi.mock("../../integrations/gleap/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../integrations/gleap/client")>()
  return {
    ...actual,
    getGleapClient: () => ({
      tickets: { update: mocks.ticketUpdate },
    }),
  }
})

import { gleapPost } from "./index"

const postTicket = async (event: "ticket.created" | "ticket.updated", ticket: object) => {
  const res = mockRes()
  await gleapPost(
    mockReq({
      body: {
        event,
        projectId: "test-project",
        data: ticket,
      },
    }),
    res,
  )
  return res
}

describe("gleap webhook tracker events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("closes silently when a tracker is updated to DONE", async () => {
    const tracker = trackerTicket({ status: "DONE" })
    const res = await postTicket("ticket.updated", tracker)

    expect(res.statusCode).toBe(200)
    expect(mocks.closeTracker).toHaveBeenCalledWith(tracker, {
      silent: true,
      source: "gleap",
    })
    expect(mocks.syncTrackerSlack).not.toHaveBeenCalled()
    expect(mocks.ticketUpdate).not.toHaveBeenCalled()
  })

  it("syncs Slack when a tracker is updated but not DONE", async () => {
    const tracker = trackerTicket({ status: "OPEN" })
    const res = await postTicket("ticket.updated", tracker)

    expect(res.statusCode).toBe(200)
    expect(mocks.closeTracker).not.toHaveBeenCalled()
    expect(mocks.syncTrackerSlack).toHaveBeenCalledWith(tracker)
    expect(mocks.ticketUpdate).not.toHaveBeenCalled()
  })

  it("corrects a new tracker with the wrong type to FOR-RELEASE then syncs Slack", async () => {
    const tracker = trackerTicket({ type: "BUG" })
    const res = await postTicket("ticket.created", tracker)

    expect(res.statusCode).toBe(200)
    expect(mocks.ticketUpdate).toHaveBeenCalledWith(tracker.id, {
      type: config.gleap.trackerTicketType,
    })
    expect(mocks.ticketUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.syncTrackerSlack).toHaveBeenCalledWith(tracker)
    expect(mocks.closeTracker).not.toHaveBeenCalled()
    expect(tracker.type).toBe(config.gleap.trackerTicketType)
  })

  it("corrects type on ticket.updated when still wrong, then continues Slack sync", async () => {
    const tracker = trackerTicket({ type: "INQUIRY", status: "OPEN" })
    const res = await postTicket("ticket.updated", tracker)

    expect(res.statusCode).toBe(200)
    expect(mocks.ticketUpdate).toHaveBeenCalledWith(tracker.id, {
      type: config.gleap.trackerTicketType,
    })
    expect(mocks.syncTrackerSlack).toHaveBeenCalledWith(tracker)
    expect(mocks.closeTracker).not.toHaveBeenCalled()
  })

  it("does not rewrite type when the tracker is already FOR-RELEASE", async () => {
    const tracker = trackerTicket({ type: config.gleap.trackerTicketType })
    const res = await postTicket("ticket.created", tracker)

    expect(res.statusCode).toBe(200)
    expect(mocks.ticketUpdate).not.toHaveBeenCalled()
    expect(mocks.syncTrackerSlack).toHaveBeenCalledWith(tracker)
  })

  it("corrects type before a silent DONE close", async () => {
    const tracker = trackerTicket({ type: "BUG", status: "DONE" })
    const res = await postTicket("ticket.updated", tracker)

    expect(res.statusCode).toBe(200)
    expect(mocks.ticketUpdate).toHaveBeenCalledWith(tracker.id, {
      type: config.gleap.trackerTicketType,
    })
    expect(mocks.closeTracker).toHaveBeenCalledWith(tracker, {
      silent: true,
      source: "gleap",
    })
    expect(mocks.syncTrackerSlack).not.toHaveBeenCalled()
  })

  it("does not rewrite type on a customer ticket", async () => {
    const customer = customerTicket({ type: "BUG" })
    mocks.findLinkedTracker.mockResolvedValueOnce(null)
    const res = await postTicket("ticket.created", customer)

    expect(res.statusCode).toBe(200)
    expect(mocks.ticketUpdate).not.toHaveBeenCalled()
    expect(mocks.syncTrackerSlack).not.toHaveBeenCalled()
    expect(mocks.closeTracker).not.toHaveBeenCalled()
  })
})
