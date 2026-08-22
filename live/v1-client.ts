/**
 * The v1 client, kept alive only long enough to be disagreed with.
 *
 * This is a copy of what `src/lunchmoney/client.ts` was before the v2
 * migration, reduced to the two reads the differential check needs. It lives
 * outside `src/` deliberately: nothing the app ships may reach v1, and nothing
 * under `src/` may reach the network at all.
 *
 * Delete this, and `differential.ts` with it, once the migration has been
 * trusted for a month or two. Lunch Money files v1 under "legacy APIs", so it
 * will stop answering eventually and that is fine — by then this has either
 * done its job or it has not.
 */

import type { LmRecurringItem, LmTransaction } from "../src/lunchmoney/types"

const BASE = "https://api.lunchmoney.dev/v1/"
const PAGE_SIZE = 500

export class V1Client {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
    })
    if (!response.ok) {
      throw new Error(`v1 GET ${path} failed: ${response.status} ${await response.text()}`)
    }
    return (await response.json()) as T
  }

  async transactions(start: string, end: string): Promise<LmTransaction[]> {
    const out: LmTransaction[] = []
    for (let offset = 0; ; ) {
      const query = new URLSearchParams({
        start_date: start,
        end_date: end,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      const page = await this.request<{ transactions: LmTransaction[]; has_more?: boolean }>(
        `transactions?${query}`
      )
      out.push(...page.transactions)
      if (!page.has_more || page.transactions.length === 0) return out
      offset += page.transactions.length
    }
  }

  async recurringItems(start: string, end: string): Promise<LmRecurringItem[]> {
    return await this.request<LmRecurringItem[]>(
      `recurring_items?start_date=${start}&end_date=${end}`
    )
  }
}
