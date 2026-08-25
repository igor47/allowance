import { describe, expect, test } from "bun:test"
import { CHASE, FIDELITY_JOINT, IGOR_PERSONAL } from "../domain/policy"
import { txn } from "../test/factories"
import { dashboard, visit } from "../test/page"
import { aWorld } from "../test/world"

/**
 * The month every test in this file starts from unless it says otherwise.
 *
 * A thunk rather than a constant, so each example gets a fresh world and no
 * test can leave a tag behind for the next one. Round numbers throughout: at
 * $200/day over 14 days the budget is $2,800, so the arithmetic in every
 * assertion below can be done in your head.
 *
 * $400 counts — the two untagged card charges. The utility is tagged
 * `recurring`, rent is on a fixed account, and the salary is a deposit, so
 * none of those three touch the balance.
 */
const august = () =>
  aWorld({ today: "2026-08-14" })
    .account(CHASE, { balance: "1200.00" })
    .account(IGOR_PERSONAL, { balance: "5000.00" })
    .account(FIDELITY_JOINT, { balance: "2000.00" })
    .deposit({ on: "2026-08-01", amount: 4_000, payee: "PAYROLL" })
    .charge({ on: "2026-08-03", amount: 100, payee: "A Grocer" })
    .charge({ on: "2026-08-08", amount: 300, payee: "A Restaurant" })
    .charge({ on: "2026-08-10", amount: 60, payee: "A Utility", tags: ["recurring"] })
    .charge({
      on: "2026-08-12",
      amount: 5_000,
      account: IGOR_PERSONAL,
      payee: "A Landlord",
      category: "Rent",
    })

