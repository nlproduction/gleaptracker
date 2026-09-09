import { describe, expect, it } from "vitest"
import config from "../../gleaptracker.config"
import { FOLLOWUP_FORM } from "../integrations/gleap/formData"
import type { GleapMessage } from "../integrations/gleap/client"
import { customerTicket, trackerTicket } from "../test/fixtures"
import { parseEnvNumber } from "../types/config"
import {
  analyzeConversation,
  classifyMessage,
  daysBetween,
  decideFollowUpAction,
  decideForTicket,
  resolveFollowUpWorkflowId,
  shouldSkipLinkedActiveTracker,
  ticketAllowsSoftFollowUp,
} from "./followUpDecision"

const hoursAgo = (hours: number, now = new Date("2026-09-09T08:00:00.000Z")): Date =>
  new Date(now.getTime() - hours * 60 * 60 * 1000)

const now = new Date("2026-09-09T08:00:00.000Z")

const msg = (
  role: "customer" | "agent" | "bot" | "note",
  createdAt: Date,
  text = "",
  extra: Partial<GleapMessage> = {},
): GleapMessage => {
  if (role === "note") {
    return {
      id: createdAt.toISOString(),
      type: "NOTE",
      createdAt: createdAt.toISOString(),
      text,
      ...extra,
    }
  }
  if (role === "customer") {
    return {
      id: createdAt.toISOString(),
      type: "TEXT",
      senderType: "user",
      createdAt: createdAt.toISOString(),
      text,
      ...extra,
    }
  }
  if (role === "agent") {
    return {
      id: createdAt.toISOString(),
      type: "TEXT",
      senderType: "agent",
      bot: false,
      createdAt: createdAt.toISOString(),
      text,
      ...extra,
    }
  }
  return {
    id: createdAt.toISOString(),
    type: "BOT",
    senderType: "bot",
    bot: true,
    createdAt: createdAt.toISOString(),
    text,
    ...extra,
  }
}

describe("parseEnvNumber", () => {
  it("keeps an explicit 0 and falls back on empty/invalid", () => {
    expect(parseEnvNumber("0", 3)).toBe(0)
    expect(parseEnvNumber("", 3)).toBe(3)
    expect(parseEnvNumber(undefined, 3)).toBe(3)
    expect(parseEnvNumber("nope", 5)).toBe(5)
  })
})

describe("shouldSkipLinkedActiveTracker", () => {
  it("does not skip when there is no linked tracker", () => {
    expect(shouldSkipLinkedActiveTracker(null)).toBe(false)
    expect(shouldSkipLinkedActiveTracker(undefined)).toBe(false)
  })

  it("skips when the linked tracker is OPEN", () => {
    expect(shouldSkipLinkedActiveTracker(trackerTicket({ status: "OPEN" }))).toBe(true)
  })

  it("skips when the linked tracker is INPROGRESS (not only OPEN)", () => {
    expect(shouldSkipLinkedActiveTracker(trackerTicket({ status: "INPROGRESS" }))).toBe(true)
  })

  it("skips when the linked tracker is any non-DONE status", () => {
    expect(shouldSkipLinkedActiveTracker(trackerTicket({ status: "TOTEST" }))).toBe(true)
  })

  it("does not skip when the linked tracker is DONE", () => {
    expect(shouldSkipLinkedActiveTracker(trackerTicket({ status: "DONE" }))).toBe(false)
  })
})

describe("decideForTicket — skip reasons", () => {
  const agentWait = [msg("agent", hoursAgo(80))]

  it("skips tracker tickets themselves", () => {
    expect(decideForTicket(trackerTicket(), null, agentWait, now).reason).toBe("tracker_ticket")
  })

  it("skips classic On Slack / waiting-for-update statuses", () => {
    expect(
      decideForTicket(
        customerTicket({ status: config.gleap.onSlackStatuses.BUG }),
        null,
        agentWait,
        now,
      ).reason,
    ).toBe("parked_status")
    expect(
      decideForTicket(
        customerTicket({ status: config.gleap.waitingStatus }),
        null,
        agentWait,
        now,
      ).reason,
    ).toBe("parked_status")
  })

  it("skips a customer ticket linked to an active (not DONE) tracker", () => {
    const decision = decideForTicket(
      customerTicket({ status: "OPEN" }),
      trackerTicket({ status: "OPEN" }),
      agentWait,
      now,
    )
    expect(decision).toEqual({ action: "none", reason: "linked_active_tracker" })
  })

  it("does not skip when the linked tracker is DONE — thresholds still apply", () => {
    const decision = decideForTicket(
      customerTicket({ status: "OPEN" }),
      trackerTicket({ status: "DONE" }),
      agentWait,
      now,
    )
    expect(decision.action).toBe("follow_up")
  })

  it("does not skip when there is no linked tracker — thresholds still apply", () => {
    const decision = decideForTicket(customerTicket({ status: "INPROGRESS" }), null, agentWait, now)
    expect(decision.action).toBe("follow_up")
  })
})

