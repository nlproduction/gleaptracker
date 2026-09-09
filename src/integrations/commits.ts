/** Collect tracker bugIds from `Fixes Gleap-<id>` tokens in a commit message. */
export const parseFixesGleapIds = (message: string): string[] => {
  const ids = new Set<string>()
  const re = /Fixes\s+Gleap-(\d+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(message))) {
    ids.add(match[1])
  }
  return [...ids]
}

/** Collect customer bugIds from a `Refs Gleap-<id>, Gleap-<id>, …` line. */
export const parseRefsGleapIds = (message: string): string[] => {
  const ids = new Set<string>()
  const re = /Refs\s+((?:Gleap-\d+(?:\s*,\s*)?)+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(message))) {
    for (const id of match[1].match(/\d+/g) ?? []) ids.add(id)
  }
  return [...ids]
}

export const parseFixesFromCommits = (
  commits: Array<{ message?: string }>,
): string[] => {
  const ids = new Set<string>()
  for (const commit of commits) {
    for (const id of parseFixesGleapIds(commit.message ?? "")) ids.add(id)
  }
  return [...ids]
}
