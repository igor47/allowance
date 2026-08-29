/**
 * The accounts every scenario is written against.
 *
 * Policy keys on the account's display name, so a scenario that invents one
 * would land in `UNKNOWN_ACCOUNT_POLICY` and pass for the wrong reason. These
 * constants — and the `TestAccount` union built from them — make that a type
 * error instead, which is the whole reason the verbs in `world.ts` refuse a
 * bare string.
 *
 * They are deliberately generic. A test that reads "a charge on Card, a
 * transfer to Savings" says what the rule is about; one naming a real bank says
 * only that the rule happened to be written by someone who banks there. The
 * same five names appear in `allowance.example.toml`, so the shipped example
 * and the suite describe the same world.
 */

import type { Accounts } from "../domain/policy"

/** The discretionary card. Untagged charges here count. */
export const CARD = "Card"
/** A tracked cash wallet — the other place untagged money is discretionary. */
export const WALLET = "Wallet"
/** Everyday bank account: rent and the card autopay leave from here. */
export const CHECKING = "Checking"
/** The other bank account, joint. Also `fixed`. */
export const SAVINGS = "Savings"
/** Dormant. Present so the `ignore` policy has something to be about. */
export const OLD_CARD = "Old Card"

export type TestAccount =
  | typeof CARD
  | typeof WALLET
  | typeof CHECKING
  | typeof SAVINGS
  | typeof OLD_CARD

/**
 * The policy the suite assumes. Mirrors `[accounts]` in the example config:
 * two `spending`, two `fixed`, one `ignore`, and the statement on the card.
 */
export const TEST_ACCOUNTS: Accounts = {
  [CARD]: { policy: "spending", statement: { closeDay: 12, dueDay: 9 } },
  [WALLET]: { policy: "spending" },
  [CHECKING]: { policy: "fixed" },
  [SAVINGS]: { policy: "fixed" },
  [OLD_CARD]: { policy: "ignore" },
}
