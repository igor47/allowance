import { describe, expect, test } from "bun:test"
import type { LmTransaction } from "../lunchmoney/types"
import { CARD, CHECKING, TEST_CATEGORIES } from "../test/accounts"
import {
  type AutopayOptions,
  aCharge,
  anAutopayDebit,
  anAutopay as anAutopayRow,
  aRefund,
} from "../test/world"
import { cycleTotal as cycleTotalOn, type ReconcileOptions, reconcile as reconcileOn } from "./card"
import type { Cycle } from "./cycle"
import { cycleView } from "./cycle"
import type { IsoDate } from "./dates"
import { findTransfers } from "./policy"

/**
 * Every statement in this file is the suite's card, so it is bound once here
 * rather than being the last argument of thirty calls.
 *
 * `transfers` is threaded from the transactions themselves, exactly as the
 * dashboard does it — which is what lets the autopay be recognised by its
 * partner on the bank account rather than by what it was categorised as.
 */
const cycleTotal = (txns: LmTransaction[], start: IsoDate, end: IsoDate) =>
  cycleTotalOn(txns, start, end, CARD, TEST_CATEGORIES, findTransfers(txns, TEST_CATEGORIES))
const reconcile = (
  txns: LmTransaction[],
  cycle: Cycle,
  options: Omit<ReconcileOptions, "account" | "categories" | "transfers"> = {}
) =>
  reconcileOn(txns, cycle, {
    ...options,
    account: CARD,
    categories: TEST_CATEGORIES,
    transfers: findTransfers(txns, TEST_CATEGORIES),
  })

/**
 * The autopay, categorised as a payment.
 *
 * The default fixture is not: on the card, Lunch Money files its own credit as
 * a transfer, and only the bank debit gets "Credit card payment". These tests
 * are about the statement *arithmetic*, so they state which row is the payment
 * and leave the question of recognising it to the tests that are about that —
 * `an autopay is recognised by its partner when its category does not say so`,
 * below, and the paired case in policy.test.ts.
 */
const anAutopay = (options: AutopayOptions) =>
  anAutopayRow({ category: "Credit card payment", ...options })

/**
 * The bug a smoke run found and the suite did not.
 *
 * When the payee regexes became categories, the card's own autopay credit
 * stopped being recognised: Lunch Money files that row as a transfer and only
 * the *bank* debit gets "Credit card payment". So the credit was no longer
 * excluded from the cycle, and netted itself out of the bill — a real month
 * showed $705 against a five-figure reported balance, and the reconciliation
 * reported "not yet paid" for a statement settled three weeks earlier.
 *
 * The suite missed it because the fixture had been given the tidy category.
 * It now carries what the feed actually sends, and this is the test that says
 * the partner is what identifies the row.
 */
describe("an autopay is recognised by its partner when its category does not say so", () => {
  const CYCLE = cycleView("2026-08-20", 12, 9).lastClosed

  /** As the feed reports it: card leg a transfer, bank leg the payment. */
  const legs = [
    aCharge({ on: "2026-07-20", amount: 1000 }),
    anAutopayRow({ on: "2026-08-09", amount: 4000 }),
    anAutopayDebit({ on: "2026-08-09", amount: 4000 }),
  ]

  test("the payment is left out of the bill rather than netted against it", () => {
    expect(cycleTotal(legs, CYCLE.start, CYCLE.end).charges).toBe(1000)
    expect(cycleTotal(legs, CYCLE.start, CYCLE.end).net).toBe(1000)
  })

  test("and reconciliation finds it, rather than reporting it unpaid", () => {
    const settled = cycleView("2026-08-20", 12, 9).settled
    // settled is 06-13..07-12, and its autopay runs on the 9th of the month
    // after it closes.
    const paid = [
      aCharge({ on: "2026-06-20", amount: 4000 }),
      anAutopayRow({ on: "2026-08-09", amount: 4000 }),
      anAutopayDebit({ on: "2026-08-09", amount: 4000 }),
    ]
    const result = reconcile(paid, settled)
    expect(result.paid).toBe(4000)
    expect(result.agrees).toBe(true)
  })

  test("with no partner and no category, it is not recognised — what the rule prevents", () => {
    const alone = [
      aCharge({ on: "2026-07-20", amount: 1000 }),
      anAutopayRow({ on: "2026-08-09", amount: 4000 }),
    ]
    expect(cycleTotal(alone, CYCLE.start, CYCLE.end).credits).toBe(-4000)
  })
})

