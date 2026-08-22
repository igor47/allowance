/**
 * The v2 wire shapes — only the fields this app reads.
 *
 * These exist so that exactly one file knows what Lunch Money sends. Everything
 * downstream speaks `LmTransaction` and friends from `types.ts`, which are the
 * app's own shapes and did not change when the API did.
 *
 * The headline of v2 is that the transaction object is **de-hydrated**: the
 * fields the domain branches on — category name, income, exclude-from-totals,
 * the account's display name, the tags — are no longer on the transaction. It
 * carries ids instead, and the client joins them back locally. See `client.ts`.
 *
 * Spec: `@lunch-money/v2-api-spec`, v2.11.0. The v2 API is in open alpha and is
 * documented as still subject to change, so this file is the blast radius.
 */

export interface V2Transaction {
  id: number
  /** YYYY-MM-DD */
  date: string
  /** Stringified decimal, 4dp. Positive is a debit — unchanged from v1. */
  amount: string
  currency: string
  to_base: number
  payee: string | null
  original_name: string | null
  notes: string | null
  status: string
  is_pending: boolean
  /** Resolved against `/categories`, which carries the flags the domain reads. */
  category_id: number | null
  plaid_account_id: number | null
  /** v1's `asset_id`: an account Lunch Money has no feed for. */
  manual_account_id: number | null
  /** v1 sent whole tag objects; v2 sends ids. */
  tag_ids: number[]
  /**
   * An object here, where v1 sent a JSON string, and present only when
   * `include_metadata=true` is asked for.
   */
  plaid_metadata?: Record<string, unknown> | null
  recurring_id: number | null
  is_group_parent?: boolean
  group_parent_id?: number | null
}

export interface V2Category {
  id: number
  name: string
  /** Moved here from the transaction. */
  is_income: boolean
  /** Likewise — and the domain deliberately overrides it in places. */
  exclude_from_totals: boolean
}

export interface V2Tag {
  id: number
  name: string
  description: string | null
  archived: boolean
}

export interface V2PlaidAccount {
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
  currency: string
  to_base: number
  balance_last_update: string | null
  last_import: string | null
  last_fetch: string | null
  plaid_last_successful_update: string | null
}

/** An account with no feed. v1 called these assets. */
export interface V2ManualAccount {
  id: number
  name: string
  display_name: string | null
  institution_name: string | null
  type: string
}

/**
 * A recurring item, restructured beyond recognition from v1.
 *
 * The flat `payee`/`amount`/`cadence`/`granularity` shape is gone; what was one
 * object is now three. Two consequences matter:
 *
 * - **`cadence` no longer exists.** v1's free-text cadence was the only thing
 *   that could say "twice a month", because `granularity`+`quantity` reports
 *   that as (month, 1) — identical to plain monthly.
 * - **`expected_occurrence_dates` replaces it, and is better.** Lunch Money now
 *   computes the dates a charge is expected on within the queried range, so the
 *   fortnightly salary is two dates rather than a string to pattern-match. It
 *   is information v1 never provided: v1's found + missing does *not* add up to
 *   the occurrence count, and reads 1 for that same salary.
 */
export interface V2RecurringItem {
  id: number
  description: string | null
  /** `suggested` items are Lunch Money's guesses rather than the user's plan. */
  status: string
  transaction_criteria: {
    granularity: string | null
    quantity: number | null
    anchor_date: string | null
    payee: string | null
    amount: string
    currency: string
    plaid_account_id: number | null
    manual_account_id: number | null
  }
  overrides: {
    payee?: string | null
    notes?: string | null
    /** Where `is_income` now lives, one hop away. */
    category_id?: number | null
  }
  matches: {
    /** The range the expectations were computed over — see `expected_range`. */
    request_start_date: string
    request_end_date: string
    /** Every date a charge is expected on, inside that range. */
    expected_occurrence_dates: string[]
    found_transactions: { date: string; transaction_id: number }[]
    missing_transaction_dates: string[]
  } | null
}
