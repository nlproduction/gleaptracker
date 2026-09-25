import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../../gleaptracker.config"
import { trackerTicket } from "../../test/fixtures"
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock("@linear/sdk", () => ({ LinearClient: class { createIssue = mocks.create } }))
import { createLinearIssue } from "./client"
const original = config.linear
beforeEach(() => {
  vi.clearAllMocks()
  config.linear = { ...original!, teamId: "test-team", labelIds: ["label-1"], stateId: "" }
  vi.stubEnv("LINEAR_API_KEY", "dummy-linear-key")
  mocks.create.mockResolvedValue({ success: true, issue: Promise.resolve({ id: "uuid", identifier: "TEAM-1", url: "https://linear.app/issue/TEAM-1" }) })
})
afterEach(() => { config.linear = original; vi.unstubAllEnvs() })
describe("Linear client", () => {
  it("adds context and a stable tracker marker without requiring a custom initial state", async () => {
    expect((await createLinearIssue(trackerTicket())).identifier).toBe("TEAM-1")
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: "test-team", labelIds: ["label-1"], stateId: undefined }))
    expect(mocks.create.mock.calls[0][0].description).toContain("Gleap tracker: Gleap-237650")
    expect(mocks.create.mock.calls[0][0].description).toContain("Fix the orange typo")
  })
  it("rejects missing configuration", async () => {
    config.linear!.teamId = ""
    await expect(createLinearIssue(trackerTicket())).rejects.toThrow("LINEAR_API_KEY")
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("rejects failed or incomplete SDK responses", async () => {
    mocks.create.mockResolvedValueOnce({ success: false })
    await expect(createLinearIssue(trackerTicket())).rejects.toThrow("creation failed")
    mocks.create.mockResolvedValueOnce({ success: true, issue: Promise.resolve(undefined) })
    await expect(createLinearIssue(trackerTicket())).rejects.toThrow("not returned")
  })
})
