import crypto from "crypto"
import type { Request, Response } from "express"
import { TEST_GITHUB_WEBHOOK_SECRET, TEST_SLACK_SIGNING_SECRET } from "./fixtures"

export const mockReq = (opts: {
  body?: unknown
  headers?: Record<string, string>
}): Request =>
  ({
    body: opts.body ?? "",
    get(name: string) {
      const headers = opts.headers ?? {}
      const key = Object.keys(headers).find(
        (k) => k.toLowerCase() === name.toLowerCase(),
      )
      return key ? headers[key] : undefined
    },
  }) as Request

export const mockRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code
      return this
    },
    set(headers: Record<string, unknown>) {
      Object.assign(this.headers, headers)
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
    send(body: unknown) {
      this.body = body
      return this
    },
    end() {
      return this
    },
  }
  return res as typeof res & Response
}

export const signGitHub = (
  rawBody: string,
  secret = TEST_GITHUB_WEBHOOK_SECRET,
): string => `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`

export const signSlack = (
  rawBody: string,
  secret = TEST_SLACK_SIGNING_SECRET,
  timestamp = String(Math.floor(Date.now() / 1000)),
): { timestamp: string; signature: string } => ({
  timestamp,
  signature: `v0=${crypto
    .createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`,
})
