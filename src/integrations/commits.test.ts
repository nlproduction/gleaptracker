import assert from "node:assert/strict"
import { parseFixesFromCommits, parseFixesGleapIds, parseRefsGleapIds } from "./commits"
import { buildHeaderText, formatFixesLine, formatRefsLine } from "./slack/blocks"
import type { GleapTicket } from "./gleap/client"

const ids = parseFixesGleapIds("fix zoom\n\nFixes Gleap-237650\nRefs Gleap-237536, Gleap-237537")
assert.deepEqual(ids, ["237650"])

assert.deepEqual(
  parseRefsGleapIds("Fixes Gleap-1\nRefs Gleap-10, Gleap-11"),
  ["10", "11"],
)

assert.deepEqual(
  parseFixesFromCommits([
    { message: "Fixes Gleap-1" },
    { message: "also Fixes Gleap-1 and Fixes Gleap-2" },
  ]),
  ["1", "2"],
)

assert.equal(formatFixesLine(237650), "Fixes Gleap-237650")
assert.equal(formatRefsLine([237536, 237537]), "Refs Gleap-237536, Gleap-237537")

const primary = {
  id: "c1",
  title: "Orange typo",
  bugId: 237536,
  status: "OPEN",
  type: "BUG",
  trackerTicket: false,
  session: { name: "Jay", email: "jay@example.com" },
} as GleapTicket

const extra = {
  id: "c2",
  title: "Same typo elsewhere",
  bugId: 237537,
  status: "OPEN",
  type: "BUG",
  trackerTicket: false,
} as GleapTicket

const withExtras = buildHeaderText({
  primary,
  extras: [extra],
  trackerBugId: 237650,
})
assert.match(withExtras, /`#237536`/)
assert.match(withExtras, /jay@example.com/)
assert.match(withExtras, /Linked: <https:\/\/app\.gleap\.io\/projects\/.+\/bugs\/c2\|#237537>/)
assert.match(withExtras, /`Fixes Gleap-237650`/)
assert.match(withExtras, /`Refs Gleap-237536, Gleap-237537`/)

const solo = buildHeaderText({ primary, extras: [], trackerBugId: 237650 })
assert.doesNotMatch(solo, /Linked:/)
assert.match(solo, /`Refs Gleap-237536`/)

console.log("commits + header tests passed")
