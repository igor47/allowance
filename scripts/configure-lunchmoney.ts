/**
 * Make Lunch Money look the way `allowance.toml` says it does.
 *
 * The app reads categories to decide which rows are movements rather than
 * spends, so those categories have to exist and be excluded from Lunch Money's
 * own budget — otherwise the card autopay is counted there alongside the
 * charges it settles, which is a double-count in the app you also use.
 *
 * This reads your config and reconciles Lunch Money to it. It invents nothing:
 * every category it creates is one you named in `[categories]`, so there is no
 * opinion here about how a household should file its money.
 *
 * **Rules are the part it cannot do.** Neither v1 nor v2 has an API for them,
 * so pointing a payee at a category stays manual — see the README. That is the
 * one manual step, and it is deliberately the step where a human looks at
 * their own payees.
 *
 * Dry run by default. This writes to a live financial account, and a plan you
 * can read is the difference between a review and a surprise. Idempotent, so a
 * second run reports what is already correct and changes nothing.
 *
 *   mise run configure:lunchmoney            # print the plan
 *   APPLY=1 mise run configure:lunchmoney    # make the changes
 */

import { loadConfig } from "../src/config"

const config = loadConfig()
const KEY = config.lunchMoneyApiKey
if (!KEY) throw new Error("LUNCHMONEY_API_KEY is not set")

const APPLY = process.env.APPLY === "1"

// v1, not v2: the categories endpoints are stable there, and this is a
// one-shot administrative script rather than part of the app.
const API = "https://dev.lunchmoney.app/v1"

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${JSON.stringify(body)}`)
  }
  return body
}

interface LmCategory {
  id: number
  name: string
  exclude_from_budget: boolean
  exclude_from_totals: boolean
}

const planned: string[] = []
const act = async (what: string, run: () => Promise<unknown>) => {
  planned.push(what)
  if (APPLY) {
    await run()
    console.log(`  ✓ ${what}`)
  } else {
    console.log(`  · ${what}`)
  }
}

const { categories } = (await api("categories")) as { categories: LmCategory[] }
const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))

/**
 * Every category the config names, and why it must be out of the budget.
 *
 * `suggestsTransfer` is deliberately *not* here. Those categories hold real
 * charges as well as movements — "Payment, Transfer" is where Lunch Money
 * files about one genuine purchase a month — so excluding them from the budget
 * would hide money that was actually spent.
 */
const wanted = [
  ...config.categories.cardPayment.map((name) => ({
    name,
    why: "settles charges that are already counted individually",
  })),
  ...config.categories.internalTransfer.map((name) => ({
    name,
    why: "a bank's bookkeeping against itself, not money crossing a boundary",
  })),
]

if (wanted.length === 0) {
  console.log("\n[categories] names nothing to configure — nothing to do.\n")
  process.exit(0)
}

console.log(`\nreconciling Lunch Money against ${wanted.length} configured categories\n`)

for (const { name, why } of wanted) {
  const existing = byName.get(name.toLowerCase())

  if (!existing) {
    await act(`create "${name}", excluded from budget and totals`, () =>
      api("categories", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: `Money moved rather than spent — ${why}. Read by allowance.`,
          exclude_from_budget: true,
          exclude_from_totals: true,
        }),
      })
    )
    continue
  }

  if (existing.exclude_from_budget && existing.exclude_from_totals) {
    console.log(`  = "${name}" already excluded from budget and totals`)
    continue
  }

  await act(`exclude "${name}" (${existing.id}) from budget and totals — ${why}`, () =>
    api(`categories/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({ exclude_from_budget: true, exclude_from_totals: true }),
    })
  )
}

// Named but never created is the failure that produces a silently wrong
// number rather than an error: the app looks for a category nothing is filed
// under, and every sweep falls through to the review queue.
const missingRules = wanted.filter(({ name }) => !byName.has(name.toLowerCase()))
if (missingRules.length > 0 && !APPLY) {
  console.log("\nafter applying, add a Lunch Money rule pointing a payee at each of:")
  for (const { name } of missingRules) console.log(`  - ${name}`)
  console.log("Rules have no API; make them in Lunch Money. See the README.")
}

console.log(
  planned.length === 0
    ? "\nnothing to do — Lunch Money already matches the config"
    : APPLY
      ? `\napplied ${planned.length} change(s)`
      : `\n${planned.length} change(s) planned. Re-run with APPLY=1 to make them.`
)
