import { describe, expect, test } from "bun:test"
import { txn } from "../test/factories"
import {
  aCharge,
  aDeposit,
  anAutopay,
  anAutopayDebit,
  aRefund,
  aSweep,
  aWalletPayment,
  aWalletTransfer,
} from "../test/world"
import {
  CHASE,
  CHASE_UNITED,
  classify,
  FIDELITY_JOINT,
  IGOR_PERSONAL,
  looksLikeSettlement,
  unknownAccounts,
} from "./policy"

describe("account policy", () => {
  test("untagged spend on the discretionary card counts", () => {
    const result = classify(aCharge({ on: "2026-08-05", amount: 42, account: CHASE }))
    expect(result.counts).toBe(true)
    expect(result.bucket).toBe("spending")
    expect(result.reviewed).toBe(false)
  })

  test("untagged spend on a fixed-cost account does NOT count", () => {
    // The trap this whole design exists to avoid: rent leaves the bank untagged,
    // and it dwarfs a month of discretionary spending.
    const rent = aCharge({
      on: "2026-08-01",
      amount: 5000,
      account: IGOR_PERSONAL,
      payee: "A Landlord",
      category: "Rent",
    })
    const result = classify(rent)
    expect(result.counts).toBe(false)
    expect(result.bucket).toBe("unclassified")
  })

  test("an explicit spending tag opts a cash withdrawal in", () => {
    const atm = classify(
      aCharge({
        on: "2026-08-04",
        amount: 200,
        account: IGOR_PERSONAL,
        payee: "CASH ADVANCE ATM",
        category: "Cash",
        tags: ["spending"],
      })
    )
    expect(atm.counts).toBe(true)
    expect(atm.reviewed).toBe(true)
  })

  test("dormant accounts are ignored entirely", () => {
    expect(classify(aCharge({ on: "2026-08-05", amount: 30, account: CHASE_UNITED })).bucket).toBe(
      "ignored"
    )
  })

  test("unknown accounts default out and are surfaced", () => {
    // Built with the raw factory on purpose: the world builder only accepts
    // account names the policy knows, which is what makes a typo a type error.
    const mystery = txn({ account_display_name: "A Savings Account", amount: "500.00" })
    expect(classify(mystery).counts).toBe(false)
    expect(unknownAccounts([mystery])).toEqual(["A Savings Account"])
  })

  test("the accounts with a policy are not reported as unknown", () => {
    const known = [
      aCharge({ on: "2026-08-01", amount: 10, account: CHASE }),
      aCharge({ on: "2026-08-01", amount: 10, account: IGOR_PERSONAL }),
      aCharge({ on: "2026-08-01", amount: 10, account: FIDELITY_JOINT }),
      aCharge({ on: "2026-08-01", amount: 10, account: CHASE_UNITED }),
      aWalletPayment({ on: "2026-08-01", amount: 10, payee: "A Friend" }),
    ]
    expect(unknownAccounts(known)).toEqual([])
  })
})

describe("tags", () => {
  test("recurring and irregular are excluded", () => {
    expect(classify(aCharge({ on: "2026-08-05", amount: 60, tags: ["recurring"] })).counts).toBe(
      false
    )
    expect(classify(aCharge({ on: "2026-08-05", amount: 60, tags: ["irregular"] })).counts).toBe(
      false
    )
  })

  test("a classifying tag beats the settlement heuristic", () => {
    const disputed = aCharge({
      on: "2026-08-05",
      amount: 60,
      category: "Payment, Transfer",
      tags: ["spending"],
    })
    expect(classify(disputed).counts).toBe(true)
  })

  test("person tags do not affect the math", () => {
    const tagged = classify(aCharge({ on: "2026-08-05", amount: 60, tags: ["serena"] }))
    expect(tagged.counts).toBe(true)
    expect(tagged.reviewed).toBe(false)
  })
})

