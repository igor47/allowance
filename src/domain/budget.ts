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
import type { Accounts } from "./policy"

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
  /** Every date this period a charge is expected on. */
  expected: IsoDate[]
  /**
   * What actually lands in this period — `amount` times the occurrences
   * expected in it, which is a different question from `monthly`.
   *
   * A yearly bill is a twelfth of itself in `monthly` every month, and its
   * whole self here in the one month it is due. Null when the expectations
   * were computed over a range that does not cover the period, because then
   * the count means nothing. See `perMonth`.
   */
  dueThisPeriod: number | null
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
    /** Everything committed before any discretionary decision, amortised. */
    committed: number
    /**
     * What is actually due in this period, rather than the steady rate.
     *
     * The two answer different questions and both are worth having: the daily
     * target should not lurch because an annual bill happens to land this
     * month, but "can we afford this month" wants the real figure. Null when
     * any commitment's expectations could not be trusted for the period.
     */
    committedThisPeriod: number | null
    /** Committed on accounts with no feed — real money, invisible in transactions. */
    untracked: number
    /** income − committed. What is left to spend day to day. */
    pool: number
    /** The pool spread across the month. */
    dailyTarget: number
  }
}

const WEEKS_PER_MONTH = 52 / 12
const DAYS_PER_MONTH = 365 / 12

/**
 * Lunch Money returns payees HTML-escaped — "PG&amp;E", "Sam&#x27;s Gym" —
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
 * Two sources, and the larger wins.
 *
 * `granularity` and `quantity` give the *amortised* rate, which is what totals
 * want: a yearly bill is a twelfth of itself every month, not its whole self in
 * one month and nothing in the other eleven. That is the floor.
 *
 * `expected_dates` gives what Lunch Money actually expects inside the queried
 * range, and it is the only thing that can say "twice a month" — that arrives
 * as (month, 1), indistinguishable from plain monthly, and counting a
 * fortnightly salary once would halve the household's income. It used to be
 * read off v1's free-text `cadence` string; v2 removed the string and added
 * the dates, which are better because they are computed rather than matched.
 *
 * The observed count is consulted only for items that fire at least monthly,
 * and only when it is the larger. That is exactly where `granularity` can be
 * wrong and never where amortising matters: a weekly item predicts 4.33 and
 * observes 4 or 5 by the month, so it stays at 4.33; the fortnightly salary
 * predicts 1, observes 2, and is counted twice.
 *
 * Anything rarer than monthly is always amortised, whatever the range holds.
 * Letting a yearly bill count in full in the month it lands *and* a twelfth in
 * the other eleven would bill it 1.9 times over the year, and would drop the
 * daily target through the floor in one month for no change in the plan.
 *
 * A count of occurrences means nothing without the window it was counted in,
 * so the observed count is used only when `expected_range` covers the whole
 * period being totalled. Asked for three weeks of a month, a twice-monthly item
 * reports one date and is indistinguishable from a monthly one — which halves a
 * fortnightly salary, silently, and did exactly that the first time this rule
 * met a real query. A partial range falls back to the amortised rate, which is
 * wrong in a small and predictable direction rather than a large invisible one.
 */
export function perMonth(item: LmRecurringItem, period?: { start: IsoDate; end: IsoDate }): number {
  const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1
  let amortised: number
  switch (item.granularity) {
    case "day":
      amortised = DAYS_PER_MONTH / quantity
      break
    case "week":
      amortised = WEEKS_PER_MONTH / quantity
      break
    case "year":
      amortised = 1 / (12 * quantity)
      break
    default:
      amortised = 1 / quantity
  }
  if (amortised < 1) return amortised
  if (!covers(item.expected_range, period)) return amortised
  return Math.max(amortised, item.expected_dates?.length ?? 0)
}

/**
 * Whether the expectations were computed over at least the period being
 * totalled. No period asked for means the caller is stating one implicitly —
 * which is what a unit test does, and what `budgetView` never does.
 */
