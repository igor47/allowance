import { afterEach, describe, expect, test } from "bun:test"
import { HttpLunchMoneyClient, hydrate, type Lookups } from "./client"
import type { V2Transaction } from "./v2"

const REVIEWED = 7
const SUGGESTED = 8

const lookups: Lookups = {
  categories: new Map(),
  tags: new Map(),
  plaid: new Map(),
  manual: new Map(),
  reviewedRecurring: new Set([REVIEWED]),
}

function fare(recurring_id: number | null): V2Transaction {
  return {
    id: 1,
    date: "2026-08-03",
    amount: "5.0000",
    currency: "usd",
    to_base: 5,
    payee: "A Transit Card",
    original_name: "A TRANSIT CARD",
    notes: null,
    status: "unreviewed",
    is_pending: false,
    category_id: null,
    plaid_account_id: null,
    manual_account_id: null,
    tag_ids: [],
    recurring_id,
  }
}

describe("the recurring link", () => {
  test("survives when the item was accepted", () => {
    expect(hydrate(fare(REVIEWED), lookups).recurring_id).toBe(REVIEWED)
  })

  // Lunch Money links rows to items it only suggested, and shows no link for
  // them. Kept, the link took every fare at a suggested price out of the count.
  test("is dropped when Lunch Money only suggested the item", () => {
    expect(hydrate(fare(SUGGESTED), lookups).recurring_id).toBeNull()
  })

  test("stays absent when there was none", () => {
    expect(hydrate(fare(null), lookups).recurring_id).toBeNull()
  })
})

/**
 * An in-memory Lunch Money behind `fetch`, counting what it is asked. Nothing
 * here reaches the network: the stub answers every path the client requests.
 */
function stubbedApi(tags: { id: number; name: string }[]) {
  const asked: string[] = []
  let nextId = 100
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace("https://api.lunchmoney.dev/v2/", "")
    const method = init?.method ?? "GET"
    asked.push(`${method} ${path}`)
    const json = (body: unknown) => new Response(JSON.stringify(body))
    if (method === "POST" && path === "tags") {
      const { name } = JSON.parse(String(init?.body))
      const tag = { id: nextId++, name }
      tags.push(tag)
      return json(tag)
    }
    if (method === "PUT") return json({})
    const empty: Record<string, unknown> = {
      categories: { categories: [] },
      tags: { tags },
      plaid_accounts: { plaid_accounts: [] },
      manual_accounts: { manual_accounts: [] },
      recurring_items: { recurring_items: [] },
    }
    return json(empty[path])
  }) as typeof fetch
  return asked
}

describe("tagging", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  // Dropping the join tables after every write made each click cost five
  // extra requests, which a triage session turned into 429 backoffs.
  test("a tag that already exists costs one request after the first", async () => {
    const asked = stubbedApi([{ id: 1, name: "spending" }])
    const client = new HttpLunchMoneyClient({ apiKey: "test" })
    await client.setTags(10, ["spending"])
    asked.length = 0
    await client.setTags(11, ["spending"])
    expect(asked).toEqual(["PUT transactions/11"])
  })

  test("a tag made just now is read back, so the tables are fetched again", async () => {
    const asked = stubbedApi([])
    const client = new HttpLunchMoneyClient({ apiKey: "test" })
    await client.setTags(10, ["spending"])
    asked.length = 0
    await client.setTags(11, ["spending"])
    expect(asked).toContain("GET tags")
    expect(asked).not.toContain("POST tags")
  })
})
