import { describe, expect, test } from "bun:test"
import { metadata, txn } from "../test/factories"
import { aCharge } from "../test/world"
import { detailsOf, postedDate } from "./details"

describe("plaid details", () => {
  test("pulls out what the bank actually shows", () => {
    const charge = txn({
      date: "2026-08-01",
      plaid_metadata: metadata({
        posted: "2026-08-02",
        authorized: "2026-08-01",
        raw: "A WAREHOUSE #0123",
        merchant: "A Warehouse",
        mcc: "5300",
        channel: "in store",
        city: "Richmond",
        region: "CA",
        plaidCategory: "GENERAL_MERCHANDISE_SUPERSTORES",
      }),
    })
    expect(detailsOf(charge)).toMatchObject({
      posted: "2026-08-02",
      authorized: "2026-08-01",
      raw: "A WAREHOUSE #0123",
      merchant: "A Warehouse",
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

  test("the posted date is Plaid's, not Lunch Money's", () => {
    // The whole reason this module exists: Lunch Money reports the day the card
    // was swiped, and the statement bills the day the charge posts.
    const lagging = aCharge({ on: "2026-07-12", amount: 100, posted: "2026-07-14" })
    expect(lagging.date).toBe("2026-07-12")
    expect(postedDate(lagging)).toBe("2026-07-14")
  })

  test("a counterparty stands in for a missing website or logo", () => {
    const withCounterparty = txn({
      plaid_metadata: JSON.stringify({
        counterparties: [{ website: "example.test", logo_url: "https://example.test/logo.png" }],
      }),
    })
    const details = detailsOf(withCounterparty)
    expect(details.website).toBe("example.test")
    expect(details.logo).toBe("https://example.test/logo.png")
  })
})
