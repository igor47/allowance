import type { Dashboard } from "../services/dashboard"
import { cents, longDate, money, shortDate } from "./format"
import { MonthChart } from "./MonthChart"

/**
 * The app checking its own arithmetic against the issuer, and saying so only when
 * it disagrees.
 *
 * Silence is the normal state and is itself the reassurance: the statement
 * before last was settled for exactly what we said it billed. When it was not,
 * that is worth a person's attention, because a Due figure quietly wrong by a
 * few hundred dollars is the sort of thing that otherwise goes unnoticed for
 * months. See `reconcile()` for why this is checkable at all.
 */
/*
 * One line per card that disagrees, and never a sum.
 *
 * Every other figure on this page adds across cards. This one must not: the
 * check compares a reconstruction against the autopay the issuer actually
 * debited — the only number in the data that did not come from us, and the
 * reason the statement arithmetic is worth trusting. Add two cards together
 * and a card overstated by $200 cancels one understated by $200 and the page
 * reports agreement, which is the one failure this component exists to catch.
 */
export const StatementCheck = ({ dashboard }: { dashboard: Dashboard }) => {
  const off = dashboard.cards.filter(({ settled }) => {
    const rec = settled.reconciliation
    return rec.checkable && !rec.agrees && rec.delta !== null && rec.paid !== null
  })
  if (off.length === 0) return null

  return (
    <div class="alert alert-warning py-2 small" id="statement-check">
      {off.map(({ account, settled }) => {
        const rec = settled.reconciliation
        // Narrowed by the filter above; repeated for the type checker.
        if (rec.delta === null || rec.paid === null) return null
        return (
          <div key={account}>
            <strong>Statement check{off.length > 1 ? ` — ${account}` : ""}.</strong> The{" "}
            {shortDate(settled.start)}–{shortDate(settled.end)} statement settled for{" "}
            {cents(rec.paid)} on {shortDate(rec.paidOn ?? settled.due)}, but we reconstructed{" "}
            {cents(rec.billed)} of charges
            {rec.creditsAfterClose !== 0 ? ` less ${cents(-rec.creditsAfterClose)} of credits` : ""}{" "}
            — a difference of <strong>{cents(Math.abs(rec.delta))}</strong>{" "}
            {rec.delta > 0 ? "less than expected" : "more than expected"}. Either something is
            missing from the feed, or the balance was not paid in full.
          </div>
        )
      })}
    </div>
  )
}

const Stat = ({
  label,
  value,
  detail,
  title,
  tone,
}: {
  label: string
  value: string
  detail?: string
  /**
   * The per-card breakdown behind a summed figure, a hover away.
   *
   * A `title` rather than a Bootstrap tooltip, as everywhere else in this app:
   * `app.js` disposes and rebuilds every tooltip instance on each htmx settle,
   * and these three boxes are swapped out of band on every tag click.
   */
  title?: string
  tone?: string
}) => (
  <div class="col">
    <div class="card h-100 border-secondary-subtle" title={title || undefined}>
      <div class="card-body">
        <div class="stat-label text-secondary mb-1">{label}</div>
        <div class={`stat-number ${tone ?? ""}`}>{value}</div>
        {detail ? <div class="small text-secondary mt-1">{detail}</div> : null}
      </div>
    </div>
  </div>
)

export const Allowance = ({ dashboard }: { dashboard: Dashboard }) => {
  const { allowance } = dashboard
  const positive = allowance.balance >= 0
  const perDay = allowance.days > 0 ? allowance.spent / allowance.days : 0

  return (
    <div id="allowance" class="card border-secondary-subtle mb-3" hx-swap-oob="true">
      <div class="card-body">
        <div class="row align-items-center g-4">
          <div class="col-lg-5">
            <div class="stat-label text-secondary mb-2">Allowance available</div>
            <div class={`hero-number ${positive ? "text-success" : "text-danger"}`}>
              {money(allowance.balance)}
            </div>
            <div class="small text-secondary mt-2">
              {money(allowance.dailyTarget)}/day &middot; day {allowance.days} of the period
              {allowance.forfeited > 0 ? (
                <>
                  {" "}
                  &middot;{" "}
                  <span title="Banked money lost to the 14-day rollover cap">
                    {money(allowance.forfeited)} forfeited to the cap
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div class="col-lg-7">
            <div class="row row-cols-3 g-3 text-center">
              <div>
                <div class="stat-label text-secondary">Budgeted</div>
                <div class="fs-5 tabular">{money(allowance.budget)}</div>
              </div>
              <div>
                <div class="stat-label text-secondary">Spent</div>
                <div class="fs-5 tabular">{money(allowance.spent)}</div>
              </div>
              <div>
                <div class="stat-label text-secondary">Actual/day</div>
                <div
                  class={`fs-5 tabular ${perDay > allowance.dailyTarget ? "text-danger" : "text-success"}`}
                >
                  {money(perDay)}
                </div>
              </div>
            </div>
            <MonthChart allowance={allowance} />
          </div>
        </div>
      </div>
    </div>
  )
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)

/*
 * The three figures, summed across however many cards the household carries.
 *
 * Two people usually hold a card each, so every figure here is a total and the
 * detail line says what it is made of — the shape "Cash on hand" already had.
 * What does not sum is the *date*: two cards close and debit on different days
 * of the month, so Due lists a section per due date rather than averaging two
 * dates into a lie, and "next closes" names the soonest of them with the card
 * a hover away.
 *
 * The reconciliation is deliberately not summed anywhere. See `StatementCheck`.
 */
export const Boxes = ({ dashboard }: { dashboard: Dashboard }) => {
  const { cash, cards } = dashboard
  // Closed and not yet debited: what is genuinely owed today, whatever month
  // each card's due date happens to fall in.
  const due = cards.filter((c) => c.lastClosed.total.charges !== 0)
  const nextClose = [...cards].sort((a, b) => a.closes.localeCompare(b.closes))[0]
  const balances = cards.filter((c) => c.reported !== null)

  return (
    <div id="boxes" class="row row-cols-1 row-cols-md-3 g-3 mb-4" hx-swap-oob="true">
      <Stat
        label="Cash on hand"
        value={money(cash.total)}
        detail={cash.accounts.map((a) => `${a.name} ${money(a.balance)}`).join(" · ")}
      />
      <Stat
        label="Due"
        value={money(sum(due.map((c) => c.lastClosed.total.charges)))}
        detail={due
          .map((c) => `${money(c.lastClosed.total.charges)} on ${shortDate(c.lastClosed.due)}`)
          .join(" · ")}
        title={due
          .map(
            (c) =>
              `${c.account}: ${money(c.lastClosed.total.charges)} due ${shortDate(
                c.lastClosed.due
              )}, statement closed ${longDate(c.lastClosed.end)}`
          )
          .join("\n")}
        tone="text-warning"
      />
      <Stat
        label="Accruing now"
        value={money(sum(cards.map((c) => c.current.total.charges)))}
        detail={[
          balances.length > 0
            ? `${money(sum(balances.map((c) => c.reported ?? 0)))} on the card${
                balances.length > 1 ? "s" : ""
              }`
            : null,
          nextClose ? `next closes ${longDate(nextClose.closes)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        title={cards
          .map(
            (c) =>
              `${c.account}: ${money(c.current.total.charges)} accrued${
                c.reported === null ? "" : `, ${money(c.reported)} owed`
              }, closes ${longDate(c.closes)}`
          )
          .join("\n")}
      />
    </div>
  )
}
