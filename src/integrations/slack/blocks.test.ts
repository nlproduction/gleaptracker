import { describe, expect, it } from "vitest"
import type { KnownBlock } from "@slack/web-api"
import {
  customerTicket,
  extraCustomerTicket,
  trackerTicket,
} from "../../test/fixtures"
import {
  buildActionsBlock,
  buildCloseModalView,
  buildHeaderText,
  buildNewRelatedTicketText,
  buildTrackerRootBlocks,
  formatFixesLine,
  formatRefsLine,
} from "./blocks"

const actionIds = (block: { elements: Array<Record<string, unknown>> }): string[] =>
  block.elements.map((el) => String(el.action_id))

const headerFromRoot = (blocks: KnownBlock[]): string => {
  const section = blocks[0] as {
    text?: { text?: string }
  }
  return section.text?.text ?? ""
}

describe("header / Fixes / Refs builders", () => {
  const primary = customerTicket()
  const extra = extraCustomerTicket()

  it("puts customer bugId, title, and email in the human header — not the tracker", () => {
    const tracker = trackerTicket()
    const header = buildHeaderText({
      primary,
      extras: [],
      trackerBugId: tracker.bugId,
    })
    const titleLine = header.split("\n")[0]

    expect(titleLine).toContain("`#237536`")
    expect(titleLine).toContain("Orange typo")
    expect(titleLine).not.toContain("237650")
    expect(header).toContain("jay@example.com")
    expect(header).toContain("Jay")
    expect(header).not.toContain(tracker.title)
    expect(header).not.toContain("tracker@example.com")
  })

  it("always includes Fixes Gleap-<trackerBugId> and Refs Gleap-<customer…>", () => {
    expect(formatFixesLine(237650)).toBe("Fixes Gleap-237650")
    expect(formatRefsLine([237536, 237537])).toBe(
      "Refs Gleap-237536, Gleap-237537",
    )

    const withExtras = buildHeaderText({
      primary,
      extras: [extra],
      trackerBugId: 237650,
    })
    expect(withExtras).toContain("`Fixes Gleap-237650`")
    expect(withExtras).toContain("`Refs Gleap-237536, Gleap-237537`")

    const solo = buildHeaderText({ primary, extras: [], trackerBugId: 237650 })
    expect(solo).toContain("`Fixes Gleap-237650`")
    expect(solo).toContain("`Refs Gleap-237536`")
    expect(solo).not.toContain("Gleap-237537")
  })

  it("shows Linked: only when there are extra customers beyond the primary", () => {
    const withExtras = buildHeaderText({
      primary,
      extras: [extra],
      trackerBugId: 237650,
    })
    expect(withExtras).toMatch(
      /Linked: <https:\/\/app\.gleap\.io\/projects\/.+\/bugs\/cust-2\|#237537>/,
    )

    const solo = buildHeaderText({ primary, extras: [], trackerBugId: 237650 })
    expect(solo).not.toMatch(/Linked:/)
  })
})

describe("action row / root blocks", () => {
  it("includes Close when open and hides it when closed, with tracker status in the row", () => {
    const open = buildActionsBlock({
      trackerId: "tracker-1",
      gleapUrl: "https://example.com",
      status: "OPEN",
      closed: false,
    })
    expect(actionIds(open)).toEqual([
      "tracker_status",
      "close_tracker",
      "open_gleap",
    ])
    expect(open.elements[0]).toMatchObject({
      action_id: "tracker_status",
      text: { text: "Open" },
      value: "tracker-1",
    })
    expect(open.elements[1]).toMatchObject({
      action_id: "close_tracker",
      style: "danger",
      text: { text: "Close" },
    })

    const closed = buildActionsBlock({
      trackerId: "tracker-1",
      gleapUrl: "https://example.com",
      status: "DONE",
      closed: true,
    })
    expect(actionIds(closed)).toEqual(["tracker_status", "open_gleap"])
    expect(closed.elements[0]).toMatchObject({
      action_id: "tracker_status",
      text: { text: "✅ Closed" },
    })
  })

  it("builds root blocks from the customer header and the closed-state action row", () => {
    const tracker = trackerTicket({ status: "DONE" })
    const primary = customerTicket()
    const extras = [extraCustomerTicket()]
    const blocks = buildTrackerRootBlocks({
      tracker,
      primary,
      extras,
      closed: true,
    })

    const header = headerFromRoot(blocks)
    expect(header).toContain("`#237536`")
    expect(header).toContain("`Fixes Gleap-237650`")
    expect(header).toContain("`Refs Gleap-237536, Gleap-237537`")
    expect(header).toMatch(/Linked:/)

    const actions = blocks[1] as { elements: Array<Record<string, unknown>> }
    expect(actionIds(actions)).not.toContain("close_tracker")
    expect(actions.elements[0]).toMatchObject({
      action_id: "tracker_status",
      text: { text: "✅ Closed" },
    })
  })
})

describe("new related ticket + close modal", () => {
  it("posts the New related ticket payload shape", () => {
    const ticket = extraCustomerTicket()
    const text = buildNewRelatedTicketText(ticket)
    expect(text).toBe(
      [
        "*New related ticket*",
        "#237537 Same typo elsewhere",
        "sam@example.com",
        "<https://app.gleap.io/projects/test-project/bugs/cust-2|Open in Gleap>",
      ].join("\n"),
    )
  })

  it("prefills the close modal and keeps the message optional", () => {
    const view = buildCloseModalView({
      privateMetadata: '{"gleapTicketId":"tracker-1"}',
      initialMessage: "Thanks, we shipped a fix.",
    })
    expect(view.callback_id).toBe("close_modal")
    expect(view.private_metadata).toBe('{"gleapTicketId":"tracker-1"}')
    const input = view.blocks[0]
    expect(input.optional).toBe(true)
    expect(input.element.initial_value).toBe("Thanks, we shipped a fix.")
    expect(input.element.action_id).toBe("message_input")
  })
})
