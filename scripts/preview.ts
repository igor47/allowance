/**
 * The app, on a synthetic world, in a browser.
 *
 * `mise run dev` talks to the live Lunch Money API, which makes it the wrong
 * tool for looking at the UI: every reload spends the rate limit, and the data
 * it shows is whatever real life happens to contain this week. This serves the
 * same Hono app over a `World` instead — offline, deterministic, and rich
 * enough to contain one of every row the list can render, which is what a
 * layout pass actually needs to see.
 *
 * Tagging works and persists for the life of the process, because the fake
 * client is an in-memory Lunch Money whose writes are visible to reads.
 */

import { createApp } from "../src/app"
import { CARD, CHECKING, SAVINGS, WALLET } from "../src/test/accounts"
import { FakeLunchMoneyClient } from "../src/test/fake-client"
import { aWorld } from "../src/test/world"

const world = aWorld({ today: "2026-08-14" })
  .account(CARD, { balance: "2431.55" })
  .account(CHECKING, { balance: "8420.10" })
  .account(SAVINGS, { balance: "15300.00" })
  .account(WALLET, { balance: "120.00" })

  // Spending on the card, including the long payees and descriptors that are
  // what actually break a narrow layout.
  .charge({ on: "2026-08-13", amount: 82.4, payee: "Bi-Rite Market", category: "Groceries" })
  .charge({
    on: "2026-08-12",
    amount: 19.75,
    payee: "Philz Coffee",
    descriptor: "PHILZ COFFEE #12 SAN FRANCISCO CA",
    category: "Coffee Shops",
  })
  .charge({
    on: "2026-08-11",
    amount: 246.18,
    payee: "A Grocery Cooperative",
    descriptor: "A GROCERY COOP 1745 FOLSOM ST SAN FRANCISCO CA 94103",
    category: "Groceries",
    posted: "2026-08-12",
  })
  .charge({ on: "2026-08-10", amount: 14.99, payee: "Spotify USA", category: "Music" })
  .charge({ on: "2026-08-09", amount: 1240.0, payee: "Alaska Airlines", category: "Travel" })
  .charge({ on: "2026-08-08", amount: 63.2, payee: "Zuni Cafe", category: "Restaurants" })
  .charge({
    on: "2026-08-07",
    amount: 8.5,
    payee: "Muni",
    category: "Public Transit",
    pending: true,
  })
  .charge({ on: "2026-08-06", amount: 320.0, payee: "Ikea", category: "Home", tags: ["irregular"] })
  .refund({ on: "2026-08-05", amount: 42.0, payee: "Zappos", category: "Clothing" })

  // The bank accounts, where untagged means fixed.
  .charge({
    on: "2026-08-03",
    amount: 3400,
    payee: "Landlord",
    account: CHECKING,
    category: "Rent",
  })
  .charge({
    on: "2026-08-04",
    amount: 88.12,
    payee: "PG&E",
    account: CHECKING,
    category: "Utilities",
  })
  .deposit({ on: "2026-08-01", amount: 6200, payee: "Acme Payroll", into: CHECKING })
  .deposit({
    on: "2026-08-06",
    amount: 130,
    payee: "A Friend",
    into: CHECKING,
    tags: ["spending"],
  })

  // A matched pair, an autopay, and a wallet, so every bucket has a row.
  .autopay({ on: "2026-08-09", amount: 1875.44, from: CHECKING })
  .transfer({ on: "2026-08-02", amount: 2000, from: SAVINGS, to: CHECKING })
  .walletPayment({ on: "2026-08-12", amount: 45, payee: "Serena", category: "Dining" })
  .walletCashout({ on: "2026-08-07", amount: 300, into: CHECKING })
  .sweep({ on: "2026-08-05", amount: 500, account: SAVINGS })

  // Enough of the plan for the budget page to have something to say.
  .income({ payee: "Acme Payroll", amount: 6200, granularity: "month", quantity: 1 })
  .subscription({ payee: "Landlord", amount: 3400, granularity: "month", quantity: 1 })
  .subscription({ payee: "Spotify USA", amount: 14.99, granularity: "month", quantity: 1 })
  .subscription({
    payee: "State Farm",
    amount: 1450,
    granularity: "year",
    quantity: 1,
    tracked: false,
  })

const app = createApp({
  client: new FakeLunchMoneyClient(world),
  config: world.config,
  today: () => world.today,
  clock: () => world.now,
})

const port = Number(process.env.PREVIEW_PORT ?? 3099)

/**
 * Behind a forward-auth proxy there is always a username in the navbar, and it
 * is the widest thing in it. Serving without one would make the header look
 * roomier here than it is in production, which is the opposite of useful.
 */
const user = process.env.PREVIEW_USER ?? "alex@example.org"

Bun.serve({
  port,
  fetch: (request) => {
    const headers = new Headers(request.headers)
    headers.set("X-authentik-username", user)
    return app.fetch(new Request(request, { headers }))
  },
})
console.log(`preview (synthetic world, no API) on http://localhost:${port}`)
