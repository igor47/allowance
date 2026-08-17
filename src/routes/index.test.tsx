import { describe, expect, test } from "bun:test"
import { parseHTML } from "linkedom"
import type { LmTransaction } from "../lunchmoney/types"
import { useTestApp } from "../test/app"
import { FakeLunchMoneyClient } from "../test/fake-client"
import { fixtureTransactions } from "../test/fixtures"

const dom = async (response: Response) => parseHTML(await response.text()).document

/**
 * The recorded data with one row's tags stripped, plus a client serving it.
 *
 * August gets reviewed: 101 of its 102 Chase charges carry a tag by now. A test
 * that needs an unreviewed row therefore has to make one rather than hope a
 * survivor is still there — untagging a real charge keeps the numbers real
 * while pinning the precondition the test actually depends on.
 */
const withUnreviewed = (match: (t: LmTransaction) => boolean) => {
  const target = fixtureTransactions.find(match)
  if (!target) throw new Error("no fixture row matches")
  const client = new FakeLunchMoneyClient(
    fixtureTransactions.map((t) => (t.id === target.id ? { ...t, tags: [] } : t))
  )
  return { client, target: { ...target, tags: [] } }
}

const anAugustCharge = (t: LmTransaction) =>
  t.account_display_name === "Card" &&
  t.date >= "2026-08-01" &&
  t.date <= "2026-08-14" &&
  Number(t.amount) > 50