describe("cycle totals", () => {
  test("sums charges and credits on the statement card only", () => {
    const total = cycleTotal(
      [
        aCharge({ on: "2026-08-01", amount: 100 }),
        aRefund({ on: "2026-08-02", amount: 25 }),
        aCharge({ on: "2026-08-02", amount: 50, account: CHECKING }),
      ],
      "2026-08-01",
      "2026-08-12"
    )
    expect(total).toEqual({ charges: 100, credits: -25, net: 75, count: 2 })
  })

  test("the bill includes recurring and irregular charges", () => {
    // Unlike the allowance, the statement does not care about tags.
    const total = cycleTotal(
      [aCharge({ on: "2026-08-01", amount: 675, tags: ["recurring"] })],
      "2026-08-01",
      "2026-08-12"
    )
    expect(total.net).toBe(675)
  })

  test("a charge Lunch Money excluded is still on the bill", () => {
    // The bank billed the hotel deposit whether or not Lunch Money filed it as
    // a transfer, so the statement total has to include it.
    const total = cycleTotal(
      [
        aCharge({
          on: "2026-08-03",
          amount: 196.15,
          payee: "A Hotel",
          category: "🔄 Payment, Transfer",
          excluded: true,
        }),
      ],
      "2026-07-13",
      "2026-08-12"
    )
    expect(total.charges).toBeCloseTo(196.15, 2)
  })

  test("the autopay is not part of the next bill", () => {
    const total = cycleTotal(
      [anAutopay({ on: "2026-08-09", amount: 4000 })],
      "2026-08-01",
      "2026-08-12"
    )
    expect(total).toEqual({ charges: 0, credits: 0, net: 0, count: 0 })
  })

  test("a charge is billed in the cycle it posts to, not the one it is made in", () => {
    // Swiped on the close date, posted the day after: the issuer puts it on the
    // following statement.
    const late = aCharge({ on: "2026-07-12", amount: 100, posted: "2026-07-13" })
    expect(cycleTotal([late], "2026-06-13", "2026-07-12").charges).toBe(0)
    expect(cycleTotal([late], "2026-07-13", "2026-08-12").charges).toBe(100)
  })
})

/**
 * The app checking its own arithmetic against the issuer.
 *
 * Every scenario here is one statement and the autopay that settled it, which
 * is the whole of the invariant: what we say was billed, plus whatever credit
 * landed before the debit ran, is what left the account.
 */
