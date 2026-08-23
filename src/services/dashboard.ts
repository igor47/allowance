/** Assembles everything the dashboard renders, from two API calls. */

import type { Config } from "../config"
import {
  type AllowanceResult,
  type ClassifiedTransaction,
  classifyAll,
  computeAllowance,
  periodStartFor,
} from "../domain/allowance"
import { type BudgetView, budgetView } from "../domain/budget"
import {
  type CycleTotal,
  cycleTotal,
  type Reconciliation,
  reconcile,
  STATEMENT_ACCOUNT,
} from "../domain/card"
import { type Cycle, cycleView } from "../domain/cycle"
import { addDays, endOfMonth, type IsoDate, startOfMonth } from "../domain/dates"
import { type Freshness, freshness } from "../domain/freshness"
import { unknownAccounts } from "../domain/policy"
import type { Cache } from "../lunchmoney/cache"
import type { LmPlaidAccount, LmTag, LmTransaction, LunchMoneyClient } from "../lunchmoney/types"

export interface CashAccount {
  name: string
  balance: number
  updatedAt: string
}

export interface CardView {
  account: string
  /** What the bank says is owed right now. */
  reported: number | null
  lastClosed: Cycle & { total: CycleTotal }
  current: { start: IsoDate; end: IsoDate; closes: IsoDate; total: CycleTotal }
  /** The statement before last, checked against the autopay that settled it. */
  settled: Cycle & { total: CycleTotal; reconciliation: Reconciliation }
}

export interface Dashboard {
  today: IsoDate
  allowance: AllowanceResult
  cash: { total: number; accounts: CashAccount[] }
  card: CardView
  /** In-period transactions, newest first. */
  transactions: ClassifiedTransaction[]
  needsReview: number
  unknownAccounts: string[]
  freshness: Freshness
  /** When we last read this from Lunch Money, as opposed to from memory. */
  readAt: Date | null
  /**
   * The instant this was built. Everything that renders an age measures against
   * it, so the clock badge and the times beneath it cannot disagree.
   */
  now: Date
}

/** Chase posts a charge up to four days after it is authorized. */
const POSTING_SLACK_DAYS = 5

export class DashboardService {
  private lastTriggerAt = 0

