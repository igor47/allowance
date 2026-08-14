/** Plain YYYY-MM-DD arithmetic. Lunch Money speaks calendar dates, not instants. */

import { DateTime } from "luxon"

export type IsoDate = string

export function parse(date: IsoDate): DateTime {
  const dt = DateTime.fromISO(date, { zone: "utc" })
  if (!dt.isValid) throw new Error(`invalid date: ${date}`)
  return dt
}

export function format(dt: DateTime): IsoDate {
  return dt.toISODate() as IsoDate
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return format(parse(date).plus({ days }))
}

/** Inclusive count: daysBetween("2026-08-01", "2026-08-01") === 1 */
export function daysBetween(start: IsoDate, end: IsoDate): number {
  return Math.floor(parse(end).diff(parse(start), "days").days) + 1
}

export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

/** Today in the display timezone, as a calendar date. */
export function today(timezone: string, now?: DateTime): IsoDate {
  return format((now ?? DateTime.now()).setZone(timezone))
}
