/**
 * The plan behind the allowance.
 *
 * The allowance page answers "what can we spend today". This one answers where
 * that number comes from: income, minus everything already committed, spread
 * across the month. The daily target stops being a figure in the config and
 * becomes a consequence of the commitments listed here.
 */

import type { BudgetView, Commitment, CommitmentState } from "../domain/budget"
import { money, perDay, shortDate } from "./format"

export interface BudgetProps {
  budget: BudgetView
  /** What the app is actually using, for comparison with the derived figure. */
  configuredTarget: number
}

const STATE: Record<CommitmentState, { label: string; class: string; note: string }> = {
  matched: { label: "paid", class: "text-bg-success", note: "a transaction is linked this month" },
  upcoming: { label: "due", class: "text-bg-secondary", note: "expected later this month" },
  overdue: {
    label: "not seen",
    class: "text-bg-warning",
    note: "expected by now, nothing linked — check it",
  },
  untracked: {
    label: "not tracked",
    class: "text-bg-dark border border-secondary",
    note: "on an account with no transaction feed; the plan is all we get",
  },
}

const Row = ({ c, days }: { c: Commitment; days: number }) => {
  const state = STATE[c.state]
  return (
    <tr>
      <td>
        <div>{c.payee}</div>
        {c.description ? <div class="small text-secondary">{c.description}</div> : null}
      </td>
      <td class="text-secondary small" data-label="Cadence">
        {c.cadence}
      </td>
      <td class="text-end tabular" data-label="Each">
        {money(c.amount)}
      </td>
      <td class="text-end tabular" data-label="Per month">
        {/* Only worth showing when it differs from the per-occurrence amount. */}
        {Math.abs(c.monthly - c.amount) < 0.5 ? (
          <span class="text-secondary">—</span>
        ) : (
          money(c.monthly)
        )}
      </td>
      <td class="text-end tabular" data-label="Per day">
        {/*
          The monthly rate over this month's days, so the column adds up to
          the per-day figure in the summary above it.
        */}
        {perDay(c.monthly / days)}
      </td>
      <td class="text-end tabular" data-label="Due this month">
        {/*
          What actually lands this month, which is the figure `monthly` hides:
          an annual bill is a twelfth of itself there and its whole self here,
          in the one month it is due.
        */}
        {c.dueThisPeriod === null || c.expected.length === 0 ? (
          <span class="text-secondary" title="Nothing expected this month">
            —
          </span>
        ) : (
          <>
            {money(c.dueThisPeriod)}
            <div class="small text-secondary" title={c.expected.join(", ")}>
              {c.expected.length <= 2
                ? c.expected.map(shortDate).join(", ")
                : `${c.expected.length} dates`}
            </div>
          </>
        )}
      </td>
      <td class="text-end">
        <span class={`badge ${state.class}`} title={state.note}>
          {state.label}
        </span>
      </td>
    </tr>
  )
}

const Table = ({ rows, caption, days }: { rows: Commitment[]; caption: string; days: number }) =>
  rows.length === 0 ? null : (
    <div class="card border-secondary-subtle mb-3">
      <div class="card-body">
        <h2 class="h6 stat-label text-secondary mb-3">{caption}</h2>
        {/*
          Seven columns do not fit on a phone, so below sm `.budget-table` stacks
          the row and the header goes away with the alignment it described —
          which is what the `data-label` on each cell is for. See app.css.
        */}
        <div class="table-responsive">
          <table class="table table-sm budget-table align-middle mb-0">
            <thead>
              <tr class="text-secondary small">
                <th>Item</th>
                <th>Cadence</th>
                <th class="text-end">Each</th>
                <th class="text-end">Per month</th>
                <th class="text-end">Per day</th>
                <th class="text-end">Due this month</th>
                <th class="text-end">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Row key={c.id} c={c} days={days} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )

