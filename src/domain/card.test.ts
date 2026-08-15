import { describe, expect, test } from "bun:test"
import { txn } from "../test/factories"
import { fixtureTransactions } from "../test/fixtures"
import { cycleTotal, reconciliation } from "./card"

describe("cycle totals", () => {
  test("sums charges and credits on the statement card only", () => {
    const total = cycleTotal(
      [
        txn({ date: "2026-08-01", amount: "100.00" }),
        txn({ date: "2026-08-02", amount: "-25.00" }),
        txn({ date: "2026-08-02", amount: "50.00", account_display_name: "Checking" }),
      ],
      "2026-08-01",
      "2026-08-12"
    )
    expect(total).toEqual({ charges: 100, credits: -25, net: 75, count: 2 })
  })

  test("the bill includes recurring and irregular charges", () => {
    // Unlike the allowance, the statement does not care about tags.
    const total = cycleTotal(
      [txn({ date: "2026-08-01", amount: "675.00", tags: ["recurring"] })],
      "2026-08-01",
      "2026-08-12"
    )
    expect(total.net).toBe(675)
  })

  test("a charge Lunch Money excluded is still on the bill", () => {
    // The bank billed the $196 hotel deposit whether or not Lunch Money filed
    // it as a transfer, so the statement total has to include it.
    const total = cycleTotal(
      [
        txn({
          date: "2026-08-03",
          amount: "196.15",
          payee: "COSMOPOL-ADV DEP",
          category_name: "🔄 Payment, Transfer",
          exclude_from_totals: true,
        }),
      ],
      "2026-07-13",
      "2026-08-12"
    )
    expect(total.charges).toBeCloseTo(196.15, 2)
  })

  test("the autopay is not part of the next bill", () => {
    const total = cycleTotal(
      [
        txn({
          date: "2026-08-09",
          amount: "-4200.00",
          payee: "AUTOMATIC PAYMENT - THANK",
          category_name: "Payment, Transfer",
        }),
      ],
      "2026-08-01",
      "2026-08-12"
    )
    expect(total).toEqual({ charges: 0, credits: 0, net: 0, count: 0 })
  })

  test("recorded data reproduces a real statement to the penny", () => {
    // statement.pdf:
    //   Opening/Closing Date  06/13/26 - 07/12/26
    //   Purchases                        $4,200.00
    // Chase bills on the posted date, so this only holds because cycleTotal
    // buckets by Plaid's posted date rather than the Lunch Money date. Bucketing
    // by the Lunch Money date gives $4,100.00 — off by $372.26.
    const cycle = cycleTotal(fixtureTransactions, "2026-06-13", "2026-07-12")
    expect(cycle.charges).toBeCloseTo(14_291.22, 2)
  })

  test("the cycle before it matches that statement's previous balance", () => {
    // Same statement, Previous Balance $5,000.00 — an independent check that
    // the boundary is in the right place.
    const cycle = cycleTotal(fixtureTransactions, "2026-05-13", "2026-06-12")
    expect(cycle.charges).toBeCloseTo(19_337.94, 2)
  })

  test("a charge is billed in the cycle it posts to, not the one it is made in", () => {
    // Swiped 7/12, posted 7/13: Chase puts it on the following statement.
    const late = txn({
      date: "2026-07-12",
      amount: "100.00",
      plaid_metadata: JSON.stringify({ date: "2026-07-13", authorized_date: "2026-07-12" }),
    })
    expect(cycleTotal([late], "2026-06-13", "2026-07-12").charges).toBe(0)
    expect(cycleTotal([late], "2026-07-13", "2026-08-12").charges).toBe(100)
  })
})

test("reconciliation reports the gap rather than hiding it", () => {
  expect(reconciliation(4500.00, 4300.00).delta).toBeCloseTo(800.00, 2)
})
