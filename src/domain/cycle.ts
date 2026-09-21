/**
 * Credit card statement cycles.
 *
 * A card closes on one day and its autopay debits a bank account on another,
 * weeks later — the 12th and the following 9th, say. That gives two numbers
 * worth showing separately: what is about to leave the checking account, and
 * what is quietly accruing toward the bill after it. Both come from the card's
 * `statement` block in `allowance.toml`.
 *
 * The due date is the fixed point, so a cycle is named here by the month it is
 * *due* in and its close is worked out from that. This file used to start from
 * a close day of the month and derive the due date, which cannot express an
 * issuer that closes a set number of days before the due date — see
 * `StatementConfig`.
 */

import type { DateTime } from "luxon"
import type { IsoDate } from "./dates"
import { addDays, parse } from "./dates"
import type { StatementConfig } from "./policy"

export interface Cycle {
  /** First day of the cycle, inclusive. */
  start: IsoDate
  /** Statement close date, inclusive. */
  end: IsoDate
  /** When the autopay debits for this statement. */
  due: IsoDate
}

export interface CycleView {
  /**
   * The statement before last: closed, due, and already paid.
   *
   * The only cycle the app can check its own arithmetic against, because it is
   * the only one the issuer has stated a figure for — the autopay that settled
   * it.
   * See `reconcile()` in card.ts.
   */
  settled: Cycle
  /** The statement that has closed but not yet been paid. */
  lastClosed: Cycle
  /** Charges since that close — this becomes next month's bill. */
  current: { start: IsoDate; end: IsoDate; closes: IsoDate }
}

function onDay(year: number, month: number, day: number): IsoDate {
  // Clamp for short months: a close day of 31 lands on Feb 28.
  const dt = parse(`${year}-${String(month).padStart(2, "0")}-01`)
  return dt.set({ day: Math.min(day, dt.daysInMonth ?? 28) }).toISODate() as IsoDate
}

/** The close of the statement due in `dueMonth`. */
function closeFor(dueMonth: DateTime, statement: StatementConfig): IsoDate {
  if ("closeDaysBeforeDue" in statement) {
    const due = onDay(dueMonth.year, dueMonth.month, statement.dueDay)
    return addDays(due, -statement.closeDaysBeforeDue)
  }
  const prior = dueMonth.minus({ months: 1 })
  return onDay(prior.year, prior.month, statement.closeDay)
}

/** The whole cycle due in `dueMonth`: it opens the day after the one before it closed. */
function cycleDueIn(dueMonth: DateTime, statement: StatementConfig): Cycle {
  return {
    start: addDays(closeFor(dueMonth.minus({ months: 1 }), statement), 1),
    end: closeFor(dueMonth, statement),
    due: onDay(dueMonth.year, dueMonth.month, statement.dueDay),
  }
}

/**
 * Far enough ahead that the statement due then cannot have closed yet, however
 * long the grace period: `closeDaysBeforeDue` is held to sixty days by the
 * config loader, and a fixed close day is always the month before its due date.
 */
const MONTHS_AHEAD = 3

export function cycleView(today: IsoDate, statement: StatementConfig): CycleView {
  // Walk back from the future to the most recent close on or before today.
  let dueMonth = parse(today).startOf("month").plus({ months: MONTHS_AHEAD })
  while (closeFor(dueMonth, statement) > today) dueMonth = dueMonth.minus({ months: 1 })

  const lastClosed = cycleDueIn(dueMonth, statement)
  return {
    settled: cycleDueIn(dueMonth.minus({ months: 1 }), statement),
    lastClosed,
    current: {
      start: addDays(lastClosed.end, 1),
      end: today,
      closes: closeFor(dueMonth.plus({ months: 1 }), statement),
    },
  }
}
