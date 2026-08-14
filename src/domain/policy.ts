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
  /** Transfers, payments, income, dormant accounts. Never a spend. */
  | "excluded"

export interface Classification {
  bucket: Bucket
  /** Does this draw down the allowance? */
  counts: boolean
  /** Has a human classified it, or is this the account default? */
  reviewed: boolean
  /** Signed dollars applied to spend. Negative for refunds. */
  amount: number
  /** Why, in a few words — rendered in the UI so the math is never a mystery. */
  reason: string
}

const EXCLUDED = (reason: string, amount: number): Classification => ({
  bucket: "excluded",
  counts: false,
  reviewed: false,
  amount,
  reason,
})

/**
 * Card payments and account transfers arrive as large negative amounts. If they
 * were treated as refunds a single autopay would hand back $19k of allowance,
 * so they are matched explicitly rather than trusted to `exclude_from_totals` —
 * which Lunch Money sets inconsistently (the 2026-07-09 Chase autopay came
 * through as category "Income" with the flag unset).
 */
const SETTLEMENT_CATEGORY = /payment|transfer|income/i
const SETTLEMENT_PAYEE =
  /automatic payment|credit card payment|crcardpmt|cautopay|redemption from core/i

export function looksLikeSettlement(txn: LmTransaction): boolean {
  if (txn.is_income) return true
  if (txn.category_name && SETTLEMENT_CATEGORY.test(txn.category_name)) return true
  const name = `${txn.payee ?? ""} ${txn.original_name ?? ""}`
  return SETTLEMENT_PAYEE.test(name)
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
  if (txn.exclude_from_totals) return EXCLUDED("excluded from totals in Lunch Money", amount)

  // An explicit tag always wins, including over the settlement heuristics —
  // it is the manual override that keeps the rules from being a cage.
  if (tags.includes(TAG.recurring))
    return {
      bucket: "recurring",
      counts: false,
      reviewed: true,
      amount,
      reason: "tagged recurring",
    }
  if (tags.includes(TAG.irregular))
    return {
      bucket: "irregular",
      counts: false,
      reviewed: true,
      amount,
      reason: "tagged irregular",
    }
  if (tags.includes(TAG.spending))
    return { bucket: "spending", counts: true, reviewed: true, amount, reason: "tagged spending" }

  if (amount < 0) {
    // A refund credits the allowance back; a payment or deposit must not.
    if (policy === "default-out") return EXCLUDED("deposit into a fixed-cost account", amount)
    if (looksLikeSettlement(txn)) return EXCLUDED("card payment or transfer", amount)
    return { bucket: "spending", counts: true, reviewed: false, amount, reason: "refund" }
  }

  if (amount === 0) return EXCLUDED("zero amount", amount)

  if (policy === "default-in")
    return {
      bucket: "spending",
      counts: true,
      reviewed: false,
      amount,
      reason: "untagged on the discretionary card",
    }

  return {
    bucket: "assumed-fixed",
    counts: false,
    reviewed: false,
    amount,
    reason: `untagged on ${account} — tag it \`spending\` to count it`,
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