describe("dashboard", () => {
  test("renders the allowance", async () => {
    const page = await dashboard(august())
    // $2,800 budgeted over fourteen days, $400 of it spent.
    expect(page.hero).toBe("$2,400")
    expect(page.title).toBe("allowance · August 2026")
  })

  test("shows cash, the closed statement, and what is accruing", async () => {
    const page = await dashboard(august())
    expect(page.statLabels).toEqual(["Cash on hand", "Due 9/9", "Accruing now"])
    // The card is a credit account and is not cash; the two bank accounts are.
    expect(page.stats[0]?.value).toBe("$7,000")
    // Everything on the card in the 7/13-8/12 cycle, tagged or not.
    expect(page.stats[1]?.value).toBe("$460")
    expect(page.stats[2]?.value).toBe("$0")
  })

  test("an overspent month reads as a negative balance", async () => {
    const page = await dashboard(august().charge({ on: "2026-08-06", amount: 3_000 }))
    expect(page.hero).toBe("-$600")
  })

  test("defaults to the review queue", async () => {
    const page = await dashboard(august())
    expect(page.activeFilter).toContain("Needs review")
    // Two untagged card charges and the untagged rent. The salary is a deposit
    // and the utility is tagged, so neither is a question anyone needs asked.
    expect(page.rows).toHaveLength(3)
    expect(page.rows.every((r) => r.unreviewed)).toBe(true)
    expect(page.reviewCount).toBe(3)
  })

  test("every row says which bucket it landed in and why", async () => {
    const page = await dashboard(august())
    const rows = (await page.filter("all")).rows
    expect(rows.map((r) => r.payee)).toEqual([
      "A Landlord",
      "A Utility",
      "A Restaurant",
      "A Grocer",
      "PAYROLL",
    ])
    expect(rows.map((r) => r.badge)).toEqual([
      "unclassified",
      "recurring",
      "spending",
      "spending",
      "deposit",
    ])
    expect(rows[1]?.reason).toBe("tagged recurring")
    expect(rows[3]?.reason).toBe(`untagged on ${CHASE}`)
    // The account chip appears only for accounts other than the card.
    expect(rows[0]?.account).toBe(IGOR_PERSONAL)
    expect(rows[3]?.account).toBe("")
  })

  test("the statement total includes charges that posted after the cycle opened", async () => {
    // The API filters on the authorized date while the cycle is bucketed on the
    // posted date, so the fetch window has to reach back past the cycle start
    // or a charge swiped on the 12th and posted on the 13th goes missing.
    const world = august().charge({
      on: "2026-07-12",
      amount: 250,
      payee: "A Late Poster",
      posted: "2026-07-13",
    })
    expect((await dashboard(world)).stats[1]?.value).toBe("$710")
  })

  test("a charge Lunch Money excluded is still on the bill", async () => {
    const world = august().charge({
      on: "2026-08-04",
      amount: 200,
      payee: "A Hotel",
      category: "Payment, Transfer",
      excluded: true,
    })
    expect((await dashboard(world)).stats[1]?.value).toBe("$660")
  })

  test("filters narrow the feed", async () => {
    const page = await dashboard(august())
    expect((await page.filter("all")).rows).toHaveLength(5)
    expect((await page.filter("spending")).rows.map((r) => r.payee)).toEqual([
      "A Restaurant",
      "A Grocer",
    ])
    expect((await page.filter("fixed")).rows.map((r) => r.payee)).toEqual([
      "A Landlord",
      "A Utility",
    ])
  })

  test("the summary line totals the filter, and the part that counts", async () => {
    // $5,000 rent + $60 utility + $400 of card charges − $4,000 of salary.
    // Both figures always show: hiding "against the allowance" when it equalled
    // the total made two filters look like they measured different things.
    const page = await dashboard(august())
    expect((await page.filter("all")).summary).toBe(
      "5 transactions · $1,460 total · $400 against the allowance"
    )
  })

  test("an unrecognised filter falls back to the review queue", async () => {
    expect((await dashboard(august(), "?filter=nonsense")).activeFilter).toContain("Needs review")
  })

  test("a filter with nothing in it says so", async () => {
    expect((await dashboard(august(), "?filter=igor")).empty).toBe(true)
  })

  test("an account with no policy is called out rather than silently dropped", async () => {
    const world = august()
    world.transactions.push(
      txn({
        date: "2026-08-06",
        amount: "500.00",
        account_display_name: "A Savings Account",
        plaid_account_display_name: "A Savings Account",
      })
    )
    const page = await dashboard(world)
    expect(page.banners.join(" ")).toContain("no policy for A Savings Account")
  })
})

