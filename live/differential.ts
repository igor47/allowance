/**
 * Run v1 and v2 over the same window and diff what the app would see.
 *
 * The migration's own test, and the one it could not have before the client sat
 * behind a fake: both clients now produce `LmTransaction[]`, so the real API is
 * its own oracle. If the hydrated output matches field for field, the domain
 * cannot tell the two apart — and the domain is where every number comes from.
 *
 * Read-only, and run by hand through `mise run migrate:verify`. Never from a
 * test and never from CI.
 */

import { classifyAll, computeAllowance } from "../src/domain/allowance"
import { budgetView } from "../src/domain/budget"
import { cycleTotal, reconcile } from "../src/domain/card"
import { cycleView } from "../src/domain/cycle"
import { addDays, endOfMonth, startOfMonth, today as todayIn } from "../src/domain/dates"
import { statementAccount, unknownAccounts } from "../src/domain/policy"
import { HttpLunchMoneyClient } from "../src/lunchmoney/client"
import type { LmRecurringItem, LmTransaction } from "../src/lunchmoney/types"
import { loadConfig } from "../src/config"
import { V1Client } from "./v1-client"

const config = loadConfig()
const apiKey = config.lunchMoneyApiKey
if (!apiKey) throw new Error("LUNCHMONEY_API_KEY is not set")

const today = todayIn(config.timezone)
const onCard = statementAccount(config.accounts)
const card = onCard?.name ?? ""
const statement = onCard?.statement
const cycles = cycleView(today, statement?.closeDay ?? 1, statement?.dueDay ?? 1)
// The same window the dashboard asks for, slack included. Without the slack a
// charge authorized before the cycle opened but posted after it is missing, and
// the reconciliation reads a false shortfall — which it did, by $480, the first
// time this script chose its own window.
const POSTING_SLACK_DAYS = 5
const start = addDays(cycles.settled.start, -POSTING_SLACK_DAYS)
// A whole month, because a truncated range cannot count occurrences: it drops
// the second half of a fortnightly salary and halves the income.
const budgetStart = startOfMonth(today)
const budgetEnd = endOfMonth(today)

console.log(`\ndifferential — v1 vs v2 over ${start}..${today}\n`)

const v1 = new V1Client(apiKey)
const v2 = new HttpLunchMoneyClient({ apiKey })

/**
 * Fields the domain actually branches on. A difference in any of these moves a
 * number on the page; a difference outside them is noise worth reporting once
 * and then ignoring.
 */
const LOAD_BEARING = [
  "id",
  "date",
  "amount",
  "payee",
  "original_name",
  "category_name",
  "is_income",
  "exclude_from_totals",
  "is_pending",
  "account_display_name",
  "plaid_account_display_name",
  "asset_display_name",
  "institution_name",
] as const

const tagNames = (t: LmTransaction) =>
  t.tags
    .map((g) => g.name.toLowerCase())
    .sort()
    .join(",")

/** Compared parsed, because v1 sends a string and v2 an object we re-serialise. */
function metadataOf(t: LmTransaction): unknown {
  if (!t.plaid_metadata) return null
  try {
    return JSON.parse(t.plaid_metadata)
  } catch {
    return "<unparseable>"
  }
}

const [oneTxns, twoTxns] = await Promise.all([
  v1.transactions(start, today),
  v2.transactions(start, today),
])

console.log(`transactions: v1 ${oneTxns.length}, v2 ${twoTxns.length}`)

const oneById = new Map(oneTxns.map((t) => [t.id, t]))
const twoById = new Map(twoTxns.map((t) => [t.id, t]))
const onlyV1 = oneTxns.filter((t) => !twoById.has(t.id))
const onlyV2 = twoTxns.filter((t) => !oneById.has(t.id))
if (onlyV1.length) console.log(`  only in v1: ${onlyV1.length} — ${summarise(onlyV1)}`)
if (onlyV2.length) console.log(`  only in v2: ${onlyV2.length} — ${summarise(onlyV2)}`)

