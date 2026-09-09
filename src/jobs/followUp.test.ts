import { beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../gleaptracker.config"
import { FOLLOWUP_FORM } from "../integrations/gleap/formData"
import { customerTicket, trackerTicket } from "../test/fixtures"
import { composeCloseMessage, composeFollowUpMessage } from "./followUpDecision"

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

import {
  CANDIDATE_STATUSES,
  CUSTOMER_TYPES,
  isFollowUpCronEnabled,
  runFollowUpJob,
  startFollowUpCron,
} from "./followUp"

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

const emptySummaryExtras = {
  skippedWaitingOnUs: 0,
  skippedTooSoon: 0,
  skippedAlreadyActed: 0,
  skippedStale: 0,
  skippedOverlap: 0,
}

describe("runFollowUpJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendMessage.mockResolvedValue(true)
    mocks.update.mockResolvedValue(true)
    mocks.listTickets.mockResolvedValue({ tickets: [], count: 0, totalCount: 0 })
    mocks.listMessages.mockResolvedValue([])
    mocks.findLinkedTracker.mockResolvedValue(null)
    mocks.getTicket.mockImplementation(async (id: string) => customerTicket({ id, status: "OPEN" }))
  })

  it("lists each status×type pair (does not rely on CSV filters) and dedupes", async () => {
    await runFollowUpJob(now, 0)
    const calls = mocks.listTickets.mock.calls.map(([params]) => params)
    expect(calls).toHaveLength(CANDIDATE_STATUSES.length * CUSTOMER_TYPES.length)
    for (const status of CANDIDATE_STATUSES) {
      for (const type of CUSTOMER_TYPES) {
        expect(calls).toContainEqual(
          expect.objectContaining({ status, type, limit: 100, sort: "updatedAt" }),
        )
      }
    }
    expect(calls.some((p: { status?: string }) => String(p.status).includes(","))).toBe(false)
    expect(calls.some((p: { type?: string }) => String(p.type).includes(","))).toBe(false)
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
    const byId: Record<string, ReturnType<typeof customerTicket>> = {
      "cust-follow": follow,
      "cust-close": close,
      "cust-linked": linked,
      "cust-parked": parked,
    }

    mocks.listTickets.mockResolvedValue({
      tickets: [follow, close, linked, parked],
      count: 4,
      totalCount: 4,
    })
    mocks.getTicket.mockImplementation(async (id: string) => byId[id] ?? customerTicket({ id }))
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

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "cust-follow",
      composeFollowUpMessage(config.followUp.followUpMessage),
    )
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "cust-close",
      composeCloseMessage(config.followUp.closeMessage),
    )
    expect(mocks.update).toHaveBeenCalledWith(
      "cust-follow",
      expect.objectContaining({
        formData: expect.objectContaining({
          [FOLLOWUP_FORM.followUpSentAt]: now.toISOString(),
        }),
      }),
    )
    expect(mocks.update).toHaveBeenCalledWith(
      "cust-close",
      expect.objectContaining({
        formData: expect.objectContaining({
          [FOLLOWUP_FORM.closeSentAt]: now.toISOString(),
        }),
      }),
    )
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
      ...emptySummaryExtras,
    })
    expect(mocks.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: config.gleap.waitingStatus }),
    )
  })

  it("is safe to re-run the same day — formData / mark counts as already sent", async () => {
    const ticket = customerTicket({
      id: "cust-1",
      status: "OPEN",
      formData: { [FOLLOWUP_FORM.followUpSentAt]: isoHoursAgo(1) },
    })
    mocks.listTickets.mockResolvedValue({ tickets: [ticket], count: 1, totalCount: 1 })
    mocks.getTicket.mockResolvedValue(ticket)
    mocks.listMessages.mockResolvedValue([
      ...agentThenSilence(80),
      {
        id: "m-bot",
        type: "BOT",
        senderType: "bot",
        bot: true,
        createdAt: isoHoursAgo(1),
        text: composeFollowUpMessage("Just checking in\n\ndo you have   any updates?"),
      },
    ])

    const summary = await runFollowUpJob(now, 0)

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(summary.followedUp).toBe(0)
    expect(summary.closed).toBe(0)
    expect(summary.skippedAlreadyActed).toBe(1)
    expect(summary.errors).toBe(0)
  })

  it("does not close-message again when the close mark/flag is set, but still marks DONE", async () => {
    const ticket = customerTicket({
      id: "cust-1",
      status: "OPEN",
      formData: { [FOLLOWUP_FORM.closeSentAt]: isoHoursAgo(1) },
    })
    mocks.listTickets.mockResolvedValue({ tickets: [ticket], count: 1, totalCount: 1 })
    mocks.getTicket.mockResolvedValue(ticket)
    mocks.listMessages.mockResolvedValue([
      ...agentThenSilence(130),
      {
        id: "m-close",
        type: "BOT",
        senderType: "bot",
        bot: true,
        createdAt: isoHoursAgo(1),
        text: composeCloseMessage(config.followUp.closeMessage),
      },
    ])

    const summary = await runFollowUpJob(now, 0)

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith("cust-1", { status: "DONE" })
    expect(summary.closed).toBe(1)
  })

  it("skips send when a tracker is linked between decide and apply (TOCTOU)", async () => {
    const ticket = customerTicket({ id: "cust-1", status: "OPEN" })
    mocks.listTickets.mockResolvedValue({ tickets: [ticket], count: 1, totalCount: 1 })
    mocks.getTicket.mockResolvedValue(ticket)
    mocks.listMessages.mockResolvedValue(agentThenSilence(80))
    mocks.findLinkedTracker
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(trackerTicket({ status: "OPEN" }))

    const summary = await runFollowUpJob(now, 0)

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(summary.followedUp).toBe(0)
    expect(summary.skippedLinkedTracker).toBe(1)
  })

  it("skips send when the customer replies between decide and apply", async () => {
    const ticket = customerTicket({ id: "cust-1", status: "OPEN" })
    mocks.listTickets.mockResolvedValue({ tickets: [ticket], count: 1, totalCount: 1 })
    mocks.getTicket.mockResolvedValue(ticket)
    mocks.findLinkedTracker.mockResolvedValue(null)
    mocks.listMessages
      .mockResolvedValueOnce(agentThenSilence(80))
      .mockResolvedValueOnce([
        ...agentThenSilence(80),
        {
          id: "m-cust",
          type: "TEXT",
          senderType: "user" as const,
          createdAt: isoHoursAgo(0),
          text: "still here",
        },
      ])

    const summary = await runFollowUpJob(now, 0)

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(summary.followedUp).toBe(0)
    expect(summary.skippedWaitingOnUs).toBe(1)
  })

  it("no-ops a second overlapping run (in-process mutex)", async () => {
    let release!: (value: { tickets: []; count: number; totalCount: number }) => void
    let firstList = true
    mocks.listTickets.mockImplementation(() => {
      if (firstList) {
        firstList = false
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return Promise.resolve({ tickets: [], count: 0, totalCount: 0 })
    })

    const first = runFollowUpJob(now, 0)
    await vi.waitFor(() => expect(mocks.listTickets).toHaveBeenCalled())
    const overlapping = await runFollowUpJob(now, 0)
    expect(overlapping.skippedOverlap).toBe(1)
    expect(overlapping.scanned).toBe(0)

    release({ tickets: [], count: 0, totalCount: 0 })
    const finished = await first
    expect(finished.skippedOverlap).toBe(0)
  })

  it("counts a per-ticket failure without aborting the rest of the run", async () => {
    const ok = customerTicket({ id: "cust-ok", status: "OPEN" })
    const bad = customerTicket({ id: "cust-bad", status: "OPEN" })
    mocks.listTickets.mockResolvedValue({ tickets: [bad, ok], count: 2, totalCount: 2 })
    mocks.getTicket.mockImplementation(async (id: string) =>
      id === "cust-ok" ? ok : bad,
    )
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
