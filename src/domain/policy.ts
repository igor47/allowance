/**
 * Which transactions count against the daily allowance.
 *
 * The rule that will bite you: inclusion is PER-ACCOUNT, not global.
 *
 * On Card — the discretionary card — untagged means "nobody has
 * classified this yet", and it counts. Errors therefore make the number more
 * conservative, not less.
 *
 * On Checking the same rule is catastrophic: rent and the Chase autopay
 * both leave from there untagged, and together they outweigh a month of
 * discretionary spending by an order of magnitude. So the bank accounts are
 * opt-in — only an explicit `spending` tag counts, which is how ATM cash
 * withdrawals make it into the number.
 */

import { accountNameOf, type LmTransaction } from "../lunchmoney/types"

export const TAG = {
  recurring: "recurring",
  irregular: "irregular",
  spending: "spending",
  igor: "igor",
  serena: "serena",
} as const

/** Tags that classify a transaction for allowance purposes. */
export const CLASSIFYING_TAGS: string[] = [TAG.recurring, TAG.irregular, TAG.spending]

/** Tags that attribute a transaction to a person. Orthogonal to the math. */
export const PERSON_TAGS: string[] = [TAG.igor, TAG.serena]

/**
 * What an *untagged* transaction on this account means. A tag always wins;
 * this is only the answer when nobody has said anything.
 */
export type AccountPolicy =
  /** Discretionary by default: untagged counts against the allowance. */
  | "spending"
  /** Fixed by default: rent, autopay, transfers. Only a `spending` tag counts. */
  | "fixed"
  /** Dormant or irrelevant. Never counts, never shown in the review queue. */
  | "ignore"

/**
 * The accounts, by the display name Lunch Money gives them.
 *
 * Exported as constants because policy keys on the name: a scenario that
 * invents one silently lands in `UNKNOWN_ACCOUNT_POLICY` and passes for the
 * wrong reason. These are production configuration, not private data.
 */
export const CHASE = "Card"
export const VENMO = "Wallet"
export const IGOR_PERSONAL = "Checking"
export const FIDELITY_JOINT = "Savings"
export const CHASE_UNITED = "Old Card"

/** An account the policy has an opinion about. Anything else is unknown. */
export type KnownAccount =
  | typeof CHASE
  | typeof VENMO
  | typeof IGOR_PERSONAL
  | typeof FIDELITY_JOINT
  | typeof CHASE_UNITED

export const ACCOUNT_POLICY: Record<string, AccountPolicy> = {
  [CHASE]: "spending",
  [VENMO]: "spending",
  [IGOR_PERSONAL]: "fixed",
  [FIDELITY_JOINT]: "fixed",
  [CHASE_UNITED]: "ignore",
}

/**
 * Accounts we have never seen are treated as fixed rather than discretionary.
 * A newly linked account should not silently add five figures to the month;
 * `unknownAccounts()` surfaces them so the omission is visible instead.
 */
export const UNKNOWN_ACCOUNT_POLICY: AccountPolicy = "fixed"

export function policyFor(accountName: string): AccountPolicy {
  return ACCOUNT_POLICY[accountName] ?? UNKNOWN_ACCOUNT_POLICY
}

export type Bucket =
  /** Counts against the allowance. */
  | "spending"
  /** Fixed cost — autopay, subscriptions, memberships. */
  | "recurring"
  /** Lumpy but not a daily choice — memory care, vet emergencies, dental. */
  | "irregular"
  /** Nobody has said what this is; it sits on a `fixed` account. */
  | "unclassified"
  /**
   * Money arriving in a bank account: payroll, interest, a cheque, an expense
   * reimbursement. Not spending, but taggable — tagging a reimbursement
   * `spending` credits the allowance back for the purchase it repays.
   */
  | "deposit"
  /** Transfers, payments, dormant accounts. Never a spend, never taggable. */
  | "ignored"

export interface Classification {
  bucket: Bucket
  /** Does this draw down the allowance? */
  counts: boolean
  /** Has a human classified it, or is this the account default? */
  reviewed: boolean
  /** Can a tag change the answer? False for transfers and dormant accounts. */
  taggable: boolean
  /** Signed dollars applied to spend. Negative for refunds. */
  amount: number
  /** Why, in a few words — rendered in the UI so the math is never a mystery. */
  reason: string
}

const IGNORED = (reason: string, amount: number): Classification => ({
  bucket: "ignored",
  counts: false,
  reviewed: false,
  taggable: false,
  amount,
  reason,
})

/**
 * Fidelity keeps cash in a money-market position and sweeps it in and out on
 * every movement, so each real transaction arrives paired with an internal
 * sweep. Both halves come through categorised "Payment, Transfer" and flagged
 * `exclude_from_totals`, which makes those two signals useless for telling a
 * genuine deposit from bookkeeping — a work reimbursement arriving as
 * "DIRECT DEPOSIT <employer> ..." is indistinguishable from its own sweep by
 * category alone.
 *
 * The payee is what separates them. These patterns are the internal half.
 */
const INTERNAL_TRANSFER = /redemption from core|purchase into core|transferred from vs|acctverify/i

/**
 * Topping up the wallet, or emptying it back into the bank.
 *
 * Venmo reports only its own person-to-person half — every row on that account
 * is named after a person, and the funding never appears there at all. It shows
 * up on the bank side instead, with a payee of exactly "Venmo": no name, no
 * memo, which is precisely what separates it from the wallet's own rows. Across
 * three months the split is total — 9 bank rows say "Venmo" and none of the 14
 * wallet rows do.
 *
 * Both directions are internal. The spend is counted where it was spent, so
 * moving the money there must not count again, and moving it back is not a
 * refund. This also swallows the ±$0.01 and ±$0.22 pairs Venmo used to verify
 * the account.
 */
