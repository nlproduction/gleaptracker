import { describe, expect, it } from "vitest"
import { customerTicket, trackerTicket } from "../../test/fixtures"
import { buildTrackerRootBlocks } from "./blocks"
const buttons = (formData: Record<string, unknown>, status = "OPEN") => {
  const blocks = buildTrackerRootBlocks({ tracker: trackerTicket({ formData, status }), primary: customerTicket(), extras: [] })
  return (blocks[1] as { elements: Array<{ action_id: string; url?: string }> }).elements
}
describe("Slack engineering issue links", () => {
  it("leaves existing cards unchanged when no provider is configured", () => {
    expect(buttons({}).map((button) => button.action_id)).toEqual(["close_tracker", "open_gleap"])
  })
  it("adds both provider links without replacing Close or Gleap", () => {
    expect(buttons({ linearIssueUrl: "https://linear.app/issue/TEAM-1", jiraIssueUrl: "https://example.atlassian.net/browse/DEMO-1" }).map((button) => button.action_id))
      .toEqual(["close_tracker", "open_gleap", "open_linear", "open_jira"])
  })
  it("keeps issue links visible on a closed tracker", () => {
    expect(buttons({ linearIssueUrl: "https://linear.app/issue/TEAM-1" }, "DONE").map((button) => button.action_id))
      .toEqual(["open_gleap", "open_linear"])
  })
  it.each(["javascript:alert(1)", "not a URL", "https://user:pass@example.com", 123, null])("ignores unsafe/malformed stored URLs: %s", (value) => {
    expect(buttons({ linearIssueUrl: value }).map((button) => button.action_id)).toEqual(["close_tracker", "open_gleap"])
  })
})
