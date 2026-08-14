import { describe, expect, test } from "bun:test"
import type { AllowanceConfig } from "../config"
import { txn } from "../test/factories"
import { classifyAll, computeAllowance } from "./allowance"

const CONFIG: AllowanceConfig = {
  periodStart: "2026-08-01",
  dailyTarget: 200,
  rolloverCapDays: 14,
}

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
    const result = compute([txn({ date: "2026-08-02", amount: "500.00" })], "2026-08-03")
    expect(result.spent).toBe(500)
    expect(result.balance).toBe(100)
  })

  test("overspend carries forward, uncapped and unforgiven", () => {
    const result = compute([txn({ date: "2026-08-01", amount: "5000.00" })], "2026-08-03")
    expect(result.balance).toBe(-4400)
    expect(result.rows[0]?.balance).toBe(-4800)
  })

  test("banked money stops at the cap, and the loss is reported", () => {
    const result = compute([], "2026-09-15") // 46 days at $200 = $9,200 earned
    expect(result.cap).toBe(2800)
    expect(result.balance).toBe(2800)
    expect(result.forfeited).toBeGreaterThan(6_000)
  })

  test("the cap applies day by day, so a blowout cannot be pre-funded", () => {
    // Thirty quiet days would bank $6,000 uncapped, leaving $3,200 after a
    // $3,000 splurge on day 31. The cap holds the bank to $2,800, so the same
    // splurge lands at zero instead.
    const result = compute([txn({ date: "2026-08-31", amount: "3000.00" })], "2026-08-31")
    expect(result.balance).toBe(0)
    expect(result.forfeited).toBe(3200)
  })

  test("transactions outside the period are ignored", () => {
    const result = compute(
      [
        txn({ date: "2026-07-31", amount: "999.00" }),
        txn({ date: "2026-08-20", amount: "999.00" }),
      ],
      "2026-08-02"
    )
    expect(result.spent).toBe(0)
    expect(result.balance).toBe(400)
  })

  test("a refund gives the money back on the day it lands", () => {
    const result = compute(
      [
        txn({ date: "2026-08-01", amount: "300.00" }),
        txn({ date: "2026-08-02", amount: "-100.00" }),
      ],
      "2026-08-02"
    )
    expect(result.spent).toBe(200)
    expect(result.rows[1]?.spent).toBe(-100)
    expect(result.balance).toBe(200)
  })

  test("fixed costs never touch the balance", () => {
    const result = compute(
      [
        txn({ date: "2026-08-01", amount: "675.00", tags: ["recurring"] }),
        txn({ date: "2026-08-01", amount: "1500.00", account_display_name: "Checking" }),
      ],
      "2026-08-01"
    )
    expect(result.spent).toBe(0)
    expect(result.balance).toBe(200)
  })
})
