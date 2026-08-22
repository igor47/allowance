import { Hono } from "hono"
import type { AppEnv } from "../app"
import { Budget } from "../components/Budget"
import { Layout } from "../components/Layout"
import { MonthPicker, monthLabel } from "../components/MonthPicker"
import { Allowance, Boxes, StatementCheck } from "../components/Summary"
import { Sync } from "../components/Sync"
import { TransactionList, TransactionRow } from "../components/Transactions"
import { HISTORY_START } from "../config"
import { endOfMonth, type IsoDate } from "../domain/dates"
import { tagNames } from "../domain/policy"
import { nextTags, parseTagAction } from "../domain/tagging"
import { applyFilter, isFilter, summarise } from "../services/dashboard"

export const dashboardRoutes = new Hono<AppEnv>()

const filterOf = (c: { req: { query(name: string): string | undefined } }) => {
  const value = c.req.query("filter")
  return isFilter(value) ? value : "review"
}

interface MonthView {
  /** YYYY-MM being displayed. */
  month: string
  /** The date to build the dashboard as of — the last day of that month. */
  asOf: IsoDate
  isCurrent: boolean
}

/**
 * Which month the request is asking for.
 *
 * Accepts `month=YYYY-MM` from links and `m`/`y` from the picker's form, and
 * clamps anything outside the range instead of erroring: the year select cannot
 * know which months exist yet, so "December 2026" arrives in August as an
 * ordinary request meaning "as recent as you have".
 *
 * A past month is rendered by building the dashboard as of its last day, which
 * works because the domain is a pure function of (transactions, config, today)
 * and the period is now the calendar month.
 */
const viewOf = (
  c: { req: { query(name: string): string | undefined } },
  today: IsoDate
): MonthView => {
  const current = today.slice(0, 7)
  const y = c.req.query("y")
  const m = c.req.query("m")
  const asked = y && m ? `${y}-${m.padStart(2, "0")}` : (c.req.query("month") ?? current)

  let month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : current
  if (month < HISTORY_START) month = HISTORY_START
  if (month > current) month = current

  const isCurrent = month === current
  return { month, asOf: isCurrent ? today : endOfMonth(`${month}-01`), isCurrent }
}

dashboardRoutes.get("/", async (c) => {
  const today = c.var.today()
  const view = viewOf(c, today)
  const dashboard = await c.var.service.build(view.asOf)
  const filter = filterOf(c)
  const entries = applyFilter(dashboard.transactions, filter)

  // Queue a pull if Lunch Money has not asked Plaid lately. Deliberately not
  // awaited: the fetch is a background job on their side, so blocking the
  // render would cost a round trip and still show the same numbers.
  //
  // Only for the current month: a closed month cannot gain transactions fast
  // enough to be worth spending the rate limit on.
  if (view.isCurrent) void c.var.service.maybeRefresh(dashboard.freshness)

  return c.html(
    <Layout
      title={`allowance · ${monthLabel(view.month)}`}
      user={c.var.user}
      page="allowance"
      nav={
        <>
          <MonthPicker month={view.month} latest={today.slice(0, 7)} filter={filter} />
          <Sync dashboard={dashboard} />
        </>
      }
    >
      {view.isCurrent ? null : (
        <div class="alert alert-secondary py-2 small d-flex justify-content-between gap-3">
          <span>
            Showing <strong>{monthLabel(view.month)}</strong>, as it stands now — cash and statement
            figures are current, not what they were on the {view.asOf.slice(8)}th.
          </span>
          <a href="/" class="text-reset">
            Back to this month
          </a>
        </div>
      )}
      {dashboard.unknownAccounts.length > 0 ? (
        <div class="alert alert-warning py-2 small">
          Not counted — no policy for {dashboard.unknownAccounts.join(", ")}. Add it to
          <code class="ms-1">ACCOUNT_POLICY</code>.
        </div>
      ) : null}
      <StatementCheck dashboard={dashboard} />
      <Allowance dashboard={dashboard} />
      <Boxes dashboard={dashboard} />
      <TransactionList
        entries={entries}
        filter={filter}
        needsReview={dashboard.needsReview}
        summary={summarise(entries)}
        month={view.isCurrent ? undefined : view.month}
      />
    </Layout>
  )
})

