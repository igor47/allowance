/**
 * What the credit card is going to cost, split into "already committed" and
 * "still accruing".
 *
 * This is a different question from the allowance: the bill includes recurring
 * and irregular charges too. So it ignores the tag buckets entirely and sums
 * everything on the card except payments.
 */

import type { LmTransaction } from "../lunchmoney/types"
import { accountNameOf } from "../lunchmoney/types"
import type { IsoDate } from "./dates"
import { looksLikeSettlement } from "./policy"

/** The card whose statement cycle drives the summary boxes. */
export const STATEMENT_ACCOUNT = "Card"

export interface CycleTotal {
  charges: number
  credits: number
  net: number
  count: number
}

const EMPTY: CycleTotal = { charges: 0, credits: 0, net: 0, count: 0 }

export function isCardCharge(txn: LmTransaction, account: string = STATEMENT_ACCOUNT): boolean {
  if (accountNameOf(txn) !== account) return false
  if (txn.exclude_from_totals) return false
  return !looksLikeSettlement(txn)
}

export function cycleTotal(
  txns: LmTransaction[],
  start: IsoDate,
  end: IsoDate,
  account: string = STATEMENT_ACCOUNT
): CycleTotal {
  const total = { ...EMPTY }
  for (const txn of txns) {
    if (txn.date < start || txn.date > end) continue
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
 * How far the reconstructed balance is from what the bank reports.
 *
 * The two do not currently agree — the cycle sums are a few hundred dollars off
 * the payments, and the Plaid balance is off the reconstruction by more. Rather
 * than quietly pick one, both are shown with the gap between them, so drift is
 * visible the day it appears instead of being discovered in a statement.
 */
export function reconciliation(reported: number, reconstructed: number) {
  return { reported, reconstructed, delta: reported - reconstructed }
}
