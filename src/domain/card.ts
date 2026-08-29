/**
 * What the credit card is going to cost, split into "already committed" and
 * "still accruing".
 *
 * This is a different question from the allowance: the bill includes recurring
 * and irregular charges too, so it ignores the tag buckets entirely and sums
 * everything on the card except payments.
 *
 * Cycles are bucketed by *posted* date, not the Lunch Money date. Lunch Money
 * reports Plaid's authorized date — when the card was swiped — and the issuer
 * bills on the date the charge posts, one or two days later. Using the posted
 * date matches the statement exactly, and `reconcile()` below re-checks that
 * against the issuer every month. Using the Lunch Money date is off by a few
 * hundred dollars a month.
 *
 * Which account is the card is configuration: every function here takes the
 * display name, and `statementAccount()` in `policy.ts` is where it comes from.
 */

import { postedDate } from "../lunchmoney/details"
import type { LmTransaction } from "../lunchmoney/types"
import { accountNameOf } from "../lunchmoney/types"
import type { Cycle } from "./cycle"
import { addDays, type IsoDate } from "./dates"
import { isCardPayment } from "./policy"

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
export function isCardCharge(txn: LmTransaction, account: string): boolean {
  if (accountNameOf(txn) !== account) return false
  return !isCardPayment(txn)
}

export function cycleTotal(
  txns: LmTransaction[],
  start: IsoDate,
  end: IsoDate,
  account: string
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
 * Checking the reconstruction against the issuer, every month, forever.
 *
 * `cycleTotal()` rebuilds a statement Lunch Money does not store, and until now
 * that reconstruction was validated once, by hand, against a downloaded PDF.
 * A number quietly wrong by a few hundred dollars is exactly the sort of thing
 * that goes unnoticed for months, so it is worth an oracle that is not us.
 *
 * The oracle is already in the data. Statements are paid in full, so the
 * autopay the issuer debits *is* the issuer stating what the statement came
 * to. Their own identity for a statement is
 *
 *     NewBalance = PreviousBalance − Payments − Credits + Purchases
 *
 * and when the previous balance clears, `NewBalance == Purchases`. The autopay
 * then pays that balance *as of the day it runs* — less any credit that landed
 * between the close and the debit. So:
 *
 *     purchases(cycle) + credits posted between the close and the payment
 *       == the payment that settled it
 *
 * Verified against two consecutive real statements, to the penny, including one
 * where a refund landed in the gap and reduced the debit by exactly its amount.
 *
 * Two honest limits. It only means anything while the balance is paid in full —
 * a partial payment carries no information about the bill's size — so a
 * mismatch is reported as information rather than as an error. And it lags a
 * cycle: this is a drift detector, not a live figure.
 */

/** A payment can post a day early when the due date falls on a weekend. */
const PAYMENT_SLACK_DAYS = 3

/** Floating-point sums of hundreds of decimals; agreement means to the cent. */
const A_CENT = 0.005

export interface Reconciliation {
  /**
   * Whether the comparison could be made at all.
   *
   * False when the data does not reach back far enough to reconstruct the
   * statement — browsing a month near the start of the linked history, where
   * the payment is visible but the charges it settled are not. Reporting that
   * as a five-figure discrepancy is the one failure this must never have.
   */
  checkable: boolean
  /** What we say the statement billed: the cycle's purchases. */
  billed: number
  /** Credits that landed after the close but before the payment ran. Negative. */
  creditsAfterClose: number
  /** What the autopay should therefore have been. */
  expected: number
  /** What actually left, positive. Null until the payment lands. */
  paid: number | null
  paidOn: IsoDate | null
  /** expected − paid. Zero while the reconstruction is right. */
  delta: number | null
  /** True when they agree to the cent, or when there is nothing to compare. */
  agrees: boolean
}

export interface ReconcileOptions {
  /** The card's display name. Required: there is no default card any more. */
  account: string
  /**
   * The earliest date the caller asked the API for.
   *
   * Given, the data is checked for actually reaching that far back. A window
   * that runs past the start of the linked history returns "not checkable"
   * rather than reporting the whole statement as missing — which is what a
   * past month near the edge of the history would otherwise do.
   */
  windowStart?: IsoDate
}

export function reconcile(
  txns: LmTransaction[],
  cycle: Cycle,
  options: ReconcileOptions
): Reconciliation {
  const { account } = options
  const onCard = txns.filter((t) => accountNameOf(t) === account)
  const billed = cycleTotal(txns, cycle.start, cycle.end, account).charges

  const unchecked = {
    checkable: false,
    billed,
    creditsAfterClose: 0,
    expected: billed,
    paid: null,
    paidOn: null,
    delta: null,
    agrees: true,
  }
  // Across every account there is something in any given few days, so the
  // oldest row we hold is a fair reading of how far the history actually goes.
  if (options.windowStart !== undefined) {
    const earliest = txns.reduce<string | null>(
      (min, t) => (min === null || t.date < min ? t.date : min),
      null
    )
    if (earliest === null || earliest > cycle.start) return unchecked
  }

  // The payment window opens the day after the close and runs a little past
  // the due date. It cannot catch a neighbouring cycle's payment: those are a
  // month apart and this window is under a week.
  const windowEnd = addDays(cycle.due, PAYMENT_SLACK_DAYS)
  const payments = onCard.filter((t) => {
    const posted = postedDate(t)
    return posted > cycle.end && posted <= windowEnd && isCardPayment(t)
  })

  // Not yet due, or not yet imported. Either way there is nothing to compare.
  if (payments.length === 0) return unchecked

  const paidOn = payments.map(postedDate).sort().at(-1) as IsoDate
  const paid = -payments.reduce((sum, t) => sum + Number.parseFloat(t.amount), 0)

  // Only credits that had actually landed by the time the debit ran: a refund
  // that posts the day after cannot have reduced it.
  const creditsAfterClose = onCard.reduce((sum, t) => {
    const posted = postedDate(t)
    if (posted <= cycle.end || posted > paidOn) return sum
    if (isCardPayment(t)) return sum
    const amount = Number.parseFloat(t.amount)
    return amount < 0 ? sum + amount : sum
  }, 0)

  const expected = billed + creditsAfterClose
  // Rounded to the cent, and past negative zero: summing hundreds of decimals
  // leaves a residue that formats as "-$0", which reads as a discrepancy.
  const delta = (Math.round((expected - paid) * 100) || 0) / 100
  return {
    checkable: true,
    billed,
    creditsAfterClose,
    expected,
    paid,
    paidOn,
    delta,
    agrees: Math.abs(delta) < A_CENT,
  }
}
