/**
 * Which transactions count against the daily allowance.
 *
 * The rule that will bite you: inclusion is PER-ACCOUNT, not global.
 *
 * On a `spending` account — the discretionary card — untagged means "nobody
 * has classified this yet", and it counts. Errors therefore make the number
 * more conservative, not less.
 *
 * On a bank account the same rule is catastrophic: rent and the card autopay
 * both leave from there untagged, and together they outweigh a month of
 * discretionary spending by an order of magnitude. Those are `fixed`, where
 * only an explicit `spending` tag counts — which is also how ATM cash
 * withdrawals make it into the number.
 *
 * Which account is which is configuration rather than code. It arrives as an
 * `Accounts` argument, threaded from `allowance.toml`, so this file names no
 * bank and the same rules ship to anyone.
 */

import { accountNameOf, type LmTransaction } from "../lunchmoney/types"
import { daysBetween } from "./dates"

/**
 * The tags that mean something to the allowance.
 *
 * Fixed vocabulary, not configuration: each one is a branch in `classify()`
 * below, so a household cannot invent a sixth without writing the rule that
 * reads it. Person tags are the opposite — they are configuration, they say
 * who spent it rather than what it was, and nothing here consults them.
 */
export const TAG = {
  recurring: "recurring",
  irregular: "irregular",
  spending: "spending",
  transfer: "transfer",
} as const

/** Tags that classify a transaction for allowance purposes. */
export const CLASSIFYING_TAGS: string[] = [TAG.recurring, TAG.irregular, TAG.spending, TAG.transfer]

/**
 * What an *untagged* transaction on this account means. A tag beats it; this is
 * only the answer when nobody has said anything — and `ignore` is the exception,
 * being a fact about the account rather than a reading of the transaction.
 */
export type AccountPolicy =
  /** Discretionary by default: untagged counts against the allowance. */
  | "spending"
  /** Fixed by default: rent, autopay, transfers. Only a `spending` tag counts. */
  | "fixed"
  /** Dormant or irrelevant. Never counts, never shown in the review queue. */
  | "ignore"

/** The billing cycle of the one account that has one. */
export interface StatementConfig {
  /** Day of the month the statement closes. */
  closeDay: number
  /** Day of the *following* month the autopay debits. */
  dueDay: number
}

export interface AccountConfig {
  policy: AccountPolicy
  /**
   * Set on exactly one account: the credit card whose cycle drives the summary
   * boxes and the reconciliation line. Absent everywhere else.
   */
  statement?: StatementConfig
}

/**
 * The accounts, by the display name Lunch Money gives them.
 *
 * Keyed by the display name because that is the only handle a transaction
 * carries — `accountNameOf()` is a string, and matching it is what policy is.
 * A name that does not match exactly is not an error here; it is an unknown
 * account, which `unknownAccounts()` surfaces rather than swallows.
 */
export type Accounts = Readonly<Record<string, AccountConfig>>

/**
 * Everything the classifier needs to know that is not the transaction.
 *
 * `Config` satisfies this structurally, so a caller that has the config passes
 * it straight through and a test can build the two fields on their own.
 */
export interface Policy {
  accounts: Accounts
  categories: TransferCategories
}

/**
 * Accounts we have never seen are treated as fixed rather than discretionary.
 * A newly linked account should not silently add five figures to the month;
 * `unknownAccounts()` surfaces them so the omission is visible instead.
 */
export const UNKNOWN_ACCOUNT_POLICY: AccountPolicy = "fixed"

export function policyFor(accountName: string, accounts: Accounts): AccountPolicy {
  return accounts[accountName]?.policy ?? UNKNOWN_ACCOUNT_POLICY
}

/**
 * The account whose statement the summary is about, and when it cycles.
 *
 * Exactly one account may carry `statement`; the loader rejects a config with
 * two, so by the time this runs the answer is unambiguous. Null means no card
 * was configured, which is a legitimate setup — the allowance still works, and
 * the summary simply has no statement to show.
 */
