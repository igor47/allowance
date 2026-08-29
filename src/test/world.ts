/**
 * A scenario is a world, not a transaction list.
 *
 * The four things Lunch Money would tell us — transactions, accounts, recurring
 * items — plus the two things only a test knows: what day it is, and what
 * instant it is. They travel together because they have to agree: a charge
 * dated after `today` is a bug in the scenario, not a case worth covering, and
 * `today` drifting from the clock used to be a real class of mistake here.
 *
 * The verbs below are thin wrappers over `factories.ts` that hide the three
 * conventions which trip people up — the sign, the posted date, and the account
 * name — so a scenario reads as a sentence about money rather than as a struct.
 */

import type { Config } from "../config"
import { addDays, type IsoDate } from "../domain/dates"
import type { LmPlaidAccount, LmRecurringItem, LmTransaction } from "../lunchmoney/types"
import { CARD, CHECKING, TEST_ACCOUNTS, type TestAccount, WALLET } from "./accounts"
import { account, metadata, recurringItem, type TxnOverrides, txn } from "./factories"

export interface World {
  transactions: LmTransaction[]
  accounts: LmPlaidAccount[]
  recurring: LmRecurringItem[]
  today: IsoDate
  now: Date
  config: Config
}

/**
 * Written out in full rather than spread over the real config, so no
 * environment variable and no file on disk can move the numbers a scenario
 * asserts on. A round $200/day, because the rule reads better against a figure
 * you can do in your head.
 */
export const TEST_CONFIG: Config = {
  port: 0,
  timezone: "America/Los_Angeles",
  lunchMoneyApiKey: "test",
  cacheTtlSeconds: 0,
  refreshAfterMinutes: 30,
  allowance: { periodStart: "2026-08-01", dailyTarget: 200, rolloverCapDays: 14 },
  historyStart: "2025-01",
  accounts: TEST_ACCOUNTS,
  people: [
    { tag: "alex", label: "Alex", short: "A" },
    { tag: "sam", label: "Sam", short: "S" },
  ],
}

const DEFAULT_TODAY = "2026-08-14"

/** Late enough in the day that a same-day import reads as fresh, not stale. */
const instantFor = (today: IsoDate) => new Date(`${today}T21:00:00.000Z`)

interface Timings {
  imported: string
  read: string
}

const timingsFor = (today: IsoDate): Timings => ({
  imported: `${today}T04:00:00.000Z`,
  read: `${today}T20:00:00.000Z`,
})

export interface WorldOptions {
  today?: IsoDate
  /** Defaults to the evening of `today`, so staleness never needs stating. */
  now?: Date
  config?: Partial<Config>
}

export interface ChargeOptions {
  /** The day the card was used. Lunch Money's date. */
  on: IsoDate
  /** Dollars. Positive is money leaving, on every verb. */
  amount: number
  payee?: string
  tags?: string[]
  account?: TestAccount
  /** When Chase posted it, if that is not the day it was made. */
  posted?: IsoDate
  category?: string
  /** Lunch Money's `exclude_from_totals`. */
  excluded?: boolean
  pending?: boolean
  /** The raw statement descriptor, when a test cares that it differs. */
  descriptor?: string
}

export interface DepositOptions {
  on: IsoDate
  amount: number
  into?: TestAccount
  payee?: string
  tags?: string[]
  category?: string
  excluded?: boolean
}

export interface SweepOptions {
  on: IsoDate
  amount: number
  account?: TestAccount
}

export interface TransferOptions {
  /** The day the money leaves `from`. */
  on: IsoDate
  /** Dollars. Positive is money leaving, as on every verb. */
  amount: number
  from: TestAccount
  to: TestAccount
  /** Days the far leg takes to land. One, as the real feeds report it. */
  settles?: number
  /**
   * Payees, when a test cares. The defaults deliberately match none of the
   * payee rules in `policy.ts`, so a scenario that passes proves the pairing
   * did the work rather than a regex quietly doing it first.
   */
  fromPayee?: string
  toPayee?: string
  fromTags?: string[]
  toTags?: string[]
}