export const Budget = ({ budget, configuredTarget }: BudgetProps) => {
  const { totals } = budget
  const drift = totals.dailyTarget - configuredTarget
  const monthName = new Date(`${budget.periodStart}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  })
  /*
   * Worth saying only when the month is genuinely heavier or lighter than the
   * steady rate. Most months land within a few dollars of it, and printing a
   * second total that close to the first is noise dressed as information.
   * Relative rather than fixed, so it scales with the size of the plan.
   */
  const lumpy =
    totals.committedThisPeriod !== null &&
    Math.abs(totals.committedThisPeriod - totals.committed) > Math.abs(totals.committed) * 0.01
  const overdue = budget.commitments.filter((c) => c.state === "overdue").length

  return (
    <div id="budget">
      <div class="card border-secondary-subtle mb-3">
        <div class="card-body">
          {/*
            Written as the sum it is — income, minus what is committed, gives
            the allowance — so the page reads left to right as the derivation
            it exists to show, and the answer sits where a sum's answer goes.

            Every term carries both units. The month is what the plan is made
            of and the day is what gets spent, so the two outer terms lead
            with the month and the answer leads with the day, each with the
            other underneath. On a phone the terms stack and the operators
            stay between them.
          */}
          <div class="budget-sum text-center">
            <div class="budget-term">
              <div class="stat-label text-secondary">Income</div>
              <div class="fs-5 tabular text-success">{money(totals.income)}</div>
              <div class="small text-secondary tabular">
                {perDay(totals.income / budget.days)}/day
              </div>
            </div>
            <div class="budget-op text-secondary" aria-hidden="true">
              −
            </div>
            <div class="budget-term">
              <div class="stat-label text-secondary">Committed</div>
              <div class="fs-5 tabular">{money(totals.committed)}</div>
              <div class="small text-secondary tabular">
                {perDay(totals.committed / budget.days)}/day
              </div>
              {/*
                The headline stays amortised, because a daily allowance
                should not lurch when an annual bill happens to land this
                month. This says what actually leaves, which is the other
                question worth asking and a different number.
              */}
              {totals.committedThisPeriod !== null && lumpy ? (
                <div
                  class="small text-secondary"
                  title="What actually lands this month, rather than the steady monthly rate"
                >
                  {money(totals.committedThisPeriod)} due {monthName}
                </div>
              ) : null}
              {totals.untracked > 0 ? (
                <div
                  class="small text-secondary"
                  title="On accounts with no transaction feed — real money that never appears as a transaction"
                >
                  {money(totals.untracked)} untracked
                </div>
              ) : null}
            </div>
            <div class="budget-op text-secondary" aria-hidden="true">
              ⇒
            </div>
            <div class="budget-term budget-answer">
              <div class="stat-label text-secondary">Allowance this implies</div>
              <div class={`hero-number ${totals.pool < 0 ? "text-danger" : ""}`}>
                {money(totals.dailyTarget)}
              </div>
              <div class="small text-secondary tabular mt-1">
                per day &middot; {money(totals.pool)} over {budget.days} days
              </div>
              <div class="small text-secondary mt-1">
                {Math.abs(drift) >= 1 ? (
                  <span class={drift < 0 ? "text-warning" : "text-success"}>
                    {money(Math.abs(drift))}/day {drift < 0 ? "under" : "over"} the{" "}
                    {money(configuredTarget)} in use
                  </span>
                ) : (
                  <>matches the {money(configuredTarget)}/day in use</>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {overdue > 0 ? (
        <div class="alert alert-warning py-2 small">
          {overdue} commitment{overdue === 1 ? "" : "s"} expected by now with nothing linked. Either
          the charge has not posted, or it posted and Lunch Money did not link it — a recurring rule
          fixes the second.
        </div>
      ) : null}

      <Table rows={budget.income} caption="Income" days={budget.days} />
      <Table rows={budget.commitments} caption="Committed" days={budget.days} />
    </div>
  )
}
