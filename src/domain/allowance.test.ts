import { describe, expect, test } from "bun:test"
import type { AllowanceConfig } from "../config"
import { aCharge, aRefund, TEST_CONFIG } from "../test/world"
import { classifyAll, computeAllowance } from "./allowance"
import { IGOR_PERSONAL } from "./policy"

const CONFIG: AllowanceConfig = TEST_CONFIG.allowance

const compute = (txns: Parameters<typeof classifyAll>[0], today: string) =>
  computeAllowance(classifyAll(txns), CONFIG, today)

describe("rolling balance", () => {
  test("an empty period banks the full target each day", () => {
    const result = compute([], "2026-08-05")
    expect(result.days).toBe(5)
    expect(result.budget).toBe(1000)
    expect(result.balance).toBe(1000)
    expect(result.rows).toHaveLength(5)
  })

  test("spending draws the balance down", () => {
    const result = compute([aCharge({ on: "2026-08-02", amount: 500 })], "2026-08-03")
    expect(result.spent).toBe(500)
    expect(result.balance).toBe(100)
  })

  test("overspend carries forward, uncapped and unforgiven", () => {
    const result = compute([aCharge({ on: "2026-08-01", amount: 5000 })], "2026-08-03")
    expect(result.balance).toBe(-4400)
    expect(result.rows[0]?.balance).toBe(-4800)
  })

  test("banked money stops at the cap, and the loss is reported", () => {
    const result = compute([], "2026-09-20") // 20 days at $200 = $4,000 earned
    expect(result.cap).toBe(2800)
    expect(result.balance).toBe(2800)
    expect(result.forfeited).toBe(1_200)
  })

  test("the cap applies day by day, so a blowout cannot be pre-funded", () => {
    // Thirty quiet days would bank $6,000 uncapped, leaving $3,200 after a
    // $3,000 splurge on day 31. The cap holds the bank to $2,800, so the same
    // splurge lands at zero instead.
    const result = compute([aCharge({ on: "2026-08-31", amount: 3000 })], "2026-08-31")
    expect(result.balance).toBe(0)
    expect(result.forfeited).toBe(3200)
  })

  test("transactions outside the period are ignored", () => {
    const result = compute(
      [aCharge({ on: "2026-07-31", amount: 999 }), aCharge({ on: "2026-08-20", amount: 999 })],
      "2026-08-02"
    )
    expect(result.spent).toBe(0)
    expect(result.balance).toBe(400)
  })

  test("a refund gives the money back on the day it lands", () => {
    const result = compute(
      [aCharge({ on: "2026-08-01", amount: 300 }), aRefund({ on: "2026-08-02", amount: 100 })],
      "2026-08-02"
    )
    expect(result.spent).toBe(200)
    expect(result.rows[1]?.spent).toBe(-100)
    expect(result.balance).toBe(200)
  })

  test("fixed costs never touch the balance", () => {
    const result = compute(
      [
        aCharge({ on: "2026-08-01", amount: 675, tags: ["recurring"] }),
        aCharge({ on: "2026-08-01", amount: 5000, account: IGOR_PERSONAL }),
      ],
      "2026-08-01"
    )
    expect(result.spent).toBe(0)
    expect(result.balance).toBe(200)
  })
})

describe("the period is the calendar month", () => {
  test("the balance starts from zero on the 1st", () => {
    // A blowout on the last day of August is not September's problem.
    const result = compute([aCharge({ on: "2026-08-31", amount: 5000 })], "2026-09-02")
    expect(result.periodStart).toBe("2026-09-01")
    expect(result.days).toBe(2)
    expect(result.spent).toBe(0)
    expect(result.balance).toBe(400)
  })

  test("surplus does not bank across the boundary either", () => {
    const august = compute([], "2026-08-31")
    expect(august.balance).toBe(2800) // capped
    const september = compute([], "2026-09-01")
    expect(september.balance).toBe(200) // one day's target, not 3,000
  })

  test("periodStart floors at the configured date in the first month", () => {
    // The app started on the 1st here, so this only shows up with a later floor.
    const late: AllowanceConfig = { ...CONFIG, periodStart: "2026-08-10" }
    const result = computeAllowance(classifyAll([]), late, "2026-08-12")
    expect(result.periodStart).toBe("2026-08-10")
    expect(result.days).toBe(3)
  })

  test("a month before the configured start is still a whole month", () => {
    // Browsing history predates the app; those months are not empty.
    const result = compute([aCharge({ on: "2026-07-20", amount: 50 })], "2026-07-31")
    expect(result.periodStart).toBe("2026-07-01")
    expect(result.days).toBe(31)
    expect(result.spent).toBe(50)
  })

  test("the period runs to the end of the month, not to today", () => {
    const result = compute([], "2026-09-02")
    expect(result.periodEnd).toBe("2026-09-30")
    expect(result.rows).toHaveLength(2) // rows still stop at today
  })
})
