/**
 * The only thing in this codebase that knows what Lunch Money sends.
 *
 * v2 de-hydrates the transaction: category name, `is_income`,
 * `exclude_from_totals`, the account's display name and the tags are all gone
 * from it, replaced by ids. Nearly every one of those is something the domain
 * branches on — the `[accounts]` policy is keyed on the account's display name — so
 * this client joins them back before anything downstream sees a transaction.
 *
 * That join is the whole design. `src/domain/` still receives exactly the
 * `LmTransaction` it always did, so the rules, and every test of them, are
 * untouched by the migration.
 */

import type { LmAccount, LmRecurringItem, LmTag, LmTransaction, LunchMoneyClient } from "./types"
import type {
  V2Category,
  V2ManualAccount,
  V2PlaidAccount,
  V2RecurringItem,
  V2Tag,
  V2Transaction,
} from "./v2"

const BASE = "https://api.lunchmoney.dev/v2/"
const PAGE_SIZE = 500

/**
 * Categories, accounts and tags are small, stable, and needed on every read.
 * Holding them briefly turns one dashboard build back into one transaction
 * fetch rather than five requests.
 */
const LOOKUP_TTL_SECONDS = 900

export class LunchMoneyError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "LunchMoneyError"
  }
}

export interface HttpClientOptions {
  apiKey: string
  /** Retries on 429. The documented limit is 100 requests/minute per IP (lunchmoney.dev/rate-limits). */
  maxRetries?: number
  sleep?: (ms: number) => Promise<void>
  /** How long the id→name lookups are held. Balances never come from these. */
  lookupTtlSeconds?: number
  now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Everything needed to turn a de-hydrated transaction back into a whole one. */
interface Lookups {
  categories: Map<number, V2Category>
  tags: Map<number, LmTag>
  plaid: Map<number, V2PlaidAccount>
  manual: Map<number, V2ManualAccount>
}

export class HttpLunchMoneyClient implements LunchMoneyClient {
  private readonly apiKey: string
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly lookupTtlSeconds: number
  private readonly now: () => number
  private lookups: { value: Promise<Lookups>; expiresAt: number } | null = null