describe("tagging", () => {
  const anUntaggedCharge = (world: ReturnType<typeof august>) =>
    world.transactions.find((t) => t.payee === "A Restaurant")?.id as number

  test("tagging recurring removes the charge from the allowance", async () => {
    const world = august()
    const id = anUntaggedCharge(world)
    const session = visit(world)

    expect((await session.dashboard()).hero).toBe("$2,400")
    const result = await session.tag(id, "recurring")

    expect(result.status).toBe(200)
    expect(session.client.writes).toEqual([{ transactionId: id, tags: ["recurring"] }])
    expect(result.row?.reason).toBe("tagged recurring")
    expect(result.row?.badge).toBe("recurring")
    // The row comes back, and the summary is swapped out of band alongside it.
    expect(result.swapsOutOfBand).toEqual(["allowance", "boxes"])
    expect(result.hero).toBe("$2,700")
  })

  test("clicking the same tag again un-tags it", async () => {
    const world = august()
    const id = world.transactions.find((t) => t.payee === "A Utility")?.id as number
    const session = visit(world)
    const result = await session.tag(id, "recurring")
    expect(session.client.writes).toEqual([{ transactionId: id, tags: [] }])
    expect(result.row?.badge).toBe("spending")
  })

  test("classifying tags are mutually exclusive", async () => {
    const world = august()
    const session = visit(world)
    const id = world.transactions.find((t) => t.payee === "A Utility")?.id as number
    await session.tag(id, "irregular")
    expect(session.client.writes.at(-1)?.tags).toEqual(["irregular"])
  })

  test("person tags leave the classification alone", async () => {
    const world = august()
    const id = anUntaggedCharge(world)
    const session = visit(world)

    expect((await session.dashboard("?filter=serena")).rows).toHaveLength(0)
    await session.tag(id, "serena")
    expect(session.client.writes.at(-1)?.tags).toEqual(["serena"])

    const after = await session.dashboard("?filter=serena")
    expect(after.rows.map((r) => r.payee)).toEqual(["A Restaurant"])
    // Still counting, still unreviewed: who spent it is a separate question.
    expect(after.rows[0]?.badge).toBe("spending")
    expect(after.rows[0]?.unreviewed).toBe(true)
  })

  test("unknown tags are refused before any write", async () => {
    const world = august()
    const session = visit(world)
    const response = await session.post(
      `/transactions/${anUntaggedCharge(world)}/tag?tag=groceries`
    )
    expect(response.status).toBe(400)
    expect(session.client.writes).toEqual([])
  })

  test("a transaction outside the period is not taggable", async () => {
    const session = visit(august())
    expect((await session.post("/transactions/999999/tag?tag=spending")).status).toBe(404)
  })

  test("a row keeps its shape whether or not it is tagged", async () => {
    // Tagging changes the reason text, and letting that reflow the row made the
    // rest of the list jump under the cursor between clicks.
    const world = august()
    const id = anUntaggedCharge(world)
    const session = visit(world)

    const before = (await session.dashboard("?filter=all")).row(id)
    await session.tag(id, "spending")
    const after = (await session.dashboard("?filter=all")).row(id)

    expect(before?.taggable).toBe(true)
    expect(after?.date).toBe(before?.date)
    expect(after?.payee).toBe(before?.payee)
    expect(after?.amount).toBe(before?.amount)
    expect(after?.taggable).toBe(before?.taggable)
    expect(after?.reason).not.toBe(before?.reason)
  })
})

describe("deposits", () => {
  const withARefund = () => august().refund({ on: "2026-08-09", amount: 40, payee: "A Retailer" })

  test("the deposits filter surfaces refunds and money coming back", async () => {
    // `credits` is not a filter and never was: it fell through to the review
    // queue, which passed only for as long as that queue happened to be full.
    const page = await dashboard(withARefund(), "?filter=deposits")
    expect(page.rows.map((r) => r.payee)).toEqual(["A Retailer", "PAYROLL"])
    // Every row is money coming back, and every one can be tagged.
    expect(page.rows.every((r) => r.taggable)).toBe(true)
  })

  test("deposits stay out of the review queue", async () => {
    const page = await dashboard(withARefund())
    expect(page.rows.map((r) => r.badge)).not.toContain("deposit")
  })

  test("tagging a reimbursement moves the allowance up", async () => {
    // Spend on the card for work, get repaid into the bank: the purchase counts
    // and the repayment counts against it, so the pair nets to zero.
    const world = august().deposit({
      on: "2026-08-11",
      amount: 300,
      payee: "CHECK RECEIVED",
      into: IGOR_PERSONAL,
    })
    const id = world.transactions.find((t) => t.payee === "CHECK RECEIVED")?.id as number
    const session = visit(world)

    expect((await session.dashboard()).hero).toBe("$2,400")
    expect((await session.tag(id, "spending")).hero).toBe("$2,700")
  })

  test("a refund on the card credits the day it lands", async () => {
    expect((await dashboard(withARefund())).hero).toBe("$2,440")
  })
})

