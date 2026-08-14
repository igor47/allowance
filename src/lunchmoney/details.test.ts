import { describe, expect, test } from "bun:test"
import { txn } from "../test/factories"
import { fixtureTransactions } from "../test/fixtures"
import { detailsOf, postedDate } from "./details"

describe("plaid details", () => {
  test("pulls out what Chase actually shows", () => {
    const costco = fixtureTransactions.find((t) => t.payee === "Costco" && t.date === "2026-08-01")
    if (!costco) throw new Error("fixture changed")
    const details = detailsOf(costco)
    expect(details).toMatchObject({
      posted: "2026-08-02",
      authorized: "2026-08-01",
      merchant: "Costco",
      mcc: "5300",
      channel: "in store",
      place: "Richmond, CA",
      plaidCategory: "general merchandise superstores",
    })
  })

  test("falls back to the Lunch Money fields when metadata is absent", () => {
    const manual = txn({ plaid_metadata: null, original_name: "ATM WITHDRAWAL" })
    const details = detailsOf(manual)
    expect(details.posted).toBe(manual.date)
    expect(details.raw).toBe("ATM WITHDRAWAL")
    expect(details.merchant).toBeNull()
  })

  test("malformed metadata degrades instead of throwing", () => {
    const broken = txn({ plaid_metadata: "{not json" })
    expect(postedDate(broken)).toBe(broken.date)
  })

  test("most charges post a day or two after they are made", () => {
    const chase = fixtureTransactions.filter((t) => t.account_display_name === "Card")
    const lagging = chase.filter((t) => postedDate(t) !== t.date)
    expect(lagging.length / chase.length).toBeGreaterThan(0.8)
  })
})
