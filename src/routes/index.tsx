import { Hono } from "hono"
import type { AppEnv } from "../app"
import { Layout } from "../components/Layout"
import { Allowance, Boxes, Sync } from "../components/Summary"
import { TransactionList, TransactionRow } from "../components/Transactions"
import { tagNames } from "../domain/policy"
import { nextTags, parseTagAction } from "../domain/tagging"
import { applyFilter, isFilter, summarise } from "../services/dashboard"

export const dashboardRoutes = new Hono<AppEnv>()

const filterOf = (c: { req: { query(name: string): string | undefined } }) => {
  const value = c.req.query("filter")
  return isFilter(value) ? value : "review"
}

dashboardRoutes.get("/", async (c) => {
  const dashboard = await c.var.service.build(c.var.today())
  const filter = filterOf(c)
  const entries = applyFilter(dashboard.transactions, filter)

  // Queue a pull if Lunch Money has not asked Plaid lately. Deliberately not
  // awaited: the fetch is a background job on their side, so blocking the
  // render would cost a round trip and still show the same numbers.
  void c.var.service.maybeRefresh(dashboard.freshness)

  return c.html(
    <Layout title="allowance" user={c.var.user}>
      {dashboard.unknownAccounts.length > 0 ? (
        <div class="alert alert-warning py-2 small">
          Not counted — no policy for {dashboard.unknownAccounts.join(", ")}. Add it to
          <code class="ms-1">ACCOUNT_POLICY</code>.
        </div>
      ) : null}
      <Sync dashboard={dashboard} />
      <Allowance dashboard={dashboard} />
      <Boxes dashboard={dashboard} />
      <TransactionList
        entries={entries}
        filter={filter}
        needsReview={dashboard.needsReview}
        summary={summarise(entries)}
      />
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
 * Manual refresh. Forces past the staleness check, but not past the cooldown —
 * Lunch Money asks that this endpoint be used sparingly, and a button invites
 * exactly the impatient clicking it warns about.
 */
dashboardRoutes.post("/refresh", async (c) => {
  const before = await c.var.service.build(c.var.today())
  const queued = await c.var.service.maybeRefresh(before.freshness, true)
  const after = await c.var.service.build(c.var.today())
  return c.html(<Sync dashboard={after} queued={queued} />)
})

/** HTMX partial: swap the transaction list when a filter is clicked. */
dashboardRoutes.get("/transactions", async (c) => {
  const dashboard = await c.var.service.build(c.var.today())
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

  const before = await c.var.service.build(c.var.today())
  const target = before.transactions.find((entry) => entry.txn.id === id)
  if (!target) return c.text("transaction not found in the current period", 404)

  await c.var.service.setTags(id, nextTags(tagNames(target.txn), action))

  const after = await c.var.service.build(c.var.today())
  const updated = after.transactions.find((entry) => entry.txn.id === id)
  if (!updated) return c.text("transaction disappeared", 500)

  return c.html(
    <>
      <TransactionRow entry={updated} />
      <Allowance dashboard={after} />
      <Boxes dashboard={after} />
    </>
  )
})