export interface CashoutOptions {
  /** The day the wallet reports it. The bank lands it `settles` days later. */
  on: IsoDate
  amount: number
  into?: TestAccount
  settles?: number
}

export interface WalletPaymentOptions {
  on: IsoDate
  amount: number
  payee: string
  tags?: string[]
  category?: string
  excluded?: boolean
}

export interface AutopayOptions {
  /** The day the payment posts to the card — the statement's due date. */
  on: IsoDate
  amount: number
  /**
   * The bank account it debits. Given, the matching outflow is added there
   * too, a day later, exactly as the real feed reports it.
   */
  from?: TestAccount
  /** When the bank side lands, if not the day after. */
  debitedOn?: IsoDate
  /** When Chase posted the credit, if that is not the day it ran. */
  posted?: IsoDate
  /**
   * Lunch Money's category. Worth overriding: it files some autopays under
   * "Income" with the exclude flag unset, which is why neither signal decides.
   */
  category?: string
}

export interface SubscriptionOptions {
  payee: string
  amount: number
  cadence?: string
  granularity?: string
  quantity?: number
  /** False for a manually-managed account: no feed, so nothing can ever link. */
  tracked?: boolean
  /** Dates in the period the plan expected and nothing arrived for. */
  missing?: IsoDate[]
  /** Dates the plan expects a charge on, when the cadence alone cannot say. */
  expected?: IsoDate[]
  /** How many transactions Lunch Money linked to it this period. */
  matched?: number
}

/**
 * A world under construction. Every verb returns `this`, and the builder *is*
 * the world, so it can be handed straight to `useTestApp` or `dashboard`.
 */
export class WorldBuilder implements World {
  readonly transactions: LmTransaction[] = []
  readonly accounts: LmPlaidAccount[] = []
  readonly recurring: LmRecurringItem[] = []
  readonly today: IsoDate
  readonly now: Date
  config: Config

  constructor(options: WorldOptions = {}) {
    this.today = options.today ?? DEFAULT_TODAY
    this.now = options.now ?? instantFor(this.today)
    this.config = { ...TEST_CONFIG, ...options.config }
    // The card is always there. A scenario that says nothing about accounts
    // still renders the summary boxes and reads as freshly synced, which is
    // what lets most of them be three lines long.
    this.account(CARD, { balance: "0", to_base: 0 })
  }

  /** Override the allowance parameters without restating the rest of the config. */
  allowance(over: Partial<Config["allowance"]>): this {
    this.config = { ...this.config, allowance: { ...this.config.allowance, ...over } }
    return this
  }

  /**
   * Declare an account. Called twice for the same name, the second wins —
   * so the constructor's default card can be replaced with a balance.
   */
  account(name: TestAccount, over: Partial<LmPlaidAccount> = {}): this {
    const timings = timingsFor(this.today)
    const built = account({
      display_name: name,
      name,
      type: name === CARD ? "credit" : "cash",
      balance_last_update: timings.read,
      last_import: timings.imported,
      last_fetch: timings.read,
      plaid_last_successful_update: timings.read,
      ...over,
      // A balance given as a string should still reach `to_base`, which is what
      // the dashboard actually reads.
      to_base: over.to_base ?? (over.balance ? Number.parseFloat(over.balance) : 0),
    })
    const existing = this.accounts.findIndex((a) => (a.display_name ?? a.name) === name)
    if (existing >= 0) this.accounts.splice(existing, 1, built)
    else this.accounts.push(built)
    return this
  }

  /** The escape hatch, for a shape no verb describes. Prefer a verb. */
  transaction(overrides: TxnOverrides): this {
    this.transactions.push(txn(overrides))
    return this
  }

