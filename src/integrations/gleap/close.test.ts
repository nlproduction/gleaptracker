import { beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../../gleaptracker.config"
import {
  customerTicket,
  extraCustomerTicket,
  trackerTicket,
} from "../../test/fixtures"

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue(true),
  runWorkflow: vi.fn().mockResolvedValue(true),
  update: vi.fn().mockResolvedValue(true),
  loadTicket: vi.fn(),
  loadCustomerTickets: vi.fn(),
  markTrackerSlackClosed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>()
  return {
    ...actual,
    getGleapClient: () => ({
      tickets: { update: mocks.update, runWorkflow: mocks.runWorkflow },
      messages: { sendMessage: mocks.sendMessage },
    }),
  }
})

vi.mock("./linked", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./linked")>()
  return {
    ...actual,
    loadTicket: mocks.loadTicket,
    loadCustomerTickets: mocks.loadCustomerTickets,
  }
})

vi.mock("../../handlers/gleapWebhook/slack", () => ({
  markTrackerSlackClosed: mocks.markTrackerSlackClosed,
}))

import { closeTracker } from "./close"

describe("closeTracker", () => {
  const primary = customerTicket()
  const extra = extraCustomerTicket()
  const customers = [primary, extra]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendMessage.mockResolvedValue(true)
    mocks.update.mockResolvedValue(true)
    mocks.loadCustomerTickets.mockResolvedValue(customers)
  })

  it("sends a custom message to each linked customer, marks the tracker DONE, and updates Slack", async () => {
    const tracker = trackerTicket()
    mocks.loadTicket.mockResolvedValue(tracker)

    await closeTracker(tracker, {
      message: "We shipped the orange-typo fix.",
      source: "slack",
    })

    expect(mocks.sendMessage).toHaveBeenCalledTimes(2)
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "cust-1",
      "We shipped the orange-typo fix.",
    )
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "cust-2",
      "We shipped the orange-typo fix.",
    )
    expect(mocks.runWorkflow).not.toHaveBeenCalled()

    expect(mocks.update).toHaveBeenCalledWith(
      "tracker-1",
      expect.objectContaining({
        formData: expect.objectContaining({
          close_processed: "true",
          close_silent: "false",
        }),
      }),
    )
    expect(mocks.update).toHaveBeenCalledWith("tracker-1", {
      status: config.gleap.doneStatus,
    })

    expect(mocks.markTrackerSlackClosed).toHaveBeenCalledTimes(1)
    expect(mocks.markTrackerSlackClosed.mock.calls[0][0]).toMatchObject({
      id: "tracker-1",
      status: "DONE",
    })
  })

  it("silent / empty close skips customer messages but still DONE + Slack closed", async () => {
    const tracker = trackerTicket()
    mocks.loadTicket.mockResolvedValue(tracker)

    await closeTracker(tracker, { silent: true, source: "slack" })

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.runWorkflow).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      "tracker-1",
      expect.objectContaining({
        formData: expect.objectContaining({
          close_processed: "true",
          close_silent: "true",
        }),
      }),
    )
    expect(mocks.update).toHaveBeenCalledWith("tracker-1", {
      status: config.gleap.doneStatus,
    })
    expect(mocks.markTrackerSlackClosed).toHaveBeenCalledTimes(1)
  })

  it("gleap-sourced close is silent — no customer messages, still DONE + Slack", async () => {
    const tracker = trackerTicket()
    mocks.loadTicket.mockResolvedValue(tracker)

    await closeTracker(tracker, { source: "gleap" })

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.runWorkflow).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      "tracker-1",
      expect.objectContaining({
        formData: expect.objectContaining({
          close_processed: "true",
          close_silent: "true",
        }),
      }),
    )
    expect(mocks.update).toHaveBeenCalledWith("tracker-1", {
      status: config.gleap.doneStatus,
    })
    expect(mocks.markTrackerSlackClosed).toHaveBeenCalledTimes(1)
  })

  it("github-sourced close notifies linked customers via bugFixedMessage", async () => {
    const tracker = trackerTicket()
    mocks.loadTicket.mockResolvedValue(tracker)

    await closeTracker(tracker, { source: "github" })

    expect(mocks.sendMessage).toHaveBeenCalledTimes(2)
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "cust-1",
      config.gleap.bugFixedMessage,
    )
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "cust-2",
      config.gleap.bugFixedMessage,
    )
    expect(mocks.runWorkflow).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      "tracker-1",
      expect.objectContaining({
        formData: expect.objectContaining({
          close_processed: "true",
          close_silent: "false",
        }),
      }),
    )
    expect(mocks.update).toHaveBeenCalledWith("tracker-1", {
      status: config.gleap.doneStatus,
    })
    expect(mocks.markTrackerSlackClosed).toHaveBeenCalledTimes(1)
  })

  it("is idempotent when the tracker is already DONE and close_processed", async () => {
    const tracker = trackerTicket({
      status: "DONE",
      formData: { close_processed: "true", close_silent: "false" },
    })
    mocks.loadTicket.mockResolvedValue(tracker)

    await closeTracker(tracker, {
      message: "should not send again",
      source: "gleap",
    })

    expect(mocks.loadCustomerTickets).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.runWorkflow).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.markTrackerSlackClosed).not.toHaveBeenCalled()
  })
})
