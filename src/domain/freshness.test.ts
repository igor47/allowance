import { describe, expect, test } from "bun:test"
import type { LmPlaidAccount } from "../lunchmoney/types"
import { ago, freshness, staleness } from "./freshness"

const NOW = new Date("2026-08-14T23:32:00Z")

const account = (over: Partial<LmPlaidAccount>): LmPlaidAccount =>
  ({
    id: 1,
    name: "CREDIT CARD",
    display_name: "Card",
    type: "credit",
    subtype: "credit card",
    mask: "0000",
    institution_name: "Chase",
    status: "active",
    limit: null,
    balance: "0",
    to_base: 0,
    currency: "usd",
    balance_last_update: "2026-08-14T21:35:25.463Z",
    last_import: "2026-08-14T04:52:15.051Z",
    last_fetch: "2026-08-14T21:35:25.872Z",
    ...over,
  }) as LmPlaidAccount

describe("freshness", () => {
  test("reports the newest transaction it holds", () => {
    const result = freshness([account({})], 30, "2026-08-13", NOW)
    expect(result.newestTransaction).toBe("2026-08-13")
  })

  test("an import timestamp only moves when something new arrived", () => {
    // A refresh that finds nothing leaves last_import alone while last_fetch
    // advances — which is why the two read differently after pressing refresh.
    const result = freshness(
      [account({ last_fetch: "2026-08-14T23:30:00Z", last_import: "2026-08-14T04:52:15.051Z" })],
      30,
      null,
      NOW
    )
    expect(result.minutesSinceFetch).toBe(2)
    expect(result.transactionsAt?.toISOString()).toBe("2026-08-14T04:52:15.051Z")
  })

  test("takes the newest timestamp across accounts", () => {
    const result = freshness(
      [
        account({ last_import: "2026-08-13T10:02:04.501Z" }),
        account({ last_import: "2026-08-14T04:52:15.051Z" }),
      ],
      30,
      null,
      NOW
    )
    expect(result.transactionsAt?.toISOString()).toBe("2026-08-14T04:52:15.051Z")
  })

  test("a recent fetch is left alone", () => {
    const result = freshness([account({ last_fetch: "2026-08-14T23:20:00Z" })], 30, null, NOW)
    expect(result.minutesSinceFetch).toBe(12)
    expect(result.shouldRefresh).toBe(false)
  })

  test("a stale fetch is worth queueing", () => {
    const result = freshness([account({ last_fetch: "2026-08-14T21:35:25.872Z" })], 30, null, NOW)
    expect(result.minutesSinceFetch).toBe(116)
    expect(result.shouldRefresh).toBe(true)
  })

  test("never fetched counts as stale", () => {
    const result = freshness([account({ last_fetch: null as unknown as string })], 30, null, NOW)
    expect(result.shouldRefresh).toBe(true)
  })
})

describe("ago", () => {
  test("rounds to something readable", () => {
    expect(ago(new Date("2026-08-14T23:31:40Z"), NOW)).toBe("just now")
    expect(ago(new Date("2026-08-14T23:00:00Z"), NOW)).toBe("32m ago")
    expect(ago(new Date("2026-08-14T04:52:15Z"), NOW)).toBe("18h ago")
    expect(ago(new Date("2026-08-11T04:52:15Z"), NOW)).toBe("3d ago")
    expect(ago(null, NOW)).toBe("never")
  })
})

describe("staleness", () => {
  const at = (minutesSinceFetch: number | null, shouldRefresh: boolean) =>
    staleness({
      transactionsAt: null,
      newestTransaction: null,
      balancesAt: null,
      lastFetchAt: null,
      minutesSinceFetch,
      shouldRefresh,
    })

  test("fresh while the automatic refresh has not come due", () => {
    expect(at(5, false)).toBe("fresh")
  })

  test("aging once it has, up to a day", () => {
    expect(at(31, true)).toBe("aging")
    expect(at(23 * 60, true)).toBe("aging")
  })

  test("stale past a day, which is about how often transactions land", () => {
    expect(at(24 * 60, true)).toBe("stale")
  })

  test("never having fetched is stale, not fresh", () => {
    expect(at(null, true)).toBe("stale")
  })
})
