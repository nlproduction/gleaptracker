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
  trackerStatusBadge,
} from "./blocks"

const actionIds = (block: { elements: Array<Record<string, unknown>> }): string[] =>
  block.elements.map((el) => String(el.action_id))

const headerFromRoot = (blocks: KnownBlock[]): string => {
  const section = blocks[0] as {
    text?: { text?: string }
  }
  return section.text?.text ?? ""
}

describe("header builders", () => {
  const primary = customerTicket()
  const extra = extraCustomerTicket()
  const tracker = trackerTicket({ status: "INPROGRESS" })

  it("puts tracker bugId and title in the header, plus primary customer email", () => {
    const header = buildHeaderText({
      tracker,
      primary,
      extras: [],
    })
    const titleLine = header.split("\n")[0]

    expect(titleLine).toContain("`#237650`")
    expect(titleLine).toContain("Tracker: Orange typo")
    expect(titleLine).not.toContain("237536")
    expect(header).toContain("jay@example.com")
    expect(header).not.toContain("Jay")
    expect(header).not.toContain("tracker@example.com")
  })

  it("lists a single customer as Ticket: and keeps email off the tickets line", () => {
    const solo = buildHeaderText({ tracker, primary, extras: [] })
    expect(solo).toMatch(
      /Ticket: <https:\/\/app\.gleap\.io\/projects\/.+\/bugs\/cust-1\|#237536>/,
    )
    expect(solo).not.toMatch(/Tickets:/)
    expect(solo).toContain("jay@example.com")
    expect(solo).not.toContain("#237537")
    expect(solo).not.toMatch(/Fixes Gleap-/)
    expect(solo).not.toMatch(/Refs Gleap-/)
    expect(solo).not.toMatch(/Linked:/)
  })

  it("lists multiple customers as space-separated Tickets: with no emails", () => {
    const withExtras = buildHeaderText({
      tracker,
      primary,
      extras: [extra],
    })
    expect(withExtras).toMatch(
      /Tickets: <https:\/\/app\.gleap\.io\/projects\/.+\/bugs\/cust-1\|#237536> <https:\/\/app\.gleap\.io\/projects\/.+\/bugs\/cust-2\|#237537>/,
    )
    expect(withExtras).not.toMatch(/(^|\n)Ticket: /)
    expect(withExtras).not.toContain("jay@example.com")
    expect(withExtras).not.toContain("sam@example.com")
    expect(withExtras).not.toMatch(/Fixes Gleap-/)
    expect(withExtras).not.toMatch(/Refs Gleap-/)
    expect(withExtras).not.toMatch(/Linked:/)
  })

  it("renders tracker status as emoji + text, not as a button", () => {
    expect(trackerStatusBadge("OPEN")).toBe("🔵 Open")
    expect(trackerStatusBadge("INPROGRESS")).toBe("🟡 In progress")
    expect(trackerStatusBadge("DONE")).toBe("✅ Closed")
    expect(trackerStatusBadge("9oyq7h", "Waiting for Update")).toBe(
      "🟡 Waiting for Update",
    )

    const open = buildHeaderText({
      tracker: trackerTicket({ status: "OPEN" }),
      primary,
      extras: [],
    })
    expect(open).toContain("🔵 Open")

    const inProgress = buildHeaderText({ tracker, primary, extras: [] })
    expect(inProgress).toContain("🟡 In progress")

    const closed = buildHeaderText({
      tracker: trackerTicket({ status: "INPROGRESS" }),
      primary,
      extras: [],
      closed: true,
    })
    expect(closed).toContain("✅ Closed")
    expect(closed).not.toContain("🟡")
  })
})

describe("commit convention helpers (git only)", () => {
  it("formats Fixes / Refs lines for commit messages", () => {
    expect(formatFixesLine(237650)).toBe("Fixes Gleap-237650")
    expect(formatRefsLine([237536, 237537])).toBe(
      "Refs Gleap-237536, Gleap-237537",
    )
  })
})

describe("action row / root blocks", () => {
  it("includes Close when open and hides it when closed — no status button", () => {
    const open = buildActionsBlock({
      trackerId: "tracker-1",
      gleapUrl: "https://example.com",
      closed: false,
    })
    expect(actionIds(open)).toEqual(["close_tracker", "open_gleap"])
    expect(open.block_id).toBe("tracker_actions")
    expect(open.elements[0]).toMatchObject({
      action_id: "close_tracker",
      style: "danger",
      text: { text: "Close" },
    })
    expect(open.elements[1]).toMatchObject({
      action_id: "open_gleap",
      url: "https://example.com",
    })
    expect(JSON.stringify(open)).not.toContain("tracker_status")

    const closed = buildActionsBlock({
      trackerId: "tracker-1",
      gleapUrl: "https://example.com",
      closed: true,
    })
    expect(actionIds(closed)).toEqual(["open_gleap"])
    expect(closed.elements[0]).toMatchObject({
      action_id: "open_gleap",
    })
  })

  it("points Open in Gleap at the customer ticket when there is exactly one", () => {
    const tracker = trackerTicket({ status: "INPROGRESS" })
    const primary = customerTicket()
    const blocks = buildTrackerRootBlocks({
      tracker,
      primary,
      extras: [],
    })

    const header = headerFromRoot(blocks)
    expect(header).toMatch(
      /Ticket: <https:\/\/app\.gleap\.io\/projects\/.+\/bugs\/cust-1\|#237536>/,
    )
    expect(header).toContain("jay@example.com")
    expect(header).not.toMatch(/Tickets:/)

    const actions = blocks[1] as { elements: Array<Record<string, unknown>> }
    expect(actionIds(actions)).toEqual(["close_tracker", "open_gleap"])
    expect(actions.elements[1]).toMatchObject({
      action_id: "open_gleap",
      url: "https://app.gleap.io/projects/test-project/bugs/cust-1",
    })
  })

  it("points Open in Gleap at the tracker when there are multiple customers", () => {
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
    expect(header).toContain("`#237650`")
    expect(header).toContain("Tracker: Orange typo")
    expect(header).not.toContain("jay@example.com")
    expect(header).not.toContain("sam@example.com")
    expect(header).toMatch(/Tickets:.*#237536.*#237537/)
    expect(header).toContain("✅ Closed")
    expect(header).not.toMatch(/Fixes Gleap-/)
    expect(header).not.toMatch(/Refs Gleap-/)

    const actions = blocks[1] as { elements: Array<Record<string, unknown>> }
    expect(actionIds(actions)).toEqual(["open_gleap"])
    expect(actions.elements[0]).toMatchObject({
      action_id: "open_gleap",
      url: "https://app.gleap.io/projects/test-project/for-release/tracker-1",
    })
    expect(JSON.stringify(blocks)).not.toContain("tracker_status")
    expect(JSON.stringify(blocks)).not.toMatch(/"type":"button"[^]]*"Open"/)
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
