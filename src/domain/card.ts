/**
 * What the credit card is going to cost, split into "already committed" and
 * "still accruing".
 *
 * This is a different question from the allowance: the bill includes recurring
 * and irregular charges too, so it ignores the tag buckets entirely and sums
 * everything on the card except payments.
 *
 * Cycles are bucketed by *posted* date, not the Lunch Money date. Lunch Money
 * reports Plaid's authorized date — when the card was swiped — and Chase bills
 * on the date the charge posts, one or two days later. Using the posted date
 * matches the statement exactly: the 06/13-07/12 cycle sums to $4,200.00
 * against a statement reading Purchases $4,200.00, and the cycle before it
 * matches that statement's Previous Balance. Using the Lunch Money date is off
 * by a few hundred dollars a month.
 */

import { postedDate } from "../lunchmoney/details"
import type { LmTransaction } from "../lunchmoney/types"
import { accountNameOf } from "../lunchmoney/types"
import type { IsoDate } from "./dates"
import { isCardPayment } from "./policy"

/** The card whose statement cycle drives the summary boxes. */
export const STATEMENT_ACCOUNT = "Card"

export interface CycleTotal {
  charges: number
  credits: number
  net: number
  count: number
}

const EMPTY: CycleTotal = { charges: 0, credits: 0, net: 0, count: 0 }

/**
 * The statement bills everything actually charged. Lunch Money's exclude flag
 * and category are not consulted — a $196 hotel deposit is on the bill whether
 * or not it got filed as a transfer — so only payments are taken out.
 */
export function isCardCharge(txn: LmTransaction, account: string = STATEMENT_ACCOUNT): boolean {
  if (accountNameOf(txn) !== account) return false
  return !isCardPayment(txn)
}

export function cycleTotal(
  txns: LmTransaction[],
  start: IsoDate,
  end: IsoDate,
  account: string = STATEMENT_ACCOUNT
): CycleTotal {
  const total = { ...EMPTY }
  for (const txn of txns) {
    const posted = postedDate(txn)
    if (posted < start || posted > end) continue
    if (!isCardCharge(txn, account)) continue
    const amount = Number.parseFloat(txn.amount)
    if (amount > 0) total.charges += amount
    else total.credits += amount
    total.net += amount
    total.count += 1
  }
  return total
}

/**
 * The gap between what Chase says is owed and what the transactions add up to.
 *
 * Not shown on the dashboard — with posted-date bucketing the statement figure
 * is exact, and the residual is just activity Plaid has not imported yet, which
 * the sync line already explains in terms a person can act on. Kept because a
 * gap that grows month over month would mean something is genuinely missing.
 */
export function reconciliation(reported: number, reconstructed: number) {
  return { reported, reconstructed, delta: reported - reconstructed }
}