describe("the statement check", () => {
  /**
   * A world with the statement before last in it, and the autopay that settled
   * it. That pair is the only external oracle the app has for its own
   * arithmetic — see `reconcile()`.
   */
  const withASettledStatement = (billed: number, paid: number) =>
    august()
      // Predates the 6/13 cycle start, so the history demonstrably reaches back
      // far enough for the reconstruction to mean anything.
      .charge({ on: "2026-06-09", amount: 0.01, payee: "An Older Charge" })
      .charge({ on: "2026-06-20", amount: billed, payee: "An Earlier Charge" })
      .autopay({ on: "2026-08-09", amount: paid, from: IGOR_PERSONAL })

  test("says nothing when the reconstruction matches what Chase debited", async () => {
    const page = await dashboard(withASettledStatement(1_000, 1_000))
    expect(page.banners).toEqual([])
  })

  test("says so when it does not", async () => {
    const page = await dashboard(withASettledStatement(1_000, 1_300))
    const banner = page.banners.join(" ")
    expect(banner).toContain("Statement check")
    expect(banner).toContain("settled for $1,300.00")
    expect(banner).toContain("reconstructed $1,000.00")
    expect(banner).toContain("$300.00")
    expect(banner).toContain("more than expected")
  })

  test("the autopay itself never reaches the review queue", async () => {
    // Both halves of it: a five-figure row would be the loudest thing there.
    const page = await dashboard(withASettledStatement(1_000, 1_000))
    expect(page.rows.map((r) => r.payee)).not.toContain("AUTOMATIC PAYMENT - THANK")
    expect(page.rows.map((r) => r.payee)).not.toContain("DIRECT DEBIT CHASE CREDIT CAUTOPAY (Cash)")
  })

  test("stays quiet when the payment has not landed yet", async () => {
    const page = await dashboard(
      august()
        .charge({ on: "2026-06-09", amount: 10, payee: "An Older Charge" })
        .charge({ on: "2026-06-20", amount: 1_000, payee: "An Earlier Charge" })
    )
    expect(page.banners).toEqual([])
  })

  test("stays quiet when the history does not reach back to the statement", async () => {
    // The charges it settled are outside the linked history, so there is
    // nothing to reconstruct — and a five-figure "discrepancy" would be a lie.
    const page = await dashboard(
      august().autopay({ on: "2026-08-09", amount: 9_000, from: IGOR_PERSONAL })
    )
    expect(page.banners).toEqual([])
  })
})

describe("sync", () => {
  test("lives in the navbar and says how stale the data is", async () => {
    const page = await dashboard(august())
    // Transactions arrived this morning, which is inside the day: green.
    expect(page.sync).toContain("Up to date")
    expect(page.sync).toContain("Banks polled")
    expect(page.sync).toContain("Newest transaction")
    // balance_last_update lands moments after last_fetch, so it is not a
    // separate fact and is deliberately not shown.
    expect(page.sync).not.toContain("Balances read")
    expect(page.doc.querySelector("nav #sync")).not.toBeNull()
    expect(page.doc.querySelector("#sync [hx-post='/refresh']")).not.toBeNull()
  })

  test("the clock is plain while the data is fresh", async () => {
    const page = await dashboard(august())
    expect(page.doc.querySelector("#sync button")?.getAttribute("class")).toContain("text-success")
    // The corner dot is the shape cue for "not fresh", so it is absent here;
    // the state thresholds themselves are covered in freshness.test.ts.
    expect(page.doc.querySelectorAll("#sync svg circle")).toHaveLength(1)
  })

  test("says how old the page's own copy of the data is", async () => {
    expect((await dashboard(august())).sync).toContain("This page read")
  })

  test("refreshing queues a pull and says so", async () => {
    const session = visit(august())
    const page = await session.refresh()
    expect(session.client.fetches).toBe(1)
    expect(page.sync).toContain("Queued.")
    // The queued state re-checks itself rather than claiming to be done.
    expect(page.doc.querySelector("#sync")?.getAttribute("hx-get")).toBe("/sync")
  })

  test("the server-rendered open menu carries a static popper marker", async () => {
    // Bootstrap only right-aligns `dropdown-menu-end` under [data-bs-popper],
    // which Popper adds when *it* opens the menu. Rendering `show` from the
    // server without it drops the menu to left:0 — off the right of the window,
    // taking every value with it.
    const menu = (await visit(august()).refresh()).doc.querySelector("#sync .dropdown-menu")
    expect(menu?.getAttribute("class")).toContain("show")
    expect(menu?.getAttribute("data-bs-popper")).toBe("static")
  })

  test("the closed menu leaves positioning to popper", async () => {
    const menu = (await dashboard(august())).doc.querySelector("#sync .dropdown-menu")
    expect(menu?.getAttribute("class")).not.toContain("show")
    expect(menu?.hasAttribute("data-bs-popper")).toBe(false)
  })

  test("a second refresh inside the cooldown does not hit the API again", async () => {
    const session = visit(august())
    await session.refresh()
    await session.refresh()
    expect(session.client.fetches).toBe(1)
  })
})

