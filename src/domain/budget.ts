/**
 * The plan: what is committed before anyone decides anything.
 *
 * Lunch Money's recurring items are the source. They are expectations, not
 * transactions — an item exists whether or not a charge ever matches it, which
 * is the point: the subscriptions on the manually-managed card produce no
 * transactions at all, and without the plan that money is invisible. Their only
 * trace in the data is the autopay that settles the card, and that is excluded
 * as a transfer, correctly, so it cannot stand in for them.
 *
 * Pure, like the rest of this directory: (items, today) in, view out.
 */

import type { LmRecurringItem } from "../lunchmoney/types"
import { endOfMonth, type IsoDate, startOfMonth } from "./dates"

export type CommitmentState =
  /** A transaction is linked for this period. */
  | "matched"
  /** Expected later this period; nothing has arrived yet, and nothing is wrong. */
  | "upcoming"
  /** The expected date has passed with nothing linked — worth a look. */
  | "overdue"
  /** On an account with no transaction feed. It will never match, by construction. */
  | "untracked"

export interface Commitment {
  id: number
  payee: string
  description: string | null
  /** Per-occurrence amount, positive for an outflow. */
  amount: number
  /** The same amount normalised to one month, for totals. */
  monthly: number
  cadence: string
  state: CommitmentState
  /** Expected dates in this period with nothing linked. */
  missing: IsoDate[]
  matched: number
  tracked: boolean
}

export interface BudgetView {
  periodStart: IsoDate
  periodEnd: IsoDate
  days: number
  income: Commitment[]
  commitments: Commitment[]
  totals: {
    /** Expected income for the month. */
    income: number
    /** Everything committed before any discretionary decision. */
    committed: number
    /** Committed on accounts with no feed — real money, invisible in transactions. */
    untracked: number
    /** income − committed. What is left to spend day to day. */
    pool: number
    /** The pool spread across the month. */
    dailyTarget: number
  }
}

const WEEKS_PER_MONTH = 52 / 12

/**
 * Lunch Money returns payees HTML-escaped — "PG&amp;E", "Serena&#x27;s Gym" —
 * and JSX escapes again on the way out, so the entity would reach the screen
 * verbatim. Decoded here rather than in the component: it is a property of
 * their data, not of how we render it.
 */
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

export function decodeEntities(text: string): string {
  return (
    text
      // Numeric first, and both bases: &#x2F; and &#39; both turn up in their
      // data, so enumerating named entities alone leaves slashes on screen.
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
      // Ampersand last, so "&amp;#x2F;" cannot decode twice into a stray slash.
      .replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => NAMED[name] ?? name)
  )
}

/**
 * Occurrences per month.
 *
 * `cadence` leads because `granularity`+`quantity` cannot express "twice a
 * month" — it arrives as (month, 1), identical to plain monthly, and counting
 * a fortnightly salary once would halve the household's income.
 */
export function perMonth(item: LmRecurringItem): number {
  const cadence = (item.cadence ?? "").toLowerCase().trim()
  if (cadence === "twice a month") return 2
  if (cadence === "twice a year") return 2 / 12

  const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1
  switch (item.granularity) {
    case "week":
      return WEEKS_PER_MONTH / quantity
    case "year":
      return 1 / (12 * quantity)
    default:
      return 1 / quantity
  }
}

export function stateOf(item: LmRecurringItem, today: IsoDate): CommitmentState {
  // No plaid account means a manually-managed one: no feed, so nothing can ever
  // link. Reporting that as overdue would cry wolf every day of every month.
  if (!item.plaid_account_id) return "untracked"
  if ((item.transactions_within_range ?? []).length > 0) return "matched"
  const missing = item.missing_dates_within_range ?? []
  return missing.some((d) => d <= today) ? "overdue" : "upcoming"
}

function commitmentOf(item: LmRecurringItem, today: IsoDate): Commitment {
  const amount = Math.abs(Number.parseFloat(item.amount))
  return {
    id: item.id,
    payee: decodeEntities(item.payee?.trim() || item.description?.trim() || "unnamed"),
    description: item.description ? decodeEntities(item.description) : null,
    amount,
    monthly: amount * perMonth(item),
    cadence: item.cadence ?? "monthly",
    state: stateOf(item, today),
    missing: item.missing_dates_within_range ?? [],
    matched: (item.transactions_within_range ?? []).length,
    tracked: !!item.plaid_account_id,
  }
}

const byMonthly = (a: Commitment, b: Commitment) => b.monthly - a.monthly

export function budgetView(items: LmRecurringItem[], today: IsoDate): BudgetView {
  const periodStart = startOfMonth(today)
  const periodEnd = endOfMonth(today)
  const days = Number.parseInt(periodEnd.slice(8), 10)

  const all = items.map((item) => commitmentOf(item, today))
  const income = all.filter((_, i) => items[i]?.is_income).sort(byMonthly)
  const commitments = all.filter((_, i) => !items[i]?.is_income).sort(byMonthly)

  const sum = (rows: Commitment[]) => rows.reduce((total, r) => total + r.monthly, 0)
  const incomeTotal = sum(income)
  const committed = sum(commitments)
  const pool = incomeTotal - committed

  return {
    periodStart,
    periodEnd,
    days,
    income,
    commitments,
    totals: {
      income: incomeTotal,
      committed,
      untracked: sum(commitments.filter((c) => !c.tracked)),
      pool,
      dailyTarget: pool / days,
    },
  }
}