const differing = new Map<string, { count: number; example: string }>()
for (const [id, one] of oneById) {
  const two = twoById.get(id)
  if (!two) continue
  for (const field of LOAD_BEARING) {
    if (one[field] !== two[field]) {
      note(field, `#${id}: v1=${JSON.stringify(one[field])} v2=${JSON.stringify(two[field])}`)
    }
  }
  if (tagNames(one) !== tagNames(two)) note("tags", `#${id}: v1=[${tagNames(one)}] v2=[${tagNames(two)}]`)
  const a = JSON.stringify(metadataOf(one))
  const b = JSON.stringify(metadataOf(two))
  if (a !== b) note("plaid_metadata", `#${id}: ${a?.length ?? 0}b vs ${b?.length ?? 0}b`)
}

function note(field: string, example: string) {
  const hit = differing.get(field)
  if (hit) hit.count += 1
  else differing.set(field, { count: 1, example })
}

function summarise(txns: LmTransaction[]): string {
  return txns
    .slice(0, 4)
    .map((t) => `${t.date} ${t.amount} ${t.payee ?? "?"}${t.is_pending ? " (pending)" : ""}`)
    .join("; ")
}

console.log(differing.size === 0 ? "  every load-bearing field agrees" : "")
for (const [field, { count, example }] of differing) {
  console.log(`  ${field}: ${count} differ — e.g. ${example}`)
}

// The end-to-end question: do the numbers on the page move?
console.log("\nwhat the domain makes of each:\n")
const rows = (txns: LmTransaction[]) => {
  const classified = classifyAll(txns, config.accounts)
  const allowance = computeAllowance(classified, config.allowance, today)
  const settled = reconcile(txns, cycles.settled, { account: card, windowStart: start })
  return {
    spent: allowance.spent.toFixed(2),
    balance: allowance.balance.toFixed(2),
    "due (closed cycle)": cycleTotal(txns, cycles.lastClosed.start, cycles.lastClosed.end, card).charges.toFixed(2),
    accruing: cycleTotal(txns, cycles.current.start, cycles.current.end, card).charges.toFixed(2),
    "reconcile delta": settled.delta === null ? "—" : settled.delta.toFixed(2),
    "needs review": String(classified.filter((c) => !c.classification.reviewed && c.classification.taggable && c.classification.bucket !== "deposit").length),
    "unknown accounts": unknownAccounts(txns, config.accounts).join(",") || "none",
  }
}
const a = rows(oneTxns)
const b = rows(twoTxns)
for (const key of Object.keys(a) as (keyof typeof a)[]) {
  const same = a[key] === b[key]
  console.log(`  ${key.padEnd(20)} v1 ${String(a[key]).padStart(12)}   v2 ${String(b[key]).padStart(12)}  ${same ? "" : "  <-- DIFFERS"}`)
}

// Recurring items are known to differ: v2 restructured them, and only v2 knows
// the expected occurrence dates. What must agree is the plan they add up to.
const [oneRec, twoRec] = await Promise.all([
  v1.recurringItems(budgetStart, budgetEnd),
  v2.recurringItems(budgetStart, budgetEnd),
])
console.log(`\nrecurring items: v1 ${oneRec.length}, v2 ${twoRec.length}\n`)
const plan = (items: LmRecurringItem[]) => {
  const view = budgetView(items, today)
  return {
    income: view.totals.income.toFixed(2),
    committed: view.totals.committed.toFixed(2),
    untracked: view.totals.untracked.toFixed(2),
    "daily target": view.totals.dailyTarget.toFixed(2),
  }
}
const p1 = plan(oneRec)
const p2 = plan(twoRec)
for (const key of Object.keys(p1) as (keyof typeof p1)[]) {
  const same = p1[key] === p2[key]
  console.log(`  ${key.padEnd(20)} v1 ${p1[key].padStart(12)}   v2 ${p2[key].padStart(12)}  ${same ? "" : "  <-- DIFFERS"}`)
}
console.log()