  /** Money spent. Positive `amount`; no test should type a minus sign. */
  charge(options: ChargeOptions): this {
    this.transactions.push(aCharge(options))
    return this
  }

  /** Money coming back from a merchant. Also positive; the verb negates it. */
  refund(options: ChargeOptions): this {
    this.transactions.push(aRefund(options))
    return this
  }

  /** Money arriving in a bank account: payroll, a cheque, a reimbursement. */
  deposit(options: DepositOptions): this {
    this.transactions.push(aDeposit(options))
    return this
  }

  /**
   * The card bill being settled. Lands on the card as a credit on the due date,
   * and — if a bank is named — as a debit there a day or two later, which is
   * how Plaid actually reports the pair.
   */
  autopay(options: AutopayOptions): this {
    this.transactions.push(anAutopay(options))
    if (options.from) this.transactions.push(anAutopayDebit(options))
    return this
  }

  /** Fidelity's internal half, swept in or out of the core cash position. */
  sweep(options: SweepOptions): this {
    this.transactions.push(aSweep(options))
    return this
  }

  /**
   * Money moved between two accounts we own, as both feeds report it: leaving
   * one on the day named, arriving in the other a day or two later.
   */
  transfer(options: TransferOptions): this {
    this.transactions.push(...aTransfer(options))
    return this
  }

  /** Topping the wallet up, or emptying it back into the bank. */
  walletTransfer(options: SweepOptions): this {
    this.transactions.push(aWalletTransfer(options))
    return this
  }

  /**
   * Emptying the wallet back into the bank — the case that motivated the
   * pairing rule. Both legs, exactly as the two feeds report them.
   */
  walletCashout(options: CashoutOptions): this {
    this.transactions.push(...aWalletCashout(options))
    return this
  }

  /** Paying a person from the wallet. Counts, the way a card charge does. */
  walletPayment(options: WalletPaymentOptions): this {
    this.transactions.push(aWalletPayment(options))
    return this
  }

  /** A committed cost in the plan. Positive amount, as everywhere else. */
  subscription(options: SubscriptionOptions): this {
    this.recurring.push(recurringOf(options, false))
    return this
  }

  /** An expected income stream in the plan. */
  income(options: SubscriptionOptions): this {
    this.recurring.push(recurringOf(options, true))
    return this
  }
}

export function aWorld(options: WorldOptions = {}): WorldBuilder {
  return new WorldBuilder(options)
}

/** Lunch Money sends stringified decimals, and the sign convention is load-bearing. */
function money(amount: number): string {
  return amount.toFixed(2)
}

function accountFields(name: TestAccount): Partial<LmTransaction> {
  return { account_display_name: name, plaid_account_display_name: name, asset_display_name: null }
}

/**
 * The verbs again, one transaction at a time.
 *
 * `src/domain/` is tested a transaction at a time rather than a world at a
 * time, and it deserves the same vocabulary — these used to be re-discovered
 * as a local helper in every file that needed one.
 */

function chargeOverrides(options: ChargeOptions, amount: number): TxnOverrides {
  const payee = options.payee ?? "A Merchant"
  return {
    date: options.on,
    amount: money(amount),
    payee,
    original_name: options.descriptor ?? payee.toUpperCase(),
    category_name: options.category ?? "Shopping",
    exclude_from_totals: options.excluded ?? false,
    is_pending: options.pending ?? false,
    ...accountFields(options.account ?? CARD),
    // Only written when it differs, so the "posted lags the swipe" cases are
    // visible in the scenario rather than implied by a metadata blob.
    plaid_metadata: options.posted
      ? metadata({ posted: options.posted, authorized: options.on })
      : null,
    tags: options.tags ?? [],
  }
}

export function aCharge(options: ChargeOptions): LmTransaction {
  return txn(chargeOverrides(options, options.amount))
}

export function aRefund(options: ChargeOptions): LmTransaction {
  return txn({ category_name: "Refund", ...chargeOverrides(options, -options.amount) })
}

