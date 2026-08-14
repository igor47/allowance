import { describe, expect, test } from "bun:test"
import { txn } from "../test/factories"
import { fixtureTransactions } from "../test/fixtures"
import { classify, looksLikeSettlement, unknownAccounts } from "./policy"

describe("account policy", () => {
  test("untagged spend on the discretionary card counts", () => {
    const result = classify(txn({ account_display_name: "Card", amount: "42.00" }))
    expect(result.counts).toBe(true)
    expect(result.bucket).toBe("spending")
    expect(result.reviewed).toBe(false)
  })

  test("untagged spend on a fixed-cost account does NOT count", () => {
    // The trap this whole design exists to avoid: rent leaves Fidelity untagged.
    const rent = txn({
      account_display_name: "Checking",
      amount: "1500.00",
      payee: "A Property Manager",
      category_name: "Rent",
    })
    const result = classify(rent)
    expect(result.counts).toBe(false)
    expect(result.bucket).toBe("assumed-fixed")
  })

  test("an explicit spending tag opts a cash withdrawal in", () => {
    const atm = txn({
      account_display_name: "Checking",
      amount: "203.00",
      payee: "CASH ADVANCE ATM6387 3473 17TH STRE SA",
      category_name: "Cash",
      tags: ["spending"],
    })
    const result = classify(atm)
    expect(result.counts).toBe(true)
    expect(result.reviewed).toBe(true)
  })

  test("dormant accounts are ignored entirely", () => {
    expect(classify(txn({ account_display_name: "Old Card" })).bucket).toBe("excluded")
  })

  test("unknown accounts default out and are surfaced", () => {
    const mystery = txn({ account_display_name: "Ally Savings", amount: "500.00" })
    expect(classify(mystery).counts).toBe(false)
    expect(unknownAccounts([mystery])).toEqual(["Ally Savings"])
  })
})

describe("tags", () => {
  test("recurring and irregular are excluded", () => {
    expect(classify(txn({ tags: ["recurring"] })).counts).toBe(false)
    expect(classify(txn({ tags: ["irregular"] })).counts).toBe(false)
  })

  test("a classifying tag beats the settlement heuristic", () => {
    const disputed = txn({ category_name: "Payment, Transfer", tags: ["spending"] })
    expect(classify(disputed).counts).toBe(true)
  })

  test("person tags do not affect the math", () => {
    expect(classify(txn({ tags: ["serena"] })).counts).toBe(true)
    expect(classify(txn({ tags: ["serena"] })).reviewed).toBe(false)
  })
})

describe("negative amounts", () => {
  test("a refund on the card credits the allowance back", () => {
    const refund = txn({ amount: "-38.00", payee: "Target", category_name: "Superstores" })
    const result = classify(refund)
    expect(result.counts).toBe(true)
    expect(result.amount).toBe(-38)
  })

  test("a card autopay never credits the allowance", () => {
    // Lunch Money filed the 2026-07-09 autopay as Income with the exclude flag
    // unset, so the flag alone is not enough to catch these.
    const payment = txn({
      amount: "-4900.00",
      payee: "AUTOMATIC PAYMENT - THANK",
      category_name: "Income",
      is_income: true,
      exclude_from_totals: false,
    })
    expect(classify(payment).counts).toBe(false)
    expect(looksLikeSettlement(payment)).toBe(true)
  })

  test("deposits into a fixed-cost account never count", () => {
    const payroll = txn({
      account_display_name: "Checking",
      amount: "-1800.00",
      payee: "DIRECT DEPOSIT SERVICECO MEPAYROLL",
      category_name: "Income",
    })
    expect(classify(payroll).counts).toBe(false)
  })

  test("transfers excluded from totals never count", () => {
    expect(classify(txn({ amount: "-100.00", exclude_from_totals: true })).counts).toBe(false)
  })
})

describe("against recorded data", () => {
  const august = fixtureTransactions.filter((t) => t.date >= "2026-08-01" && t.date <= "2026-08-13")

  test("per-account policy keeps August in the hundreds, not the tens of thousands", () => {
    const counted = august
      .map(classify)
      .filter((c) => c.counts)
      .reduce((sum, c) => sum + c.amount, 0)

    // A global untagged-counts rule reads ~$23,370 here because rent ($5,922)
    // and the card autopay ($14,291) leave from Fidelity untagged.
    expect(counted).toBeLessThan(5_000)
    expect(counted).toBeGreaterThan(2_000)
  })

  test("nothing from a fixed-cost account slips in untagged", () => {
    const leaked = august.filter(
      (t) => classify(t).counts && t.account_display_name !== "Card"
    )
    expect(leaked).toEqual([])
  })
})
