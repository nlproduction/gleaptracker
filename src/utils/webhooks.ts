import crypto from "node:crypto"

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export const rawBodyToString = (body: unknown): string =>
  Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : ""

export const verifyHmac = (signature: string, body: string, secret?: string): boolean => {
  if (!secret || !/^[a-f\d]{64}$/i.test(signature)) return false
  const actual = Buffer.from(signature, "hex")
  const expected = crypto.createHmac("sha256", secret).update(body).digest()
  return crypto.timingSafeEqual(new Uint8Array(actual), new Uint8Array(expected))
}

export const verifySharedSecret = (value: unknown, secret?: string): boolean => {
  if (!secret || typeof value !== "string" || !value) return false
  const hash = (input: string) => new Uint8Array(crypto.createHash("sha256").update(input).digest())
  return crypto.timingSafeEqual(hash(value), hash(secret))
}

/** Read plain descriptions and Jira's Atlassian Document Format. */
export const descriptionText = (value: unknown, depth = 0): string => {
  if (depth > 30) return ""
  if (typeof value === "string") return value
  if (!isRecord(value)) return ""
  if (typeof value.text === "string") return value.text
  return Array.isArray(value.content)
    ? value.content.map((child) => descriptionText(child, depth + 1)).join("\n")
    : ""
}

export const trackerBugId = (title: string, description?: unknown): string | undefined => {
  // The marker survives edits to the title. Existing [bugId] titles still work.
  const marker = descriptionText(description).match(/(?:^|\n)Gleap tracker: Gleap-(\d+)\s*(?:\n|$)/)
  return marker?.[1] ?? title.match(/^\[(\d+)\]/)?.[1]
}
