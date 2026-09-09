import { beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../gleaptracker.config"
import { TEST_SLACK_CHANNEL_ID, trackerTicket } from "../test/fixtures"
import { mockReq, mockRes, signSlack } from "../test/http"

const mocks = vi.hoisted(() => ({
  closeTracker: vi.fn().mockResolvedValue(undefined),
  loadTicket: vi.fn(),
  viewsOpen: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock("../integrations/gleap/close", () => ({
  closeTracker: mocks.closeTracker,
}))

vi.mock("../integrations/gleap/linked", () => ({
  loadTicket: mocks.loadTicket,
}))

vi.mock("../integrations/slack/client", () => ({
  getSlackClient: () => ({
    views: { open: mocks.viewsOpen },
    conversations: { replies: vi.fn() },
  }),
}))

import { slackPost } from "./slack"

const signedForm = async (payload: Record<string, unknown>) => {
  const rawBody = `payload=${encodeURIComponent(JSON.stringify(payload))}`
  const { timestamp, signature } = signSlack(rawBody)
  const res = mockRes()
  await slackPost(
    mockReq({
      body: rawBody,
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
    }),
    res,
  )
  return res
}

describe("Slack close modal (path C)", () => {
  const tracker = trackerTicket()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadTicket.mockResolvedValue(tracker)
    mocks.viewsOpen.mockResolvedValue({ ok: true })
    mocks.closeTracker.mockResolvedValue(undefined)
  })

  it("opens the close modal prefilled with gleap.bugFixedMessage", async () => {
    const res = await signedForm({
      type: "block_actions",
      trigger_id: "T.trigger.1",
      channel: { id: TEST_SLACK_CHANNEL_ID },
      message: { ts: "1234.5678" },
      user: { id: "U1" },
      actions: [{ action_id: "close_tracker", value: tracker.id }],
    })

    expect(res.statusCode).toBe(200)
    expect(mocks.viewsOpen).toHaveBeenCalledTimes(1)
    const arg = mocks.viewsOpen.mock.calls[0][0]
    expect(arg.trigger_id).toBe("T.trigger.1")
    expect(arg.view.callback_id).toBe("close_modal")
    expect(JSON.parse(arg.view.private_metadata)).toMatchObject({
      gleapTicketId: tracker.id,
      channelId: TEST_SLACK_CHANNEL_ID,
      threadTs: "1234.5678",
      userId: "U1",
    })
    expect(arg.view.blocks[0].element.initial_value).toBe(
      config.gleap.bugFixedMessage,
    )
    expect(arg.view.blocks[0].optional).toBe(true)
    expect(mocks.closeTracker).not.toHaveBeenCalled()
  })

  it("empty submit closes silently (no customer message)", async () => {
    const res = await signedForm({
      type: "view_submission",
      view: {
        callback_id: "close_modal",
        private_metadata: JSON.stringify({
          gleapTicketId: tracker.id,
          channelId: TEST_SLACK_CHANNEL_ID,
          threadTs: "1234.5678",
          userId: "U1",
        }),
        state: {
          values: {
            message_block: {
              message_input: { value: "   " },
            },
          },
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mocks.loadTicket).toHaveBeenCalledWith(tracker.id)
    expect(mocks.closeTracker).toHaveBeenCalledWith(tracker, {
      silent: true,
      message: undefined,
      source: "slack",
    })
  })

  it("non-empty submit notifies customers with the submitted text", async () => {
    const res = await signedForm({
      type: "view_submission",
      view: {
        callback_id: "close_modal",
        private_metadata: JSON.stringify({
          gleapTicketId: tracker.id,
          channelId: TEST_SLACK_CHANNEL_ID,
          threadTs: "1234.5678",
          userId: "U1",
        }),
        state: {
          values: {
            message_block: {
              message_input: { value: "  We shipped the orange-typo fix.  " },
            },
          },
        },
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mocks.closeTracker).toHaveBeenCalledWith(tracker, {
      silent: false,
      message: "We shipped the orange-typo fix.",
      source: "slack",
    })
  })
})