describe("caching", () => {
  const cached = () => aWorld({ today: "2026-08-14", config: { cacheTtlSeconds: 300 } })

  test("tagging patches the cache instead of re-reading the window", async () => {
    const world = cached().charge({ on: "2026-08-05", amount: 100, payee: "A Merchant" })
    const id = world.transactions[0]?.id as number
    const session = visit(world)

    await session.dashboard()
    const readsBefore = session.client.reads
    await session.tag(id, "spending")
    expect(session.client.reads).toBe(readsBefore)
    expect(session.client.writes).toHaveLength(1)

    // ...and the new tag is visible without going back to the API.
    const page = await session.dashboard("?filter=spending")
    expect(page.row(id)?.reason).toBe("tagged spending")
    expect(session.client.reads).toBe(readsBefore)
  })
})

describe("the month chart", () => {
  test("draws one hover column per day of the whole month, not just to today", async () => {
    expect((await dashboard(august())).chart.columns).toBe(31)
  })

  test("labels each column with its date and exact amount", async () => {
    const chart = (await dashboard(august())).chart
    expect(chart.day(3)).toBe("Mon, Aug 3 · $100 spent")
    expect(chart.day(4)).toBe("Tue, Aug 4 · $0 spent")
    // Today is still being written, and says so.
    expect(chart.day(14)).toBe("Fri, Aug 14 · $0 spent so far")
    expect(chart.day(31)).toBe("Mon, Aug 31 · not yet")
  })

  test("the hover targets are HTML, because Popper cannot anchor to SVG", async () => {
    const page = await dashboard(august())
    expect(page.doc.querySelectorAll("svg [data-bs-toggle='tooltip']")).toHaveLength(0)
  })
})

describe("month picker", () => {
  test("shows the current month by default", async () => {
    expect((await dashboard(august())).monthLabel).toBe("August 2026")
  })

  test("a past month is rebuilt as of its last day", async () => {
    // The period is the calendar month, so July stands on its own.
    const world = august()
      .charge({ on: "2026-07-04", amount: 200, payee: "A Grocer" })
      .charge({ on: "2026-07-20", amount: 300, payee: "A Restaurant" })
    const page = await dashboard(world, "?month=2026-07")
    expect(page.monthLabel).toBe("July 2026")
    // $6,200 budgeted against $500 spent, so the balance runs into the 14-day
    // rollover cap: a frugal month cannot bank more than $2,800 of runway.
    expect(page.hero).toBe("$2,800")
    expect(page.chart.day(4)).toBe("Sat, Jul 4 · $200 spent")
    expect(page.chart.columns).toBe(31)
    expect((await page.filter("all")).rows.map((r) => r.payee)).toEqual([
      "A Restaurant",
      "A Grocer",
    ])
  })

  test("says the cash figures are not historical", async () => {
    const page = await dashboard(august(), "?month=2026-07")
    expect(page.banners.join(" ")).toContain("as it stands now")
  })

  test("keeps the month on filter links so it is not lost on a click", async () => {
    const page = await dashboard(august(), "?month=2026-07")
    expect(page.doc.querySelector("#txn-list a")?.getAttribute("hx-get")).toContain("month=2026-07")
  })

  test("clamps a month beyond the data, in both directions", async () => {
    expect((await dashboard(august(), "?y=2030&m=12")).monthLabel).toBe("August 2026")
    expect((await dashboard(august(), "?month=2019-03")).monthLabel).toBe("January 2025")
  })

  test("the form asks for a month by number, and submits itself", async () => {
    const form = (await dashboard(august())).doc.querySelector("form.dropdown-menu")
    expect(form?.getAttribute("method")).toBe("get")
    expect(form?.hasAttribute("data-autosubmit")).toBe(true)
    expect(form?.querySelector("select[name='m']")).not.toBeNull()
    expect(form?.querySelector("select[name='y']")).not.toBeNull()
    // The submit button is the no-javascript fallback, not the normal path.
    expect(form?.querySelector("noscript button[type='submit']")).not.toBeNull()
  })
})

