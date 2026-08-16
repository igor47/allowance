/**
 * The rolling daily allowance.
 *
 * Each day adds the target and subtracts what was spent. Unspent money banks
 * up to a cap so a frugal stretch cannot fund one blowout; overspend carries
 * forward in full and uncapped, because a floor would make the number stop
 * meaning anything.
 */

import type { AllowanceConfig } from "../config"
import type { LmTransaction } from "../lunchmoney/types"
import { daysBetween, eachDay, endOfMonth, type IsoDate, startOfMonth } from "./dates"
import { type Classification, classify } from "./policy"

export interface DayRow {
  date: IsoDate
  spent: number
  /** Balance at end of day, after the cap is applied. */
  balance: number
}

/**
 * The period is the calendar month containing `today`, so the balance starts
 * from zero on the 1st: surplus is not banked across the boundary and a bad
 * month is not carried into the next one.
 *
 * `config.periodStart` is a floor, not the start — it is the date the app began
 * to have an opinion, and it only bites in the first month, when the month
 * began before there was any data.
 */
export function periodStartFor(config: AllowanceConfig, today: IsoDate): IsoDate {
  const monthStart = startOfMonth(today)
  return monthStart > config.periodStart ? monthStart : config.periodStart
}

export interface AllowanceResult {
  periodStart: IsoDate
  /** Last day of the period — in the future for all but the final day. */
  periodEnd: IsoDate
  today: IsoDate
  days: number
  dailyTarget: number
  /** dailyTarget * days */
  budget: number
  spent: number
  /** What is actually available today. */
  balance: number
  /** The rollover ceiling. */
  cap: number
  /** Banked money lost to the cap over the period. Surfaced, never silent. */
  forfeited: number
  rows: DayRow[]
}

export interface ClassifiedTransaction {
  txn: LmTransaction
  classification: Classification
}

export function classifyAll(txns: LmTransaction[]): ClassifiedTransaction[] {
  return txns.map((txn) => ({ txn, classification: classify(txn) }))
}

export function computeAllowance(
  classified: ClassifiedTransaction[],
  config: AllowanceConfig,
  today: IsoDate
): AllowanceResult {
  const { dailyTarget, rolloverCapDays } = config
  const periodStart = periodStartFor(config, today)
  const periodEnd = endOfMonth(today)
  const cap = dailyTarget * rolloverCapDays

  const spentByDay = new Map<IsoDate, number>()
  let spent = 0
  for (const { txn, classification } of classified) {
    if (!classification.counts) continue
    if (txn.date < periodStart || txn.date > today) continue
    spentByDay.set(txn.date, (spentByDay.get(txn.date) ?? 0) + classification.amount)
    spent += classification.amount
  }

  const rows: DayRow[] = []
  let balance = 0
  let forfeited = 0
  for (const date of eachDay(periodStart, today)) {
    const daySpent = spentByDay.get(date) ?? 0
    balance += dailyTarget - daySpent
    if (balance > cap) {
      forfeited += balance - cap
      balance = cap
    }
    rows.push({ date, spent: daySpent, balance })
  }

  const days = daysBetween(periodStart, today)
  return {
    periodStart,
    periodEnd,
    today,
    days,
    dailyTarget,
    budget: dailyTarget * days,
    spent,
    balance,
    cap,
    forfeited,
    rows,
  }
}
