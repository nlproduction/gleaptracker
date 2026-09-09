import { describe, expect, it } from "vitest"
import config from "../../gleaptracker.config"
import type { GleapMessage } from "../integrations/gleap/client"
import { customerTicket, trackerTicket } from "../test/fixtures"
import {
  analyzeConversation,
  classifyMessage,
  daysBetween,
  decideFollowUpAction,
  decideForTicket,
  shouldSkipLinkedActiveTracker,
} from "./followUpDecision"

const hoursAgo = (hours: number, now = new Date("2026-09-09T08:00:00.000Z")): Date =>
  new Date(now.getTime() - hours * 60 * 60 * 1000)

const now = new Date("2026-09-09T08:00:00.000Z")

const msg = (
  role: "customer" | "agent" | "bot" | "note",
  createdAt: Date,
  text = "",
): GleapMessage => {
  if (role === "note") {
    return { id: createdAt.toISOString(), type: "NOTE", createdAt: createdAt.toISOString(), text }
  }
  if (role === "customer") {
    return {
      id: createdAt.toISOString(),
      type: "TEXT",
      senderType: "user",
      createdAt: createdAt.toISOString(),
      text,
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
    }
  }
  return {
    id: createdAt.toISOString(),
    type: "BOT",
    senderType: "bot",
    bot: true,
    createdAt: createdAt.toISOString(),
    text,
  }
}

const templates = {
  followUpMessage: config.followUp.followUpMessage,
  closeMessage: config.followUp.closeMessage,
}

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
    closeAfterDays: 5,
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

  it("sends a follow-up at 3 days with no customer reply", () => {
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

  it("closes at 5 days even if a 3-day follow-up was already sent", () => {
    expect(
      decideFollowUpAction({
        ...base,
        lastAgentAt: hoursAgo(120),
        alreadySentFollowUp: true,
      }),
    ).toEqual({ action: "close" })
  })

  it("closes at 5 days when no follow-up was sent (job missed a day)", () => {
    expect(decideFollowUpAction({ ...base, lastAgentAt: hoursAgo(120) })).toEqual({
      action: "close",
    })
  })

  it("uses elapsed days, not calendar midnights", () => {
    expect(daysBetween(hoursAgo(72), now)).toBe(3)
    expect(daysBetween(hoursAgo(119.9), now)).toBeLessThan(5)
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
    expect(classifyMessage({ id: "5", createdAt: now.toISOString(), type: "BOT_REPLY" })).toBe(
      "customer",
    )
  })

  it("treats our bot follow-up as already-sent and does not reset the agent clock", () => {
    const cursor = analyzeConversation(
      [
        msg("agent", hoursAgo(80), "Can you share a screenshot?"),
        msg("bot", hoursAgo(8), templates.followUpMessage),
      ],
      templates,
    )
    expect(cursor.lastAgentAt).toEqual(hoursAgo(80))
    expect(cursor.alreadySentFollowUp).toBe(true)
    expect(cursor.lastCustomerAt).toBeUndefined()
  })

  it("resets the already-sent flags when a human agent replies again", () => {
    const cursor = analyzeConversation(
      [
        msg("agent", hoursAgo(200), "First reply"),
        msg("bot", hoursAgo(120), templates.followUpMessage),
        msg("agent", hoursAgo(80), "Following up myself"),
      ],
      templates,
    )
    expect(cursor.lastAgentAt).toEqual(hoursAgo(80))
    expect(cursor.alreadySentFollowUp).toBe(false)
  })

  it("detects an already-sent close message so the job can skip the customer text", () => {
    const cursor = analyzeConversation(
      [msg("agent", hoursAgo(130)), msg("bot", hoursAgo(1), templates.closeMessage)],
      templates,
    )
    expect(cursor.alreadySentClose).toBe(true)
  })
})
