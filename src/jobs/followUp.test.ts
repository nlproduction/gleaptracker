import { beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../gleaptracker.config"
import { customerTicket, trackerTicket } from "../test/fixtures"

const mocks = vi.hoisted(() => ({
  listTickets: vi.fn(),
  getTicket: vi.fn(),
  listMessages: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(true),
  update: vi.fn().mockResolvedValue(true),
  findLinkedTracker: vi.fn(),
  schedule: vi.fn(),
  validate: vi.fn().mockReturnValue(true),
}))

vi.mock("../integrations/gleap/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integrations/gleap/client")>()
  return {
    ...actual,
    getGleapClient: () => ({
      tickets: { list: mocks.listTickets, get: mocks.getTicket, update: mocks.update },
      messages: { list: mocks.listMessages, sendMessage: mocks.sendMessage },
    }),
  }
})

vi.mock("../integrations/gleap/linked", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integrations/gleap/linked")>()
  return {
    ...actual,
    findLinkedTracker: mocks.findLinkedTracker,
  }
})

vi.mock("node-cron", () => ({
  default: {
    schedule: mocks.schedule,
    validate: mocks.validate,
  },
  schedule: mocks.schedule,
  validate: mocks.validate,
}))

import { isFollowUpCronEnabled, runFollowUpJob, startFollowUpCron } from "./followUp"

const now = new Date("2026-09-09T08:00:00.000Z")
const isoHoursAgo = (hours: number): string =>
  new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()

const agentThenSilence = (hoursSinceAgent: number) => [
  {
    id: "m-agent",
    type: "TEXT",
    senderType: "agent" as const,
    bot: false,
    createdAt: isoHoursAgo(hoursSinceAgent),
    text: "Any update?",
  },
]

describe("runFollowUpJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendMessage.mockResolvedValue(true)
    mocks.update.mockResolvedValue(true)
    mocks.listTickets.mockResolvedValue({ tickets: [], count: 0, totalCount: 0 })
    mocks.listMessages.mockResolvedValue([])
    mocks.findLinkedTracker.mockResolvedValue(null)
  })

  it("sends a follow-up, closes no-reply, skips an active linked tracker, and logs counts", async () => {
    const follow = customerTicket({ id: "cust-follow", bugId: 1, status: "OPEN" })
    const close = customerTicket({ id: "cust-close", bugId: 2, status: "INPROGRESS" })
    const linked = customerTicket({ id: "cust-linked", bugId: 3, status: "OPEN" })
    const parked = customerTicket({
      id: "cust-parked",
      bugId: 4,
      status: config.gleap.onSlackStatuses.BUG,
    })

    mocks.listTickets.mockResolvedValue({
      tickets: [follow, close, linked, parked],
      count: 4,
      totalCount: 4,
    })
    mocks.findLinkedTracker.mockImplementation(async (ticket: { id: string }) => {
      if (ticket.id === "cust-linked") return trackerTicket({ status: "INPROGRESS" })
      if (ticket.id === "cust-follow") return trackerTicket({ status: "DONE" })
      return null
    })
    mocks.listMessages.mockImplementation(async ({ ticket }: { ticket: string }) => {
      if (ticket === "cust-follow") return agentThenSilence(80)
      if (ticket === "cust-close") return agentThenSilence(130)
      return agentThenSilence(80)
    })

    const summary = await runFollowUpJob(now, 0)

    expect(mocks.sendMessage).toHaveBeenCalledWith("cust-follow", config.followUp.followUpMessage)
    expect(mocks.sendMessage).toHaveBeenCalledWith("cust-close", config.followUp.closeMessage)
    expect(mocks.update).toHaveBeenCalledWith("cust-close", { status: config.gleap.doneStatus })
    expect(mocks.sendMessage).not.toHaveBeenCalledWith("cust-linked", expect.anything())
    expect(mocks.sendMessage).not.toHaveBeenCalledWith("cust-parked", expect.anything())

    expect(summary).toEqual({
      scanned: 4,
      skippedLinkedTracker: 1,
      skippedParked: 1,
      followedUp: 1,
      closed: 1,
      errors: 0,
    })
  })

  it("is safe to re-run the same day — does not send a second follow-up", async () => {
    const ticket = customerTicket({ id: "cust-1", status: "OPEN" })
    mocks.listTickets.mockResolvedValue({ tickets: [ticket], count: 1, totalCount: 1 })
    mocks.listMessages.mockResolvedValue([
      ...agentThenSilence(80),
      {
        id: "m-bot",
        type: "BOT",
        senderType: "bot",
        bot: true,
        createdAt: isoHoursAgo(1),
        text: config.followUp.followUpMessage,
      },
    ])

    const summary = await runFollowUpJob(now, 0)

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(summary.followedUp).toBe(0)
    expect(summary.closed).toBe(0)
    expect(summary.errors).toBe(0)
  })

  it("does not close-message again when the close text is already on the thread, but still marks DONE", async () => {
    const ticket = customerTicket({ id: "cust-1", status: "OPEN" })
    mocks.listTickets.mockResolvedValue({ tickets: [ticket], count: 1, totalCount: 1 })
    mocks.listMessages.mockResolvedValue([
      ...agentThenSilence(130),
      {
        id: "m-close",
        type: "BOT",
        senderType: "bot",
        bot: true,
        createdAt: isoHoursAgo(1),
        text: config.followUp.closeMessage,
      },
    ])

    const summary = await runFollowUpJob(now, 0)

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith("cust-1", { status: "DONE" })
    expect(summary.closed).toBe(1)
  })

  it("counts a per-ticket failure without aborting the rest of the run", async () => {
    const ok = customerTicket({ id: "cust-ok", status: "OPEN" })
    const bad = customerTicket({ id: "cust-bad", status: "OPEN" })
    mocks.listTickets.mockResolvedValue({ tickets: [bad, ok], count: 2, totalCount: 2 })
    mocks.findLinkedTracker.mockImplementation(async (ticket: { id: string }) => {
      if (ticket.id === "cust-bad") throw new Error("gleap down")
      return null
    })
    mocks.listMessages.mockResolvedValue(agentThenSilence(80))

    const summary = await runFollowUpJob(now, 0)

    expect(summary.errors).toBe(1)
    expect(summary.followedUp).toBe(1)
    expect(summary.scanned).toBe(2)
  })
})

describe("startFollowUpCron", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validate.mockReturnValue(true)
  })

  it("does not register a schedule in the test env", () => {
    expect(isFollowUpCronEnabled()).toBe(false)
    expect(startFollowUpCron()).toBeUndefined()
    expect(mocks.schedule).not.toHaveBeenCalled()
  })

  it("would schedule daily 08:00 UTC when enabled", () => {
    expect(
      isFollowUpCronEnabled({
        FOLLOWUP_CRON: "0 8 * * *",
      } as NodeJS.ProcessEnv),
    ).toBe(true)
    expect(
      isFollowUpCronEnabled({
        FOLLOWUP_CRON: "off",
      } as NodeJS.ProcessEnv),
    ).toBe(false)
    expect(config.followUp.cron).toBe("0 8 * * *")
    expect(config.followUp.timezone).toBe("UTC")
    expect(config.followUp.followUpAfterDays).toBe(3)
    expect(config.followUp.closeAfterDays).toBe(5)
  })
})