export function aDeposit(options: DepositOptions): LmTransaction {
  return txn({
    date: options.on,
    amount: money(-options.amount),
    payee: options.payee ?? "A Deposit",
    original_name: (options.payee ?? "A DEPOSIT").toUpperCase(),
    category_name: options.category ?? "Income",
    is_income: true,
    exclude_from_totals: options.excluded ?? false,
    ...accountFields(options.into ?? CHECKING),
    tags: options.tags ?? [],
  })
}

/**
 * The card half of the autopay: a credit on the card, dated the statement's
 * due date. This is the one `reconcile()` reads — it lands on the account
 * whose statement is being reconstructed, and on the day the statement names.
 */
export function anAutopay(options: AutopayOptions): LmTransaction {
  return txn({
    date: options.on,
    amount: money(-options.amount),
    payee: "AUTOMATIC PAYMENT - THANK",
    original_name: "AUTOMATIC PAYMENT - THANK YOU",
    category_name: options.category ?? "Payment, Transfer",
    is_income: options.category === "Income",
    ...accountFields(CARD),
    plaid_metadata: options.posted
      ? metadata({ posted: options.posted, authorized: options.on })
      : null,
  })
}

/**
 * The bank half: the debit that leaves the current account a day or two later.
 *
 * Carries no information the card side does not, and must never reach the
 * review queue — a five-figure row would be the loudest thing in it.
 */
export function anAutopayDebit(options: AutopayOptions): LmTransaction {
  return txn({
    date: options.debitedOn ?? addDays(options.on, 1),
    amount: money(options.amount),
    payee: "DIRECT DEBIT CARD CREDIT CAUTOPAY (Cash)",
    original_name: "DIRECT DEBIT CARD CREDIT CAUTOPAY",
    category_name: "Credit card payment",
    ...accountFields(options.from ?? CHECKING),
  })
}

/**
 * Fidelity's internal half: cash swept in or out of the core position on every
 * real movement. Categorised and excluded exactly like a genuine deposit,
 * which is why only the payee separates them.
 */
export function aSweep(options: SweepOptions): LmTransaction {
  return txn({
    date: options.on,
    amount: money(options.amount),
    payee:
      options.amount > 0
        ? "PURCHASE INTO CORE ACCOUNT FDIC INSURED DEPOSIT"
        : "REDEMPTION FROM CORE ACCOUNT FDIC INSURED DEPOSIT",
    category_name: "Payment, Transfer",
    exclude_from_totals: true,
    ...accountFields(options.account ?? CHECKING),
  })
}

/**
 * Both legs of one movement between accounts we own.
 *
 * Nothing about either row says "transfer" to any payee rule — what makes them
 * one movement is that they are equal, opposite, in different accounts and a
 * day apart, which is exactly what `findTransfers()` looks for.
 */
export function aTransfer(options: TransferOptions): [LmTransaction, LmTransaction] {
  const leaving = options.fromPayee ?? "Standard transfer"
  const arriving = options.toPayee ?? "Transfer"
  return [
    txn({
      date: options.on,
      amount: money(options.amount),
      payee: leaving,
      original_name: leaving.toUpperCase(),
      category_name: "Payment, Transfer",
      exclude_from_totals: true,
      ...accountFields(options.from),
      tags: options.fromTags ?? [],
    }),
    txn({
      date: addDays(options.on, options.settles ?? 1),
      amount: money(-options.amount),
      payee: arriving,
      original_name: arriving.toUpperCase(),
      category_name: "Payment, Transfer",
      exclude_from_totals: true,
      ...accountFields(options.to),
      tags: options.toTags ?? [],
    }),
  ]
}

/**
 * The bank side of topping the wallet up, or emptying it back: a payee of
 * exactly "Venmo", no name, no memo, which is the entire basis of the rule that
 * catches it. A top-up appears here and nowhere else, which is why it is still
 * the payee rather than a matching leg that has to catch it. A cashout also
 * posts a wallet row — see `aWalletCashout()`.
 */
