import { beforeEach, describe, expect, it, vi } from "vitest"
import type { KnownBlock } from "@slack/web-api"
import config from "../../../gleaptracker.config"
import {
  customerTicket,
  extraCustomerTicket,
  TEST_SLACK_CHANNEL_ID,
  TEST_THREAD_TS,
  TEST_THREAD_URL,
  trackerTicket,
} from "../../test/fixtures"

const mocks = vi.hoisted(() => ({
  postMessage: vi.fn(),
  update: vi.fn(),
  getPermalink: vi.fn(),
  ticketUpdate: vi.fn().mockResolvedValue(true),
  addNote: vi.fn().mockResolvedValue(undefined),
  loadTicket: vi.fn(),
  loadCustomerTickets: vi.fn(),
}))

vi.mock("../../integrations/slack/client", () => ({
  getSlackClient: () => ({
    chat: {
      postMessage: mocks.postMessage,
      update: mocks.update,
      getPermalink: mocks.getPermalink,
    },
  }),
}))

vi.mock("../../integrations/gleap/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../integrations/gleap/client")>()
  return {
    ...actual,
    getGleapClient: () => ({
      tickets: { update: mocks.ticketUpdate },
      messages: { addNote: mocks.addNote },
    }),
  }
})

vi.mock("../../integrations/gleap/linked", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../integrations/gleap/linked")>()
  return {
    ...actual,
    loadTicket: mocks.loadTicket,
    loadCustomerTickets: mocks.loadCustomerTickets,
  }
})

import {
  markTrackerSlackClosed,
  resetSlackSyncDedupForTests,
  syncTrackerSlack,
} from "./slack"

const actionIds = (blocks: KnownBlock[]): string[] => {
  const actions = blocks.find((b) => b.type === "actions") as
    | { elements: Array<{ action_id: string }> }
    | undefined
  return actions?.elements.map((el) => el.action_id) ?? []
}

const headerText = (blocks: KnownBlock[]): string => {
  const section = blocks.find((b) => b.type === "section") as
    | { text?: { text?: string } }
    | undefined
  return section?.text?.text ?? ""
}

