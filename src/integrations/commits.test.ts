import { describe, expect, it } from "vitest"
import { parseFixesFromCommits, parseFixesGleapIds, parseRefsGleapIds } from "./commits"

describe("parseFixesGleapIds", () => {
  it("extracts tracker ids from Fixes Gleap-<id> tokens", () => {
    expect(
      parseFixesGleapIds("fix zoom\n\nFixes Gleap-237650\nRefs Gleap-237536, Gleap-237537"),
    ).toEqual(["237650"])
  })

  it("is case-insensitive and dedups within one message", () => {
    expect(parseFixesGleapIds("fixes Gleap-1 and Fixes Gleap-1")).toEqual(["1"])
  })

  it("ignores Refs, wrong verbs, and other noise", () => {
    expect(
      parseFixesGleapIds("chore: bump\nFixed Gleap-9\nRefs Gleap-10\nFixes Ticket-11"),
    ).toEqual([])
  })
})

describe("parseRefsGleapIds", () => {
  it("collects customer ids from a Refs line", () => {
    expect(parseRefsGleapIds("Fixes Gleap-1\nRefs Gleap-10, Gleap-11")).toEqual([
      "10",
      "11",
    ])
  })
})

describe("parseFixesFromCommits", () => {
  it("scans every commit and dedups ids across the push", () => {
    expect(
      parseFixesFromCommits([
        { message: "Fixes Gleap-1" },
        { message: "also Fixes Gleap-1 and Fixes Gleap-2" },
        { message: "chore: ignore me" },
      ]),
    ).toEqual(["1", "2"])
  })

  it("returns nothing when commits have no Fixes tokens", () => {
    expect(
      parseFixesFromCommits([{ message: "refactor parser" }, { message: undefined }]),
    ).toEqual([])
  })
})