export function aWalletTransfer(options: SweepOptions): LmTransaction {
  return txn({
    date: options.on,
    amount: money(options.amount),
    payee: "Venmo",
    original_name: "WALLET",
    category_name: "Payment, Transfer",
    ...accountFields(options.account ?? CHECKING),
  })
}

/**
 * A cashout, both legs, with the payees the real feeds actually use.
 *
 * The wallet leg is the awkward one: it lands on a `spending` account under a
 * payee no rule recognises, so before it was matched to its other half it read
 * as several hundred dollars of discretionary spend.
 */
export function aWalletCashout(options: CashoutOptions): [LmTransaction, LmTransaction] {
  const into = options.into ?? CHECKING
  return [
    txn({
      date: options.on,
      amount: money(options.amount),
      payee: "Standard transfer",
      original_name: "STANDARD TRANSFER",
      category_name: "Payment, Transfer",
      exclude_from_totals: true,
      ...accountFields(WALLET),
      institution_name: "Venmo - Personal",
    }),
    aWalletTransfer({
      on: addDays(options.on, options.settles ?? 1),
      amount: -options.amount,
      account: into,
    }),
  ]
}

/** Paying a person from the wallet. Counts, the way a card charge does. */
export function aWalletPayment(options: WalletPaymentOptions): LmTransaction {
  return txn({
    date: options.on,
    amount: money(options.amount),
    payee: options.payee,
    original_name: options.payee,
    category_name: options.category ?? "Payment, Transfer",
    exclude_from_totals: options.excluded ?? true,
    ...accountFields(WALLET),
    institution_name: "Venmo - Personal",
    tags: options.tags ?? [],
  })
}

function recurringOf(options: SubscriptionOptions, isIncome: boolean): LmRecurringItem {
  const tracked = options.tracked ?? true
  const matched = options.matched ?? 0
  const cadence = options.cadence ?? "monthly"
  return recurringItem({
    payee: options.payee,
    amount: (isIncome ? -options.amount : options.amount).toFixed(4),
    cadence,
    granularity: options.granularity ?? granularityFor(options.cadence),
    quantity: options.quantity ?? 1,
    // What Lunch Money computes for the queried month. The verb derives it
    // from the cadence so a scenario can still say "twice a month" in words,
    // but the arithmetic reads these, exactly as production does.
    expected_dates: options.expected ?? expectedDatesFor(cadence),
    expected_range: { start: "2026-08-01", end: "2026-08-31" },
    is_income: isIncome,
    plaid_account_id: tracked ? 1 : null,
    asset_id: tracked ? null : 1,
    missing_dates_within_range: options.missing ?? [],
    transactions_within_range: Array.from({ length: matched }, (_, i) => ({
      id: i + 1,
      date: "2026-08-10",
    })),
  })
}

/**
 * What Lunch Money would report alongside the cadence. "Twice a month" arrives
 * as (month, 1), identical to plain monthly — the ambiguity `perMonth` exists
 * to resolve — so it must not be special-cased away here.
 */
/**
 * What Lunch Money would report for the queried month.
 *
 * Only the count is read, and only where it exceeds the amortised rate, so
 * these are placeholder dates rather than a real schedule — the one case that
 * matters is twice-monthly, which reports as plain monthly otherwise.
 */
function expectedDatesFor(cadence: string): IsoDate[] {
  if (cadence === "twice a month") return ["2026-08-14", "2026-08-28"]
  if (cadence === "once a week") return ["2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25"]
  if (cadence.includes("year")) return []
  return ["2026-08-10"]
}

function granularityFor(cadence: string | undefined): string {
  if (!cadence) return "month"
  if (cadence.includes("week")) return "week"
  if (cadence.includes("year") && cadence !== "twice a year") return "year"
  return "month"
}