describe("reconciling against the autopay", () => {
  const CLOSE = 12
  const DUE = 9
  /** The statement before last — the only one whose payment has run. */
  const settled = cycleView("2026-08-14", CLOSE, DUE).settled

  test("the settled cycle is the one before the closed one", () => {
    expect(settled).toEqual({ start: "2026-06-13", end: "2026-07-12", due: "2026-08-09" })
  })

  test("a statement paid in full reconciles to zero", () => {
    const result = reconcile(
      [
        aCharge({ on: "2026-06-20", amount: 400 }),
        aCharge({ on: "2026-07-01", amount: 600 }),
        anAutopay({ on: "2026-08-09", amount: 1000 }),
      ],
      settled
    )
    expect(result.billed).toBe(1000)
    expect(result.paid).toBe(1000)
    expect(result.paidOn).toBe("2026-08-09")
    expect(result.delta).toBe(0)
    expect(result.agrees).toBe(true)
  })

  test("a credit landing before the debit explains the smaller payment", () => {
    // The real case, and the reason this is not simply `net`: a refund posted
    // after the statement closed reduces the autopay by exactly its amount,
    // while leaving the statement's own Purchases figure untouched.
    const result = reconcile(
      [
        aCharge({ on: "2026-07-01", amount: 1000 }),
        aRefund({ on: "2026-07-20", amount: 195 }),
        anAutopay({ on: "2026-08-09", amount: 805 }),
      ],
      settled
    )
    expect(result.billed).toBe(1000)
    expect(result.creditsAfterClose).toBe(-195)
    expect(result.expected).toBe(805)
    expect(result.agrees).toBe(true)
  })

  test("a credit inside the cycle is already in the bill, and is not counted twice", () => {
    // The issuer nets a credit posted before the close out of that statement's own
    // balance, so it must not also be subtracted from the payment.
    const result = reconcile(
      [
        aCharge({ on: "2026-07-01", amount: 1000 }),
        aRefund({ on: "2026-07-05", amount: 200 }),
        anAutopay({ on: "2026-08-09", amount: 1000 }),
      ],
      settled
    )
    expect(result.creditsAfterClose).toBe(0)
    expect(result.agrees).toBe(true)
  })

  test("a credit landing after the debit cannot have reduced it", () => {
    const result = reconcile(
      [
        aCharge({ on: "2026-07-01", amount: 1000 }),
        aRefund({ on: "2026-08-10", amount: 195 }),
        anAutopay({ on: "2026-08-09", amount: 1000 }),
      ],
      settled
    )
    expect(result.creditsAfterClose).toBe(0)
    expect(result.agrees).toBe(true)
  })

  test("a balance carried is reported as the difference it is", () => {
    // Not an error: it says the assumption that made this checkable — that the
    // statement is paid in full — no longer holds.
    const result = reconcile(
      [aCharge({ on: "2026-07-01", amount: 1000 }), anAutopay({ on: "2026-08-09", amount: 600 })],
      settled
    )
    expect(result.delta).toBe(400)
    expect(result.agrees).toBe(false)
  })

  test("a charge we missed shows up as a shortfall", () => {
    // The failure this exists to catch: the reconstruction is too low, so the
    // debit is larger than what we say was billed.
    const result = reconcile(
      [aCharge({ on: "2026-07-01", amount: 700 }), anAutopay({ on: "2026-08-09", amount: 1000 })],
      settled
    )
    expect(result.delta).toBe(-300)
    expect(result.agrees).toBe(false)
  })

  test("bucketing by the wrong date is exactly what this catches", () => {
    // A charge swiped before the close but posted after it belongs to the next
    // statement. Counting it in this one would overstate the bill, and the
    // autopay says so.
    const result = reconcile(
      [
        aCharge({ on: "2026-07-01", amount: 900 }),
        aCharge({ on: "2026-07-12", amount: 100, posted: "2026-07-14" }),
        anAutopay({ on: "2026-08-09", amount: 900 }),
      ],
      settled
    )
    expect(result.billed).toBe(900)
    expect(result.agrees).toBe(true)
  })

  test("a statement older than the data we hold is not checked at all", () => {
    // Browsing back to the edge of the linked history: the payment is in the
    // window but the charges it settled are not, and calling that a five-figure
    // discrepancy would be the one false alarm this must never raise.
    const result = reconcile([anAutopay({ on: "2026-08-09", amount: 4000 })], settled, {
      windowStart: "2026-06-08",
    })
    expect(result.checkable).toBe(false)
    expect(result.agrees).toBe(true)
  })

  test("a window that does reach back is checked as normal", () => {
    const result = reconcile(
      [
        aCharge({ on: "2026-06-10", amount: 50 }),
        aCharge({ on: "2026-07-01", amount: 950 }),
      ].concat(anAutopay({ on: "2026-08-09", amount: 950 })),
      settled,
      { windowStart: "2026-06-08" }
    )
    // The 6/10 charge predates the cycle, so the history demonstrably reaches
    // back past its start; only the 7/1 charge is on this statement.
    expect(result.checkable).toBe(true)
    expect(result.billed).toBe(950)
    expect(result.agrees).toBe(true)
  })

  test("a rounding residue is not a discrepancy", () => {
    // Summing hundreds of decimals leaves a residue that formatted as "-$0",
    // which reads as a difference where there is none.
    const result = reconcile(
      [
        aCharge({ on: "2026-07-01", amount: 0.1 }),
        aCharge({ on: "2026-07-02", amount: 0.2 }),
        anAutopay({ on: "2026-08-09", amount: 0.3 }),
      ],
      settled
    )
    expect(result.delta).toBe(0)
    expect(Object.is(result.delta, -0)).toBe(false)
    expect(result.agrees).toBe(true)
  })

  test("nothing to compare until the payment lands", () => {
    const result = reconcile([aCharge({ on: "2026-07-01", amount: 1000 })], settled)
    expect(result.paid).toBeNull()
    expect(result.delta).toBeNull()
    // Silent rather than alarming: an unpaid statement is not a discrepancy.
    expect(result.agrees).toBe(true)
  })

  test("a payment a day early still counts, since the due date can fall on a weekend", () => {
    const result = reconcile(
      [aCharge({ on: "2026-07-01", amount: 1000 }), anAutopay({ on: "2026-08-08", amount: 1000 })],
      settled
    )
    expect(result.paidOn).toBe("2026-08-08")
    expect(result.agrees).toBe(true)
  })

  test("the next cycle's payment is not mistaken for this one's", () => {
    // Payments are a month apart and the window is under a week, so the debit
    // that settles the *following* statement must stay out of this sum.
    const result = reconcile(
      [
        aCharge({ on: "2026-07-01", amount: 1000 }),
        anAutopay({ on: "2026-08-09", amount: 1000 }),
        anAutopay({ on: "2026-09-09", amount: 4000 }),
      ],
      settled
    )
    expect(result.paid).toBe(1000)
    expect(result.agrees).toBe(true)
  })

  test("the bank side of the autopay is not counted as a second payment", () => {
    // It lands on a different account, so it never reaches the card's sum —
    // but it is in the data, and double-counting it would halve the delta.
    const result = reconcile(
      [
        aCharge({ on: "2026-07-01", amount: 1000 }),
        anAutopay({ on: "2026-08-09", amount: 1000 }),
        anAutopayDebit({ on: "2026-08-09", amount: 1000, from: CHECKING }),
      ],
      settled
    )
    expect(result.paid).toBe(1000)
    expect(result.agrees).toBe(true)
  })
})