describe("budget page", () => {
  /** A plan small enough to check in your head: $10,000 in, $1,620 committed. */
  const withAPlan = () =>
    august()
      .income({ payee: "Payroll", amount: 4_000, cadence: "twice a month" })
      .income({ payee: "Rent Received", amount: 2_000 })
      .subscription({ payee: "Mortgage", amount: 1_500 })
      .subscription({ payee: "A Streaming Service", amount: 20, tracked: false })
      .subscription({ payee: "A Gym", amount: 100, tracked: false })

  test("derives a daily allowance from income minus commitments", async () => {
    const page = await visit(withAPlan()).budget()
    // $8,380 left over 31 days.
    expect(page.hero).toBe("$270")
    expect(page.summary).toContain("$10,000")
    expect(page.summary).toContain("$1,620")
  })

  test("says what actually lands this month, beside the steady rate", async () => {
    // An annual bill is a twelfth of itself in the monthly column and its
    // whole self in the month it is due. The headline stays amortised so the
    // daily target does not lurch; this is the other question worth asking.
    const world = withAPlan().subscription({
      payee: "Car Insurance",
      amount: 1_200,
      cadence: "yearly",
      expected: ["2026-08-18"],
    })
    const page = await visit(world).budget()
    expect(page.summary).toContain("$1,720") // committed: $1,620 + $100 amortised
    expect(page.summary).toContain("due Aug")
    const insurance = page.rates.find((r) => r.payee === "Car Insurance")
    expect(insurance?.monthly).toBe("$100")
    expect(insurance?.dueThisPeriod).toBe("$1,200")
    expect(insurance?.dates).toBe("8/18")

    // A monthly item says the same thing in both columns, so the extra one
    // only ever earns its place where the two genuinely disagree.
    const mortgage = page.rates.find((r) => r.payee === "Mortgage")
    expect(mortgage?.dueThisPeriod).toBe("$1,500")
  })

  test("stays quiet in an ordinary month, where the two figures agree", async () => {
    // Most months land within a few dollars of the steady rate, and a second
    // total that close to the first is noise dressed as information.
    const page = await visit(withAPlan()).budget()
    expect(page.summary).not.toContain("due Aug")
  })

  test("says how much is committed on accounts with no transaction feed", async () => {
    expect((await visit(withAPlan()).budget()).summary).toContain("$120 untracked")
  })

  test("lists commitments by what they cost a month", async () => {
    expect((await visit(withAPlan()).budget()).payees).toEqual([
      "Payroll",
      "Rent Received",
      "Mortgage",
      "A Gym",
      "A Streaming Service",
    ])
  })

  test("both pages are reachable from the navbar", async () => {
    const page = await visit(withAPlan()).budget()
    expect(page.navLinks).toEqual([
      ["/", "Allowance"],
      ["/budget", "Budget"],
    ])
    // The page you are on is the marked one.
    expect(page.activeNav).toBe("/budget")
  })

  test("the month picker keeps you on the budget page", async () => {
    const page = await visit(withAPlan()).budget()
    expect(page.doc.querySelector("form.dropdown-menu")?.getAttribute("action")).toBe("/budget")
  })
})

