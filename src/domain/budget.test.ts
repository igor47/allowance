import { describe, expect, test } from "bun:test"
import { recurringItem as item } from "../test/factories"
import { aWorld } from "../test/world"
import { budgetView, decodeEntities, perMonth, stateOf } from "./budget"

describe("cadence to a monthly figure", () => {
  test("monthly is itself", () => {
    expect(perMonth(item())).toBe(1)
  })

  test("twice a month is two, which granularity alone cannot say", () => {
    // The API reports (month, 1) for this exactly as it does for plain monthly;
    // counting it once would halve a fortnightly salary.
    const twice = item({ cadence: "twice a month", granularity: "month", quantity: 1 })
    expect(twice.granularity).toBe(item().granularity)
    expect(perMonth(twice)).toBe(2)
  })

  test("weekly is 52/12, not 4", () => {
    expect(
      perMonth(item({ cadence: "once a week", granularity: "week", quantity: 1 }))
    ).toBeCloseTo(4.333, 3)
  })

  test("every N months divides", () => {
    expect(
      perMonth(item({ cadence: "every 3 months", granularity: "month", quantity: 3 }))
    ).toBeCloseTo(1 / 3, 5)
  })

  test("yearly and twice-yearly", () => {
    expect(perMonth(item({ cadence: "yearly", granularity: "year", quantity: 1 }))).toBeCloseTo(
      1 / 12,
      5
    )
    expect(
      perMonth(item({ cadence: "twice a year", granularity: "month", quantity: 6 }))
    ).toBeCloseTo(1 / 6, 5)
  })
})

describe("state", () => {
  test("linked is matched", () => {
    expect(
      stateOf(item({ transactions_within_range: [{ id: 1, date: "2026-08-10" }] }), "2026-08-16")
    ).toBe("matched")
  })

  test("expected later this month is upcoming, not a problem", () => {
    expect(stateOf(item({ missing_dates_within_range: ["2026-08-20"] }), "2026-08-16")).toBe(
      "upcoming"
    )
  })

  test("expected by now with nothing linked is overdue", () => {
    expect(stateOf(item({ missing_dates_within_range: ["2026-08-07"] }), "2026-08-16")).toBe(
      "overdue"
    )
  })

  test("an item on an account with no feed is never overdue", () => {
    // A manually-managed card: no transaction can ever link, so flagging it
    // would cry wolf every day of every month.
    const manual = item({
      plaid_account_id: null,
      asset_id: 1,
      missing_dates_within_range: ["2026-08-01"],
    })
    expect(stateOf(manual, "2026-08-16")).toBe("untracked")
  })
})

describe("payees arrive HTML-escaped", () => {
  test("named and numeric entities both decode", () => {
    expect(decodeEntities("PG&amp;E")).toBe("PG&E")
    expect(decodeEntities("Serena&#x27;s Gym")).toBe("Serena's Gym")
    expect(decodeEntities("3-5x&#x2F;mo")).toBe("3-5x/mo")
  })

  test("an escaped entity does not decode twice", () => {
    expect(decodeEntities("&amp;#x2F;")).toBe("&#x2F;")
  })
})

describe("the plan, totalled", () => {
  /**
   * A whole plan, small enough to check in your head: a fortnightly salary and
   * a rent cheque in, a mortgage and two subscriptions out — one of them on a
   * card Lunch Money cannot see.
   */
  const plan = aWorld({ today: "2026-08-16" })
    .income({ payee: "Payroll", amount: 4_000, cadence: "twice a month" })
    .income({ payee: "Rent Received", amount: 2_000 })
    .subscription({ payee: "Mortgage", amount: 1_500 })
    .subscription({ payee: "A Streaming Service", amount: 20, tracked: false })
    .subscription({ payee: "A Gym", amount: 100, tracked: false })

  const view = budgetView(plan.recurring, "2026-08-16")

  test("a fortnightly salary is counted twice, not once", () => {
    // The API reports (month, 1) for it, so only the cadence string says so —
    // and counting it once would halve the household's income.
    const payroll = view.income.find((i) => i.payee === "Payroll")
    expect(payroll?.amount).toBe(4_000)
    expect(payroll?.monthly).toBe(8_000)
    expect(view.totals.income).toBe(10_000)
  })

  test("commitments include money that never appears as a transaction", () => {
    // Subscriptions on a manually-managed card leave no trace in the
    // transaction feed at all; without the plan that money is invisible.
    expect(view.totals.committed).toBe(1_620)
    expect(view.totals.untracked).toBe(120)
    expect(view.commitments.filter((c) => !c.tracked)).toHaveLength(2)
  })

  test("the daily target is what is left, spread across the month", () => {
    expect(view.days).toBe(31)
    expect(view.totals.pool).toBe(8_380)
    expect(view.totals.dailyTarget).toBeCloseTo(8_380 / 31, 5)
  })

  test("both lists are ordered by what they cost a month", () => {
    expect(view.commitments.map((c) => c.payee)).toEqual([
      "Mortgage",
      "A Gym",
      "A Streaming Service",
    ])
    expect(view.income.map((i) => i.payee)).toEqual(["Payroll", "Rent Received"])
  })

  test("payees are decoded for display", () => {
    const escaped = budgetView([item({ payee: "PG&amp;E" })], "2026-08-16")
    expect(escaped.commitments.map((c) => c.payee)).toContain("PG&E")
  })
})
