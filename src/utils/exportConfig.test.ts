import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import dotenv from "dotenv"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
let directory: string
const script = path.resolve("scripts/export-config.cjs")
beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), "gleaptracker-export-")) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })
const run = (message: string) => {
  const source = path.join(directory, "previous.cjs")
  const output = path.join(directory, ".env.migration")
  writeFileSync(source, `exports.default = ${JSON.stringify({
    issueTracker: "none", gleap: { bugFixedMessage: message, webhookSecret: "do-not-export-this-secret" },
    linear: { teamId: "old-team", labelIds: ["one", "two"] },
    followUp: { cron: "0 8 * * *", workflows: { bugFollowUp: "old-workflow" } },
  })}`)
  const log = execFileSync(process.execPath, [script, source, output], { cwd: directory, encoding: "utf8" })
  return { source, output, log, content: readFileSync(output, "utf8") }
}
describe("previous configuration export", () => {
  it("preserves effective settings without exporting secrets or printing values", () => {
    const result = run("Please update the plugin.")
    expect(dotenv.parse(result.content)).toMatchObject({ ISSUE_TRACKER: "none", LINEAR_TEAM_ID: "old-team", LINEAR_LABEL_IDS: "one,two", FOLLOWUP_BUG_FOLLOWUP_WORKFLOW_ID: "old-workflow" })
    expect(result.content).not.toContain("do-not-export")
    expect(result.log).not.toContain("old-team")
    expect(statSync(result.output).mode & 0o777).toBe(0o600)
  })
  it("preserves multiline customer copy exactly", () => {
    const message = "We've fixed the issue.\n\nPlease update your plugin."
    expect(dotenv.parse(run(message).content).GLEAP_BUG_FIXED_MESSAGE).toBe(message)
  })
  it("never overwrites a previous export", () => {
    const result = run("Original")
    expect(() => execFileSync(process.execPath, [script, result.source, result.output], { cwd: directory, stdio: "pipe" })).toThrow()
    expect(readFileSync(result.output, "utf8")).toBe(result.content)
  })
  it("fails clearly when the previous build is missing", () => {
    expect(() => execFileSync(process.execPath, [script, path.join(directory, "missing.cjs")], { cwd: directory, stdio: "pipe" })).toThrow()
  })
})