export function statementAccount(
  accounts: Accounts
): { name: string; statement: StatementConfig } | null {
  for (const [name, account] of Object.entries(accounts)) {
    if (account.statement) return { name, statement: account.statement }
  }
  return null
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
   * Money moving between places we own — the card autopay, a wallet cashout, a
   * bank-to-bank move, a brokerage's core sweep. Never a spend on either leg, but
   * taggable, because a match can be wrong and a human has to be able to say so.
   */
  | "transfer"
  /**
   * Money arriving in a bank account: payroll, interest, a cheque, an expense
   * reimbursement. Not spending, but taggable — tagging a reimbursement
   * `spending` credits the allowance back for the purchase it repays.
   */
  | "deposit"
  /**
   * Nothing to say and nothing to ask: an account we do not track at all, or a
   * zero-amount row. The only bucket that is not taggable, because no tag could
   * change the answer.
   */
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
 * Money that moved rather than money that went. Taggable on purpose: every way
 * of arriving here is an inference, and the row has to stay reachable so a
 * wrong one can be corrected — see the `spending` exception in `classify()`.
 */
const TRANSFER = (reason: string, amount: number, reviewed = false): Classification => ({
  bucket: "transfer",
  counts: false,
  reviewed,
  taggable: true,
  amount,
  reason,
})

/**
 * Which Lunch Money categories mean a movement rather than a spend.
 *
 * This used to be two regexes over the payee, listing the exact strings one
 * household's bank writes — `cautopay`, `redemption from core`, `acctverify`.
 * They worked, and they were unshippable: they named the institutions, they
 * were invisible to the person who would need to change them, and a household
 * whose bank spells its sweeps differently got silence rather than an error.
 *
 * The categories are better on every count. Lunch Money's own rules assign
 * them — deterministically, from the payee, where the data lives and where a
 * phone can edit them — and a rule is a thing you can look at. It is also the
 * division of labour the rest of this app already assumes: Lunch Money is the
 * store, and classification it can do belongs there.
 *
 * Three lists, because the three have different authority. See
 * `looksLikeTransfer()` for why the last one may never act alone.
 */
export interface TransferCategories {
  /**
   * A payment against a card balance — the bill being settled, on either side.
   * Lunch Money ships "Credit card payment" and Plaid files autopays into it,
   * so this one generally needs no rule.
   *
   * Deliberately not `is_income` or an "Income" category: Lunch Money files
   * genuine merchant refunds that way too, and treating those as settlements
   * silently swallowed money that should have come back.
   */
  cardPayment: string[]
  /**
   * A bank's bookkeeping against itself. A brokerage cash account keeps its
   * balance in a money-market position and sweeps it in and out on every
   * movement, so each real transaction arrives paired with an internal row.
   * Both halves come through with the same generic category and the same
   * exclude flag as a genuine deposit, so only a rule can separate them.
   */
  internalTransfer: string[]
  /**
   * Categories that merely *suggest* a movement, and can never drop a row on
   * their own — Lunch Money files about one real charge a month under
   * "Payment, Transfer". Corroboration for a structural match, nothing more.
   */
  suggestsTransfer: string[]
}

const inCategory = (txn: LmTransaction, names: string[]): boolean =>
  !!txn.category_name && names.some((n) => n.toLowerCase() === txn.category_name?.toLowerCase())

export function isInternalTransfer(txn: LmTransaction, categories: TransferCategories): boolean {
  return inCategory(txn, categories.internalTransfer)
}

/** A payment against the card balance, as opposed to anything bought with it. */
export function isCardPayment(txn: LmTransaction, categories: TransferCategories): boolean {
  return inCategory(txn, categories.cardPayment)
}

/**
 * Does this row look like it might be one half of a movement between accounts?
 *
 * Nothing may be dropped on this evidence alone, and that is the whole point of
 * the name. Lunch Money files about one real charge a month on the card under
 * "Payment, Transfer" — a hotel deposit, a coffee — so a rule that ignored rows
 * for saying so would quietly swallow money. This is only ever a second opinion
 * on a match `findTransfers()` has already made structurally, and it exists
 * because structure alone is not enough either: a $300 restaurant charge and a
 * $300 cheque three days later are equal, opposite and in different accounts,
 * and are not a transfer.
 */
export function looksLikeTransfer(txn: LmTransaction, categories: TransferCategories): boolean {
  return (
    isCardPayment(txn, categories) ||
    isInternalTransfer(txn, categories) ||
    inCategory(txn, categories.suggestsTransfer)
  )
}

/**
 * Two legs of one movement, matched to each other.
 *
 * The rules above ask "does this payee look like a transfer", which is a guess
 * about a string, and every one of them names a particular bank. This asks a
 * structural question instead: did an equal and opposite amount land in another
 * account we own, within the few days a transfer takes to settle? When both
 * legs are in the data that is not a guess, it is the definition — and it
 * subsumes the card autopay, the wallet cashout and a plain bank-to-bank move
 * under one rule that names nothing.
 *
 * What it cannot do is see one leg. Money sent somewhere Lunch Money does not
 * track reports a single row with nothing to match against, and that row goes
 * to review rather than being guessed at.
 *
 * A top-up into a tracked wallet is the case worth naming, because a comment
 * here claimed for a long time that it was "caught by payee alone". It was
 * not: the payee is the bare name of the wallet app, which matched none of the
 * payee rules that existed then either. What actually catches it is this
 * function — the wallet's own credit is the far leg — with the bank row's
 * category corroborating. When the wallet is *not* in Lunch Money there is no
 * far leg, and that is exactly the ambiguity a human has to resolve.
 */

/** How long a transfer may take to appear on the far side. */
export const TRANSFER_WINDOW_DAYS = 3

export interface TransferLeg {
  /** The transaction on the other side of the same movement. */
  counterpart: LmTransaction
}

/** Transaction id to the leg it was matched with. Absent means unmatched. */
export type TransferIndex = ReadonlyMap<number, TransferLeg>

/** Whole cents, so two amounts that print the same compare the same. */
const centsOf = (txn: LmTransaction): number => Math.round(Number.parseFloat(txn.amount) * 100)

/** Days between two dates, in either order. */
const gap = (a: string, b: string): number => daysBetween(a < b ? a : b, a < b ? b : a) - 1

/**
 * Matches are monogamous in both directions: a leg with two possible partners
 * matches neither, and neither does a partner courted twice. Ambiguity
 * therefore falls back to asking a human rather than to ignoring money, which
 * is the direction this file errs everywhere else, and it makes the result
 * independent of the order the transactions arrive in.
 *
 * Measured against sixteen weeks of the real feed: six matches, all genuine,
 * one ambiguous pair correctly skipped. Widening the window to five days is
 * where it starts matching unrelated cent-sized rows to each other.
 *
 * Amounts must agree exactly, so a transfer that charges a fee — an instant
 * cashout typically takes 1–2% — has no match and falls through to the rules
 * above. That is the intended failure: wrong small, and visible.
 *
 * One leg must also read as a transfer to `looksLikeTransfer()`. Structure
 * alone was not enough: a $300 restaurant charge and a $300 cheque three days
 * later satisfy every arithmetic condition here and are two separate things.
 * Neither signal may drop a row by itself — see that function — but a category
 * of "Payment, Transfer" *on a row that also has an equal and opposite partner
 * in another account* is a very different claim from the same category alone.
 */
export function findTransfers(
  txns: LmTransaction[],
  categories: TransferCategories
): TransferIndex {
  const leaving = txns.filter((t) => centsOf(t) > 0)
  const arriving = txns.filter((t) => centsOf(t) < 0)

  const candidatesFor = new Map<number, LmTransaction[]>()
  const suitorsOf = new Map<number, LmTransaction[]>()

  for (const out of leaving) {
    const matches = arriving.filter(
      (into) =>
        centsOf(into) === -centsOf(out) &&
        accountNameOf(into) !== accountNameOf(out) &&
        gap(out.date, into.date) <= TRANSFER_WINDOW_DAYS &&
        (looksLikeTransfer(out, categories) || looksLikeTransfer(into, categories))
    )
    candidatesFor.set(out.id, matches)
    for (const into of matches) suitorsOf.set(into.id, [...(suitorsOf.get(into.id) ?? []), out])
  }

  const index = new Map<number, TransferLeg>()
  for (const out of leaving) {
    const matches = candidatesFor.get(out.id) ?? []
    const [into] = matches
    if (matches.length !== 1 || !into) continue
    if ((suitorsOf.get(into.id) ?? []).length !== 1) continue
    index.set(out.id, { counterpart: into })
    index.set(into.id, { counterpart: out })
  }
  return index
}

export function tagNames(txn: LmTransaction): string[] {
  return txn.tags.map((t) => t.name.toLowerCase())
}

/**
 * `transfers` is the index from `findTransfers()`, built over the whole fetched
 * window. Omitting it costs only the pairing rule, which is why the domain
 * tests can still classify a single transaction on its own.
 */
export function classify(
  txn: LmTransaction,
  { accounts, categories }: Policy,
  transfers?: TransferIndex
): Classification {
  const amount = Number.parseFloat(txn.amount)
  const account = accountNameOf(txn)
  const policy = policyFor(account, accounts)
  const tags = tagNames(txn)

  // Structural facts first, and they beat the tags: an untracked account, a
  // zero amount and a matched pair of legs are things the data *is*, not
  // guesses about it, and there is no answer a human could usefully give.
  //
  // The exception is `spending`, the only tag that can put money back into the
  // count rather than merely re-bucket a row, and the escape hatch the
  // reimbursement case below depends on. The others are safe to override
  // because they cannot change the number, only where the row is filed.
  if (policy === "ignore") return IGNORED(`${account} is not tracked`, amount)
  if (amount === 0) return IGNORED("zero amount", amount)

  const paired = transfers?.get(txn.id)
  if (paired && !tags.includes(TAG.spending)) {
    const other = paired.counterpart
    return TRANSFER(`the other leg is on ${accountNameOf(other)}, ${other.date}`, amount)
  }

  // An explicit tag beats every payee heuristic below, and Lunch Money's own
  // exclude flag with it. Without this a reimbursement could never be counted,
  // because the deposit that repays it arrives flagged as a transfer.
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
  if (tags.includes(TAG.transfer)) return TRANSFER("tagged transfer", amount, true)
  if (tags.includes(TAG.spending))
    return {
      bucket: "spending",
      counts: true,
      reviewed: true,
      taggable: true,
      amount,
      reason: "tagged spending",
    }

  // Below here everything is a guess about a payee, so an explicit tag wins.
  if (isInternalTransfer(txn, categories)) return TRANSFER("internal account sweep", amount)

  if (policy === "fixed") {
    // `exclude_from_totals` is not consulted here: a sweeping account's double
    // entry sets it on real deposits as well as on the sweeps, so it hides the
    // very transactions a reimbursement needs.
    if (isCardPayment(txn, categories)) return TRANSFER("credit card payment", amount)
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
    if (isCardPayment(txn, categories)) return TRANSFER("payment against the card balance", amount)
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
export function unknownAccounts(txns: LmTransaction[], accounts: Accounts): string[] {
  const seen = new Set<string>()
  for (const txn of txns) {
    const name = accountNameOf(txn)
    if (!(name in accounts)) seen.add(name)
  }
  return [...seen].sort()
}
