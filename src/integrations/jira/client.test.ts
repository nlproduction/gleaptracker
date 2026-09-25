import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import config from "../../../gleaptracker.config"
import { trackerTicket } from "../../test/fixtures"
import { createJiraIssue, getJiraOrigin } from "./client"
const original = config.jira
beforeEach(() => {
  config.jira = { ...original!, host: "https://example.atlassian.net/", projectKey: "DEMO", labels: ["support"], additionalFields: { customfield_1: "value" } }
  vi.stubEnv("JIRA_EMAIL", "test@example.com")
  vi.stubEnv("JIRA_API_TOKEN", "dummy-jira-token")
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "123", key: "DEMO-1" }) }))
})
afterEach(() => { config.jira = original; vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe("Jira client", () => {
  it.each(["example.atlassian.net", "https://example.atlassian.net/"])("normalizes %s", (host) => {
    expect(getJiraOrigin(host)).toBe("https://example.atlassian.net")
  })
  it.each(["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?token=x"])("rejects invalid origins: %s", (host) => {
    expect(() => getJiraOrigin(host)).toThrow()
  })
  it("creates linked issues with ADF descriptions, labels and custom fields", async () => {
    const result = await createJiraIssue(trackerTicket())
    expect(result).toEqual({ id: "123", key: "DEMO-1", identifier: "DEMO-1", url: "https://example.atlassian.net/browse/DEMO-1" })
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe("https://example.atlassian.net/rest/api/3/issue")
    const body = JSON.parse(String(options?.body))
    expect(body.fields.customfield_1).toBe("value")
    expect(body.fields.labels).toEqual(["support", "gleap-237650"])
    expect(body.fields.description.type).toBe("doc")
    expect(JSON.stringify(body.fields.description)).toContain("Gleap tracker: Gleap-237650")
    expect(JSON.stringify(body.fields.description)).toContain("Fix the orange typo")
    expect(options?.signal).toBeDefined()
  })
  it("protects core linkage fields from custom field overrides", async () => {
    config.jira!.additionalFields = { project: { key: "WRONG" }, summary: "wrong" }
    await createJiraIssue(trackerTicket())
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(body.fields.project.key).toBe("DEMO")
    expect(body.fields.summary).toMatch(/^\[237650\]/)
  })
  it("rejects missing credentials before a network request", async () => {
    vi.stubEnv("JIRA_API_TOKEN", "")
    await expect(createJiraIssue(trackerTicket())).rejects.toThrow("Configure JIRA_HOST")
    expect(fetch).not.toHaveBeenCalled()
  })
  it("reports API failures and malformed create responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 400, text: async () => "Required field" } as Response)
    await expect(createJiraIssue(trackerTicket())).rejects.toThrow("Required field")
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
    await expect(createJiraIssue(trackerTicket())).rejects.toThrow("missing issue")
  })
})
