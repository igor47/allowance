/**
 * The only state that outlives a request.
 *
 * Two users refreshing a dashboard should not each trigger a fresh pull from a
 * rate-limited API. Writes invalidate, so tagging a transaction shows up
 * immediately rather than after the TTL.
 */

interface Entry<T> {
  value: T
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
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlSeconds * 1000 })
    return value
  }

  clear(): void {
    this.entries.clear()
  }

  /** Drop everything under a key prefix — used after a write. */
  invalidate(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }
}
