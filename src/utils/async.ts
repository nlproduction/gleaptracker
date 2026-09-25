/** Serialize by resource, without letting a failure poison the queue. */
export const createKeyedLock = () => {
  const tails = new Map<string, Promise<unknown>>()
  return async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(work)
    tails.set(key, current)
    try {
      return await current
    } finally {
      if (tails.get(key) === current) tails.delete(key)
    }
  }
}

/** Coalesce successful deliveries; a failure must remain immediately retryable. */
export const createDeliveryDedup = (ttlMs = 30_000) => {
  const entries = new Map<string, Promise<void>>()
  return async (key: string, work: () => Promise<void>): Promise<void> => {
    const existing = entries.get(key)
    if (existing) return existing
    const operation = Promise.resolve().then(work)
    entries.set(key, operation)
    try {
      await operation
      setTimeout(() => {
        if (entries.get(key) === operation) entries.delete(key)
      }, ttlMs).unref()
    } catch (error) {
      if (entries.get(key) === operation) entries.delete(key)
      throw error
    }
  }
}
