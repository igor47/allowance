import { describe, expect, test } from "bun:test"
import { parseHTML } from "linkedom"
import { useTestApp } from "../test/app"
import { FakeLunchMoneyClient } from "../test/fake-client"

const dom = async (response: Response) => parseHTML(await response.text()).document

describe("dashboard", () => {
  test("renders the allowance from recorded data", async () => {
    const { get } = useTestApp()
    const response = await get("/")
    expect(response.status).toBe(200)

    const page = await dom(response)
    const hero = page.querySelector(".hero-number")?.textContent?.trim()
    // $200/day over 14 days against $3,157 of real August spend.
    expect(hero).toBe("-$356")
  })

  test("shows cash, the closed statement, and what is accruing", async () => {
    const page = await dom(await useTestApp().get("/"))
    const labels = Array.from(page.querySelectorAll("#boxes .stat-label"), (n) =>
      n.textContent?.trim()
    )
    expect(labels).toEqual(["Cash on hand", "Due 9/9", "Accruing now"])
  })

  test("defaults to the review queue", async () => {
    const page = await dom(await useTestApp().get("/"))
    const active = page.querySelector("#txn-list .btn-secondary")?.textContent
    expect(active).toContain("Needs review")
    expect(page.querySelectorAll("tr.unreviewed").length).toBeGreaterThan(0)
  })

  test("the statement total includes charges that posted after the cycle opened", async () => {
    // The fetch window has to reach back past the cycle start, since the API
    // filters on the authorized date and the cycle is bucketed on the posted
    // date. Without the slack this number comes out several hundred short.
    const page = await dom(await useTestApp().get("/"))
    const due = page.querySelectorAll("#boxes .stat-number")[1]?.textContent
    expect(due).toBe("$14,927")
  })

  test("filters narrow the feed", async () => {
    const { get } = useTestApp()
    const all = await dom(await get("/transactions?filter=all"))
    const fixed = await dom(await get("/transactions?filter=fixed"))
    expect(all.querySelectorAll("tbody tr").length).toBeGreaterThan(
      fixed.querySelectorAll("tbody tr").length
    )
  })

  test("an unrecognised filter falls back to the review queue", async () => {
    const page = await dom(await useTestApp().get("/?filter=nonsense"))
    expect(page.querySelector("#txn-list .btn-secondary")?.textContent).toContain("Needs review")
  })
})

describe("tagging", () => {
  const findUnreviewed = async () => {
    const client = new FakeLunchMoneyClient()
    const all = await client.transactions("2026-08-01", "2026-08-14")
    const target = all.find(
      (t) =>
        t.account_display_name === "Card" && t.tags.length === 0 && Number(t.amount) > 50
    )
    if (!target) throw new Error("fixture has no untagged Chase spend")
    return { client, target }
  }

  test("tagging recurring removes the charge from the allowance", async () => {
    const { client, target } = await findUnreviewed()
    const app = useTestApp(client)

    const before = await dom(await app.get("/"))
    const beforeBalance = before.querySelector(".hero-number")?.textContent

    const response = await app.post(`/transactions/${target.id}/tag?tag=recurring`)
    expect(response.status).toBe(200)
    expect(client.writes).toEqual([{ transactionId: target.id, tags: ["recurring"] }])

    const page = await dom(response)
    // The row comes back reclassified, with the summary swapped out of band.
    expect(page.querySelector("tr")?.textContent).toContain("tagged recurring")
    expect(page.querySelector("#allowance")?.getAttribute("hx-swap-oob")).toBe("true")
    expect(page.querySelector("#allowance .hero-number")?.textContent).not.toBe(beforeBalance)
  })

  test("person tags leave the classification alone", async () => {
    const { client, target } = await findUnreviewed()
    const app = useTestApp(client)

    // The recorded data now carries real igor/serena tags, so count the delta
    // rather than assuming this is the only one.
    const before = (await dom(await app.get("/?filter=serena"))).querySelectorAll("tbody tr").length
    await app.post(`/transactions/${target.id}/tag?tag=serena`)
    expect(client.writes.at(-1)?.tags).toEqual(["serena"])

    const after = (await dom(await app.get("/?filter=serena"))).querySelectorAll("tbody tr").length
    expect(after).toBe(before + 1)
  })

  test("unknown tags are refused before any write", async () => {
    const { client, target } = await findUnreviewed()
    const app = useTestApp(client)
    expect((await app.post(`/transactions/${target.id}/tag?tag=groceries`)).status).toBe(400)
    expect(client.writes).toEqual([])
  })

  test("a transaction outside the period is not taggable", async () => {
    const app = useTestApp()
    expect((await app.post("/transactions/1/tag?tag=spending")).status).toBe(404)
  })
})

describe("sync", () => {
  test("shows how stale the data is and offers a refresh", async () => {
    const page = await dom(await useTestApp().get("/"))
    const sync = page.querySelector("#sync")?.textContent ?? ""
    expect(sync).toContain("Transactions synced")
    expect(page.querySelector("#sync button")?.getAttribute("hx-post")).toBe("/refresh")
  })

  test("refreshing queues a pull and says so", async () => {
    const { client, post } = useTestApp()
    const page = await dom(await post("/refresh"))
    expect(client.fetches).toBe(1)
    expect(page.querySelector("#sync")?.textContent).toContain("Refresh queued")
    // The queued state re-checks itself rather than claiming to be done.
    expect(page.querySelector("#sync")?.getAttribute("hx-get")).toBe("/sync")
  })

  test("a second refresh inside the cooldown does not hit the API again", async () => {
    const { client, post } = useTestApp()
    await post("/refresh")
    await post("/refresh")
    expect(client.fetches).toBe(1)
  })
})

describe("caching", () => {
  test("tagging patches the cache instead of re-reading the window", async () => {
    const client = new FakeLunchMoneyClient()
    const all = await client.transactions("2026-08-01", "2026-08-14")
    const target = all.find(
      (t) =>
        t.account_display_name === "Card" && t.tags.length === 0 && !t.exclude_from_totals
    )
    if (!target) throw new Error("fixture has no untagged Chase spend")

    // A cache that actually caches, so a tag write must not need a re-read.
    const app = useTestApp(client, 300)
    await app.get("/")
    const readsBefore = client.reads
    await app.post(`/transactions/${target.id}/tag?tag=spending`)
    expect(client.reads).toBe(readsBefore)
    expect(client.writes).toHaveLength(1)

    // ...and the new tag is visible without going back to the API.
    const page = await dom(await app.get("/?filter=spending"))
    expect(page.querySelector(`#txn-${target.id}`)?.textContent).toContain("tagged spending")
    expect(client.reads).toBe(readsBefore)
  })
})
