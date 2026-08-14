/**
 * Credit card statement cycles.
 *
 * Card closes on the 12th and the autopay debits Fidelity on the 9th
 * of the following month. That gives two numbers worth showing separately: what
 * is about to leave the checking account, and what is quietly accruing toward
 * the bill after it.
 */

import type { IsoDate } from "./dates"
import { addDays, parse } from "./dates"

export interface Cycle {
  /** First day of the cycle, inclusive. */
  start: IsoDate
  /** Statement close date, inclusive. */
  end: IsoDate
  /** When the autopay debits for this statement. */
  due: IsoDate
}

export interface CycleView {
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

export function cycleView(today: IsoDate, closeDay: number, dueDay: number): CycleView {
  const now = parse(today)
  // The most recent close on or before today.
  let close = onDay(now.year, now.month, closeDay)
  if (close > today) {
    const prev = now.minus({ months: 1 })
    close = onDay(prev.year, prev.month, closeDay)
  }
  const closeDt = parse(close)
  const prior = closeDt.minus({ months: 1 })
  const priorClose = onDay(prior.year, prior.month, closeDay)
  const dueMonth = closeDt.plus({ months: 1 })

  const next = closeDt.plus({ months: 1 })
  return {
    lastClosed: {
      start: addDays(priorClose, 1),
      end: close,
      due: onDay(dueMonth.year, dueMonth.month, dueDay),
    },
    current: {
      start: addDays(close, 1),
      end: today,
      closes: onDay(next.year, next.month, closeDay),
    },
  }
}