describe("decideFollowUpAction — thresholds and idempotency", () => {
  const base = {
    now,
    lastAgentAt: hoursAgo(0),
    alreadySentFollowUp: false,
    alreadySentClose: false,
    followUpAfterDays: 3,
    closeAfterDays: 7,
    ticketType: "BUG",
  }

  it("does nothing when no human agent has replied", () => {
    expect(decideFollowUpAction({ ...base, lastAgentAt: undefined })).toEqual({
      action: "none",
      reason: "no_agent_reply",
    })
  })

  it("does nothing when the customer replied after the last agent", () => {
    expect(
      decideFollowUpAction({
        ...base,
        lastAgentAt: hoursAgo(96),
        lastCustomerAt: hoursAgo(1),
      }),
    ).toEqual({ action: "none", reason: "waiting_on_us" })
  })

  it("does nothing before the 3-day follow-up threshold", () => {
    expect(decideFollowUpAction({ ...base, lastAgentAt: hoursAgo(71) })).toEqual({
      action: "none",
      reason: "too_soon",
    })
  })

  it("sends a follow-up at 3 days with no customer reply (BUG)", () => {
    expect(decideFollowUpAction({ ...base, lastAgentAt: hoursAgo(72) })).toEqual({
      action: "follow_up",
    })
  })

  it("does not send a second follow-up (same-day re-run / already nudged)", () => {
    expect(
      decideFollowUpAction({
        ...base,
        lastAgentAt: hoursAgo(80),
        alreadySentFollowUp: true,
      }),
    ).toEqual({ action: "none", reason: "already_acted" })
  })

  it("closes at 7 days even if a 3-day follow-up was already sent", () => {
    expect(
      decideFollowUpAction({
        ...base,
        lastAgentAt: hoursAgo(168),
        alreadySentFollowUp: true,
      }),
    ).toEqual({ action: "close" })
  })

  it("closes at 7 days when no follow-up was sent (job missed a day)", () => {
    expect(decideFollowUpAction({ ...base, lastAgentAt: hoursAgo(168) })).toEqual({
      action: "close",
    })
  })

  it("does not re-close when the close workflow flag is already set", () => {
    expect(
      decideFollowUpAction({
        ...base,
        lastAgentAt: hoursAgo(170),
        alreadySentClose: true,
      }),
    ).toEqual({ action: "none", reason: "already_acted" })
  })

  it("does not follow up INQUIRY at 3 days — waits for the close threshold", () => {
    expect(
      decideFollowUpAction({
        ...base,
        ticketType: "INQUIRY",
        lastAgentAt: hoursAgo(80),
      }),
    ).toEqual({ action: "none", reason: "too_soon" })
  })

  it("closes INQUIRY at 7 days with no soft follow-up", () => {
    expect(
      decideFollowUpAction({
        ...base,
        ticketType: "INQUIRY",
        lastAgentAt: hoursAgo(168),
      }),
    ).toEqual({ action: "close" })
  })

  it("uses elapsed days, not calendar midnights", () => {
    expect(daysBetween(hoursAgo(72), now)).toBe(3)
    expect(daysBetween(hoursAgo(167.9), now)).toBeLessThan(7)
  })
})

describe("ticket type → workflow", () => {
  it("maps BUG follow-up / close and INQUIRY close only", () => {
    expect(ticketAllowsSoftFollowUp("BUG")).toBe(true)
    expect(ticketAllowsSoftFollowUp("INQUIRY")).toBe(false)
    expect(resolveFollowUpWorkflowId("BUG", "follow_up")).toBe(
      config.followUp.workflows.bugFollowUp,
    )
    expect(resolveFollowUpWorkflowId("BUG", "close")).toBe(config.followUp.workflows.bugClose)
    expect(resolveFollowUpWorkflowId("INQUIRY", "close")).toBe(
      config.followUp.workflows.inquiryClose,
    )
  })
})

