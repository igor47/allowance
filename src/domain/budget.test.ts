import { describe, expect, test } from "bun:test"
import type { LmRecurringItem } from "../lunchmoney/types"
import { fixtureRecurring } from "../test/fixtures"
import { budgetView, decodeEntities, perMonth, stateOf } from "./budget"

const item = (over: Partial<LmRecurringItem> = {}): LmRecurringItem => ({
  id: 1,
  payee: "Thing",
  description: null,
  amount: "10.0000",
  currency: "usd",
  cadence: "monthly",
  granularity: "month",
  quantity: 1,
  billing_date: "2026-08-10",
  category_id: null,
  is_income: false,
  plaid_account_id: 452114,
  asset_id: null,
  transactions_within_range: [],
  missing_dates_within_range: [],
  ...over,
})

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
    // Venture 6396 is manually managed: no transaction can ever link, so
    // flagging it would cry wolf every day of every month.
    const manual = item({
      plaid_account_id: null,
      asset_id: 386913,
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

describe("the real plan", () => {
  const view = budgetView(fixtureRecurring, "2026-08-16")

  test("income is the fortnightly salary, monthlyised", () => {
    // The salary arrives twice a month and is spread across it — $2,100.00 an
    // occurrence, $15,413 a month, which is the calculation being pinned here.
    const payroll = view.income.find((i) => i.payee === "SERVICECO MEPAYROLL")
    expect(Math.round(payroll?.monthly ?? 0)).toBe(15_413)
    // A second, manually-entered income of $1,717 against Chase joined it.
    expect(view.income).toHaveLength(2)
    expect(Math.round(view.totals.income)).toBe(17_130)
  })

  test("commitments include money that never appears as a transaction", () => {
    // 26 subscriptions sit on the manually-managed card; their only trace in
    // the transaction data is the autopay, which is excluded as a transfer.
    expect(Math.round(view.totals.untracked)).toBe(1_193)
    expect(view.commitments.filter((c) => !c.tracked)).toHaveLength(26)
  })

  test("the derived daily target lands near the one in use", () => {
    expect(view.days).toBe(31)
    // Was $197. The drop is entirely new recurring items, and a rental
    // property is most of it: $900.00/month of "Nest Mortgage" out against
    // $1,717 of "Nest Rent" in, plus $975 of therapy and $449 of
    // subscriptions. A property that nets +$145 a month still costs $50 a day
    // of allowance, because the mortgage is committed and the rent is income
    // spread across everything.
    expect(Math.round(view.totals.dailyTarget)).toBe(171)
  })

  test("payees are decoded for display", () => {
    expect(view.commitments.map((c) => c.payee)).toContain("PG&E")
  })
})
