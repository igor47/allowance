/**
 * What the page says, in the page's own vocabulary.
 *
 * The other half of "a scenario says what the UI should look like". Every
 * selector in the suite lives in this file, so a class rename is one edit
 * rather than a search — `.hero-number` alone used to be hardcoded in seven
 * places and `.month-chart-hover > div` in four.
 *
 * A session holds one app, and therefore one cache, across the requests made
 * through it. That matters: tagging is supposed to patch the cache rather than
 * re-read the window, and a page object that made a fresh app per request
 * could never notice the difference.
 */

import { parseHTML } from "linkedom"
import { useTestApp } from "./app"
import type { World } from "./world"

const text = (node: Element | null | undefined): string => node?.textContent?.trim() ?? ""
const all = (root: ParentNode, selector: string): Element[] =>
  Array.from(root.querySelectorAll(selector)) as Element[]

export interface Row {
  id: number
  /** The Lunch Money date, as rendered. */
  date: string
  /** The posted date, shown only when it differs from the date. */
  posted: string
  payee: string
  /** The statement descriptor line, when it says more than the payee. */
  descriptor: string
  /** Category, channel, place — the middle meta line. */
  facts: string
  /** Why it was classified the way it was. */
  reason: string
  /** As rendered, to the cent. */
  amount: string
  badge: string
  /** The account chip, present only for accounts other than the card. */
  account: string
  unreviewed: boolean
  notCounted: boolean
  /** Which tag buttons are lit. */
  activeTags: string[]
  taggable: boolean
}

function rowOf(tr: Element): Row {
  const cells = all(tr, "td")
  const lines = all(tr, ".txn-line")
  const chip = tr.querySelector(".txn-line .badge")
  const classes = tr.getAttribute("class") ?? ""
  return {
    id: Number.parseInt((tr.getAttribute("id") ?? "txn-0").slice(4), 10),
    date: text(cells[0]).split("↳")[0]?.trim() ?? "",
    posted: text(tr.querySelector(".txn-posted")).replace(/^↳\s*/, ""),
    payee: text(cells[1]?.querySelector(".fw-medium")),
    descriptor: text(lines[0]),
    facts: text(lines[1]),
    reason: text(tr.querySelector(".txn-line .fst-italic")),
    amount: text(cells[2]),
    badge: text(cells[3]?.querySelector(".badge")),
    account: chip ? text(chip) : "",
    unreviewed: classes.includes("unreviewed"),
    notCounted: classes.includes("not-counted"),
    activeTags: all(tr, "button.tag-btn")
      .filter((b) => !(b.getAttribute("class") ?? "").includes("btn-outline-secondary"))
      .map((b) => text(b)),
    taggable: all(tr, "button.tag-btn").length > 0,
  }
}

export interface Stat {
  label: string
  value: string
  detail: string
}

/** The bits of a page that both the dashboard and the budget page have. */
class Page {
  constructor(readonly doc: Document) {}

  /** The one big number, whichever page it is on. */
  get hero(): string {
    return text(this.doc.querySelector(".hero-number"))
  }

  /** Warnings and notices, in the order they appear. */
  get banners(): string[] {
    return all(this.doc, ".alert").map((a) => text(a).replace(/\s+/g, " "))
  }

  get monthLabel(): string {
    return text(this.doc.querySelector(".dropdown-toggle"))
  }

  /** The whole sync menu as one string — states, ages and all. */
  get sync(): string {
    return text(this.doc.querySelector("#sync")).replace(/\s+/g, " ")
  }

  get navLinks(): [string, string][] {
    return all(this.doc, "nav .nav-link").map((n) => [n.getAttribute("href") ?? "", text(n)])
  }

  get activeNav(): string {
    return this.doc.querySelector("nav .nav-link.active")?.getAttribute("href") ?? ""
  }

  get title(): string {
    return text(this.doc.querySelector("title"))
  }
}

export class DashboardPage extends Page {
  constructor(
    doc: Document,
    private readonly session: Session,
    /** The query this page was loaded with, so a click keeps the month. */
    private readonly query = ""
  ) {
    super(doc)
  }

  /** As the app does on its own filter links: change one thing, keep the rest. */
  private withParam(name: string, value: string): string {
    const params = new URLSearchParams(this.query.replace(/^\?/, ""))
    params.set(name, value)
    return `?${params}`
  }

  get stats(): Stat[] {
    return all(this.doc, "#boxes .col").map((col) => ({
      label: text(col.querySelector(".stat-label")),
      value: text(col.querySelector(".stat-number")),
      detail: text(col.querySelector(".card-body > .small")),
    }))
  }

  get statLabels(): string[] {
    return this.stats.map((s) => s.label)
  }

  get rows(): Row[] {
    return all(this.doc, "tbody tr").map(rowOf)
  }

  row(id: number): Row | undefined {
    const tr = this.doc.querySelector(`[id="txn-${id}"]`)
    return tr ? rowOf(tr as Element) : undefined
  }

  /** The label of the filter currently selected. */
  get activeFilter(): string {
    return text(this.doc.querySelector("#txn-list .btn-secondary"))
  }

  /** The count on the review filter's badge, or 0 when it is absent. */
  get reviewCount(): number {
    return Number.parseInt(text(this.doc.querySelector("#txn-list .badge")) || "0", 10)
  }

