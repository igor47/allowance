import { describe, expect, test } from "bun:test"
import { aCharge, anAutopay, aRefund } from "../test/world"
import { cycleTotal, reconciliation } from "./card"
import { IGOR_PERSONAL } from "./policy"

describe("cycle totals", () => {
  test("sums charges and credits on the statement card only", () => {
    const total = cycleTotal(
      [
        aCharge({ on: "2026-08-01", amount: 100 }),
        aRefund({ on: "2026-08-02", amount: 25 }),
        aCharge({ on: "2026-08-02", amount: 50, account: IGOR_PERSONAL }),
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
    // Swiped on the close date, posted the day after: Chase puts it on the
    // following statement.
    const late = aCharge({ on: "2026-07-12", amount: 100, posted: "2026-07-13" })
    expect(cycleTotal([late], "2026-06-13", "2026-07-12").charges).toBe(0)
    expect(cycleTotal([late], "2026-07-13", "2026-08-12").charges).toBe(100)
  })
})

test("reconciliation reports the gap rather than hiding it", () => {
  expect(reconciliation(1_600, 1_450).delta).toBeCloseTo(150, 2)
})
