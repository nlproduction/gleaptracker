import { beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../../gleaptracker.config"
import { customerTicket } from "../../test/fixtures"

const mocks = vi.hoisted(() => ({
  update: vi.fn().mockResolvedValue(true),
}))

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>()
  return {
    ...actual,
    getGleapClient: () => ({
      tickets: { update: mocks.update },
    }),
  }
})

import { markLinkedInProgress } from "./linked"

describe("markLinkedInProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.update.mockResolvedValue(true)
  })

  it("moves OPEN customer tickets to INPROGRESS", async () => {
    await markLinkedInProgress(customerTicket({ status: "OPEN" }))
    expect(mocks.update).toHaveBeenCalledWith("cust-1", { status: "INPROGRESS" })
    expect(mocks.update).not.toHaveBeenCalledWith(
      "cust-1",
      expect.objectContaining({ status: config.gleap.waitingStatus }),
    )
  })

  it("leaves INPROGRESS unchanged", async () => {
    await markLinkedInProgress(customerTicket({ status: "INPROGRESS" }))
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("leaves On Slack, Waiting for update, and DONE unchanged", async () => {
    await markLinkedInProgress(
      customerTicket({ status: config.gleap.onSlackStatuses.BUG }),
    )
    await markLinkedInProgress(customerTicket({ status: config.gleap.waitingStatus }))
    await markLinkedInProgress(customerTicket({ status: "DONE" }))
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
