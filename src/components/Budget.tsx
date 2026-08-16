/**
 * The plan behind the allowance.
 *
 * The allowance page answers "what can we spend today". This one answers where
 * that number comes from: income, minus everything already committed, spread
 * across the month. The daily target stops being a figure in the config and
 * becomes a consequence of the commitments listed here.
 */

import type { BudgetView, Commitment, CommitmentState } from "../domain/budget"
import { money } from "./format"

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

const Row = ({ c }: { c: Commitment }) => {
  const state = STATE[c.state]
  return (
    <tr>
      <td>
        <div>{c.payee}</div>
        {c.description ? <div class="small text-secondary">{c.description}</div> : null}
      </td>
      <td class="text-secondary small">{c.cadence}</td>
      <td class="text-end tabular">{money(c.amount)}</td>
      <td class="text-end tabular">
        {/* Only worth showing when it differs from the per-occurrence amount. */}
        {Math.abs(c.monthly - c.amount) < 0.5 ? (
          <span class="text-secondary">—</span>
        ) : (
          money(c.monthly)
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

const Table = ({ rows, caption }: { rows: Commitment[]; caption: string }) =>
  rows.length === 0 ? null : (
    <div class="card border-secondary-subtle mb-3">
      <div class="card-body">
        <h2 class="h6 stat-label text-secondary mb-3">{caption}</h2>
        <table class="table table-sm align-middle mb-0">
          <thead>
            <tr class="text-secondary small">
              <th>Item</th>
              <th>Cadence</th>
              <th class="text-end">Each</th>
              <th class="text-end">Per month</th>
              <th class="text-end">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

export const Budget = ({ budget, configuredTarget }: BudgetProps) => {
  const { totals } = budget
  const drift = totals.dailyTarget - configuredTarget
  const overdue = budget.commitments.filter((c) => c.state === "overdue").length

  return (
    <div id="budget">
      <div class="card border-secondary-subtle mb-3">
        <div class="card-body">
          <div class="row align-items-center g-4">
            <div class="col-lg-5">
              <div class="stat-label text-secondary mb-2">Allowance this implies</div>
              <div class="hero-number">{money(totals.dailyTarget)}</div>
              <div class="small text-secondary mt-2">
                per day &middot; {money(totals.pool)} left over {budget.days} days
                {Math.abs(drift) >= 1 ? (
                  <>
                    {" "}
                    &middot;{" "}
                    <span class={drift < 0 ? "text-warning" : "text-success"}>
                      {money(Math.abs(drift))}/day {drift < 0 ? "under" : "over"} the{" "}
                      {money(configuredTarget)} in use
                    </span>
                  </>
                ) : (
                  <> &middot; matches the {money(configuredTarget)} in use</>
                )}
              </div>
            </div>
            <div class="col-lg-7">
              <div class="row row-cols-3 g-3 text-center">
                <div>
                  <div class="stat-label text-secondary">Income</div>
                  <div class="fs-5 tabular text-success">{money(totals.income)}</div>
                </div>
                <div>
                  <div class="stat-label text-secondary">Committed</div>
                  <div class="fs-5 tabular">{money(totals.committed)}</div>
                  {totals.untracked > 0 ? (
                    <div
                      class="small text-secondary"
                      title="On accounts with no transaction feed — real money that never appears as a transaction"
                    >
                      {money(totals.untracked)} untracked
                    </div>
                  ) : null}
                </div>
                <div>
                  <div class="stat-label text-secondary">Left to spend</div>
                  <div class={`fs-5 tabular ${totals.pool < 0 ? "text-danger" : ""}`}>
                    {money(totals.pool)}
                  </div>
                </div>
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

      <Table rows={budget.income} caption="Income" />
      <Table rows={budget.commitments} caption="Committed" />
    </div>
  )
}
