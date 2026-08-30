import { describe, expect, test } from "bun:test"
import type { LmTransaction } from "../lunchmoney/types"
import {
  CARD,
  CHECKING,
  OLD_CARD,
  SAVINGS,
  TEST_ACCOUNTS,
  TEST_CATEGORIES,
  TEST_POLICY,
  WALLET,
} from "../test/accounts"
import { tag, txn } from "../test/factories"
import {
  aCharge,
  aDeposit,
  anAutopay,
  anAutopayDebit,
  aRefund,
  aSweep,
  aTransfer,
  aWalletCashout,
  aWalletPayment,
} from "../test/world"
import type { TransferIndex } from "./policy"
import {
  classify as classifyWith,
  findTransfers,
  unknownAccounts as unknownAccountsIn,
} from "./policy"

/**
 * Every example in this file is about the suite's accounts, so the policy is
 * bound once here rather than being the third argument of forty calls.
 */
const classify = (txn: LmTransaction, transfers?: TransferIndex) =>
  classifyWith(txn, TEST_POLICY, transfers)
const unknownAccounts = (txns: LmTransaction[]) => unknownAccountsIn(txns, TEST_ACCOUNTS)

describe("account policy", () => {
  test("untagged spend on the discretionary card counts", () => {
    const result = classify(aCharge({ on: "2026-08-05", amount: 42, account: CARD }))
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
      account: CHECKING,
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
        account: CHECKING,
        payee: "CASH ADVANCE ATM",
        category: "Cash",
        tags: ["spending"],
      })
    )
    expect(atm.counts).toBe(true)
    expect(atm.reviewed).toBe(true)
  })

  test("dormant accounts are ignored entirely", () => {
    expect(classify(aCharge({ on: "2026-08-05", amount: 30, account: OLD_CARD })).bucket).toBe(
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
      aCharge({ on: "2026-08-01", amount: 10, account: CARD }),
      aCharge({ on: "2026-08-01", amount: 10, account: CHECKING }),
      aCharge({ on: "2026-08-01", amount: 10, account: SAVINGS }),
      aCharge({ on: "2026-08-01", amount: 10, account: OLD_CARD }),
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
    const tagged = classify(aCharge({ on: "2026-08-05", amount: 60, tags: ["sam"] }))
    expect(tagged.counts).toBe(true)
    expect(tagged.reviewed).toBe(false)
  })
})

describe("Lunch Money's own recurring link", () => {
  test("a linked charge stops counting, without anyone tagging it", () => {
    // The premium arrives on the discretionary card every month. Untagged it
    // counts, so before this the household re-tagged the same charge forever.
    const premium = aCharge({ on: "2026-08-29", amount: 145, payee: "Geico", recurring: true })
    const seen = classify(premium)
    expect(seen.bucket).toBe("recurring")
    expect(seen.counts).toBe(false)
  })

  test("but it is not claimed as reviewed, so it stays in the queue", () => {
    // The inference takes money out of the count, which is the direction this
    // file never guesses in. Staying visible is what pays for the guess.
    const premium = aCharge({ on: "2026-08-29", amount: 145, recurring: true })
    expect(classify(premium).reviewed).toBe(false)
    expect(classify(premium).taggable).toBe(true)
  })

  test("`spending` overrides it, because Lunch Money can link the wrong row", () => {
    const disputed = aCharge({ on: "2026-08-29", amount: 145, recurring: true, tags: ["spending"] })
    expect(classify(disputed).counts).toBe(true)
  })

  test("a matched transfer still beats it — that is a fact, not a reading", () => {
    // A standing monthly transfer to savings can carry a recurring link and
    // still be a movement rather than a commitment; both legs would otherwise
    // report as "recurring" and the money would be counted as planned twice.
    const [out, into] = aTransfer({ on: "2026-08-10", amount: 2_000, from: CHECKING, to: SAVINGS })
    if (!out || !into) throw new Error("no legs")
    const linked: LmTransaction = { ...out, recurring_id: 7 }
    const transfers = findTransfers([linked, into], TEST_CATEGORIES)
    expect(classify(linked, transfers).bucket).toBe("transfer")
  })

  test("payroll keeps its deposit bucket, so it is not asked about twice a month", () => {
    // Income carries a recurring link too. Re-bucketing it would put a salary
    // into the review queue, which the deposit bucket exists to prevent.
    const salary = aDeposit({ on: "2026-08-22", amount: 4_500, payee: "Direct Deposit" })
    const paid = classify({ ...salary, recurring_id: 9 })
    expect(paid.bucket).toBe("deposit")
    expect(paid.counts).toBe(false)
  })
})