describe("phone layout", () => {
  // The page must never scroll sideways: a 390px screen fits the navbar and
  // the filters only because the brand is a 24px mark rather than a word, the
  // page links collapse behind a toggle, and the filters wrap.
  test("the brand is the icon, which fits at every width", async () => {
    const brand = (await dashboard(august())).doc.querySelector(".navbar-brand")
    expect(brand?.getAttribute("class")).not.toContain("d-none")
    expect(brand?.querySelector("img")?.getAttribute("src")).toBe("/static/icon.svg")
  })

  test("the page links collapse, and the controls do not", async () => {
    // The controls are the reason the collapse exists. Moving the clock or the
    // month picker inside it would hide the refresh button behind a toggle
    // and cost the staleness colour the glance it is in the navbar for.
    const page = await dashboard(august())
    const menu = page.doc.querySelector("#nav-menu")
    expect(menu?.getAttribute("class")).toContain("collapse")
    expect(menu?.querySelectorAll(".nav-link")).toHaveLength(2)
    expect(menu?.querySelector("#sync")).toBeNull()
    expect(menu?.querySelector(".month-menu")).toBeNull()

    const toggler = page.doc.querySelector(".navbar-toggler")
    expect(toggler?.getAttribute("data-bs-target")).toBe("#nav-menu")
  })

  test("the filter bar wraps instead of running off the edge", async () => {
    const page = await dashboard(august())
    const bar = page.doc.querySelector("#txn-list .btn-group")?.getAttribute("class")
    expect(bar).toContain("flex-wrap")
    // Below sm the joins come off and the seven become chips, because a button
    // group only knows how to square the edges of a single row.
    expect(bar).toContain("filter-bar")
  })

  test("the row's cells stay in the order the phone grid places them", async () => {
    // Below sm the `tr` is a three-row grid and `static/app.css` places the
    // cells into it by `:nth-child` — date, payee, amount, bucket, buttons.
    // Reordering the markup would scramble the phone layout silently, because
    // the desktop table would go on looking exactly right.
    const page = await dashboard(august().charge({ on: "2026-08-10", amount: 42 }))
    const cells = Array.from(page.doc.querySelectorAll("tbody tr:first-child td"))
    expect(cells).toHaveLength(5)
    expect(cells[0]?.querySelector(".txn-posted")).not.toBeNull()
    expect(cells[1]?.querySelectorAll(".txn-line")).toHaveLength(3)
    expect(cells[2]?.textContent?.trim()).toMatch(/^-?\$[\d,]+\.\d\d$/)
    expect(cells[3]?.querySelector(".badge")).not.toBeNull()
    expect(cells[4]?.querySelectorAll(".tag-btn").length).toBeGreaterThan(0)
  })

  test("wide tables scroll inside their own container", async () => {
    const home = await dashboard(august())
    expect(home.doc.querySelector(".table-responsive .txn-table")).not.toBeNull()
    // One box, not two: the wrapper used to be nested inside a copy of itself.
    expect(home.doc.querySelectorAll(".table-responsive")).toHaveLength(1)
    const budget = await visit(
      august()
        .income({ payee: "Payroll", amount: 4_000 })
        .subscription({ payee: "A Gym", amount: 100 })
    ).budget()
    expect(budget.doc.querySelectorAll(".table-responsive table")).toHaveLength(2)
  })

  test("the budget row labels its own figures, for when the header goes away", async () => {
    // Below sm the six columns stack and the header is hidden along with the
    // alignment that gave five of the six figures their meaning; each cell
    // draws its own `data-label` instead. They must keep saying what the
    // headers say, and there is nothing in the CSS to notice when they drift.
    const page = await visit(august().subscription({ payee: "A Gym", amount: 100 })).budget()
    const headers = Array.from(page.doc.querySelectorAll("#budget thead th")).map((h) =>
      h.textContent?.trim()
    )
    const labels = Array.from(page.doc.querySelectorAll("#budget tbody tr:first-child td")).map(
      (td) => td.getAttribute("data-label")
    )
    // Item and State say themselves; the four in between do not.
    expect(labels).toEqual([null, ...headers.slice(1, 5), null])
  })

  test("the sync menu only refuses to wrap on its label rows", async () => {
    // Applying nowrap to every child stretched the queued sentence into one
    // 609px line, which is wider than the phone it opens on.
    const page = await visit(august()).refresh()
    expect(page.doc.querySelectorAll("#sync .sync-row").length).toBeGreaterThan(0)
    expect(page.doc.querySelector("#sync .text-info")?.getAttribute("class")).not.toContain(
      "sync-row"
    )
  })
})

