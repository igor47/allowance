/** Assembles everything the dashboard renders, from two API calls. */

import type { Config, Person } from "../config"
import {
  type AllowanceResult,
  type ClassifiedTransaction,
  classifyAll,
  computeAllowance,
  periodStartFor,
} from "../domain/allowance"
import { type BudgetView, budgetView } from "../domain/budget"
import { type CycleTotal, cycleTotal, type Reconciliation, reconcile } from "../domain/card"
import { type Cycle, cycleView } from "../domain/cycle"
import { addDays, endOfMonth, type IsoDate, startOfMonth } from "../domain/dates"
import { type Freshness, freshness } from "../domain/freshness"
import { findTransfers, statementAccount, unknownAccounts } from "../domain/policy"
import type { Cache } from "../lunchmoney/cache"
import type { LmAccount, LmTag, LmTransaction, LunchMoneyClient } from "../lunchmoney/types"

export interface CashAccount {
  name: string
  balance: number
  updatedAt: string
}

export interface CardView {
  account: string
  /** What the bank says is owed right now. */
  reported: number | null
  lastClosed: Cycle & { total: CycleTotal }
  current: { start: IsoDate; end: IsoDate; closes: IsoDate; total: CycleTotal }
  /** The statement before last, checked against the autopay that settled it. */
  settled: Cycle & { total: CycleTotal; reconciliation: Reconciliation }
}

export interface Dashboard {
  today: IsoDate
  allowance: AllowanceResult
  cash: { total: number; accounts: CashAccount[] }
  card: CardView
  /** In-period transactions, newest first. */
  transactions: ClassifiedTransaction[]
  needsReview: number
  unknownAccounts: string[]
  freshness: Freshness
  /** When we last read this from Lunch Money, as opposed to from memory. */
  readAt: Date | null
  /**
   * The instant this was built. Everything that renders an age measures against
   * it, so the clock badge and the times beneath it cannot disagree.
   */
  now: Date
}

/** A card can post a charge up to four days after it is authorized. */
const POSTING_SLACK_DAYS = 5

export class DashboardService {
  private lastTriggerAt = 0