function covers(
  range: LmRecurringItem["expected_range"],
  period?: { start: IsoDate; end: IsoDate }
): boolean {
  if (!period) return true
  if (!range) return false
  return range.start <= period.start && range.end >= period.end
}

/**
 * Will a transaction ever be linked to this item?
 *
 * For a linked account, yes: Plaid delivers the charge and Lunch Money
 * matches it. For a manual account the answer is not in the data — a card
 * kept by hand and never reconciled produces no transactions at all, while a
 * checking account someone enters every payment into produces all of them,
 * and the API describes both identically.
 *
 * So the config decides. A manual account listed under `[accounts]` as
 * `spending` or `fixed` is one the household says it records against, and
 * its items can be expected to match; one that is `ignore`d or not listed is
 * not. Before this the rule was "no Plaid, no tracking", which reported every
 * item of an all-manual household as untracked and its entire plan as
 * invisible money.
 */
export function isTracked(item: LmRecurringItem, accounts: Accounts): boolean {
  if (item.plaid_account_id !== null) return true
  if (item.account_name === null) return false
  const policy = accounts[item.account_name]?.policy
  return policy !== undefined && policy !== "ignore"
}

export function stateOf(
  item: LmRecurringItem,
  today: IsoDate,
  accounts: Accounts = {}
): CommitmentState {
  // Reporting an item that can never link as overdue would cry wolf every day
  // of every month.
  if (!isTracked(item, accounts)) return "untracked"
  if ((item.transactions_within_range ?? []).length > 0) return "matched"
  const missing = item.missing_dates_within_range ?? []
  return missing.some((d) => d <= today) ? "overdue" : "upcoming"
}

function commitmentOf(
  item: LmRecurringItem,
  today: IsoDate,
  period: { start: IsoDate; end: IsoDate },
  accounts: Accounts
): Commitment {
  const amount = Math.abs(Number.parseFloat(item.amount))
  return {
    id: item.id,
    payee: decodeEntities(item.payee?.trim() || item.description?.trim() || "unnamed"),
    description: item.description ? decodeEntities(item.description) : null,
    amount,
    monthly: amount * perMonth(item, period),
    cadence: item.cadence ?? "monthly",
    state: stateOf(item, today, accounts),
    missing: item.missing_dates_within_range ?? [],
    expected: item.expected_dates ?? [],
    dueThisPeriod: covers(item.expected_range, period)
      ? amount * (item.expected_dates?.length ?? 0)
      : null,
    matched: (item.transactions_within_range ?? []).length,
    tracked: isTracked(item, accounts),
  }
}

const byMonthly = (a: Commitment, b: Commitment) => b.monthly - a.monthly

export function budgetView(
  items: LmRecurringItem[],
  today: IsoDate,
  accounts: Accounts = {}
): BudgetView {
  const periodStart = startOfMonth(today)
  const periodEnd = endOfMonth(today)
  const days = Number.parseInt(periodEnd.slice(8), 10)

  const all = items.map((item) =>
    commitmentOf(item, today, { start: periodStart, end: periodEnd }, accounts)
  )
  const income = all.filter((_, i) => items[i]?.is_income).sort(byMonthly)
  const commitments = all.filter((_, i) => !items[i]?.is_income).sort(byMonthly)

  const sum = (rows: Commitment[]) => rows.reduce((total, r) => total + r.monthly, 0)
  const incomeTotal = sum(income)
  const committed = sum(commitments)
  const pool = incomeTotal - committed
  // One untrustworthy row makes the whole total untrustworthy; a partial sum
  // presented as a whole one is worse than not showing it.
  const committedThisPeriod = commitments.some((c) => c.dueThisPeriod === null)
    ? null
    : commitments.reduce((total, c) => total + (c.dueThisPeriod ?? 0), 0)

  return {
    periodStart,
    periodEnd,
    days,
    income,
    commitments,
    totals: {
      income: incomeTotal,
      committed,
      committedThisPeriod,
      untracked: sum(commitments.filter((c) => !c.tracked)),
      pool,
      dailyTarget: pool / days,
    },
  }
}