const WALLET_TRANSFER = /^venmo$/i

/**
 * Card payments: the bill being settled, on either side of the transaction.
 *
 * Deliberately NOT keyed on `is_income` or an "Income" category. Lunch Money
 * files genuine merchant refunds that way too — a real theatre credit arrived
 * as category "Income" — and treating those as settlements silently swallowed
 * money that should have come back. A refund is never called
 * "AUTOMATIC PAYMENT".
 */
const CARD_PAYMENT = /automatic payment|credit card payment|crcardpmt|cautopay|chase credit/i

export function isInternalTransfer(txn: LmTransaction): boolean {
  return INTERNAL_TRANSFER.test(`${txn.payee ?? ""} ${txn.original_name ?? ""}`)
}

/** Money moving between a bank account and a wallet like Venmo. Never a spend. */
export function isWalletTransfer(txn: LmTransaction): boolean {
  return WALLET_TRANSFER.test((txn.payee ?? "").trim())
}

/** A payment against the card balance, as opposed to anything bought with it. */
export function isCardPayment(txn: LmTransaction): boolean {
  return CARD_PAYMENT.test(`${txn.payee ?? ""} ${txn.original_name ?? ""}`)
}

export function looksLikeSettlement(txn: LmTransaction): boolean {
  const name = `${txn.payee ?? ""} ${txn.original_name ?? ""}`
  if (CARD_PAYMENT.test(name)) return true
  if (INTERNAL_TRANSFER.test(name)) return true
  if (isWalletTransfer(txn)) return true
  return !!txn.category_name && /payment|transfer/i.test(txn.category_name)
}

export function tagNames(txn: LmTransaction): string[] {
  return txn.tags.map((t) => t.name.toLowerCase())
}

export function classify(txn: LmTransaction): Classification {
  const amount = Number.parseFloat(txn.amount)
  const account = accountNameOf(txn)
  const policy = policyFor(account)
  const tags = tagNames(txn)

  if (policy === "ignore") return IGNORED(`${account} is not tracked`, amount)

  // An explicit tag beats every heuristic, including Lunch Money's own exclude
  // flag. Without this a reimbursement could never be counted, because the
  // deposit that repays it arrives flagged as a transfer.
  if (tags.includes(TAG.recurring))
    return {
      bucket: "recurring",
      counts: false,
      reviewed: true,
      taggable: true,
      amount,
      reason: "tagged recurring",
    }
  if (tags.includes(TAG.irregular))
    return {
      bucket: "irregular",
      counts: false,
      reviewed: true,
      taggable: true,
      amount,
      reason: "tagged irregular",
    }
  if (tags.includes(TAG.spending))
    return {
      bucket: "spending",
      counts: true,
      reviewed: true,
      taggable: true,
      amount,
      reason: "tagged spending",
    }

  if (isInternalTransfer(txn)) return IGNORED("internal account sweep", amount)
  if (isWalletTransfer(txn)) return IGNORED("moving money in or out of the wallet", amount)
  if (amount === 0) return IGNORED("zero amount", amount)

  if (policy === "fixed") {
    // `exclude_from_totals` is not consulted here: Fidelity's double entry sets
    // it on real deposits as well as their sweeps, so it hides the very
    // transactions a reimbursement needs.
    if (CARD_PAYMENT.test(`${txn.payee ?? ""} ${txn.original_name ?? ""}`))
      return IGNORED("credit card payment", amount)
    if (amount < 0)
      return {
        bucket: "deposit",
        counts: false,
        reviewed: false,
        taggable: true,
        amount,
        reason: "deposit — tag it `spending` if it reimburses one",
      }
    return {
      bucket: "unclassified",
      counts: false,
      reviewed: false,
      taggable: true,
      amount,
      reason: "not counted — `spending` to include it, `recurring` to stop asking",
    }
  }

  // A spending account: the discretionary card, and the wallet.
  //
  // Categories here are good — 697 of 701 charges over three months carried a
  // real merchant category and none were uncategorised. But roughly one a
  // month lands in "Payment, Transfer" and picks up `exclude_from_totals` from
  // it, and when that happens the charge is real: a hotel deposit, a coffee, a
  // refund. Three were corrected by hand; another arrived the same week.
  //
  // So neither signal is consulted to *drop* a charge. Counting it and saying
  // so in the reason errs towards overstating spend, which is the direction
  // this file errs everywhere else. Only the payee marks a payment.
  if (amount < 0) {
    if (isCardPayment(txn)) return IGNORED("payment against the card balance", amount)
    return {
      bucket: "spending",
      counts: true,
      reviewed: false,
      taggable: true,
      amount,
      reason: txn.exclude_from_totals ? "refund — Lunch Money excludes it, counted here" : "refund",
    }
  }
  return {
    bucket: "spending",
    counts: true,
    reviewed: false,
    taggable: true,
    amount,
    reason: txn.exclude_from_totals
      ? `counted despite Lunch Money excluding it (${txn.category_name ?? "no category"})`
      : `untagged on ${account}`,
  }
}

/** Account names present in the data that have no explicit policy. */
export function unknownAccounts(txns: LmTransaction[]): string[] {
  const seen = new Set<string>()
  for (const txn of txns) {
    const name = accountNameOf(txn)
    if (!(name in ACCOUNT_POLICY)) seen.add(name)
  }
  return [...seen].sort()
}
