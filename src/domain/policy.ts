/**
 * Which transactions count against the daily allowance.
 *
 * The rule that will bite you: inclusion is PER-ACCOUNT, not global.
 *
 * On Card — the discretionary card — untagged means "nobody has
 * classified this yet", and it counts. Errors therefore make the number more
 * conservative, not less.
 *
 * On Fidelity the same rule is catastrophic: rent and the credit card autopay
 * leave from there untagged. Aug 1-13 reads $23,370 under a global
 * untagged-counts rule versus $3,157 for Chase alone. So Fidelity is opt-in —
 * only an explicit `spending` tag counts, which is how ATM cash withdrawals
 * make it into the number.
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

export type AccountPolicy =
  /** Untagged counts against the allowance. The discretionary card. */
  | "default-in"
  /** Untagged is assumed fixed. Only an explicit `spending` tag counts. */
  | "default-out"
  /** Dormant or irrelevant. Never counts, never shown in the review queue. */
  | "ignore"

export const ACCOUNT_POLICY: Record<string, AccountPolicy> = {
  "Card": "default-in",
  "Checking": "default-out",
  "Savings": "default-out",
  "Old Card": "ignore",
}

/**
 * Accounts we have never seen are treated as fixed rather than discretionary.
 * A newly linked account should not silently add five figures to the month;
 * `unknownAccounts()` surfaces them so the omission is visible instead.
 */
export const UNKNOWN_ACCOUNT_POLICY: AccountPolicy = "default-out"

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
  /** Assumed fixed because it is on a default-out account and untagged. */
  | "assumed-fixed"
  /**
   * Money arriving in a bank account: payroll, interest, a cheque, an expense
   * reimbursement. Not spending, but taggable — tagging a reimbursement
   * `spending` credits the allowance back for the purchase it repays.
   */
  | "deposit"
  /** Transfers, payments, income, dormant accounts. Never a spend. */
  | "excluded"

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

const EXCLUDED = (reason: string, amount: number): Classification => ({
  bucket: "excluded",
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
 * genuine deposit from bookkeeping — a work reimbursement ("DIRECT DEPOSIT
 * Fractional ...") is indistinguishable from its own sweep by category alone.
 *
 * The payee is what separates them. These patterns are the internal half.
 */
const INTERNAL_TRANSFER = /redemption from core|purchase into core|transferred from vs|acctverify/i

/**
 * Card payments: the bill being settled, on either side of the transaction.
 *
 * Deliberately NOT keyed on `is_income` or an "Income" category. Lunch Money
 * files genuine merchant refunds that way too — a $195 credit from A Theatre
 * arrived as category "Income" — and treating those as settlements silently
 * swallowed money that should have come back. A refund is never called
 * "AUTOMATIC PAYMENT".
 */
const CARD_PAYMENT = /automatic payment|credit card payment|crcardpmt|cautopay|chase credit/i

export function isInternalTransfer(txn: LmTransaction): boolean {
  return INTERNAL_TRANSFER.test(`${txn.payee ?? ""} ${txn.original_name ?? ""}`)
}

export function looksLikeSettlement(txn: LmTransaction): boolean {
  const name = `${txn.payee ?? ""} ${txn.original_name ?? ""}`
  if (CARD_PAYMENT.test(name)) return true
  if (INTERNAL_TRANSFER.test(name)) return true
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

  if (policy === "ignore") return EXCLUDED(`${account} is not tracked`, amount)

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

  if (isInternalTransfer(txn)) return EXCLUDED("internal account sweep", amount)
  if (amount === 0) return EXCLUDED("zero amount", amount)

  if (policy === "default-out") {
    // `exclude_from_totals` is not consulted here: Fidelity's double entry sets
    // it on real deposits as well as their sweeps, so it hides the very
    // transactions a reimbursement needs.
    if (CARD_PAYMENT.test(`${txn.payee ?? ""} ${txn.original_name ?? ""}`))
      return EXCLUDED("credit card payment", amount)
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
      bucket: "assumed-fixed",
      counts: false,
      reviewed: false,
      taggable: true,
      amount,
      reason: "not counted — `spending` to include it, `recurring` to stop asking",
    }
  }

  // The discretionary card. Lunch Money's exclude flag is trustworthy here —
  // it is how a superseded pending duplicate is marked.
  if (txn.exclude_from_totals) return EXCLUDED("excluded from totals in Lunch Money", amount)
  if (amount < 0) {
    if (looksLikeSettlement(txn)) return EXCLUDED("card payment or transfer", amount)
    return {
      bucket: "spending",
      counts: true,
      reviewed: false,
      taggable: true,
      amount,
      reason: "refund",
    }
  }
  return {
    bucket: "spending",
    counts: true,
    reviewed: false,
    taggable: true,
    amount,
    reason: "untagged on the discretionary card",
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