describe("dashboard", () => {
  test("renders the allowance from recorded data", async () => {
    const { get } = useTestApp()
    const response = await get("/")
    expect(response.status).toBe(200)

    const page = await dom(response)
    const hero = page.querySelector(".hero-number")?.textContent?.trim()
    // $200/day over 14 days against $3,691 of real August spend — which
    // includes the $196.15 hotel deposit and $6.87 coffee that Lunch Money had
    // filed as transfers and excluded.
    expect(hero).toBe("-$891")
  })

  test("shows cash, the closed statement, and what is accruing", async () => {
    const page = await dom(await useTestApp().get("/"))
    const labels = Array.from(page.querySelectorAll("#boxes .stat-label"), (n) =>
      n.textContent?.trim()
    )
    expect(labels).toEqual(["Cash on hand", "Due 9/9", "Accruing now"])
  })

  test("defaults to the review queue", async () => {
    const page = await dom(await useTestApp(withUnreviewed(anAugustCharge).client).get("/"))
    const active = page.querySelector("#txn-list .btn-secondary")?.textContent
    expect(active).toContain("Needs review")
    expect(page.querySelectorAll("tr.unreviewed").length).toBeGreaterThan(0)
  })

  test("the statement total includes charges that posted after the cycle opened", async () => {
    // Two things this pins. The fetch window has to reach back past the cycle
    // start, since the API filters on the authorized date while the cycle is
    // bucketed on the posted date. And the bill includes charges Lunch Money
    // excluded from totals — a $196 hotel deposit and a $6.87 coffee, both
    // filed as "Payment, Transfer" — because the bank billed them regardless.
    const page = await dom(await useTestApp().get("/"))
    const due = page.querySelectorAll("#boxes .stat-number")[1]?.textContent
    expect(due).toBe("$14,997")
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
  const findUnreviewed = async () => withUnreviewed(anAugustCharge)

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
  test("lives in the navbar and says how stale the data is", async () => {
    const page = await dom(await useTestApp().get("/"))
    const sync = page.querySelector("#sync")?.textContent ?? ""
    // New transactions arrived 19h ago, which is inside the day: green. The
    // banks were last polled 29h ago, which used to drive this and would have
    // said "stale" for what is in fact current data.
    expect(sync).toContain("Up to date")
    expect(sync).toContain("Banks polled")
    expect(sync).toContain("Newest transaction")
    // balance_last_update lands half a second after last_fetch, so it is not
    // a separate fact and is deliberately not shown.
    expect(sync).not.toContain("Balances read")
    expect(page.querySelector("nav #sync")).not.toBeNull()
    expect(page.querySelector("#sync [hx-post='/refresh']")).not.toBeNull()
  })

  test("the clock is plain while the data is fresh", async () => {
    const page = await dom(await useTestApp().get("/"))
    const toggle = page.querySelector("#sync button")
    expect(toggle?.getAttribute("class")).toContain("text-success")
    // The corner dot is the shape cue for "not fresh", so it is absent here;
    // the state thresholds themselves are covered in freshness.test.ts.
    expect(page.querySelectorAll("#sync svg circle")).toHaveLength(1)
  })

  test("says how old the page's own copy of the data is", async () => {
    const page = await dom(await useTestApp().get("/"))
    expect(page.querySelector("#sync")?.textContent).toContain("This page read")
  })

  test("refreshing queues a pull and says so", async () => {
    const { client, post } = useTestApp()
    const page = await dom(await post("/refresh"))
    expect(client.fetches).toBe(1)
    expect(page.querySelector("#sync")?.textContent).toContain("Queued.")
    // The queued state re-checks itself rather than claiming to be done.
    expect(page.querySelector("#sync")?.getAttribute("hx-get")).toBe("/sync")
  })

  test("the server-rendered open menu carries a static popper marker", async () => {
    // Bootstrap only right-aligns `dropdown-menu-end` under [data-bs-popper],
    // which Popper adds when *it* opens the menu. Rendering `show` from the
    // server without it drops the menu to left:0 — off the right of the window,
    // taking every value with it.
    const page = await dom(await useTestApp().post("/refresh"))
    const menu = page.querySelector("#sync .dropdown-menu")
    expect(menu?.getAttribute("class")).toContain("show")
    expect(menu?.getAttribute("data-bs-popper")).toBe("static")
  })

  test("the closed menu leaves positioning to popper", async () => {
    const page = await dom(await useTestApp().get("/"))
    const menu = page.querySelector("#sync .dropdown-menu")
    expect(menu?.getAttribute("class")).not.toContain("show")
    expect(menu?.hasAttribute("data-bs-popper")).toBe(false)
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
    const { client, target } = withUnreviewed((t) => anAugustCharge(t) && !t.exclude_from_totals)

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

describe("deposits", () => {
  test("the deposits filter surfaces refunds and deposits to tag", async () => {
    // `credits` is not a filter and never was: it fell through to the review
    // queue, which passed only for as long as that queue happened to be full.
    const page = await dom(await useTestApp().get("/?filter=deposits"))
    const rows = page.querySelectorAll("tbody tr")
    expect(rows.length).toBeGreaterThan(0)
    // Every row is money coming back, and every one can be tagged.
    for (const row of Array.from(rows)) {
      expect(row.querySelectorAll("button").length).toBeGreaterThan(0)
    }
  })

  test("deposits stay out of the review queue", async () => {
    const app = useTestApp()
    const review = await dom(await app.get("/?filter=review"))
    const badges = Array.from(review.querySelectorAll("tbody .badge"), (b) => b.textContent)
    expect(badges).not.toContain("deposit")
  })

  test("tagging a reimbursement moves the allowance up", async () => {
    const client = new FakeLunchMoneyClient()
    const all = await client.transactions("2026-08-01", "2026-08-14")
    const check = all.find((t) => t.payee?.startsWith("CHECK RECEIVED"))
    if (!check) throw new Error("fixture has no deposit to reimburse against")

    const app = useTestApp(client, 300)
    const before = (await dom(await app.get("/"))).querySelector(".hero-number")?.textContent
    const page = await dom(await app.post(`/transactions/${check.id}/tag?tag=spending`))
    const after = page.querySelector("#allowance .hero-number")?.textContent
    expect(after).not.toBe(before)
  })
})

describe("row stability", () => {
  test("a row keeps its shape whether or not it is tagged", async () => {
    const { client, target } = withUnreviewed((t) => anAugustCharge(t) && !t.exclude_from_totals)

    const app = useTestApp(client, 300)
    const shape = (doc: Document) => {
      const row = doc.querySelector(`[id="txn-${target.id}"]`)
      return {
        cells: row?.querySelectorAll("td").length,
        lines: row?.querySelectorAll(".txn-line").length,
        buttons: row?.querySelectorAll("button").length,
      }
    }

    const before = shape(await dom(await app.get("/?filter=all")))
    await app.post(`/transactions/${target.id}/tag?tag=spending`)
    const after = shape(await dom(await app.get("/?filter=all")))

    expect(before.lines).toBe(3)
    expect(after).toEqual(before)
  })
})

describe("the month chart", () => {
  test("draws one hover column per day of the whole month, not just to today", async () => {
    const page = await dom(await useTestApp().get("/"))
    const columns = page.querySelectorAll(".month-chart-hover > div")
    expect(columns).toHaveLength(31) // August, though the fixture stops on the 14th
  })

  test("labels each column with its date and exact amount", async () => {
    const page = await dom(await useTestApp().get("/"))
    const tips = Array.from(page.querySelectorAll(".month-chart-hover > div"), (n) =>
      n.getAttribute("data-bs-title")
    )
    expect(tips[7]).toBe("Sat, Aug 8 · $677 spent")
    // The 14th is the day the fixture was recorded on, and charges kept posting
    // to it after the recording — hence a figure rather than the $0 it had
    // when the day was still half-written.
    expect(tips[13]).toBe("Fri, Aug 14 · $160 spent so far")
    expect(tips[30]).toBe("Mon, Aug 31 · not yet")
  })

  test("the hover targets are HTML, because Popper cannot anchor to SVG", async () => {
    const page = await dom(await useTestApp().get("/"))
    expect(page.querySelectorAll("svg [data-bs-toggle='tooltip']")).toHaveLength(0)
  })
})

describe("month picker", () => {
  test("shows the current month by default", async () => {
    const page = await dom(await useTestApp().get("/"))
    expect(page.querySelector(".dropdown-toggle")?.textContent?.trim()).toBe("August 2026")
  })

  test("a past month is rebuilt as of its last day", async () => {
    const page = await dom(await useTestApp().get("/?month=2026-07"))
    expect(page.querySelector(".dropdown-toggle")?.textContent?.trim()).toBe("July 2026")
    // 252 real July transactions in the fixture, against 31 days of target.
    // Was -$3,308 before the wallet was given a policy: the $222 sent back to
    // Nico on the 12th is a loan settling, and it counts until it is tagged
    // `irregular`, exactly as an untagged card charge would.
    expect(page.querySelector(".hero-number")?.textContent?.trim()).toBe("-$3,530")
    expect(page.querySelectorAll(".month-chart-hover > div")).toHaveLength(31)
  })

  test("says the cash figures are not historical", async () => {
    const page = await dom(await useTestApp().get("/?month=2026-07"))
    expect(page.querySelector(".alert")?.textContent).toContain("as it stands now")
  })

  test("keeps the month on filter links so it is not lost on a click", async () => {
    const page = await dom(await useTestApp().get("/?month=2026-07"))
    const href = page.querySelector("#txn-list a")?.getAttribute("hx-get")
    expect(href).toContain("month=2026-07")
  })

  test("clamps a month beyond the data, in both directions", async () => {
    const { get } = useTestApp()
    const future = await dom(await get("/?y=2030&m=12"))
    expect(future.querySelector(".dropdown-toggle")?.textContent?.trim()).toBe("August 2026")
    const ancient = await dom(await get("/?month=2019-03"))
    expect(ancient.querySelector(".dropdown-toggle")?.textContent?.trim()).toBe("January 2025")
  })

  test("the form asks for a month by number, and submits itself", async () => {
    const page = await dom(await useTestApp().get("/"))
    const form = page.querySelector("form.dropdown-menu")
    expect(form?.getAttribute("method")).toBe("get")
    expect(form?.hasAttribute("data-autosubmit")).toBe(true)
    expect(form?.querySelector("select[name='m']")).not.toBeNull()
    expect(form?.querySelector("select[name='y']")).not.toBeNull()
    // The submit button is the no-javascript fallback, not the normal path.
    expect(form?.querySelector("noscript button[type='submit']")).not.toBeNull()
  })
})

describe("budget page", () => {
  test("derives a daily allowance from income minus commitments", async () => {
    const page = await dom(await useTestApp().get("/budget"))
    // A rental property arrived in the plan since: $1,717/month of rent in,
    // $1,572 of mortgage out, alongside $975 of therapy and $449 of new
    // subscriptions — which is the whole of the drop from the $197 this used
    // to derive.
    expect(page.querySelector(".hero-number")?.textContent?.trim()).toBe("$171")
    const summary = page.querySelector("#budget")?.textContent ?? ""
    expect(summary).toContain("$17,130") // income
    expect(summary).toContain("$11,840") // committed
  })

  test("says how much is committed on accounts with no transaction feed", async () => {
    const page = await dom(await useTestApp().get("/budget"))
    expect(page.querySelector("#budget")?.textContent).toContain("$1,193 untracked")
  })

  test("both pages are reachable from the navbar", async () => {
    const page = await dom(await useTestApp().get("/budget"))
    const links = Array.from(page.querySelectorAll("nav .nav-link"), (n) => [
      n.getAttribute("href"),
      n.textContent?.trim(),
    ])
    expect(links).toEqual([
      ["/", "Allowance"],
      ["/budget", "Budget"],
    ])
    // The page you are on is the marked one.
    expect(page.querySelector("nav .nav-link.active")?.getAttribute("href")).toBe("/budget")
  })

  test("the month picker keeps you on the budget page", async () => {
    const page = await dom(await useTestApp().get("/budget"))
    expect(page.querySelector("form.dropdown-menu")?.getAttribute("action")).toBe("/budget")
  })
})

describe("phone layout", () => {
  // The page must never scroll sideways: a 390px screen fits the navbar and
  // the filters only because the brand is a 28px mark rather than a word and
  // the filters wrap, and wide tables scroll inside their own box rather than
  // dragging the page with them.
  test("the brand is the icon, which fits at every width", async () => {
    const page = await dom(await useTestApp().get("/"))
    const brand = page.querySelector(".navbar-brand")
    expect(brand?.getAttribute("class")).not.toContain("d-none")
    expect(brand?.querySelector("img")?.getAttribute("src")).toBe("/static/icon.svg")
  })

  test("the filter bar wraps instead of running off the edge", async () => {
    const page = await dom(await useTestApp().get("/"))
    expect(page.querySelector("#txn-list .btn-group")?.getAttribute("class")).toContain("flex-wrap")
  })

  test("wide tables scroll inside their own container", async () => {
    const home = await dom(await useTestApp(withUnreviewed(anAugustCharge).client).get("/"))
    expect(home.querySelector(".table-responsive .txn-table")).not.toBeNull()
    const budget = await dom(await useTestApp().get("/budget"))
    expect(budget.querySelectorAll(".table-responsive table")).toHaveLength(2)
  })

  test("the sync menu only refuses to wrap on its label rows", async () => {
    // Applying nowrap to every child stretched the queued sentence into one
    // 609px line, which is wider than the phone it opens on.
    const page = await dom(await useTestApp().post("/refresh"))
    expect(page.querySelectorAll("#sync .sync-row").length).toBeGreaterThan(0)
    const queued = page.querySelector("#sync .text-info")
    expect(queued?.getAttribute("class")).not.toContain("sync-row")
  })
})

describe("access log", () => {
  test("says who asked for what, and how it went", async () => {
    const { get, logs } = useTestApp()
    await get("/budget?month=2026-07", { headers: { "X-authentik-username": "igor47" } })

    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z GET \/budget\?month=2026-07 200 \d+ms user=igor47$/
    )
  })

  test("marks the anonymous case, since that is the forward-auth failure", async () => {
    // A blank username looks like an ordinary page in the browser and only
    // shows up later, as a tag filed under nobody. In the log it is visible.
    const { get, logs } = useTestApp()
    await get("/")
    expect(logs[0]).toContain("user=-")
  })

  test("logs the request that failed, not just the stack", async () => {
    const client = new FakeLunchMoneyClient()
    client.transactions = () => {
      throw new Error("lunch money is down")
    }
    const { get, logs } = useTestApp(client)

    expect((await get("/")).status).toBe(500)
    expect(logs.some((l) => l.includes("GET / failed: Error: lunch money is down"))).toBe(true)
    expect(logs.some((l) => /GET \/ 500 \d+ms/.test(l))).toBe(true)
  })
})