  constructor(
    private readonly client: LunchMoneyClient,
    private readonly config: Config,
    private readonly cache: Cache,
    /** Injected so tests do not depend on the wall clock. */
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * The plan for the month: recurring commitments and income.
   *
   * A separate read from the dashboard, and deliberately not folded into
   * `build`: the allowance page has no use for it, and recurring items are
   * configuration that changes a few times a year rather than hourly.
   */
  async budget(today: IsoDate): Promise<BudgetView> {
    const start = startOfMonth(today)
    const end = endOfMonth(today)
    const items = await this.cache.fetch(`recurring:${start}:${end}`, () =>
      this.client.recurringItems(start, end)
    )
    return budgetView(items, today)
  }

  /** Force the next build to re-read from the API. */
  invalidate(): void {
    this.cache.clear()
  }

  /**
   * Write through to Lunch Money, then patch the cached copy in place.
   *
   * Re-reading the whole window after every tag click cost an extra ~300ms
   * round trip and re-downloaded a thousand transactions to learn about one.
   * Patching keeps a click at a single API call. The patch is applied after
   * the write succeeds rather than before, so a failed write never leaves the
   * dashboard showing a tag that Lunch Money does not have.
   */
  async setTags(transactionId: number, tags: string[]): Promise<void> {
    await this.client.setTags(transactionId, tags)
    const applied: LmTag[] = tags.map((name, i) => ({
      id: -(i + 1),
      name,
      description: null,
      archived: false,
    }))
    this.cache.mutate<LmTransaction[]>("txns:", (txns) =>
      txns.map((t) => (t.id === transactionId ? { ...t, tags: applied } : t))
    )
  }

  private async load(start: IsoDate, end: IsoDate) {
    const [transactions, accounts] = await Promise.all([
      this.cache.fetch(`txns:${start}:${end}`, () => this.client.transactions(start, end)),
      this.cache.fetch("accounts", () => this.client.plaidAccounts()),
    ])
    return { transactions, accounts }
  }

  async build(today: IsoDate): Promise<Dashboard> {
    const { statementCloseDay, statementDueDay, allowance } = this.config
    const cycles = cycleView(today, statementCloseDay, statementDueDay)

    // One fetch covering the budgeting period, the open statement, and the one
    // before it — which is the only statement the autopay has settled, and so
    // the only one `reconcile()` can check the arithmetic against. That is one
    // extra month on a call that is cached anyway.
    //
    // The API filters on the Lunch Money date — Plaid's *authorized* date —
    // while statement cycles are bucketed by the posted date, which lags by up
    // to four days. Without the slack, a charge swiped just before a cycle
    // opened but posted just after it is missing from the statement total,
    // which understated a month's bill by a few hundred dollars.
    const periodStart = periodStartFor(allowance, today)
    const earliest = periodStart < cycles.settled.start ? periodStart : cycles.settled.start
    const start = addDays(earliest, -POSTING_SLACK_DAYS)
    const { transactions, accounts } = await this.load(start, today)

    const classified = classifyAll(transactions)
    const inPeriod = classified
      .filter((c) => c.txn.date >= periodStart && c.txn.date <= today)
      .sort((a, b) =>
        a.txn.date === b.txn.date ? b.txn.id - a.txn.id : b.txn.date.localeCompare(a.txn.date)
      )

    const lastClosedTotal = cycleTotal(transactions, cycles.lastClosed.start, cycles.lastClosed.end)
    const currentTotal = cycleTotal(transactions, cycles.current.start, cycles.current.end)
    const settledTotal = cycleTotal(transactions, cycles.settled.start, cycles.settled.end)
    const reported = balanceOf(accounts, STATEMENT_ACCOUNT)

    return {
      today,
      allowance: computeAllowance(classified, allowance, today),
      cash: cashAccounts(accounts),
      card: {
        account: STATEMENT_ACCOUNT,
        reported,
        lastClosed: { ...cycles.lastClosed, total: lastClosedTotal },
        current: { ...cycles.current, total: currentTotal },
        settled: {
          ...cycles.settled,
          total: settledTotal,
          reconciliation: reconcile(transactions, cycles.settled, { windowStart: start }),
        },
      },
      transactions: inPeriod,
      // Deposits are taggable but not review items — payroll arriving twice a
      // month is not a question anyone needs asked. They live under "deposits".
      needsReview: inPeriod.filter(needsReview).length,
      unknownAccounts: unknownAccounts(transactions),
      freshness: freshness(
        accounts,
        this.config.refreshAfterMinutes,
        transactions.reduce<string | null>(
          (max, t) => (max === null || t.date > max ? t.date : max),
          null
        ),
        this.now()
      ),
      now: this.now(),
      readAt: (() => {
        const at = this.cache.storedAt("txns:")
        return at === null ? null : new Date(at)
      })(),
    }
  }

  /**
   * Ask Lunch Money to pull from Plaid, if it has not lately.
   *
   * Their API allows one fetch a minute — sooner returns 425 — but asks for
   * restraint, so this is gated twice: on the accounts' own last_fetch, and on
   * an in-process cooldown so two people loading the page at once queue one
   * job, not two. The cooldown is deliberately far longer than the API's
   * minute: Plaid will not have anything new within it either.
   * The pull is a background job on their side - nothing is fresher when this
   * returns, it is the *next* load that benefits.
   */
  async maybeRefresh(current: Freshness, force = false): Promise<boolean> {
    if (!force && !current.shouldRefresh) return false
    const now = this.now().getTime()
    if (now - this.lastTriggerAt < this.config.refreshAfterMinutes * 60_000) return false
    this.lastTriggerAt = now
    try {
      await this.client.triggerFetch()
      // Deliberately no cache invalidation. The pull is a background job on
      // Lunch Money's side, so nothing is fresher yet — dropping the cache here
      // would only force the next page load to re-read identical data, and
      // because the trigger is fired without awaiting it, it also raced the
      // render. `/sync` is where a re-read belongs: it runs after the job has
      // had time to land and is explicitly asking whether anything arrived.
      return true
    } catch (error) {
      // A failed refresh must never take the dashboard down with it.
      console.error("plaid fetch trigger failed", error)
      return false
    }
  }
}

function balanceOf(accounts: LmPlaidAccount[], displayName: string): number | null {
  const account = accounts.find((a) => (a.display_name ?? a.name) === displayName)
  return account ? account.to_base : null
}

function cashAccounts(accounts: LmPlaidAccount[]): { total: number; accounts: CashAccount[] } {
  const cash = accounts
    .filter((a) => a.type === "cash")
    .map((a) => ({
      name: a.display_name ?? a.name,
      balance: a.to_base,
      updatedAt: a.balance_last_update,
    }))
  return { total: cash.reduce((sum, a) => sum + a.balance, 0), accounts: cash }
}

/** Filters offered in the transaction feed, in the order they are shown. */
export const FILTERS = ["review", "spending", "deposits", "all", "fixed", "igor", "serena"] as const
export type Filter = (typeof FILTERS)[number]

export function isFilter(value: string | undefined): value is Filter {
  return !!value && (FILTERS as readonly string[]).includes(value)
}

/**
 * Worth a human's attention.
 *
 * Deposits are taggable but not review items — payroll arriving twice a month
 * is not a question anyone needs asked. They live under "deposits", where a work
 * reimbursement can be found when one turns up.
 */
export function needsReview(entry: ClassifiedTransaction): boolean {
  const { reviewed, taggable, bucket } = entry.classification
  return !reviewed && taggable && bucket !== "deposit" && bucket !== "transfer"
}

export interface FilterSummary {
  count: number
  /** Everything in the filtered set. */
  total: number
  /** The part of it that draws down the allowance. */
  counting: number
}

export function summarise(entries: ClassifiedTransaction[]): FilterSummary {
  let total = 0
  let counting = 0
  for (const entry of entries) {
    const amount = entry.classification.amount
    if (entry.classification.bucket === "ignored") continue
    // A transfer is the same money seen twice; summing it would double it.
    if (entry.classification.bucket === "transfer") continue
    total += amount
    if (entry.classification.counts) counting += amount
  }
  return { count: entries.length, total, counting }
}

export function applyFilter(
  transactions: ClassifiedTransaction[],
  filter: Filter
): ClassifiedTransaction[] {
  switch (filter) {
    case "review":
      return transactions.filter(needsReview)
    case "spending":
      return transactions.filter((c) => c.classification.counts)
    // Money coming back: merchant refunds and bank deposits. This is where a
    // work expense reimbursement is found and tagged.
    case "deposits":
      // Transfers are taggable and often negative — the autopay's card leg, a
      // cashout landing — but they are not money coming back.
      return transactions.filter(
        (c) =>
          c.classification.taggable &&
          c.classification.amount < 0 &&
          c.classification.bucket !== "transfer"
      )
    case "fixed":
      return transactions.filter((c) =>
        ["recurring", "irregular", "unclassified", "transfer"].includes(c.classification.bucket)
      )
    case "igor":
    case "serena":
      return transactions.filter((c) => c.txn.tags.some((t) => t.name.toLowerCase() === filter))
    default:
      return transactions
  }
}