  constructor(options: HttpClientOptions) {
    if (!options.apiKey) throw new Error("LUNCHMONEY_API_KEY is not set")
    this.apiKey = options.apiKey
    this.maxRetries = options.maxRetries ?? 6
    this.sleep = options.sleep ?? defaultSleep
    this.lookupTtlSeconds = options.lookupTtlSeconds ?? LOOKUP_TTL_SECONDS
    this.now = options.now ?? Date.now
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let delay = 5_000
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(BASE + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      })
      if (response.status === 429 && attempt < this.maxRetries) {
        const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10)
        await this.sleep(Number.isNaN(retryAfter) ? delay : retryAfter * 1000)
        delay = Math.min(delay * 2, 120_000)
        continue
      }
      if (!response.ok) {
        throw new LunchMoneyError(
          `${init?.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`,
          response.status
        )
      }
      return (await response.json()) as T
    }
  }

  /**
   * The join tables, fetched once and held. The promise itself is cached, so
   * four concurrent dashboard builds share one set of requests rather than
   * racing to make four.
   */
  private async joinTables(): Promise<Lookups> {
    if (this.lookups && this.lookups.expiresAt > this.now()) return this.lookups.value
    const value = this.fetchJoinTables()
    this.lookups = { value, expiresAt: this.now() + this.lookupTtlSeconds * 1000 }
    // A failed fetch must not be remembered as the answer for fifteen minutes.
    value.catch(() => {
      this.lookups = null
    })
    return value
  }

  private async fetchJoinTables(): Promise<Lookups> {
    const [categories, tags, plaid, manual] = await Promise.all([
      this.request<{ categories: V2Category[] }>("categories"),
      this.request<{ tags: V2Tag[] }>("tags"),
      this.request<{ plaid_accounts: V2PlaidAccount[] }>("plaid_accounts"),
      this.request<{ manual_accounts: V2ManualAccount[] }>("manual_accounts"),
    ])
    return {
      categories: byId(categories.categories),
      tags: new Map(
        tags.tags.map((t) => [
          t.id,
          { id: t.id, name: t.name, description: t.description, archived: t.archived },
        ])
      ),
      plaid: byId(plaid.plaid_accounts),
      manual: byId(manual.manual_accounts),
    }
  }

  async transactions(start: string, end: string): Promise<LmTransaction[]> {
    const lookups = await this.joinTables()
    const out: LmTransaction[] = []
    for (let offset = 0; ; ) {
      const query = new URLSearchParams({
        start_date: start,
        end_date: end,
        // Plaid's metadata carries the posted date, which is what statement
        // cycles bucket on. v2 withholds it unless asked.
        include_metadata: "true",
        // v2 excludes pending transactions by default and v1 did not. They are
        // money that has left, so they count the day they appear, and dropping
        // them would quietly understate every current month.
        include_pending: "true",
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      const page = await this.request<{ transactions: V2Transaction[]; has_more?: boolean }>(
        `transactions?${query}`
      )
      for (const txn of page.transactions) out.push(hydrate(txn, lookups))
      if (!page.has_more || page.transactions.length === 0) return out
      offset += page.transactions.length
    }
  }

  /** Recurring items overlapping the range. Unpaginated; there are dozens. */
  async recurringItems(start: string, end: string): Promise<LmRecurringItem[]> {
    const lookups = await this.joinTables()
    const body = await this.request<{ recurring_items: V2RecurringItem[] }>(
      `recurring_items?start_date=${start}&end_date=${end}`
    )
    return body.recurring_items.map((item) => hydrateRecurring(item, lookups))
  }

  /**
   * Always a live read: this is what the freshness clock and the cash figures
   * are built from, so it must never come from the join-table cache.
   *
   * Both kinds of account, because a household that keeps its checking
   * account by hand still has cash on hand, and a card kept by hand still has
   * a balance for the reconciliation line to be checked against. Reading only
   * `plaid_accounts` here showed such a household "$0" and no issuer figure,
   * silently — the demo account, which has no Plaid link at all, is where that
   * was noticed.
   */
  async accounts(): Promise<LmAccount[]> {
    const [plaid, manual] = await Promise.all([
      this.request<{ plaid_accounts: V2PlaidAccount[] }>("plaid_accounts"),
      this.request<{ manual_accounts: V2ManualAccount[] }>("manual_accounts"),
    ])
    return [
      ...plaid.plaid_accounts.map(toPlaidAccount),
      ...manual.manual_accounts.map(toManualAccount),
    ]
  }

  async tags(): Promise<LmTag[]> {
    const body = await this.request<{ tags: V2Tag[] }>("tags")
    return body.tags.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      archived: t.archived,
    }))
  }

  /**
   * Lunch Money queues a background job; nothing is available synchronously.
   * Their docs ask for this to be used sparingly, so the route rate-limits it.
   */
  async triggerFetch(): Promise<void> {
    await this.request("plaid_accounts/fetch", { method: "POST", body: "{}" })
  }

  /**
   * v2 takes tag *ids*, not names, and will not create a tag on the way past
   * as v1 did — so a name with no tag behind it has to become one first.
   */
  async setTags(transactionId: number, tags: string[]): Promise<void> {
    const ids = await this.tagIdsFor(tags)
    await this.request(`transactions/${transactionId}`, {
      method: "PUT",
      body: JSON.stringify({ tag_ids: ids }),
    })
    // The next read must see the new tag, and a stale table would hide it.
    this.lookups = null
  }

  private async tagIdsFor(names: string[]): Promise<number[]> {
    if (names.length === 0) return []
    const existing = new Map(
      [...(await this.joinTables()).tags.values()].map((t) => [t.name.toLowerCase(), t.id])
    )
    const ids: number[] = []
    for (const name of names) {
      const hit = existing.get(name.toLowerCase())
      if (hit !== undefined) {
        ids.push(hit)
        continue
      }
      const created = await this.request<{ tag: V2Tag } | V2Tag>("tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      })
      ids.push("tag" in created ? created.tag.id : created.id)
    }
    return ids
  }
}

function byId<T extends { id: number }>(rows: T[]): Map<number, T> {
  return new Map(rows.map((row) => [row.id, row]))
}

const nameOf = (account: { display_name: string | null; name: string }): string =>
  account.display_name ?? account.name

function toPlaidAccount(a: V2PlaidAccount): LmAccount {
  return {
    id: a.id,
    source: "plaid",
    name: a.name,
    display_name: a.display_name,
    type: a.type,
    subtype: a.subtype,
    mask: a.mask,
    institution_name: a.institution_name,
    status: a.status,
    limit: a.limit,
    balance: a.balance,
    to_base: a.to_base,
    currency: a.currency,
    balance_last_update: a.balance_last_update ?? "",
    last_import: a.last_import,
    last_fetch: a.last_fetch,
    plaid_last_successful_update: a.plaid_last_successful_update,
  }
}

/**
 * The fields Plaid would have supplied are null rather than invented: nothing
 * ever imports into a manual account, and `freshness()` reads null as "never",
 * which is the truth.
 */