describe("negative amounts", () => {
  test("a refund on the card credits the allowance back", () => {
    const result = classify(aRefund({ on: "2026-08-06", amount: 38, payee: "A Retailer" }))
    expect(result.counts).toBe(true)
    expect(result.amount).toBe(-38)
  })

  test("a card autopay never credits the allowance", () => {
    // Lunch Money files some autopays as Income with the exclude flag unset, so
    // the flag alone is not enough to catch these.
    const payment = anAutopay({ on: "2026-07-09", amount: 9000, category: "Income" })
    expect(classify(payment).counts).toBe(false)
    expect(looksLikeSettlement(payment)).toBe(true)
  })

  test("deposits into a fixed-cost account never count", () => {
    const payroll = aDeposit({
      on: "2026-08-01",
      amount: 6000,
      payee: "DIRECT DEPOSIT PAYROLL",
      into: IGOR_PERSONAL,
    })
    expect(classify(payroll).counts).toBe(false)
  })

  test("a card autopay leaving the bank account is not a review item", () => {
    // It is the card bill being paid, not spending, and it should never appear
    // in the queue — where a five-figure row would be the loudest thing there.
    const result = classify(anAutopayDebit({ on: "2026-08-09", amount: 9000, from: IGOR_PERSONAL }))
    expect(result.bucket).toBe("ignored")
    expect(result.counts).toBe(false)
  })

  test("rent stays a review item, since it is not a transfer", () => {
    const rent = aCharge({
      on: "2026-08-01",
      amount: 5000,
      account: IGOR_PERSONAL,
      payee: "A Landlord",
      category: "Rent",
    })
    expect(classify(rent).bucket).toBe("unclassified")
  })

  test("a merchant refund filed as Income still credits the allowance", () => {
    // Lunch Money files genuine merchant credits under "Income" too. Treating
    // an Income category as a settlement swallowed money that should have come
    // back, so the payee is what decides.
    const refund = aRefund({
      on: "2026-08-06",
      amount: 195,
      payee: "A Theatre",
      category: "💵 Income",
    })
    const result = classify({ ...refund, is_income: true })
    expect(result.counts).toBe(true)
    expect(result.amount).toBe(-195)
  })

  test("on the card, a credit is a refund unless the payee says otherwise", () => {
    // Lunch Money's exclude flag does not decide this. Only the payee does.
    const credit = aRefund({ on: "2026-08-06", amount: 100, excluded: true })
    expect(classify(credit).counts).toBe(true)
    expect(classify(anAutopay({ on: "2026-08-09", amount: 100 })).counts).toBe(false)
  })
})

describe("reimbursements", () => {
  const aCheque = (over: Partial<Parameters<typeof aDeposit>[0]> = {}) =>
    aDeposit({
      on: "2026-08-07",
      amount: 154,
      into: IGOR_PERSONAL,
      payee: "CHECK RECEIVED",
      category: "💵 Income",
      ...over,
    })

  test("a deposit does not count, but can be tagged", () => {
    const result = classify(aCheque())
    expect(result.bucket).toBe("deposit")
    expect(result.counts).toBe(false)
    expect(result.taggable).toBe(true)
  })

  test("tagging a reimbursement spending gives the allowance back", () => {
    // Spend on the card for work, get repaid into the bank: the purchase counts
    // and the repayment counts negatively, so the pair nets to zero.
    const result = classify(aCheque({ tags: ["spending"] }))
    expect(result.counts).toBe(true)
    expect(result.amount).toBe(-154)
  })

  test("a reimbursement flagged as a transfer is still taggable", () => {
    // The real case: the brokerage sweeps cash on every movement, so this
    // arrives categorised "Payment, Transfer" AND excluded from totals — the
    // same signals as its own internal sweep. Trusting either made it
    // untaggable, which meant a work reimbursement could never be credited back.
    const swept = {
      payee: "DIRECT DEPOSIT An Employer",
      category: "🔄 Payment, Transfer",
      excluded: true,
    }
    expect(classify(aCheque(swept)).bucket).toBe("deposit")
    expect(classify(aCheque(swept)).taggable).toBe(true)

    // ...and tagging it works, despite Lunch Money excluding it.
    const tagged = classify(aCheque({ ...swept, tags: ["spending"] }))
    expect(tagged.counts).toBe(true)
    expect(tagged.amount).toBe(-154)
  })

  test("the sweep that pairs with it is not a deposit", () => {
    const sweep = classify(aSweep({ on: "2026-08-07", amount: 154, account: IGOR_PERSONAL }))
    expect(sweep.bucket).toBe("ignored")
    expect(sweep.reason).toBe("internal account sweep")
  })

  test("payroll and transfers are not reimbursements by default", () => {
    expect(classify(aCheque({ payee: "DIRECT DEPOSIT PAYROLL" })).counts).toBe(false)
    expect(classify(aSweep({ on: "2026-08-07", amount: -154 })).bucket).toBe("ignored")
  })
})