describe("analyzeConversation + classifyMessage", () => {
  it("classifies REST and MCP-shaped messages", () => {
    expect(classifyMessage({ id: "1", createdAt: now.toISOString(), senderType: "user" })).toBe(
      "customer",
    )
    expect(classifyMessage({ id: "2", createdAt: now.toISOString(), senderType: "agent" })).toBe(
      "agent",
    )
    expect(classifyMessage({ id: "3", createdAt: now.toISOString(), type: "BOT", bot: true })).toBe(
      "bot",
    )
    expect(classifyMessage({ id: "4", createdAt: now.toISOString(), type: "NOTE" })).toBe("ignore")
  })

  it("treats BOT_REPLY as bot/AI unless senderType is user", () => {
    expect(classifyMessage({ id: "5", createdAt: now.toISOString(), type: "BOT_REPLY" })).toBe(
      "bot",
    )
    expect(
      classifyMessage({
        id: "6",
        createdAt: now.toISOString(),
        type: "BOT_REPLY",
        senderType: "user",
      }),
    ).toBe("customer")
  })

  it("uses max createdAt per role so newest-first and oldest-first arrays agree", () => {
    const agent = msg("agent", hoursAgo(80), "Can you share a screenshot?")
    const customer = msg("customer", hoursAgo(10), "here you go")
    const oldestFirst = [agent, customer]
    const newestFirst = [customer, agent]

    const a = analyzeConversation(oldestFirst)
    const b = analyzeConversation(newestFirst)
    expect(a.lastAgentAt).toEqual(hoursAgo(80))
    expect(a.lastCustomerAt).toEqual(hoursAgo(10))
    expect(b.lastAgentAt).toEqual(a.lastAgentAt)
    expect(b.lastCustomerAt).toEqual(a.lastCustomerAt)
  })

  it("does not treat a bot message as a human agent reply or as already-sent", () => {
    const cursor = analyzeConversation([
      msg("agent", hoursAgo(80), "Can you share a screenshot?"),
      msg("bot", hoursAgo(8), "Just checking in — do you have any updates on this?"),
    ])
    expect(cursor.lastAgentAt).toEqual(hoursAgo(80))
    expect(cursor.alreadySentFollowUp).toBe(false)
    expect(cursor.lastCustomerAt).toBeUndefined()
  })

  it("honors formData noreply workflow flags without inspecting bot text", () => {
    const cursor = analyzeConversation([msg("agent", hoursAgo(80))], {
      [FOLLOWUP_FORM.followUpSentAt]: hoursAgo(2).toISOString(),
    })
    expect(cursor.alreadySentFollowUp).toBe(true)
  })

  it("honors legacy bot-message formData flags so those tickets are not double-nudged", () => {
    const cursor = analyzeConversation([msg("agent", hoursAgo(80))], {
      noreply_followup_sent_at: hoursAgo(2).toISOString(),
    })
    expect(cursor.alreadySentFollowUp).toBe(true)
  })

  it("does not treat an older formData flag as already-sent after a newer agent reply", () => {
    const cursor = analyzeConversation([msg("agent", hoursAgo(2))], {
      [FOLLOWUP_FORM.followUpSentAt]: hoursAgo(80).toISOString(),
    })
    expect(cursor.alreadySentFollowUp).toBe(false)
  })

  it("resets the already-sent flags when a human agent replies again", () => {
    const cursor = analyzeConversation(
      [
        msg("agent", hoursAgo(200), "First reply"),
        msg("bot", hoursAgo(120), "old follow-up"),
        msg("agent", hoursAgo(80), "Following up myself"),
      ],
      { [FOLLOWUP_FORM.followUpSentAt]: hoursAgo(120).toISOString() },
    )
    expect(cursor.lastAgentAt).toEqual(hoursAgo(80))
    expect(cursor.alreadySentFollowUp).toBe(false)
  })

  it("detects an already-run close workflow via formData", () => {
    const cursor = analyzeConversation([msg("agent", hoursAgo(170))], {
      [FOLLOWUP_FORM.closeSentAt]: hoursAgo(1).toISOString(),
    })
    expect(cursor.alreadySentClose).toBe(true)
  })
})
