import { beforeEach, describe, expect, it, vi } from "vitest"
import { trackerTicket } from "../test/fixtures"
import { mockReq, mockRes, signGitHub } from "../test/http"

const mocks = vi.hoisted(() => ({
  closeTracker: vi.fn().mockResolvedValue(undefined),
  findTrackerByBugId: vi.fn(),
}))

vi.mock("../integrations/gleap/close", () => ({
  closeTracker: mocks.closeTracker,
}))

vi.mock("../integrations/gleap/linked", () => ({
  findTrackerByBugId: mocks.findTrackerByBugId,
}))

import { githubPost } from "./githubWebhook"

const pushBody = (commits: Array<{ message: string }>, ref = "refs/heads/master") =>
  JSON.stringify({ ref, commits })

const postPush = async (rawBody: string) => {
  const res = mockRes()
  await githubPost(
    mockReq({
      body: rawBody,
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": signGitHub(rawBody),
      },
    }),
    res,
  )
  return res
}

describe("github webhook (path B)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findTrackerByBugId.mockImplementation(async (bugId: string) =>
      trackerTicket({
        id: `tracker-${bugId}`,
        bugId: Number(bugId),
      }),
    )
  })

  it("parses Fixes Gleap-<id> from push commits and closes those trackers", async () => {
    const rawBody = pushBody([
      { message: "fix zoom\n\nFixes Gleap-88001\nRefs Gleap-237536" },
      { message: "also Fixes Gleap-88002" },
    ])

    const res = await postPush(rawBody)

    expect(res.statusCode).toBe(200)
    expect(mocks.findTrackerByBugId).toHaveBeenCalledWith("88001")
    expect(mocks.findTrackerByBugId).toHaveBeenCalledWith("88002")
    expect(mocks.closeTracker).toHaveBeenCalledTimes(2)
    expect(mocks.closeTracker).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tracker-88001", bugId: 88001 }),
      { source: "github" },
    )
    expect(mocks.closeTracker).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tracker-88002", bugId: 88002 }),
      { source: "github" },
    )
  })

  it("ignores noise: no Fixes token, Refs-only, wrong verb, other branches", async () => {
    const noise = await postPush(
      pushBody([
        { message: "chore: bump deps" },
        { message: "Fixed Gleap-88003" },
        { message: "Refs Gleap-237536" },
      ]),
    )
    expect(noise.statusCode).toBe(200)
    expect(mocks.findTrackerByBugId).not.toHaveBeenCalled()
    expect(mocks.closeTracker).not.toHaveBeenCalled()

    const otherBranch = await postPush(
      pushBody([{ message: "Fixes Gleap-88004" }], "refs/heads/develop"),
    )
    expect(otherBranch.statusCode).toBe(200)
    expect(mocks.closeTracker).not.toHaveBeenCalled()
  })

  it("dedups the same Fixes Gleap-<id> across repeated pushes", async () => {
    const rawBody = pushBody([
      { message: "Fixes Gleap-88005" },
      { message: "retry Fixes Gleap-88005" },
    ])

    await postPush(rawBody)
    await postPush(rawBody)

    expect(mocks.findTrackerByBugId).toHaveBeenCalledTimes(1)
    expect(mocks.findTrackerByBugId).toHaveBeenCalledWith("88005")
    expect(mocks.closeTracker).toHaveBeenCalledTimes(1)
  })
})
