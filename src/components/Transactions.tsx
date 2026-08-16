import type { ClassifiedTransaction } from "../domain/allowance"
import { STATEMENT_ACCOUNT } from "../domain/card"
import type { Bucket } from "../domain/policy"
import { detailsOf } from "../lunchmoney/details"
import { accountNameOf } from "../lunchmoney/types"
import { FILTERS, type Filter, type FilterSummary } from "../services/dashboard"
import { cents, money, shortDate } from "./format"

const BUCKET_STYLE: Record<Bucket, { label: string; class: string }> = {
  spending: { label: "spending", class: "text-bg-primary" },
  recurring: { label: "recurring", class: "text-bg-secondary" },
  irregular: { label: "irregular", class: "text-bg-info" },
  unclassified: { label: "unclassified", class: "text-bg-dark border border-secondary" },
  deposit: { label: "deposit", class: "text-bg-success" },
  ignored: { label: "ignored", class: "text-bg-dark border border-secondary" },
}

const FILTER_LABEL: Record<Filter, string> = {
  review: "Needs review",
  spending: "Spending",
  deposits: "Deposits",
  all: "All",
  fixed: "Fixed",
  igor: "Igor",
  serena: "Serena",
}

const TagButton = ({
  id,
  tag,
  label,
  active,
  style,
  month,
}: {
  id: number
  tag: string
  label: string
  active: boolean
  style: string
  month?: string
}) => (
  <button
    type="button"
    class={`btn tag-btn ${active ? style : "btn-outline-secondary"}`}
    hx-post={`/transactions/${id}/tag?tag=${tag}${month ? `&month=${month}` : ""}`}
    hx-target="closest tr"
    hx-swap="outerHTML"
    title={active ? `Remove ${tag}` : `Tag as ${tag}`}
  >
    {label}
  </button>
)

export const TransactionRow = ({
  entry,
  month,
}: {
  entry: ClassifiedTransaction
  month?: string
}) => {
  const { txn, classification } = entry
  const tags = txn.tags.map((t) => t.name.toLowerCase())
  const account = accountNameOf(txn)
  const details = detailsOf(txn)
  const style = BUCKET_STYLE[classification.bucket]
  const taggable = classification.taggable
  const credit = classification.amount < 0
  const classes = [
    !classification.reviewed && taggable && classification.bucket !== "deposit" ? "unreviewed" : "",
    classification.counts || credit ? "" : "not-counted",
  ]
    .filter(Boolean)
    .join(" ")

  const name = txn.payee ?? details.raw ?? "(no payee)"
  // The statement descriptor, when it says more than the cleaned-up payee does.
  const descriptor =
    details.raw && details.raw.toLowerCase() !== name.toLowerCase() ? details.raw : null
  const facts = [
    txn.category_name,
    details.channel === "online" ? "online" : null,
    details.place,
  ].filter(Boolean)

  // Every row renders the same three meta lines whether or not it is tagged.
  // Tagging changes the reason text, and letting that reflow the row made the
  // rest of the list jump under the cursor between clicks.
  return (
    <tr class={classes} id={`txn-${txn.id}`}>
      <td class="text-secondary small text-nowrap align-top">
        {shortDate(txn.date)}
        <div class="txn-posted">
          {details.posted !== txn.date ? (
            <span title={`Posted to the statement on ${details.posted}`}>
              ↳ {shortDate(details.posted)}
            </span>
          ) : null}
        </div>
      </td>
      <td>
        <div class="fw-medium text-truncate">{name}</div>
        <div class="txn-line small text-secondary font-monospace">{descriptor}</div>
        <div class="txn-line small text-secondary">{facts.join(" · ")}</div>
        <div class="txn-line small">
          {account !== STATEMENT_ACCOUNT ? (
            <span class="badge text-bg-dark border border-secondary me-1">{account}</span>
          ) : null}
          {txn.is_pending ? <span class="badge text-bg-warning me-1">pending</span> : null}
          <span class="text-secondary fst-italic">{classification.reason}</span>
        </div>
      </td>
      <td class={`text-end tabular text-nowrap align-top${credit ? " text-success" : ""}`}>
        {cents(classification.amount)}
      </td>
      <td class="align-top">
        <span class={`badge ${style.class}`}>{style.label}</span>
      </td>
      <td class="text-end text-nowrap align-top">
        {taggable ? (
          <>
            <div class="btn-group tag-group me-1">
              <TagButton
                month={month}
                id={txn.id}
                tag="spending"
                label="spend"
                active={tags.includes("spending")}
                style="btn-primary"
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="recurring"
                label="recur"
                active={tags.includes("recurring")}
                style="btn-secondary"
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="irregular"
                label="irreg"
                active={tags.includes("irregular")}
                style="btn-info"
              />
            </div>
            <div class="btn-group tag-group">
              <TagButton
                month={month}
                id={txn.id}
                tag="igor"
                label="I"
                active={tags.includes("igor")}
                style="btn-light"
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="serena"
                label="S"
                active={tags.includes("serena")}
                style="btn-light"
              />
            </div>
          </>
        ) : (
          <span class="small text-secondary fst-italic">not taggable</span>
        )}
      </td>
    </tr>
  )
}

export interface TransactionListProps {
  /** Set only when a past month is being viewed, so links stay in that month. */
  month?: string
  entries: ClassifiedTransaction[]
  filter: Filter
  needsReview: number
  summary: FilterSummary
}

export const TransactionList = ({
  entries,
  filter,
  needsReview,
  summary,
  month,
}: TransactionListProps) => (
  <div id="txn-list">
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
      <h2 class="h6 text-secondary stat-label mb-0">Transactions</h2>
      <div class="btn-group btn-group-sm">
        {FILTERS.map((f) => (
          <a
            class={`btn ${f === filter ? "btn-secondary" : "btn-outline-secondary"}`}
            href={`/?filter=${f}${month ? `&month=${month}` : ""}`}
            hx-get={`/transactions?filter=${f}${month ? `&month=${month}` : ""}`}
            hx-target="#txn-list"
            hx-swap="outerHTML"
            hx-push-url={`/?filter=${f}${month ? `&month=${month}` : ""}`}
          >
            {FILTER_LABEL[f]}
            {f === "review" && needsReview > 0 ? (
              <span class="badge text-bg-warning ms-1">{needsReview}</span>
            ) : null}
          </a>
        ))}
      </div>
    </div>

    {/*
     * Both figures always show. Hiding "against the allowance" when it equalled
     * the total made two filters look like they were measuring different
     * things — Igor read "$925 · $675 against the allowance" while Serena read
     * "$879" and you had to work out whether the rest was excluded or absent.
     */}
    <p class="small text-secondary mb-2">
      <span class="tabular">{summary.count}</span> transaction{summary.count === 1 ? "" : "s"} ·{" "}
      <span class="tabular">{money(summary.total)}</span> total ·{" "}
      <span class="tabular">{money(summary.counting)}</span> against the allowance
    </p>

    {entries.length === 0 ? (
      <p class="text-secondary fst-italic">Nothing here.</p>
    ) : (
      <div class="table-responsive">
        <table class="table table-sm txn-table align-middle mb-0">
          <tbody>
            {entries.map((entry) => (
              <TransactionRow entry={entry} month={month} />
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)