/**
 * The plan behind the allowance: income, commitments, and the daily figure they
 * imply. Reads recurring items rather than transactions, so it says what is
 * meant to happen — including on accounts whose transactions we never see.
 */
dashboardRoutes.get("/budget", async (c) => {
  const today = c.var.today()
  const view = viewOf(c, today)
  const [budget, dashboard] = await Promise.all([
    c.var.service.budget(view.asOf),
    c.var.service.build(view.asOf),
  ])

  return c.html(
    <Layout
      title={`budget · ${monthLabel(view.month)}`}
      user={c.var.user}
      page="budget"
      nav={
        <>
          <MonthPicker month={view.month} latest={today.slice(0, 7)} action="/budget" />
          <Sync dashboard={dashboard} />
        </>
      }
    >
      <Budget budget={budget} configuredTarget={dashboard.allowance.dailyTarget} />
    </Layout>
  )
})

/**
 * Just the sync line — used by the queued state to re-check itself twenty
 * seconds after a refresh was queued. This is the one place that reads past the
 * cache, because "did anything arrive?" is the entire question it exists to
 * answer.
 */
dashboardRoutes.get("/sync", async (c) => {
  c.var.service.invalidate()
  return c.html(<Sync dashboard={await c.var.service.build(c.var.today())} />)
})

/**
 * Manual refresh. Always re-reads Lunch Money; asks Plaid only if the cooldown
 * has passed. Lunch Money asks that the Plaid endpoint be used sparingly, and a
 * button invites exactly the impatient clicking it warns about — but the click
 * is never wasted, because the cache re-read is the half that has something to
 * show for it.
 */
dashboardRoutes.post("/refresh", async (c) => {
  // Drop the cache first, unconditionally. Asking Plaid is rate-limited and
  // often pointless; re-reading Lunch Money is neither, and it is what surfaces
  // a tag the other person applied from their phone two minutes ago.
  //
  // Built as of today rather than the month on screen: freshness is a property
  // of the data, not of the month being looked at.
  c.var.service.invalidate()
  const dashboard = await c.var.service.build(c.var.today())
  const queued = await c.var.service.maybeRefresh(dashboard.freshness, true)
  return c.html(<Sync dashboard={dashboard} state={queued ? "queued" : "reloaded"} />)
})

/** HTMX partial: swap the transaction list when a filter is clicked. */
dashboardRoutes.get("/transactions", async (c) => {
  const view = viewOf(c, c.var.today())
  const dashboard = await c.var.service.build(view.asOf)
  const filter = filterOf(c)
  const entries = applyFilter(dashboard.transactions, filter)
  return c.html(
    <TransactionList
      entries={entries}
      filter={filter}
      needsReview={dashboard.needsReview}
      summary={summarise(entries)}
    />
  )
})

/**
 * Tagging. Returns the updated row plus out-of-band swaps for the summary, so
 * one click both reclassifies the transaction and moves the headline number.
 */
dashboardRoutes.post("/transactions/:id/tag", async (c) => {
  const id = Number.parseInt(c.req.param("id"), 10)
  if (Number.isNaN(id)) return c.text("bad transaction id", 400)

  let action: ReturnType<typeof parseTagAction>
  try {
    action = parseTagAction(c.req.query("tag") ?? "")
  } catch {
    return c.text("unknown tag", 400)
  }

  const view = viewOf(c, c.var.today())
  const before = await c.var.service.build(view.asOf)
  const target = before.transactions.find((entry) => entry.txn.id === id)
  if (!target) return c.text("transaction not found in the current period", 404)

  await c.var.service.setTags(id, nextTags(tagNames(target.txn), action))

  const after = await c.var.service.build(view.asOf)
  const updated = after.transactions.find((entry) => entry.txn.id === id)
  if (!updated) return c.text("transaction disappeared", 500)

  return c.html(
    <>
      <TransactionRow entry={updated} month={view.isCurrent ? undefined : view.month} />
      <Allowance dashboard={after} />
      <Boxes dashboard={after} />
    </>
  )
})