describe("Lunch Money's exclude flag on the card", () => {
  // Charges land under "Payment, Transfer" and pick up the exclude flag from it
  // about once a month, and when they do the charge is usually real.
  test("a real charge filed as a transfer still counts", () => {
    const hotel = aCharge({
      on: "2026-08-03",
      amount: 196.15,
      payee: "A Hotel",
      category: "🔄 Payment, Transfer",
      excluded: true,
    })
    expect(classify(hotel).counts).toBe(true)
    expect(classify(hotel).reason).toContain("despite Lunch Money excluding it")
  })

  test("a refund filed as a transfer still credits back", () => {
    const refund = aRefund({
      on: "2026-08-03",
      amount: 250,
      payee: "A Kennel",
      category: "🔄 Payment, Transfer",
      excluded: true,
    })
    expect(classify(refund).counts).toBe(true)
    expect(classify(refund).amount).toBe(-250)
  })

  test("the actual card payment is still excluded", () => {
    expect(classify(anAutopay({ on: "2026-08-09", amount: 4000 })).counts).toBe(false)
  })
})

describe("the wallet", () => {
  test("paying a person counts, the way a card charge does", () => {
    const dinner = aWalletPayment({ on: "2026-08-05", amount: 80, payee: "A Friend" })
    expect(classify(dinner).counts).toBe(true)
    expect(classify(dinner).bucket).toBe("spending")
  })

  test("funding the wallet is a transfer, on the bank side where it appears", () => {
    // The wallet reports only its own person-to-person half, so the top-up
    // shows up once, on the bank statement, as a payee of exactly "Venmo".
    const topUp = classify(
      aWalletTransfer({ on: "2026-08-02", amount: 150, account: FIDELITY_JOINT })
    )
    expect(topUp.counts).toBe(false)
    expect(topUp.reason).toBe("moving money in or out of the wallet")

    const cashOut = aWalletTransfer({ on: "2026-08-03", amount: -150, account: IGOR_PERSONAL })
    expect(classify(cashOut).counts).toBe(false)
  })

  test("a person's name is never mistaken for the wallet itself", () => {
    // Bank rows say exactly "Venmo" and wallet rows never do, which is the
    // whole basis of the rule above.
    const fromAFriend = aWalletPayment({ on: "2026-08-05", amount: -20, payee: "A Friend" })
    expect(classify(fromAFriend).counts).toBe(true)
  })

  test("a loan repaid is neither spend nor refund once tagged", () => {
    const lent = aWalletPayment({
      on: "2026-08-01",
      amount: 200,
      payee: "A Friend",
      tags: ["irregular"],
    })
    const repaid = aWalletPayment({
      on: "2026-08-12",
      amount: -200,
      payee: "A Friend",
      tags: ["irregular"],
    })
    expect(classify(lent).counts).toBe(false)
    expect(classify(repaid).counts).toBe(false)
    expect(classify(repaid).bucket).toBe("irregular")
  })
})
