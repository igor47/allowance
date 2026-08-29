/**
 * How stale the data is, and whether to do anything about it.
 *
 * Lunch Money pulls from Plaid on its own schedule — in practice transactions
 * land roughly once a day, while balances refresh more often. `POST
 * /plaid_accounts/fetch` queues an extra pull; their docs allow one a minute
 * but ask for restraint, so this decides when it is actually worth asking.
 */

import type { LmPlaidAccount } from "../lunchmoney/types"

export interface Freshness {
  /**
   * When new transactions were last *imported*.
   *
   * This only moves when Plaid actually had something new to hand over. A
   * refresh that finds nothing leaves it untouched, which is why it can sit at
   * "18h ago" while balances update — balances are re-read every time, whereas
   * an import needs a bank to have posted something.
   */
  transactionsAt: Date | null
  /** Date of the newest transaction held, which is what people actually mean. */
  newestTransaction: string | null
  /** Newest balance read across accounts. */
  balancesAt: Date | null
  /** When Lunch Money last asked Plaid for anything. */
  lastFetchAt: Date | null
  /** Whole minutes since the last fetch, or null if never. */
  minutesSinceFetch: number | null
  /** Whole minutes since new transactions last arrived, or null if never. */
  minutesSinceImport: number | null
  /** Worth queueing another pull. */
  shouldRefresh: boolean
}

const newest = (values: (string | null | undefined)[]): Date | null => {
  const dates = values
    .filter((v): v is string => !!v)
    .map((v) => new Date(v))
    .filter((d) => !Number.isNaN(d.getTime()))
  if (dates.length === 0) return null
  return dates.reduce((a, b) => (a > b ? a : b))
}

export function freshness(
  accounts: LmPlaidAccount[],
  refreshAfterMinutes: number,
  newestTransaction: string | null = null,
  now: Date = new Date()
): Freshness {
  const transactionsAt = newest(accounts.map((a) => a.last_import))
  const balancesAt = newest(accounts.map((a) => a.balance_last_update))
  const lastFetchAt = newest(accounts.map((a) => a.last_fetch))
  const since = (then: Date | null) =>
    then === null ? null : Math.floor((now.getTime() - then.getTime()) / 60_000)
  const minutesSinceFetch = since(lastFetchAt)

  return {
    transactionsAt,
    newestTransaction,
    balancesAt,
    lastFetchAt,
    minutesSinceFetch,
    minutesSinceImport: since(transactionsAt),
    shouldRefresh: minutesSinceFetch === null || minutesSinceFetch >= refreshAfterMinutes,
  }
}

/**
 * Three states, because a clock face in a navbar can only say so much.
 *
 * Keyed on when data last *arrived*, not when Lunch Money last asked. Imports
 * are webhook-driven — Lunch Money pulls when Plaid says there is something to
 * pull — so an old `last_fetch` describes a quiet bank rather than a broken
 * sync, and a clock keyed on it would show red through every quiet weekend.
 *
 * The thresholds are in days because that is the unit the banks work in: one
 * day is normal, three is a long weekend, more than that and something is
 * wrong. It is also independent of which month is on screen, which the newest
 * transaction *in view* is not.
 */
export type Staleness = "fresh" | "aging" | "stale"

const AGING_AFTER_MINUTES = 24 * 60
const STALE_AFTER_MINUTES = 72 * 60

export function staleness(f: Freshness): Staleness {
  if (f.minutesSinceImport === null) return "stale"
  if (f.minutesSinceImport < AGING_AFTER_MINUTES) return "fresh"
  return f.minutesSinceImport < STALE_AFTER_MINUTES ? "aging" : "stale"
}

/** "19h ago", "4m ago" — precision nobody needs is precision nobody reads. */
export function ago(then: Date | null, now: Date = new Date()): string {
  if (!then) return "never"
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