function toManualAccount(a: V2ManualAccount): LmAccount {
  return {
    id: a.id,
    source: "manual",
    name: a.name,
    display_name: a.display_name,
    type: a.type,
    subtype: a.subtype,
    mask: "",
    institution_name: a.institution_name ?? "",
    status: a.closed_on ? "closed" : (a.status ?? "active"),
    limit: null,
    balance: a.balance,
    to_base: a.to_base,
    currency: a.currency,
    balance_last_update: a.balance_as_of ?? "",
    last_import: null,
    last_fetch: null,
    plaid_last_successful_update: null,
  }
}

/**
 * A de-hydrated transaction, made whole again.
 *
 * The two account fields are set the way v1 set them — `plaid_*` for a linked
 * account, `asset_*` for a manual one — because `accountNameOf()` falls through
 * them in that order and the `[accounts]` policy is keyed on the result.
 */
export function hydrate(txn: V2Transaction, lookups: Lookups): LmTransaction {
  const category =
    txn.category_id === null ? null : (lookups.categories.get(txn.category_id) ?? null)
  const plaid =
    txn.plaid_account_id === null ? null : (lookups.plaid.get(txn.plaid_account_id) ?? null)
  const manual =
    txn.manual_account_id === null ? null : (lookups.manual.get(txn.manual_account_id) ?? null)
  const account = plaid ? nameOf(plaid) : manual ? nameOf(manual) : null

  return {
    id: txn.id,
    date: txn.date,
    amount: txn.amount,
    currency: txn.currency,
    payee: txn.payee,
    original_name: txn.original_name,
    category_name: category?.name ?? null,
    notes: txn.notes,
    is_income: category?.is_income ?? false,
    exclude_from_totals: category?.exclude_from_totals ?? false,
    is_pending: txn.is_pending,
    status: txn.status,
    account_display_name: account,
    plaid_account_display_name: plaid ? nameOf(plaid) : null,
    asset_display_name: manual ? nameOf(manual) : null,
    institution_name: plaid?.institution_name ?? manual?.institution_name ?? null,
    tags: txn.tag_ids
      .map((id) => lookups.tags.get(id))
      .filter((tag): tag is LmTag => tag !== undefined),
    // `details.ts` parses a string, as v1 sent one. Re-serialising here keeps
    // the wire format's business inside this file.
    plaid_metadata: txn.plaid_metadata ? JSON.stringify(txn.plaid_metadata) : null,
  }
}

export function hydrateRecurring(item: V2RecurringItem, lookups: Lookups): LmRecurringItem {
  const { transaction_criteria: criteria, overrides, matches } = item
  const category =
    overrides.category_id === null || overrides.category_id === undefined
      ? null
      : (lookups.categories.get(overrides.category_id) ?? null)
  const expected = matches?.expected_occurrence_dates ?? []
  const plaid =
    criteria.plaid_account_id === null
      ? null
      : (lookups.plaid.get(criteria.plaid_account_id) ?? null)
  const manual =
    criteria.manual_account_id === null
      ? null
      : (lookups.manual.get(criteria.manual_account_id) ?? null)

  return {
    id: item.id,
    payee: overrides.payee ?? criteria.payee,
    description: item.description,
    amount: criteria.amount,
    currency: criteria.currency,
    cadence: cadenceLabel(criteria.granularity, criteria.quantity, expected.length),
    granularity: criteria.granularity,
    quantity: criteria.quantity,
    expected_dates: expected,
    expected_range: matches
      ? { start: matches.request_start_date, end: matches.request_end_date }
      : null,
    billing_date: expected[0] ?? null,
    category_id: overrides.category_id ?? null,
    is_income: category?.is_income ?? false,
    plaid_account_id: criteria.plaid_account_id,
    asset_id: criteria.manual_account_id,
    account_name: plaid ? nameOf(plaid) : manual ? nameOf(manual) : null,
    transactions_within_range: (matches?.found_transactions ?? []).map((t) => ({
      id: t.transaction_id,
      date: t.date,
    })),
    missing_dates_within_range: matches?.missing_transaction_dates ?? [],
  }
}

/**
 * A cadence in words, for the budget table to print.
 *
 * v2 sends no such string, and nothing computes with this one — `perMonth()`
 * reads `granularity`, `quantity` and `expected_dates` instead. It exists
 * because "every 2 weeks" is easier to read in a table than "week × 2".
 */
export function cadenceLabel(
  granularity: string | null,
  quantity: number | null,
  occurrences = 0
): string {
  const n = quantity && quantity > 0 ? quantity : 1
  // The one case the machine-readable pair cannot express: twice a month
  // arrives as (month, 1), and only the expected dates give it away.
  if (granularity === "month" && n === 1 && occurrences > 1) return "twice a month"
  const unit = granularity ?? "month"
  if (n === 1)
    return (
      { day: "daily", week: "once a week", month: "monthly", year: "yearly" }[unit] ?? "monthly"
    )
  return `every ${n} ${unit}s`
}
