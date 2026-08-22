/**
 * The four API shapes, built from as little as a test wants to say.
 *
 * Everything here is invented: round amounts, made-up payees, and account names
 * taken from `ACCOUNT_POLICY`, which is production configuration rather than
 * anything private. A test that needs a real-looking descriptor writes one.
 *
 * These are the raw shapes. `world.ts` sits on top and speaks in verbs —
 * charges, refunds, deposits — which is what scenarios should use.
 */

import { CHASE } from "../domain/policy"
import type { LmPlaidAccount, LmRecurringItem, LmTag, LmTransaction } from "../lunchmoney/types"

let nextId = 1

/** Ids are unique within a run but say nothing; never assert on one. */
export function anId(): number {
  return nextId++
}

export function tag(name: string): LmTag {
  return { id: anId(), name, description: null, archived: false }
}

export interface MetadataOptions {
  /** The date Chase posted it, which is what statement cycles bucket on. */
  posted?: string
  authorized?: string
  /** The descriptor as it appears on the statement. */
  raw?: string
  merchant?: string
  mcc?: string
  /** "in store", "online", "other". */
  channel?: string
  city?: string
  region?: string
  website?: string
  logo?: string
  /** Plaid's own taxonomy, SHOUTING_SNAKE as it arrives. */
  plaidCategory?: string
}

/**
 * `plaid_metadata`, which arrives as a JSON string rather than an object.
 *
 * Hand-writing the `JSON.stringify` is the single most common piece of
 * ceremony in a statement-cycle test, so it lives here instead.
 */
export function metadata(options: MetadataOptions): string {
  const md: Record<string, unknown> = {}
  if (options.posted) md.date = options.posted
  if (options.authorized) md.authorized_date = options.authorized
  if (options.raw) md.name = options.raw
  if (options.merchant) md.merchant_name = options.merchant
  if (options.mcc) md.merchant_category_code = options.mcc
  if (options.channel) md.payment_channel = options.channel
  if (options.website) md.website = options.website
  if (options.logo) md.logo_url = options.logo
  if (options.city || options.region) {
    md.location = { city: options.city ?? null, region: options.region ?? null }
  }
  if (options.plaidCategory) md.personal_finance_category = { detailed: options.plaidCategory }
  return JSON.stringify(md)
}

/** Tags may be given as plain strings; the factory promotes them. */
export type TxnOverrides = Partial<Omit<LmTransaction, "tags">> & { tags?: (string | LmTag)[] }

export function txn(overrides: TxnOverrides = {}): LmTransaction {
  const tags = (overrides.tags ?? []).map((t) => (typeof t === "string" ? tag(t) : t))
  return {
    id: anId(),
    date: "2026-08-05",
    amount: "25.00",
    currency: "usd",
    payee: "A Grocer",
    original_name: "A GROCER #1234",
    category_name: "Groceries",
    notes: null,
    is_income: false,
    exclude_from_totals: false,
    is_pending: false,
    status: "cleared",
    account_display_name: CHASE,
    plaid_account_display_name: CHASE,
    asset_display_name: null,
    institution_name: "A Bank",
    ...overrides,
    tags,
  }
}

/**
 * A linked account, as `plaid_accounts` returns it.
 *
 * The three timestamps are what `freshness.ts` reads, and they default to a
 * coherent recent past rather than to null, so a scenario that does not care
 * about staleness does not have to say anything about it.
 */
export function account(overrides: Partial<LmPlaidAccount> = {}): LmPlaidAccount {
  return {
    id: anId(),
    name: "CREDIT CARD",
    display_name: CHASE,
    type: "credit",
    subtype: "credit card",
    mask: "0000",
    institution_name: "A Bank",
    status: "active",
    limit: null,
    balance: "0",
    to_base: 0,
    currency: "usd",
    balance_last_update: "2026-08-14T20:00:00.000Z",
    last_import: "2026-08-14T04:00:00.000Z",
    last_fetch: "2026-08-14T20:00:00.000Z",
    plaid_last_successful_update: "2026-08-14T20:00:00.000Z",
    ...overrides,
  }
}

/**
 * A recurring item — a plan, not a transaction.
 *
 * `plaid_account_id` is set by default, because an item without one is the
 * special "untracked" case rather than the ordinary one.
 */
export function recurringItem(overrides: Partial<LmRecurringItem> = {}): LmRecurringItem {
  return {
    id: anId(),
    payee: "A Subscription",
    description: null,
    amount: "10.0000",
    currency: "usd",
    cadence: "monthly",
    granularity: "month",
    quantity: 1,
    expected_dates: ["2026-08-10"],
    expected_range: { start: "2026-08-01", end: "2026-08-31" },
    billing_date: "2026-08-10",
    category_id: null,
    is_income: false,
    plaid_account_id: 1,
    asset_id: null,
    transactions_within_range: [],
    missing_dates_within_range: [],
    ...overrides,
  }
}
