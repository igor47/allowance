import { describe, expect, test } from "bun:test"
import { hydrate, type Lookups } from "./client"
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
