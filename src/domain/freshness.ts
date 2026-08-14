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
  /** Newest transaction import across accounts. */
  transactionsAt: Date | null
  /** Newest balance read across accounts. */
  balancesAt: Date | null
  /** When Lunch Money last asked Plaid for anything. */
  lastFetchAt: Date | null
  /** Whole minutes since the last fetch, or null if never. */
  minutesSinceFetch: number | null
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
  now: Date = new Date()
): Freshness {
  const transactionsAt = newest(accounts.map((a) => a.last_import))
  const balancesAt = newest(accounts.map((a) => a.balance_last_update))
  const lastFetchAt = newest(accounts.map((a) => a.last_fetch))
  const minutesSinceFetch =
    lastFetchAt === null ? null : Math.floor((now.getTime() - lastFetchAt.getTime()) / 60_000)

  return {
    transactionsAt,
    balancesAt,
    lastFetchAt,
    minutesSinceFetch,
    shouldRefresh: minutesSinceFetch === null || minutesSinceFetch >= refreshAfterMinutes,
  }
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