describe("syncTrackerSlack — first link", () => {
  const primary = customerTicket()
  const tracker = trackerTicket({
    plainContent: "Fix the orange typo in the checkout.",
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadTicket.mockResolvedValue(tracker)
    mocks.loadCustomerTickets.mockResolvedValue([primary])
    mocks.postMessage
      .mockResolvedValueOnce({ ok: true, ts: TEST_THREAD_TS })
      .mockResolvedValueOnce({ ok: true, ts: "1234.9999" })
    mocks.getPermalink.mockResolvedValue({ ok: true, permalink: TEST_THREAD_URL })
    mocks.ticketUpdate.mockResolvedValue(true)
  })

  it("creates the Slack thread and posts the tracker description as the first in-thread message", async () => {
    await syncTrackerSlack(tracker, { triggerTicketId: primary.id })

    expect(mocks.postMessage).toHaveBeenCalledTimes(2)

    const root = mocks.postMessage.mock.calls[0][0]
    expect(root).toMatchObject({
      channel: TEST_SLACK_CHANNEL_ID,
      text: `#${tracker.bugId} ${tracker.title}`,
      metadata: {
        event_type: "gleap_ticket",
        event_payload: { gleap_ticket_id: tracker.id },
      },
    })
    expect(root.thread_ts).toBeUndefined()
    expect(headerText(root.blocks)).toContain("`#237650`")
    expect(headerText(root.blocks)).toContain("Tracker: Orange typo")
    expect(headerText(root.blocks)).toContain("jay@example.com")
    expect(headerText(root.blocks)).toMatch(/Ticket:.*#237536/)
    expect(headerText(root.blocks)).not.toMatch(/Tickets:/)
    expect(headerText(root.blocks)).not.toMatch(/Fixes Gleap-/)
    expect(headerText(root.blocks)).not.toMatch(/Refs Gleap-/)
    expect(headerText(root.blocks)).not.toMatch(/Linked:/)
    expect(actionIds(root.blocks)).toEqual(["close_tracker", "open_gleap"])
    const actions = root.blocks.find((b: KnownBlock) => b.type === "actions") as {
      elements: Array<{ action_id: string; url?: string }>
    }
    expect(actions.elements.find((el) => el.action_id === "open_gleap")?.url).toBe(
      "https://app.gleap.io/projects/test-project/bugs/cust-1",
    )

    expect(mocks.postMessage.mock.calls[1][0]).toEqual({
      channel: TEST_SLACK_CHANNEL_ID,
      thread_ts: TEST_THREAD_TS,
      text: "Fix the orange typo in the checkout.",
    })

    expect(mocks.ticketUpdate).toHaveBeenCalledWith(
      tracker.id,
      expect.objectContaining({
        formData: expect.objectContaining({
          slack_thread: TEST_THREAD_URL,
          slack_thread_ts: TEST_THREAD_TS,
          primary_ticket_id: primary.id,
          slack_notified_ids: primary.id,
        }),
      }),
    )
    expect(mocks.addNote).toHaveBeenCalledWith(
      tracker.id,
      `Slack thread: ${TEST_THREAD_URL}`,
    )
    expect(mocks.ticketUpdate).toHaveBeenCalledWith(primary.id, {
      status: "INPROGRESS",
    })
    expect(mocks.ticketUpdate).not.toHaveBeenCalledWith(
      primary.id,
      expect.objectContaining({ status: config.gleap.waitingStatus }),
    )
  })
})

describe("syncTrackerSlack — subsequent link", () => {
  const primary = customerTicket()
  const extra = extraCustomerTicket()
  const tracker = trackerTicket({
    linkedTickets: ["cust-1", "cust-2"],
    formData: {
      slack_thread: TEST_THREAD_URL,
      slack_thread_ts: TEST_THREAD_TS,
      primary_ticket_id: "cust-1",
      slack_notified_ids: "cust-1",
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadTicket.mockResolvedValue(tracker)
    mocks.loadCustomerTickets.mockResolvedValue([primary, extra])
    mocks.update.mockResolvedValue({ ok: true })
    mocks.postMessage.mockResolvedValue({ ok: true, ts: "999.001" })
    mocks.ticketUpdate.mockResolvedValue(true)
  })

  it("refreshes Tickets: on the root and posts a New related ticket reply", async () => {
    await syncTrackerSlack(tracker, { triggerTicketId: extra.id })

    expect(mocks.update).toHaveBeenCalledTimes(1)
    const updated = mocks.update.mock.calls[0][0]
    expect(updated).toMatchObject({
      channel: TEST_SLACK_CHANNEL_ID,
      ts: TEST_THREAD_TS,
      text: `#${tracker.bugId} ${tracker.title}`,
    })
    const header = headerText(updated.blocks)
    expect(header).toContain("`#237650`")
    expect(header).toMatch(
      /Tickets: <https:\/\/app\.gleap\.io\/projects\/.+\/bugs\/cust-1\|#237536> <https:\/\/app\.gleap\.io\/projects\/.+\/bugs\/cust-2\|#237537>/,
    )
    expect(header).not.toContain("jay@example.com")
    expect(header).not.toContain("sam@example.com")
    expect(header).not.toMatch(/Fixes Gleap-/)
    expect(header).not.toMatch(/Refs Gleap-/)
    expect(header).not.toMatch(/Linked:/)
    const actions = updated.blocks.find((b: KnownBlock) => b.type === "actions") as {
      elements: Array<{ action_id: string; url?: string }>
    }
    expect(actions.elements.find((el) => el.action_id === "open_gleap")?.url).toBe(
      "https://app.gleap.io/projects/test-project/for-release/tracker-1",
    )

    expect(mocks.postMessage).toHaveBeenCalledTimes(1)
    const reply = mocks.postMessage.mock.calls[0][0]
    expect(reply.channel).toBe(TEST_SLACK_CHANNEL_ID)
    expect(reply.thread_ts).toBe(TEST_THREAD_TS)
    expect(reply.text).toBe(
      [
        "*New related ticket*",
        "#237537 Same typo elsewhere",
        "sam@example.com",
        "<https://app.gleap.io/projects/test-project/bugs/cust-2|Open in Gleap>",
      ].join("\n"),
    )

    expect(mocks.ticketUpdate).toHaveBeenCalledWith(
      tracker.id,
      expect.objectContaining({
        formData: expect.objectContaining({
          slack_notified_ids: "cust-1,cust-2",
        }),
      }),
    )
    expect(mocks.ticketUpdate).toHaveBeenCalledWith(extra.id, { status: "INPROGRESS" })
    expect(mocks.ticketUpdate).not.toHaveBeenCalledWith(
      extra.id,
      expect.objectContaining({ status: config.gleap.waitingStatus }),
    )
  })

  it("leaves a newcomer already INPROGRESS (or any non-OPEN status) unchanged", async () => {
    const inProgressExtra = extraCustomerTicket({ status: "INPROGRESS" })
    mocks.loadCustomerTickets.mockResolvedValue([primary, inProgressExtra])

    await syncTrackerSlack(tracker, { triggerTicketId: inProgressExtra.id })

    expect(mocks.ticketUpdate).not.toHaveBeenCalledWith(
      inProgressExtra.id,
      expect.objectContaining({ status: expect.anything() }),
    )
  })
})

describe("syncTrackerSlack — reopen", () => {
  const primary = customerTicket()
  const reopened = trackerTicket({
    id: "tracker-reopen-1",
    status: "INPROGRESS",
    formData: {
      slack_thread: TEST_THREAD_URL,
      slack_thread_ts: TEST_THREAD_TS,
      primary_ticket_id: "cust-1",
      slack_notified_ids: "cust-1",
      close_processed: "true",
      close_silent: "false",
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetSlackSyncDedupForTests()
    mocks.loadTicket.mockResolvedValue(reopened)
    mocks.loadCustomerTickets.mockResolvedValue([primary])
    mocks.update.mockResolvedValue({ ok: true })
    mocks.postMessage.mockResolvedValue({ ok: true, ts: "reopen.1" })
    mocks.ticketUpdate.mockResolvedValue(true)
  })

  it("posts 🔄 Reopened once when two ticket.updated syncs race", async () => {
    await Promise.all([syncTrackerSlack(reopened), syncTrackerSlack(reopened)])

    const reopenPosts = mocks.postMessage.mock.calls.filter(
      ([arg]) => arg.text === "🔄 Reopened",
    )
    expect(reopenPosts).toHaveLength(1)
    expect(reopenPosts[0][0]).toEqual({
      channel: TEST_SLACK_CHANNEL_ID,
      thread_ts: TEST_THREAD_TS,
      text: "🔄 Reopened",
    })
    expect(mocks.ticketUpdate).toHaveBeenCalledWith(
      reopened.id,
      expect.objectContaining({
        formData: expect.objectContaining({
          close_processed: "false",
          close_silent: "false",
        }),
      }),
    )
  })

  it("does not post a second Reopened on a follow-up sync inside the dedup window", async () => {
    await syncTrackerSlack(reopened)
    await syncTrackerSlack(reopened)

    expect(
      mocks.postMessage.mock.calls.filter(([{ text }]) => text === "🔄 Reopened"),
    ).toHaveLength(1)
  })

  it("allows another Reopened after the tracker is marked closed on Slack", async () => {
    await syncTrackerSlack(reopened)
    await markTrackerSlackClosed(reopened)
    await syncTrackerSlack(reopened)

    expect(
      mocks.postMessage.mock.calls.filter(([{ text }]) => text === "🔄 Reopened"),
    ).toHaveLength(2)
  })

  it("posts Reopened again after the dedup window if Gleap still reports close_processed", async () => {
    vi.useFakeTimers()
    try {
      await syncTrackerSlack(reopened)
      await vi.advanceTimersByTimeAsync(3_001)
      await syncTrackerSlack(reopened)
      expect(
        mocks.postMessage.mock.calls.filter(([{ text }]) => text === "🔄 Reopened"),
      ).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("markTrackerSlackClosed", () => {
  it("closes the header (no Close button) and posts ✅ Closed", async () => {
    vi.clearAllMocks()
    const primary = customerTicket()
    const tracker = trackerTicket({
      status: "DONE",
      formData: {
        slack_thread_ts: TEST_THREAD_TS,
        primary_ticket_id: primary.id,
      },
    })
    mocks.loadCustomerTickets.mockResolvedValue([primary])
    mocks.update.mockResolvedValue({ ok: true })
    mocks.postMessage.mockResolvedValue({ ok: true, ts: "1.2" })

    await markTrackerSlackClosed(tracker)

    const updated = mocks.update.mock.calls[0][0]
    expect(actionIds(updated.blocks)).toEqual(["open_gleap"])
    expect(headerText(updated.blocks)).toContain("✅ Closed")
    expect(JSON.stringify(updated.blocks)).not.toContain("tracker_status")
    expect(mocks.postMessage).toHaveBeenCalledWith({
      channel: TEST_SLACK_CHANNEL_ID,
      thread_ts: TEST_THREAD_TS,
      text: "✅ Closed",
    })
  })
})
