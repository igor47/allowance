/**
 * One-shot live fetch, printed as text. For eyeballing whether the numbers the
 * dashboard shows are the numbers the accounts actually hold.
 *
 * Read-only — it never writes a tag. Run through `mise run smoke`.
 */

import { config } from "../src/config"
import { money } from "../src/components/format"
import { today } from "../src/domain/dates"
import { Cache } from "../src/lunchmoney/cache"
import { HttpLunchMoneyClient } from "../src/lunchmoney/client"
import { DashboardService } from "../src/services/dashboard"

const client = new HttpLunchMoneyClient({ apiKey: config.lunchMoneyApiKey })
const service = new DashboardService(client, config, new Cache(0))
const dashboard = await service.build(today(config.timezone))

const { allowance, card, cash } = dashboard
const line = (label: string, value: string) => console.log(`  ${label.padEnd(24)}${value.padStart(12)}`)

console.log(`\nallowance — ${dashboard.today}\n`)
line("Period start", allowance.periodStart)
line("Day", `${allowance.days}`)
line("Budgeted", money(allowance.budget))
line("Spent", money(allowance.spent))
line("Balance", money(allowance.balance))
line("Actual per day", money(allowance.spent / allowance.days))
if (allowance.forfeited > 0) line("Forfeited to cap", money(allowance.forfeited))

console.log(`\ncash\n`)
for (const account of cash.accounts) line(account.name, money(account.balance))
line("Total", money(cash.total))

console.log(`\n${card.account}\n`)
line(`Due ${card.lastClosed.due}`, money(card.lastClosed.total.net))
line(`Accruing since ${card.current.start}`, money(card.current.total.net))
if (card.reconciliation) {
  line("Bank reports owed", money(card.reconciliation.reported))
  line("Unexplained", money(card.reconciliation.delta))
}

console.log(`\nreview\n`)
line("Needs review", `${dashboard.needsReview}`)
line("In period", `${dashboard.transactions.length}`)
if (dashboard.unknownAccounts.length > 0) line("Unknown accounts", dashboard.unknownAccounts.join(", "))
console.log()
