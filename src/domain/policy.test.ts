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
    expect(result.bucket).toBe("unclassified")
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
    expect(classify(txn({ account_display_name: "Old Card" })).bucket).toBe("ignored")
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

  test("a card autopay leaving the bank account is not a review item", () => {
    // $4,200.00 out of Fidelity every month. It is the Chase bill being paid,
    // not spending, and it should never appear in the queue.
    const autopay = txn({
      account_display_name: "Checking",
      amount: "4200.00",
      payee: "DIRECT DEBIT CHASE CREDIT CAUTOPAY (Cash)",
      category_name: "Credit card payment",
    })
    const result = classify(autopay)
    expect(result.bucket).toBe("ignored")
    expect(result.counts).toBe(false)
  })

  test("rent stays a review item, since it is not a transfer", () => {
    const rent = txn({
      account_display_name: "Checking",
      amount: "1500.00",
      payee: "A Property Manager",
      category_name: "Rent",
    })
    expect(classify(rent).bucket).toBe("unclassified")
  })

  test("a merchant refund filed as Income still credits the allowance", () => {
    // Lunch Money filed a real $195 credit from A Theatre under "Income".
    // Treating an Income category as a settlement swallowed money that should
    // have come back, so the payee is what decides.
    const refund = txn({
      amount: "-195.00",
      payee: "A Theatreertory The",
      category_name: "💵 Income",
      is_income: true,
    })
    const result = classify(refund)
    expect(result.counts).toBe(true)
    expect(result.amount).toBe(-195)
  })

  test("on the card, a credit is a refund unless the payee says otherwise", () => {
    // Lunch Money's exclude flag does not decide this. Only the payee does.
    expect(classify(txn({ amount: "-100.00", exclude_from_totals: true })).counts).toBe(true)
    expect(classify(txn({ amount: "-100.00", payee: "AUTOMATIC PAYMENT - THANK" })).counts).toBe(
      false
    )
  })
})

describe("reimbursements", () => {
  const deposit = (over = {}) =>
    txn({
      account_display_name: "Checking",
      amount: "-154.00",
      payee: "CHECK RECEIVED (Cash)",
      category_name: "💵 Income",
      is_income: true,
      ...over,
    })

  test("a deposit does not count, but can be tagged", () => {
    const result = classify(deposit())
    expect(result.bucket).toBe("deposit")
    expect(result.counts).toBe(false)
    expect(result.taggable).toBe(true)
  })

  test("tagging a reimbursement spending gives the allowance back", () => {
    // Spend on the card for work, get repaid into the bank: the purchase counts
    // and the repayment counts negatively, so the pair nets to zero.
    const result = classify(deposit({ tags: ["spending"] }))
    expect(result.counts).toBe(true)
    expect(result.amount).toBe(-154)
  })

  test("a reimbursement flagged as a transfer is still taggable", () => {
    // The real case: Fidelity sweeps cash on every movement, so this arrives
    // categorised "Payment, Transfer" AND excluded from totals — the same
    // signals as its own internal sweep. Trusting either made it untaggable,
    // which meant a work reimbursement could never be credited back.
    const reimbursement = txn({
      account_display_name: "Checking",
      amount: "-245.86",
      payee: "DIRECT DEPOSIT Fractional ABDW3EEY5HF (Cash)",
      category_name: "🔄 Payment, Transfer",
      exclude_from_totals: true,
    })
    expect(classify(reimbursement).bucket).toBe("deposit")
    expect(classify(reimbursement).taggable).toBe(true)

    // ...and tagging it works, despite Lunch Money excluding it.
    const tagged = classify({
      ...reimbursement,
      tags: [{ id: 1, name: "spending", description: null, archived: false }],
    })
    expect(tagged.counts).toBe(true)
    expect(tagged.amount).toBe(-245.86)
  })

  test("the sweep that pairs with it is not a deposit", () => {
    const sweep = txn({
      account_display_name: "Checking",
      amount: "245.86",
      payee: "PURCHASE INTO CORE ACCOUNT FDIC INSURED DEPOSIT",
      category_name: "🔄 Payment, Transfer",
      exclude_from_totals: true,
    })
    expect(classify(sweep).bucket).toBe("ignored")
    expect(classify(sweep).reason).toBe("internal account sweep")
  })

  test("payroll and transfers are not reimbursements by default", () => {
    expect(classify(deposit({ payee: "DIRECT DEPOSIT SERVICECO MEPAYROLL" })).counts).toBe(false)
    expect(classify(deposit({ payee: "REDEMPTION FROM CORE ACCOUNT FDIC" })).bucket).toBe("ignored")
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

describe("Lunch Money's exclude flag on the card", () => {
  // Four Chase charges carried exclude_from_totals across three months, all of
  // them because they were filed under "Payment, Transfer". Three were real.
  const excluded = (over = {}) =>
    txn({ exclude_from_totals: true, category_name: "🔄 Payment, Transfer", ...over })

  test("a real charge filed as a transfer still counts", () => {
    const hotel = excluded({ payee: "COSMOPOL-ADV DEP", amount: "196.15" })
    expect(classify(hotel).counts).toBe(true)
    expect(classify(hotel).reason).toContain("despite Lunch Money excluding it")
  })

  test("a refund filed as a transfer still credits back", () => {
    const refund = excluded({ payee: "A DOG DAYCARE", amount: "-700.00" })
    expect(classify(refund).counts).toBe(true)
    expect(classify(refund).amount).toBe(-1690)
  })

  test("the actual card payment is still excluded", () => {
    const payment = excluded({ payee: "AUTOMATIC PAYMENT - THANK", amount: "-4200.00" })
    expect(classify(payment).counts).toBe(false)
  })
})
