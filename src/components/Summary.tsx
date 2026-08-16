import type { Dashboard } from "../services/dashboard"
import { longDate, money, shortDate } from "./format"
import { MonthChart } from "./MonthChart"

const Stat = ({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail?: string
  tone?: string
}) => (
  <div class="col">
    <div class="card h-100 border-secondary-subtle">
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

export const Boxes = ({ dashboard }: { dashboard: Dashboard }) => {
  const { cash, card } = dashboard

  return (
    <div id="boxes" class="row row-cols-1 row-cols-md-3 g-3 mb-4" hx-swap-oob="true">
      <Stat
        label="Cash on hand"
        value={money(cash.total)}
        detail={cash.accounts.map((a) => `${a.name} ${money(a.balance)}`).join(" · ")}
      />
      <Stat
        label={`Due ${shortDate(card.lastClosed.due)}`}
        value={money(card.lastClosed.total.charges)}
        detail={`Statement closed ${longDate(card.lastClosed.end)}`}
        tone="text-warning"
      />
      <Stat
        label="Accruing now"
        value={money(card.current.total.charges)}
        detail={
          card.reported === null
            ? `Next statement closes ${longDate(card.current.closes)}`
            : `${money(card.reported)} on the card · next closes ${longDate(card.current.closes)}`
        }
      />
    </div>
  )
}
