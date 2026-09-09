import type { GleapTicket } from "../integrations/gleap/client"

export const TEST_SLACK_CHANNEL_ID = "C123TEST"
export const TEST_SLACK_SIGNING_SECRET = "slack-signing-secret"
export const TEST_GITHUB_WEBHOOK_SECRET = "gh-webhook-secret"
export const TEST_THREAD_TS = "1234.5678"
export const TEST_THREAD_URL =
  "https://workspace.slack.com/archives/C123TEST/p12345678"

export const customerTicket = (overrides: Partial<GleapTicket> = {}): GleapTicket => ({
  id: "cust-1",
  title: "Orange typo",
  bugId: 237536,
  status: "OPEN",
  type: "BUG",
  trackerTicket: false,
  session: { name: "Jay", email: "jay@example.com" },
  ...overrides,
})

export const extraCustomerTicket = (
  overrides: Partial<GleapTicket> = {},
): GleapTicket =>
  customerTicket({
    id: "cust-2",
    title: "Same typo elsewhere",
    bugId: 237537,
    session: { name: "Sam", email: "sam@example.com" },
    ...overrides,
  })

export const trackerTicket = (overrides: Partial<GleapTicket> = {}): GleapTicket => ({
  id: "tracker-1",
  title: "Tracker: Orange typo",
  bugId: 237650,
  status: "OPEN",
  type: "FOR-RELEASE",
  trackerTicket: true,
  plainContent: "Fix the orange typo in the checkout.",
  linkedTickets: ["cust-1"],
  formData: {},
  session: { name: "Internal", email: "tracker@example.com" },
  ...overrides,
})