describe("access log", () => {
  test("says who asked for what, and how it went", async () => {
    const session = visit(august())
    await session.get("/budget?month=2026-07", { headers: { "X-authentik-username": "igor47" } })

    expect(session.logs).toHaveLength(1)
    expect(session.logs[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z GET \/budget\?month=2026-07 200 \d+ms user=igor47$/
    )
  })

  test("marks the anonymous case, since that is the forward-auth failure", async () => {
    // A blank username looks like an ordinary page in the browser and only
    // shows up later, as a tag filed under nobody. In the log it is visible.
    const session = visit(august())
    await session.dashboard()
    expect(session.logs[0]).toContain("user=-")
  })

  test("logs the request that failed, not just the stack", async () => {
    const session = visit(august())
    session.client.transactions = () => {
      throw new Error("lunch money is down")
    }

    expect((await session.get("/")).status).toBe(500)
    expect(session.logs.some((l) => l.includes("GET / failed: Error: lunch money is down"))).toBe(
      true
    )
    expect(session.logs.some((l) => /GET \/ 500 \d+ms/.test(l))).toBe(true)
  })
})

/**
 * Transfers are the same money seen twice, so they touch no total — but they
 * are reachable, which the `ignored` bucket they used to live in was not.
 */
describe("transfers in the list", () => {
  const withACashout = () =>
    august().transfer({ on: "2026-08-05", amount: 500, from: IGOR_PERSONAL, to: CHASE })

  test("neither leg moves the allowance", async () => {
    expect((await dashboard(august())).hero).toBe("$2,400")
    expect((await dashboard(withACashout())).hero).toBe("$2,400")
  })

  test("they stay out of the review queue", async () => {
    const page = await dashboard(withACashout(), "?filter=review")
    expect(page.rows.map((r) => r.badge)).not.toContain("transfer")
  })

  test("they are not money coming back", async () => {
    const page = await dashboard(withACashout(), "?filter=deposits")
    expect(page.rows.map((r) => r.badge)).not.toContain("transfer")
  })

  test("but every one of them can still be tagged", async () => {
    // The regression that motivated the bucket split: an inferred verdict has
    // to stay correctable from the list, not only from Lunch Money.
    const page = await dashboard(withACashout(), "?filter=all")
    const transfers = page.rows.filter((r) => r.badge === "transfer")
    expect(transfers.length).toBe(2)
    expect(transfers.every((r) => r.taggable)).toBe(true)
  })

  test("insisting a leg was spending takes it back", async () => {
    const world = withACashout()
    const id = world.transactions.find((t) => t.payee === "Standard transfer")?.id as number
    const session = visit(world)
    expect((await session.dashboard()).hero).toBe("$2,400")
    expect((await session.tag(id, "spending")).hero).toBe("$1,900")
  })
})
