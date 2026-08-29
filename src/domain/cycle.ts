/**
 * Credit card statement cycles.
 *
 * A card closes on one day of the month and its autopay debits a bank account
 * on another, the following month — the 12th and the 9th, say. That gives two
 * numbers worth showing separately: what is about to leave the checking
 * account, and what is quietly accruing toward the bill after it. Both days
 * come from the card's `statement` block in `allowance.toml`.
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

/** The whole cycle implied by the date it closes on. */
function cycleEndingAt(close: IsoDate, closeDay: number, dueDay: number): Cycle {
  const closeDt = parse(close)
  const prior = closeDt.minus({ months: 1 })
  const dueMonth = closeDt.plus({ months: 1 })
  return {
    start: addDays(onDay(prior.year, prior.month, closeDay), 1),
    end: close,
    due: onDay(dueMonth.year, dueMonth.month, dueDay),
  }
}

export function cycleView(today: IsoDate, closeDay: number, dueDay: number): CycleView {
  const now = parse(today)
  // The most recent close on or before today.
  let close = onDay(now.year, now.month, closeDay)
  if (close > today) {
    const prev = now.minus({ months: 1 })
    close = onDay(prev.year, prev.month, closeDay)
  }
  const lastClosed = cycleEndingAt(close, closeDay, dueDay)
  const settled = cycleEndingAt(addDays(lastClosed.start, -1), closeDay, dueDay)
  const next = parse(close).plus({ months: 1 })

  return {
    settled,
    lastClosed,
    current: {
      start: addDays(close, 1),
      end: today,
      closes: onDay(next.year, next.month, closeDay),
    },
  }
}
