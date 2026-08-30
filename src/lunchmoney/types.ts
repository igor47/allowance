/** The subset of the Lunch Money API we actually use. */

export interface LmTag {
  id: number
  name: string
  description: string | null
  archived: boolean
}

export interface LmTransaction {
  id: number
  /** YYYY-MM-DD */
  date: string
  /** Stringified decimal. Positive is an outflow. */
  amount: string
  currency: string
  payee: string | null
  original_name: string | null
  category_name: string | null
  notes: string | null
  is_income: boolean
  exclude_from_totals: boolean
  is_pending: boolean
  status: string
  /** Display name of the owning account — the key `[accounts]` matches on. */
  account_display_name: string | null
  plaid_account_display_name: string | null
  asset_display_name: string | null
  institution_name: string | null
  tags: LmTag[]
  /** Plaid's raw payload as a JSON string. See details.ts. */
  plaid_metadata?: string | null
}

/**
 * An account and its balance, whether Lunch Money feeds it from Plaid or a
 * person keeps it by hand.
 *
 * The two arrive from different endpoints and the manual one carries fewer
 * fields, but the dashboard asks both the same questions — what is the
 * balance, what kind of account is it, when was that last true — so they are
 * one shape here. `source` says which, and is what the freshness clock reads:
 * a manual account is never polled, so it has no import or fetch times.
 */
export interface LmAccount {
  id: number
  source: "plaid" | "manual"
  name: string
  display_name: string | null
  type: string
  subtype: string | null
  mask: string
  institution_name: string
  status: string
  limit: number | null
  balance: string
  to_base: number
  currency: string
  /** When the balance was last read; `balance_as_of` for a manual account. */
  balance_last_update: string
  /** When transactions were last imported from Plaid. Null for a manual account. */
  last_import: string | null
  /** When Lunch Money last asked Plaid for anything. Null for a manual account. */
  last_fetch: string | null
  plaid_last_successful_update: string | null
}

/**
 * A repeating commitment or income stream, as Lunch Money models it.
 *
 * These exist independently of any transaction: an item on a manually-managed
 * account will never have one linked, which is not an error — it is a
 * subscription on a card Lunch Money cannot see, and the plan is all we get.
 */
export interface LmRecurringItem {
  id: number
  payee: string | null
  description: string | null
  /** Stringified decimal. Positive is an outflow, as with transactions. */
  amount: string
  currency: string
  /**
   * "monthly", "twice a month", "every 3 months"... **For display only.**
   *
   * v2 does not send this; the client renders it from `granularity` and
   * `quantity`. Nothing may compute with it — v1's habit of pattern-matching
   * the string is what `expected_dates` now replaces.
   */
  cadence: string | null
  /** "day" | "week" | "month" | "year" — with `quantity`, the cadence. */
  granularity: string | null
  quantity: number | null
  /**
   * Every date in the queried range a charge is expected on.
   *
   * The only thing that separates a twice-monthly item from a monthly one:
   * both report `granularity` "month" and `quantity` 1, and only this says the
   * charge lands twice. Empty when the range holds no occurrence, which is the
   * ordinary state of a yearly bill in eleven months out of twelve.
   */
  expected_dates: string[]
  /**
   * The range `expected_dates` was computed over.
   *
   * Load-bearing: a count of occurrences means nothing without the window it
   * was counted in. Asked for the first three weeks of a month, a twice-monthly
   * item reports one date and looks exactly like a monthly one — which silently
   * halves a fortnightly salary. `perMonth()` refuses a partial range for
   * precisely that reason.
   */
  expected_range: { start: string; end: string } | null
  /** Next expected billing date in the queried range, YYYY-MM-DD. */
  billing_date: string | null
  category_id: number | null
  is_income: boolean
  /** Set when the item belongs to a linked (Plaid) account. */
  plaid_account_id: number | null
  /** Set instead when it belongs to a manually-managed account. */
  asset_id: number | null
  /**
   * Display name of whichever account it belongs to, resolved the same way
   * `accountNameOf()` resolves a transaction's, so it can be looked up in the
   * config's `[accounts]`. Null when the item names no account at all.
   */
  account_name: string | null
  transactions_within_range: { id: number; date: string }[] | null
  missing_dates_within_range: string[] | null
}

export interface LunchMoneyClient {
  transactions(start: string, end: string): Promise<LmTransaction[]>
  recurringItems(start: string, end: string): Promise<LmRecurringItem[]>
  /** Every account with a balance — linked and manual alike. */
  accounts(): Promise<LmAccount[]>
  tags(): Promise<LmTag[]>
  setTags(transactionId: number, tags: string[]): Promise<void>
  /** Queue a background pull from Plaid. Asynchronous; results arrive later. */
  triggerFetch(): Promise<void>
}

/** Account display name, resolved consistently across plaid and manual assets. */
export function accountNameOf(txn: LmTransaction): string {
  return (
    txn.account_display_name ??
    txn.plaid_account_display_name ??
    txn.asset_display_name ??
    "(unknown account)"
  )
}
