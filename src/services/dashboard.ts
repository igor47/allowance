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
import { unknownAccounts } from "../domain/policy"
import type { Cache } from "../lunchmoney/cache"
import type { LmPlaidAccount, LunchMoneyClient } from "../lunchmoney/types"

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
}

/** Chase posts a charge up to four days after it is authorized. */
const POSTING_SLACK_DAYS = 5

export class DashboardService {
  constructor(
    private readonly client: LunchMoneyClient,
    private readonly config: Config,
    private readonly cache: Cache
  ) {}

  /**
   * Writes go straight through to Lunch Money, then drop the transaction
   * cache so the next render reflects them. Account balances are left alone —
   * tagging cannot change them, and their fetch is the slower of the two.
   */
  async setTags(transactionId: number, tags: string[]): Promise<void> {
    await this.client.setTags(transactionId, tags)
    this.cache.invalidate("txns:")
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
      needsReview: inPeriod.filter(
        (c) => !c.classification.reviewed && c.classification.bucket !== "excluded"
      ).length,
      unknownAccounts: unknownAccounts(transactions),
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

/** Filters offered in the transaction feed. */
export const FILTERS = ["review", "all", "spending", "fixed", "igor", "serena"] as const
export type Filter = (typeof FILTERS)[number]

export function isFilter(value: string | undefined): value is Filter {
  return !!value && (FILTERS as readonly string[]).includes(value)
}

export function applyFilter(
  transactions: ClassifiedTransaction[],
  filter: Filter
): ClassifiedTransaction[] {
  switch (filter) {
    case "review":
      return transactions.filter(
        (c) => !c.classification.reviewed && c.classification.bucket !== "excluded"
      )
    case "spending":
      return transactions.filter((c) => c.classification.counts)
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