  constructor(
    private readonly client: LunchMoneyClient,
    private readonly config: Config,
    private readonly cache: Cache,
    /** Injected so tests do not depend on the wall clock. */
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * The plan for the month: recurring commitments and income.
   *
   * A separate read from the dashboard, and deliberately not folded into
   * `build`: the allowance page has no use for it, and recurring items are
   * configuration that changes a few times a year rather than hourly.
   */
  async budget(today: IsoDate): Promise<BudgetView> {
    const start = startOfMonth(today)
    const end = endOfMonth(today)
    const items = await this.cache.fetch(`recurring:${start}:${end}`, () =>
      this.client.recurringItems(start, end)
    )
    return budgetView(items, today, this.config.accounts)
  }

  /** Force the next build to re-read from the API. */
  invalidate(): void {
    this.cache.clear()
  }

  /**
   * Write through to Lunch Money, then patch the cached copy in place.
   *
   * Re-reading the whole window after every tag click cost an extra ~300ms
   * round trip and re-downloaded a thousand transactions to learn about one.
   * Patching keeps a click at a single API call. The patch is applied after
   * the write succeeds rather than before, so a failed write never leaves the
   * dashboard showing a tag that Lunch Money does not have.
   */
  async setTags(transactionId: number, tags: string[]): Promise<void> {
    await this.client.setTags(transactionId, tags)
    const applied: LmTag[] = tags.map((name, i) => ({
      id: -(i + 1),
      name,
      description: null,
      archived: false,
    }))
    this.cache.mutate<LmTransaction[]>("txns:", (txns) =>
      txns.map((t) => (t.id === transactionId ? { ...t, tags: applied } : t))
    )
  }

  private async load(start: IsoDate, end: IsoDate) {
    const [transactions, balances] = await Promise.all([
      this.cache.fetch(`txns:${start}:${end}`, () => this.client.transactions(start, end)),
      this.cache.fetch("accounts", () => this.client.accounts()),
    ])
    return { transactions, balances }
  }

  async build(today: IsoDate): Promise<Dashboard> {
    const { accounts, categories, allowance } = this.config
    // A config with no card is legitimate — the allowance works without one —
    // but the summary boxes and the reconciliation line have nothing to be
    // about, so `card` is null and the components say so.
    const card = statementAccount(accounts)
    const cycles = cycleView(today, card?.statement.closeDay ?? 1, card?.statement.dueDay ?? 1)

    // One fetch covering the budgeting period, the open statement, and the one
    // before it — which is the only statement the autopay has settled, and so
    // the only one `reconcile()` can check the arithmetic against. That is one
    // extra month on a call that is cached anyway.
    //
    // The API filters on the Lunch Money date — Plaid's *authorized* date —
    // while statement cycles are bucketed by the posted date, which lags by up
    // to four days. Without the slack, a charge swiped just before a cycle
    // opened but posted just after it is missing from the statement total,
    // which understated a month's bill by a few hundred dollars.
    const periodStart = periodStartFor(allowance, today)
    const earliest = periodStart < cycles.settled.start ? periodStart : cycles.settled.start
    const start = addDays(earliest, -POSTING_SLACK_DAYS)
    // `accounts` here is the config's policy; the API's, with balances, are
    // `balances`.
    const { transactions, balances } = await this.load(start, today)

    // One index, shared: the classifier needs it to bucket both legs of a
    // movement, and the statement needs it to know which row on the card was
    // the payment rather than a purchase.
    const transfers = findTransfers(transactions, categories)
    const classified = classifyAll(transactions, this.config, transfers)
    const inPeriod = classified
      .filter((c) => c.txn.date >= periodStart && c.txn.date <= today)
      .sort((a, b) =>
        a.txn.date === b.txn.date ? b.txn.id - a.txn.id : b.txn.date.localeCompare(a.txn.date)
      )

    const on = card?.name ?? ""
    const lastClosedTotal = cycleTotal(
      transactions,
      cycles.lastClosed.start,
      cycles.lastClosed.end,
      on,
      categories,
      transfers
    )
    const currentTotal = cycleTotal(
      transactions,
      cycles.current.start,
      cycles.current.end,
      on,
      categories,
      transfers
    )
    const settledTotal = cycleTotal(
      transactions,
      cycles.settled.start,
      cycles.settled.end,
      on,
      categories,
      transfers
    )
    const reported = balanceOf(balances, on)

    return {
      today,
      allowance: computeAllowance(classified, allowance, today),
      cash: cashAccounts(balances),
      card: {
        account: on,
        reported,
        lastClosed: { ...cycles.lastClosed, total: lastClosedTotal },
        current: { ...cycles.current, total: currentTotal },
        settled: {
          ...cycles.settled,
          total: settledTotal,
          reconciliation: reconcile(transactions, cycles.settled, {
            account: on,
            categories,
            transfers,
            windowStart: start,
          }),
        },
      },
      transactions: inPeriod,
      // Deposits are taggable but not review items — payroll arriving twice a
      // month is not a question anyone needs asked. They live under "deposits".
      needsReview: inPeriod.filter(needsReview).length,
      unknownAccounts: unknownAccounts(transactions, accounts),
      freshness: freshness(
        balances,
        this.config.refreshAfterMinutes,
        transactions.reduce<string | null>(
          (max, t) => (max === null || t.date > max ? t.date : max),
          null
        ),
        this.now()
      ),
      now: this.now(),
      readAt: (() => {
        const at = this.cache.storedAt("txns:")
        return at === null ? null : new Date(at)
      })(),
    }
  }

  /**
   * Ask Lunch Money to pull from Plaid, if it has not lately.
   *
   * Their API allows one fetch a minute — sooner returns 425 — but asks for
   * restraint, so this is gated twice: on the accounts' own last_fetch, and on
   * an in-process cooldown so two people loading the page at once queue one
   * job, not two. The cooldown is deliberately far longer than the API's
   * minute: Plaid will not have anything new within it either.
   * The pull is a background job on their side - nothing is fresher when this
   * returns, it is the *next* load that benefits.
   */
  async maybeRefresh(current: Freshness, force = false): Promise<boolean> {
    if (!force && !current.shouldRefresh) return false
    const now = this.now().getTime()
    if (now - this.lastTriggerAt < this.config.refreshAfterMinutes * 60_000) return false
    this.lastTriggerAt = now
    try {
      await this.client.triggerFetch()
      // Deliberately no cache invalidation. The pull is a background job on
      // Lunch Money's side, so nothing is fresher yet — dropping the cache here
      // would only force the next page load to re-read identical data, and
      // because the trigger is fired without awaiting it, it also raced the
      // render. `/sync` is where a re-read belongs: it runs after the job has
      // had time to land and is explicitly asking whether anything arrived.
      return true
    } catch (error) {
      // A failed refresh must never take the dashboard down with it.
      console.error("plaid fetch trigger failed", error)
      return false
    }
  }
}

function balanceOf(accounts: LmAccount[], displayName: string): number | null {
  const account = accounts.find((a) => (a.display_name ?? a.name) === displayName)
  return account ? account.to_base : null
}

function cashAccounts(accounts: LmAccount[]): { total: number; accounts: CashAccount[] } {
  const cash = accounts
    .filter((a) => a.type === "cash")
    .map((a) => ({
      name: a.display_name ?? a.name,
      balance: a.to_base,
      updatedAt: a.balance_last_update,
    }))
  return { total: cash.reduce((sum, a) => sum + a.balance, 0), accounts: cash }
}

/**
 * What the list is showing, and whose. Two questions, not one.
 *
 * These used to be one flat list, which contradicted the domain: person tags
 * are documented there as orthogonal to the math, and they are — a person tag
 * says who spent it, never what kind of spend it was. As one list you could
 * ask for spending, or for one person, but never for that person's spending,
 * and picking either silently discarded the other.
 *
 * Each axis is a radio group that can also be turned off: clicking the
 * selected chip returns that axis to "everything", and touches nothing else.
 * A chip that reached across and changed the other axis would be a rule to
 * remember; a chip that owns exactly one axis is a rule you cannot get wrong.
 *
 * The review chip is the single exception, and `FilterBar` says why: it is
 * the view you arrive at with no parameters, so a person carried into it
 * empties the home page. Both axes still cross here — the combination is
 * expressible and honoured — it is only the chip that starts you clean.
 */
export const VIEWS = ["review", "spending", "deposits", "irregular", "fixed", "all"] as const
export type View = (typeof VIEWS)[number]

export function isView(value: string | undefined): value is View {
  return !!value && (VIEWS as readonly string[]).includes(value)
}

/**
 * Is this a person the config knows about?
 *
 * The guard is what stops `?who=` from being an arbitrary tag lookup: an
 * unrecognised value falls back to "everybody" rather than filtering the list
 * down to nothing and looking like a bug.
 */
export function isPerson(value: string | undefined, people: Person[]): boolean {
  return !!value && people.some((p) => p.tag === value)
}

/**
 * Worth a human's attention.
 *
 * Deposits are taggable but not review items — payroll arriving twice a month
 * is not a question anyone needs asked. They live under "deposits", where a work
 * reimbursement can be found when one turns up.
 */
export function needsReview(entry: ClassifiedTransaction): boolean {
  const { reviewed, taggable, bucket } = entry.classification
  return !reviewed && taggable && bucket !== "deposit" && bucket !== "transfer"
}

export interface FilterSummary {
  /** Rows on screen. */
  count: number
  /** Everything in the filtered set. */
  total: number
  /** The part of it that draws down the allowance. */
  counting: number
  /**
   * Rows on screen that are in neither figure — transfers and ignored rows.
   *
   * Without this the line does not reconcile and there is nothing to say why:
   * "21 transactions · $704 total" is summing nineteen of them, and the two it
   * left out are visible right underneath.
   */
  excluded: number
}

export function summarise(entries: ClassifiedTransaction[]): FilterSummary {
  let total = 0
  let counting = 0
  let excluded = 0
  for (const entry of entries) {
    const amount = entry.classification.amount
    const { bucket } = entry.classification
    // A transfer is the same money seen twice; summing it would double it.
    if (bucket === "ignored" || bucket === "transfer") {
      excluded++
      continue
    }
    total += amount
    if (entry.classification.counts) counting += amount
  }
  return { count: entries.length, total, counting, excluded }
}

/**
 * The two axes, applied in either order — a person tag and a bucket are
 * independent properties of a row, so intersecting them commutes.
 */
export function applyFilter(
  transactions: ClassifiedTransaction[],
  view: View,
  /** A person's tag, already validated by `isPerson()`. */
  who?: string
): ClassifiedTransaction[] {
  const mine = who
    ? transactions.filter((c) => c.txn.tags.some((t) => t.name.toLowerCase() === who))
    : transactions
  switch (view) {
    case "review":
      return mine.filter(needsReview)
    case "spending":
      return mine.filter((c) => c.classification.counts)
    // Money coming back: merchant refunds and bank deposits. This is where a
    // work expense reimbursement is found and tagged.
    case "deposits":
      // Transfers are taggable and often negative — the autopay's card leg, a
      // cashout landing — but they are not money coming back.
      return mine.filter(
        (c) =>
          c.classification.taggable &&
          c.classification.amount < 0 &&
          c.classification.bucket !== "transfer"
      )
    // The one bucket worth its own view: an irregular is a real commitment that
    // simply does not recur on a schedule, and it is the hardest to find again
    // among everything else "fixed" gathers up.
    case "irregular":
      return mine.filter((c) => c.classification.bucket === "irregular")
    case "fixed":
      return mine.filter((c) =>
        ["recurring", "irregular", "unclassified", "transfer"].includes(c.classification.bucket)
      )
    default:
      return mine
  }
}
