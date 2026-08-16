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
  /** Display name of the owning account, e.g. "Card". */
  account_display_name: string | null
  plaid_account_display_name: string | null
  asset_display_name: string | null
  institution_name: string | null
  tags: LmTag[]
  /** Plaid's raw payload as a JSON string. See details.ts. */
  plaid_metadata?: string | null
}

export interface LmPlaidAccount {
  id: number
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
  balance_last_update: string
  /** When transactions were last imported from Plaid. */
  last_import: string | null
  /** When Lunch Money last asked Plaid for anything. */
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
  /** "monthly", "twice a month", "every 3 months", "once a week", "yearly"... */
  cadence: string | null
  /** "month" | "week" | "year" — with `quantity`, the machine-readable cadence. */
  granularity: string | null
  quantity: number | null
  /** Next expected billing date in the queried range, YYYY-MM-DD. */
  billing_date: string | null
  category_id: number | null
  is_income: boolean
  /** Set when the item belongs to a linked (Plaid) account. */
  plaid_account_id: number | null
  /** Set instead when it belongs to a manually-managed account. */
  asset_id: number | null
  transactions_within_range: { id: number; date: string }[] | null
  missing_dates_within_range: string[] | null
}

export interface LunchMoneyClient {
  transactions(start: string, end: string): Promise<LmTransaction[]>
  recurringItems(start: string, end: string): Promise<LmRecurringItem[]>
  plaidAccounts(): Promise<LmPlaidAccount[]>
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
