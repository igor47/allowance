import { describe, expect, test } from "bun:test"
import { txn } from "../test/factories"
import { fixtureTransactions } from "../test/fixtures"
import { cycleTotal, reconciliation } from "./card"
import { cycleView } from "./cycle"

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

  test("recorded data: the closed statement is a plausible bill", () => {
    const view = cycleView("2026-08-14", 12, 9)
    const closed = cycleTotal(fixtureTransactions, view.lastClosed.start, view.lastClosed.end)
    expect(closed.net).toBeGreaterThan(10_000)
    expect(closed.net).toBeLessThan(20_000)
  })
})

test("reconciliation reports the gap rather than hiding it", () => {
  expect(reconciliation(4500.00, 4300.00).delta).toBeCloseTo(800.00, 2)
})
