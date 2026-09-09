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

import { markTrackerSlackClosed, syncTrackerSlack } from "./slack"

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
      text: `#${primary.bugId} ${primary.title}`,
      metadata: {
        event_type: "gleap_ticket",
        event_payload: { gleap_ticket_id: tracker.id },
      },
    })
    expect(root.thread_ts).toBeUndefined()
    expect(headerText(root.blocks)).toContain("`#237536`")
    expect(headerText(root.blocks)).toContain("`Fixes Gleap-237650`")
    expect(headerText(root.blocks)).toContain("`Refs Gleap-237536`")
    expect(headerText(root.blocks)).not.toMatch(/Linked:/)
    expect(actionIds(root.blocks)).toContain("close_tracker")

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

  it("refreshes Refs/Linked on the root and posts a New related ticket reply", async () => {
    await syncTrackerSlack(tracker, { triggerTicketId: extra.id })

    expect(mocks.update).toHaveBeenCalledTimes(1)
    const updated = mocks.update.mock.calls[0][0]
    expect(updated).toMatchObject({
      channel: TEST_SLACK_CHANNEL_ID,
      ts: TEST_THREAD_TS,
      text: `#${primary.bugId} ${primary.title}`,
    })
    const header = headerText(updated.blocks)
    expect(header).toContain("`Fixes Gleap-237650`")
    expect(header).toContain("`Refs Gleap-237536, Gleap-237537`")
    expect(header).toMatch(/Linked:.*#237537/)

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
    expect(actionIds(updated.blocks)).not.toContain("close_tracker")
    expect(updated.blocks[1].elements[0]).toMatchObject({
      action_id: "tracker_status",
      text: { text: "✅ Closed" },
    })
    expect(mocks.postMessage).toHaveBeenCalledWith({
      channel: TEST_SLACK_CHANNEL_ID,
      thread_ts: TEST_THREAD_TS,
      text: "✅ Closed",
    })
  })
})