  /** "12 transactions · $340 total · $220 against the allowance". */
  get summary(): string {
    return text(this.doc.querySelector("#txn-list p.small")).replace(/\s+/g, " ")
  }

  get empty(): boolean {
    return text(this.doc.querySelector("#txn-list p.fst-italic")) === "Nothing here."
  }

  get chart(): Chart {
    return new Chart(this.doc)
  }

  /** Click a filter, the way HTMX would — without losing the month. */
  filter(name: string): Promise<DashboardPage> {
    return this.session.dashboard(this.withParam("filter", name))
  }

  month(month: string): Promise<DashboardPage> {
    return this.session.dashboard(this.withParam("month", month))
  }

  /** Click a tag button. Returns the fragment HTMX would swap in. */
  tag(id: number, tag: string): Promise<TagResult> {
    return this.session.tag(id, tag)
  }
}

/** One hover column per day of the calendar month, whatever today is. */
class Chart {
  constructor(private readonly doc: Document) {}

  private get hits(): Element[] {
    return all(this.doc, ".month-chart-hover > div")
  }

  get columns(): number {
    return this.hits.length
  }

  /** The tooltip for the nth day of the month, counting from 1. */
  day(dayOfMonth: number): string {
    return this.hits[dayOfMonth - 1]?.getAttribute("data-bs-title") ?? ""
  }

  get tips(): string[] {
    return this.hits.map((h) => h.getAttribute("data-bs-title") ?? "")
  }
}

export class BudgetPage extends Page {
  /** The whole summary block, for asserting a figure appears in it. */
  get summary(): string {
    return text(this.doc.querySelector("#budget")).replace(/\s+/g, " ")
  }

  get commitments(): { payee: string; state: string }[] {
    return all(this.doc, "#budget tbody tr").map((tr) => ({
      payee: text(tr.querySelector("td")),
      state: text(tr.querySelector(".badge")),
    }))
  }

  get payees(): string[] {
    return this.commitments.map((c) => c.payee)
  }

  /** Per-row: the amortised rate, and what actually lands this month. */
  get rates(): { payee: string; monthly: string; dueThisPeriod: string; dates: string }[] {
    return all(this.doc, "#budget tbody tr").map((tr) => {
      const cells = all(tr, "td")
      const due = cells[4]
      // The cell holds the amount, then a small line naming the dates.
      const dates = due?.querySelector(".small")
      return {
        payee: text(tr.querySelector("td")),
        monthly: text(cells[3]),
        dueThisPeriod: text(due).replace(text(dates), "").trim(),
        dates: text(dates),
      }
    })
  }
}

/** What comes back from a tag click: the row, plus the summary swapped out of band. */
export class TagResult {
  constructor(
    readonly status: number,
    private readonly doc: Document
  ) {}

  get row(): Row | undefined {
    const tr = this.doc.querySelector("tr")
    return tr ? rowOf(tr as Element) : undefined
  }

  get hero(): string {
    return text(this.doc.querySelector("#allowance .hero-number"))
  }

  /** Out-of-band swaps only work if HTMX is told to make them. */
  get swapsOutOfBand(): string[] {
    return all(this.doc, "[hx-swap-oob]").map((n) => n.getAttribute("id") ?? "")
  }
}

/**
 * One browser session against one world: one app, one cache, many requests.
 */
export class Session {
  private readonly app: ReturnType<typeof useTestApp>

  constructor(readonly world: World) {
    this.app = useTestApp(world)
  }

  get client() {
    return this.app.client
  }

  get logs() {
    return this.app.logs
  }

  private async doc(response: Response): Promise<Document> {
    return parseHTML(await response.text()).document as unknown as Document
  }

  async dashboard(query = ""): Promise<DashboardPage> {
    return new DashboardPage(await this.doc(await this.app.get(`/${query}`)), this, query)
  }

  async budget(query = ""): Promise<BudgetPage> {
    return new BudgetPage(await this.doc(await this.app.get(`/budget${query}`)))
  }

  /** The HTMX partial, as a filter click fetches it. */
  async transactions(query = ""): Promise<DashboardPage> {
    return new DashboardPage(
      await this.doc(await this.app.get(`/transactions${query}`)),
      this,
      query
    )
  }

  async tag(id: number, tag: string, query = ""): Promise<TagResult> {
    const response = await this.app.post(`/transactions/${id}/tag?tag=${tag}${query}`)
    return new TagResult(response.status, await this.doc(response))
  }

  async refresh(): Promise<Page> {
    return new Page(await this.doc(await this.app.post("/refresh")))
  }

  async syncFragment(): Promise<Page> {
    return new Page(await this.doc(await this.app.get("/sync")))
  }

  /** For status codes and headers, where a parsed document says nothing. */
  async get(path: string, init?: RequestInit): Promise<Response> {
    return await this.app.get(path, init)
  }

  async post(path: string, init?: RequestInit): Promise<Response> {
    return await this.app.post(path, init)
  }
}

export function visit(world: World): Session {
  return new Session(world)
}

/** The common case: load the dashboard for a world and look at it. */
export function dashboard(world: World, query = ""): Promise<DashboardPage> {
  return visit(world).dashboard(query)
}

export function budgetPage(world: World, query = ""): Promise<BudgetPage> {
  return visit(world).budget(query)
}
