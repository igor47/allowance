/** Assembles everything the dashboard renders, from two API calls. */

import type { Config } from "../config"
import {
  type AllowanceResult,
  type ClassifiedTransaction,
  classifyAll,
  computeAllowance,
} from "../domain/allowance"
import { type CycleTotal, cycleTotal, reconciliation, STATEMENT_ACCOUNT } from "../domain/card"
import { type Cycle, cycleView } from "../domain/cycle"
import { addDays, type IsoDate } from "../domain/dates"
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
  reconciliation: ReturnType<typeof reconciliation> | null
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
}

/** Chase posts a charge up to four days after it is authorized. */
const POSTING_SLACK_DAYS = 5

export class DashboardService {
  private lastTriggerAt = 0

  constructor(
    private readonly client: LunchMoneyClient,
    private readonly config: Config,
    private readonly cache: Cache
  ) {}

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

    // One fetch covering both the budgeting period and the open statement.
    //
    // The API filters on the Lunch Money date — Plaid's *authorized* date —
    // while statement cycles are bucketed by the posted date, which lags by up
    // to four days. Without the slack, a charge swiped just before a cycle
    // opened but posted just after it is missing from the statement total,
    // which understated the August bill by $303.
    const earliest =
      allowance.periodStart < cycles.lastClosed.start
        ? allowance.periodStart
        : cycles.lastClosed.start
    const start = addDays(earliest, -POSTING_SLACK_DAYS)
    const { transactions, accounts } = await this.load(start, today)

    const classified = classifyAll(transactions)
    const inPeriod = classified
      .filter((c) => c.txn.date >= allowance.periodStart && c.txn.date <= today)
      .sort((a, b) =>
        a.txn.date === b.txn.date ? b.txn.id - a.txn.id : b.txn.date.localeCompare(a.txn.date)
      )

    const lastClosedTotal = cycleTotal(transactions, cycles.lastClosed.start, cycles.lastClosed.end)
    const currentTotal = cycleTotal(transactions, cycles.current.start, cycles.current.end)
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
        reconciliation:
          reported === null
            ? null
            : reconciliation(reported, lastClosedTotal.net + currentTotal.net),
      },
      transactions: inPeriod,
      // Deposits are taggable but not review items — payroll arriving twice a
      // month is not a question anyone needs asked. They live under "credits".
      needsReview: inPeriod.filter(
        (c) =>
          !c.classification.reviewed &&
          c.classification.taggable &&
          c.classification.bucket !== "deposit"
      ).length,
      unknownAccounts: unknownAccounts(transactions),
      freshness: freshness(
        accounts,
        this.config.refreshAfterMinutes,
        transactions.reduce<string | null>(
          (max, t) => (max === null || t.date > max ? t.date : max),
          null
        )
      ),
    }
  }

  /**
   * Ask Lunch Money to pull from Plaid, if it has not lately.
   *
   * Their API allows one fetch a minute but asks for restraint, so this is
   * gated twice: on the accounts' own last_fetch, and on an in-process
   * cooldown so two people loading the page at once queue one job, not two.
   * The pull is a background job on their side - nothing is fresher when this
   * returns, it is the *next* load that benefits.
   */
  async maybeRefresh(current: Freshness, force = false): Promise<boolean> {
    if (!force && !current.shouldRefresh) return false
    const now = Date.now()
    if (now - this.lastTriggerAt < this.config.refreshAfterMinutes * 60_000) return false
    this.lastTriggerAt = now
    try {
      await this.client.triggerFetch()
      this.cache.clear()
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
export const FILTERS = ["review", "spending", "credits", "all", "fixed", "igor", "serena"] as const
export type Filter = (typeof FILTERS)[number]

export function isFilter(value: string | undefined): value is Filter {
  return !!value && (FILTERS as readonly string[]).includes(value)
}

/**
 * Worth a human's attention.
 *
 * Deposits are taggable but not review items — payroll arriving twice a month
 * is not a question anyone needs asked. They live under "credits", where a work
 * reimbursement can be found when one turns up.
 */
export function needsReview(entry: ClassifiedTransaction): boolean {
  const { reviewed, taggable, bucket } = entry.classification
  return !reviewed && taggable && bucket !== "deposit"
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
    if (entry.classification.bucket === "excluded") continue
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
    case "credits":
      return transactions.filter((c) => c.classification.taggable && c.classification.amount < 0)
    case "fixed":
      return transactions.filter((c) =>
        ["recurring", "irregular", "assumed-fixed"].includes(c.classification.bucket)
      )
    case "igor":
    case "serena":
      return transactions.filter((c) => c.txn.tags.some((t) => t.name.toLowerCase() === filter))
    default:
      return transactions
  }
}
