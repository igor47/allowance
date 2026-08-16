/**
 * The only state that outlives a request.
 *
 * Two users refreshing a dashboard should not each trigger a fresh pull from a
 * rate-limited API. Writes invalidate, so tagging a transaction shows up
 * immediately rather than after the TTL.
 */

interface Entry<T> {
  value: T
  storedAt: number
  expiresAt: number
}

export class Cache {
  private readonly entries = new Map<string, Entry<unknown>>()

  constructor(
    private readonly ttlSeconds: number,
    private readonly now: () => number = Date.now
  ) {}

  async fetch<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.value as T
    const value = await load()
    this.entries.set(key, {
      value,
      storedAt: this.now(),
      expiresAt: this.now() + this.ttlSeconds * 1000,
    })
    return value
  }

  /**
   * When the newest entry under a prefix was read from the API.
   *
   * The dashboard shows this: with two people tagging from two phones, "how old
   * is what I am looking at" is a different question from "when did Lunch Money
   * last hear from the bank", and only this one is about us.
   */
  storedAt(prefix: string): number | null {
    let newest: number | null = null
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix) && (newest === null || entry.storedAt > newest)) {
        newest = entry.storedAt
      }
    }
    return newest
  }

  clear(): void {
    this.entries.clear()
  }

  /** Drop everything under a key prefix. */
  invalidate(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  /**
   * Rewrite cached values in place, keeping their expiry.
   *
   * This is how a write stays cheap: after tagging one transaction there is no
   * reason to re-download the window it lives in.
   */
  mutate<T>(prefix: string, update: (value: T) => T): void {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix)) entry.value = update(entry.value as T)
    }
  }
}
