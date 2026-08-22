import { describe, expect, test } from "bun:test"
import { recurringItem as item } from "../test/factories"
import { aWorld } from "../test/world"
import { budgetView, decodeEntities, perMonth, stateOf } from "./budget"

describe("occurrences per month", () => {
  /** A month the plan does not fire in — the ordinary state of a yearly bill. */
  const quiet = { expected_dates: [] }

  test("monthly is itself", () => {
    expect(perMonth(item())).toBe(1)
  })

  test("twice a month is two, which granularity alone cannot say", () => {
    // Lunch Money reports (month, 1) for this exactly as it does for plain
    // monthly. Only the expected dates give it away, and counting it once
    // would halve a fortnightly salary.
    const twice = item({
      granularity: "month",
      quantity: 1,
      expected_dates: ["2026-08-14", "2026-08-28"],
    })
    expect(twice.granularity).toBe(item().granularity)
    expect(twice.quantity).toBe(item().quantity)
    expect(perMonth(twice)).toBe(2)
  })

  test("weekly amortises to 52/12 rather than to the weeks in this month", () => {
    // Four expected dates in August, five in a month that starts on a Tuesday.
    // Totals want the steady rate, so the amortised figure is the floor.
    const weekly = item({
      granularity: "week",
      quantity: 1,
      expected_dates: ["2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25"],
    })
    expect(perMonth(weekly)).toBeCloseTo(4.333, 3)
  })

  test("every N months divides", () => {
    expect(perMonth(item({ granularity: "month", quantity: 3, ...quiet }))).toBeCloseTo(1 / 3, 5)
  })

  test("yearly and twice-yearly amortise across the months they skip", () => {
    // A yearly bill is a twelfth of itself every month, not its whole self in
    // one month and nothing in the other eleven.
    expect(perMonth(item({ granularity: "year", quantity: 1, ...quiet }))).toBeCloseTo(1 / 12, 5)
    expect(perMonth(item({ granularity: "month", quantity: 6, ...quiet }))).toBeCloseTo(1 / 6, 5)
  })

  test("a yearly bill stays amortised even in the month it lands", () => {
    // Counting it in full here *and* a twelfth in the other eleven months
    // would bill it 1.9 times over the year, and would drop the daily target
    // through the floor in one month for no change in the plan.
    const due = item({ granularity: "year", quantity: 1, expected_dates: ["2026-08-01"] })
    expect(perMonth(due)).toBeCloseTo(1 / 12, 5)
  })

  test("more often than monthly, the expected dates win", () => {
    // The general form of the twice-a-month case: whenever an item fires at
    // least monthly, what Lunch Money expects beats what the cadence implies.
    const twiceWeekly = item({
      granularity: "week",
      quantity: 1,
      expected_dates: Array.from(
        { length: 8 },
        (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`
      ),
    })
    expect(perMonth(twiceWeekly)).toBe(8)
  })

  test("a partial range cannot be trusted to count occurrences", () => {
    // Asked for three weeks of the month, a twice-monthly item reports one
    // date and is indistinguishable from a monthly one. Falling back to the
    // amortised rate is wrong small; trusting the count halves a salary.
    const truncated = item({
      granularity: "month",
      quantity: 1,
      expected_dates: ["2026-08-14"],
      expected_range: { start: "2026-08-01", end: "2026-08-22" },
    })
    expect(perMonth(truncated, { start: "2026-08-01", end: "2026-08-31" })).toBe(1)

    // The same item, asked over the whole month, counts twice.
    const whole = item({
      granularity: "month",
      quantity: 1,
      expected_dates: ["2026-08-14", "2026-08-28"],
      expected_range: { start: "2026-08-01", end: "2026-08-31" },
    })
    expect(perMonth(whole, { start: "2026-08-01", end: "2026-08-31" })).toBe(2)
  })

  test("an item with no expectations at all amortises", () => {
    expect(
      perMonth(item({ expected_dates: [], expected_range: null }), {
        start: "2026-08-01",
        end: "2026-08-31",
      })
    ).toBe(1)
  })

  test("a daily item is a month of days", () => {
    expect(perMonth(item({ granularity: "day", quantity: 1, ...quiet }))).toBeCloseTo(365 / 12, 3)
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