describe("negative amounts", () => {
  test("a refund on the card credits the allowance back", () => {
    const result = classify(aRefund({ on: "2026-08-06", amount: 38, payee: "A Retailer" }))
    expect(result.counts).toBe(true)
    expect(result.amount).toBe(-38)
  })

  test("a card autopay never credits the allowance", () => {
    // Categorised as a payment — the stated answer, and the only one available
    // when the far leg falls outside the fetched window.
    const stated = anAutopay({ on: "2026-07-09", amount: 9000, category: "Credit card payment" })
    expect(classify(stated).counts).toBe(false)
  })

  /**
   * What changed when the payee regexes became categories, stated as a test
   * rather than left to be discovered.
   *
   * A regex on the payee caught "AUTOMATIC PAYMENT" whatever Lunch Money had
   * called the row. Categories cannot: Lunch Money does file the occasional
   * autopay under "Income" with the exclude flag unset, and read alone that is
   * a five-figure refund crediting the allowance.
   *
   * It is caught anyway, because the far leg is a row on a tracked bank
   * account that Lunch Money files under "Credit card payment" — so the pair
   * matches structurally and both halves drop out. That is the normal case:
   * an autopay debits an account you track, or it would not be an autopay.
   *
   * The exposure is a leg whose partner is outside the fetched window, and the
   * answer to it is a Lunch Money rule mapping the payee to the category. That
   * rule is documented in the README, and it is a thing a person can see and
   * edit, which the regex never was.
   */
  test("a miscategorised autopay is still caught, by its partner", () => {
    const miscategorised = anAutopay({ on: "2026-08-09", amount: 9000, category: "Income" })
    const debit = anAutopayDebit({ on: "2026-08-09", amount: 9000 })

    const [card, bank] = verdictsFor([miscategorised, debit])
    expect(card?.counts).toBe(false)
    expect(card?.bucket).toBe("transfer")
    expect(bank?.counts).toBe(false)

    // And alone — the case the Lunch Money rule exists to prevent.
    expect(classify(miscategorised).counts).toBe(true)
  })

  test("deposits into a fixed-cost account never count", () => {
    const payroll = aDeposit({
      on: "2026-08-01",
      amount: 6000,
      payee: "DIRECT DEPOSIT PAYROLL",
      into: CHECKING,
    })
    expect(classify(payroll).counts).toBe(false)
  })

  test("a card autopay leaving the bank account is not a review item", () => {
    // It is the card bill being paid, not spending, and it should never appear
    // in the queue — where a five-figure row would be the loudest thing there.
    const result = classify(anAutopayDebit({ on: "2026-08-09", amount: 9000, from: CHECKING }))
    expect(result.bucket).toBe("transfer")
    expect(result.counts).toBe(false)
  })

  test("rent stays a review item, since it is not a transfer", () => {
    const rent = aCharge({
      on: "2026-08-01",
      amount: 5000,
      account: CHECKING,
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

  test("on the card, a credit is a refund unless it is a payment", () => {
    // Lunch Money's exclude flag does not decide this, and neither does the
    // payee any more: a category, or a matched partner, is what marks a payment.
    const credit = aRefund({ on: "2026-08-06", amount: 100, excluded: true })
    expect(classify(credit).counts).toBe(true)
    const payment = anAutopay({ on: "2026-08-09", amount: 100, category: "Credit card payment" })
    expect(classify(payment).counts).toBe(false)
  })
})

describe("reimbursements", () => {
  const aCheque = (over: Partial<Parameters<typeof aDeposit>[0]> = {}) =>
    aDeposit({
      on: "2026-08-07",
      amount: 154,
      into: CHECKING,
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
    const sweep = classify(aSweep({ on: "2026-08-07", amount: 154, account: CHECKING }))
    expect(sweep.bucket).toBe("transfer")
    expect(sweep.reason).toBe("internal account sweep")
  })

  test("payroll and transfers are not reimbursements by default", () => {
    expect(classify(aCheque({ payee: "DIRECT DEPOSIT PAYROLL" })).counts).toBe(false)
    expect(classify(aSweep({ on: "2026-08-07", amount: -154 })).bucket).toBe("transfer")
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
    const payment = anAutopay({ on: "2026-08-09", amount: 4000, category: "Credit card payment" })
    expect(classify(payment).counts).toBe(false)
  })
})

describe("the wallet", () => {
  test("paying a person counts, the way a card charge does", () => {
    const dinner = aWalletPayment({ on: "2026-08-05", amount: 80, payee: "A Friend" })
    expect(classify(dinner).counts).toBe(true)
    expect(classify(dinner).bucket).toBe("spending")
  })

  test("funding the wallet from the bank is a question, not an answer", () => {
    // A rule on the wallet app's bare name used to ignore these outright.
    // It could not tell a tracked
    // wallet (the spend lands there) from an untracked one (so this
    // row is the only record) — same payee, same category, opposite meaning.
    // Only a human knows, so it goes to review instead of being swallowed.
    const topUp = classify(
      aCharge({
        on: "2026-08-02",
        amount: 150,
        account: SAVINGS,
        payee: "A Wallet App",
        category: "Payment, Transfer",
      })
    )
    expect(topUp.counts).toBe(false)
    expect(topUp.bucket).toBe("unclassified")
    expect(topUp.taggable).toBe(true)
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

/**
 * Matching two legs to each other, which is the only rule here that asks a
 * question about the set rather than about one row's payee.
 */
const verdictsFor = (txns: LmTransaction[]) => {
  const transfers = findTransfers(txns, TEST_CATEGORIES)
  return txns.map((t) => classify(t, transfers))
}

describe("transfers between accounts we own", () => {
  const verdicts = verdictsFor

  test("both legs of a bank-to-bank move are transfers, on no payee at all", () => {
    const legs = aTransfer({
      on: "2026-08-10",
      amount: 2000,
      from: CHECKING,
      to: SAVINGS,
    })
    const [out, into] = verdicts(legs)
    expect(out?.bucket).toBe("transfer")
    expect(into?.bucket).toBe("transfer")
    // The reason names the other half, so a row explains itself in the list.
    expect(out?.reason).toContain(SAVINGS)
    expect(into?.reason).toContain(CHECKING)
  })

  test("emptying the wallet into the bank is no longer discretionary spend", () => {
    // The regression this rule exists for. The wallet leg lands on a spending
    // account under a payee no rule recognises, and counted in full.
    const legs = aWalletCashout({ on: "2026-08-20", amount: 400, into: CHECKING })
    const [wallet, bank] = verdicts(legs)
    expect(wallet?.counts).toBe(false)
    expect(wallet?.bucket).toBe("transfer")
    expect(bank?.bucket).toBe("transfer")

    // ...and on its own, with nothing to match against, it still counts.
    const alone = classify(legs[0])
    expect(alone.counts).toBe(true)
  })

  test("a transfer that charges a fee does not match, and is wrong small", () => {
    // An instant cashout takes a percent or two, so the amounts disagree. The
    // wallet leg falls through and counts — visibly, in the review queue.
    const legs = aWalletCashout({ on: "2026-08-20", amount: 400 })
    const shaved = [legs[0], { ...legs[1], amount: "-393.00" }]
    const [wallet] = verdicts(shaved)
    expect(wallet?.counts).toBe(true)
  })

  test("two possible partners match nothing, rather than matching one", () => {
    const transfer = { category: "Payment, Transfer" }
    const legs = [
      aCharge({
        on: "2026-08-10",
        amount: 400,
        account: WALLET,
        payee: "Standard transfer",
        ...transfer,
      }),
      aDeposit({ on: "2026-08-11", amount: 400, into: CHECKING, ...transfer }),
      aDeposit({ on: "2026-08-11", amount: 400, into: SAVINGS, ...transfer }),
    ]
    expect(findTransfers(legs, TEST_CATEGORIES).size).toBe(0)
    const [wallet] = verdicts(legs)
    expect(wallet?.counts).toBe(true)
  })

  test("a partner courted twice matches neither suitor", () => {
    const transfer = { category: "Payment, Transfer" }
    const legs = [
      aCharge({
        on: "2026-08-10",
        amount: 400,
        account: WALLET,
        payee: "Standard transfer",
        ...transfer,
      }),
      aCharge({
        on: "2026-08-10",
        amount: 400,
        account: SAVINGS,
        payee: "A Move",
        ...transfer,
      }),
      aDeposit({ on: "2026-08-11", amount: 400, into: CHECKING, ...transfer }),
    ]
    expect(findTransfers(legs, TEST_CATEGORIES).size).toBe(0)
  })

  test("matching does not depend on the order the transactions arrive in", () => {
    const legs = aTransfer({ on: "2026-08-10", amount: 2000, from: CHECKING, to: WALLET })
    expect(findTransfers(legs, TEST_CATEGORIES).size).toBe(2)
    expect(findTransfers([...legs].reverse(), TEST_CATEGORIES).size).toBe(2)
  })

  test("a leg that lands outside the window is not matched", () => {
    const legs = aTransfer({
      on: "2026-08-10",
      amount: 2000,
      from: CHECKING,
      to: SAVINGS,
      settles: 4,
    })
    expect(findTransfers(legs, TEST_CATEGORIES).size).toBe(0)
  })

  test("opposite rows within one account are not a transfer", () => {
    // A core sweep is equal, opposite and filed as a transfer, but it
    // goes nowhere. Only the two-account rule separates it from a real move.
    const rows = aTransfer({
      on: "2026-08-10",
      amount: 400,
      from: CHECKING,
      to: CHECKING,
    })
    expect(findTransfers(rows, TEST_CATEGORIES).size).toBe(0)
    const [out] = verdicts(rows)
    expect(out?.bucket).toBe("unclassified")
  })

  test("equal and opposite is not enough: it must also read as a transfer", () => {
    // The false match this rule was caught making. A restaurant charge and a
    // cheque three days later satisfy every arithmetic condition and are two
    // separate things, so structure alone may not ignore either one.
    const rows = [
      aCharge({ on: "2026-08-08", amount: 300, payee: "A Restaurant" }),
      aDeposit({ on: "2026-08-11", amount: 300, payee: "CHECK RECEIVED", into: CHECKING }),
    ]
    expect(findTransfers(rows, TEST_CATEGORIES).size).toBe(0)
    const [dinner, cheque] = verdicts(rows)
    expect(dinner?.counts).toBe(true)
    expect(cheque?.bucket).toBe("deposit")
  })

  test("an explicit spending tag still wins, so reimbursements keep working", () => {
    // The one tag that can put money back into the count, and the escape hatch
    // the reimbursement case depends on. A coincidental match must not eat it.
    const rows = aTransfer({
      on: "2026-08-10",
      amount: 400,
      from: CHECKING,
      to: SAVINGS,
      toTags: ["spending"],
    })
    const [out, repaid] = verdicts(rows)
    expect(repaid?.counts).toBe(true)
    expect(repaid?.amount).toBe(-400)
    // The tag speaks for its own row only; the other leg is still a transfer.
    expect(out?.bucket).toBe("transfer")
  })

  test("the card autopay is matched structurally, as well as by payee", () => {
    const legs = [
      anAutopay({ on: "2026-08-09", amount: 9000 }),
      anAutopayDebit({ on: "2026-08-09", amount: 9000, from: CHECKING }),
    ]
    expect(findTransfers(legs, TEST_CATEGORIES).size).toBe(2)
    for (const verdict of verdicts(legs)) expect(verdict.counts).toBe(false)
  })
})

/**
 * The bucket a human can reach. Everything in `transfer` got there by
 * inference, so every row in it has to stay correctable.
 */
describe("saying so by hand", () => {
  test("a transfer tag settles a row nothing could match", () => {
    // Checking -> Wallet: the wallet records the spend, but the
    // arrival is never reported, so there is no second leg to match against.
    const topUp = classify(
      aCharge({
        on: "2026-08-02",
        amount: 1072,
        account: CHECKING,
        payee: "A Wallet App",
        category: "Payment, Transfer",
        tags: ["transfer"],
      })
    )
    expect(topUp.bucket).toBe("transfer")
    expect(topUp.counts).toBe(false)
    expect(topUp.reviewed).toBe(true)
  })

  test("every transfer stays taggable, however it was decided", () => {
    // The one-way door this closes: a row ignored by inference used to render
    // no buttons at all, so a wrong verdict could only be fixed in Lunch Money.
    const matched = verdictsFor(aWalletCashout({ on: "2026-08-20", amount: 400 }))
    const guessed = classify(anAutopay({ on: "2026-08-09", amount: 9000 }))
    const swept = classify(aSweep({ on: "2026-08-07", amount: 154 }))
    for (const verdict of [...matched, guessed, swept]) expect(verdict.taggable).toBe(true)
  })

  test("a spending tag takes a matched leg back, and the row is reachable to do it", () => {
    const legs = aWalletCashout({ on: "2026-08-20", amount: 400 })
    expect(verdictsFor(legs)[0]?.taggable).toBe(true)
    const insisted = [{ ...legs[0], tags: [tag("spending")] }, legs[1]]
    expect(verdictsFor(insisted)[0]?.counts).toBe(true)
  })

  test("an untracked account is the one thing no tag can reach", () => {
    // The check runs before the tags, so a button here would do nothing. Not
    // rendering it is the honest answer.
    const dormant = classify(
      aCharge({ on: "2026-08-05", amount: 40, account: OLD_CARD, tags: ["spending"] })
    )
    expect(dormant.bucket).toBe("ignored")
    expect(dormant.taggable).toBe(false)
    expect(dormant.counts).toBe(false)
  })
})
