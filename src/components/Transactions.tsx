import type { ClassifiedTransaction } from "../domain/allowance"
import { STATEMENT_ACCOUNT } from "../domain/card"
import type { Bucket } from "../domain/policy"
import { accountNameOf } from "../lunchmoney/types"
import { FILTERS, type Filter } from "../services/dashboard"
import { cents, shortDate } from "./format"

const BUCKET_STYLE: Record<Bucket, { label: string; class: string }> = {
  spending: { label: "spending", class: "text-bg-primary" },
  recurring: { label: "recurring", class: "text-bg-secondary" },
  irregular: { label: "irregular", class: "text-bg-info" },
  "assumed-fixed": { label: "assumed fixed", class: "text-bg-dark border border-secondary" },
  excluded: { label: "excluded", class: "text-bg-dark border border-secondary" },
}

const FILTER_LABEL: Record<Filter, string> = {
  review: "Needs review",
  all: "All",
  spending: "Counts",
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
}: {
  id: number
  tag: string
  label: string
  active: boolean
  style: string
}) => (
  <button
    type="button"
    class={`btn tag-btn ${active ? style : "btn-outline-secondary"}`}
    hx-post={`/transactions/${id}/tag?tag=${tag}`}
    hx-target="closest tr"
    hx-swap="outerHTML"
    title={active ? `Remove ${tag}` : `Tag as ${tag}`}
  >
    {label}
  </button>
)

export const TransactionRow = ({ entry }: { entry: ClassifiedTransaction }) => {
  const { txn, classification } = entry
  const tags = txn.tags.map((t) => t.name.toLowerCase())
  const account = accountNameOf(txn)
  const style = BUCKET_STYLE[classification.bucket]
  const classes = [
    !classification.reviewed && classification.bucket !== "excluded" ? "unreviewed" : "",
    classification.counts ? "" : "not-counted",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <tr class={classes} id={`txn-${txn.id}`}>
      <td class="text-secondary small text-nowrap">{shortDate(txn.date)}</td>
      <td>
        <div class="text-truncate" style="max-width: 22rem">
          {txn.payee ?? txn.original_name ?? "(no payee)"}
        </div>
        <div class="small text-secondary">
          {account !== STATEMENT_ACCOUNT ? <span class="me-2">{account}</span> : null}
          {txn.is_pending ? <span class="badge text-bg-warning me-2">pending</span> : null}
          <span title={classification.reason}>{classification.reason}</span>
        </div>
      </td>
      <td class="text-end tabular text-nowrap">{cents(classification.amount)}</td>
      <td>
        <span class={`badge ${style.class}`}>{style.label}</span>
      </td>
      <td class="text-end text-nowrap">
        <div class="btn-group tag-group me-1">
          <TagButton
            id={txn.id}
            tag="spending"
            label="spend"
            active={tags.includes("spending")}
            style="btn-primary"
          />
          <TagButton
            id={txn.id}
            tag="recurring"
            label="recur"
            active={tags.includes("recurring")}
            style="btn-secondary"
          />
          <TagButton
            id={txn.id}
            tag="irregular"
            label="irreg"
            active={tags.includes("irregular")}
            style="btn-info"
          />
        </div>
        <div class="btn-group tag-group">
          <TagButton
            id={txn.id}
            tag="igor"
            label="I"
            active={tags.includes("igor")}
            style="btn-light"
          />
          <TagButton
            id={txn.id}
            tag="serena"
            label="S"
            active={tags.includes("serena")}
            style="btn-light"
          />
        </div>
      </td>
    </tr>
  )
}

export interface TransactionListProps {
  entries: ClassifiedTransaction[]
  filter: Filter
  needsReview: number
}

export const TransactionList = ({ entries, filter, needsReview }: TransactionListProps) => (
  <div id="txn-list">
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
      <h2 class="h6 text-secondary stat-label mb-0">Transactions</h2>
      <div class="btn-group btn-group-sm">
        {FILTERS.map((f) => (
          <a
            class={`btn ${f === filter ? "btn-secondary" : "btn-outline-secondary"}`}
            href={`/?filter=${f}`}
            hx-get={`/transactions?filter=${f}`}
            hx-target="#txn-list"
            hx-swap="outerHTML"
            hx-push-url={`/?filter=${f}`}
          >
            {FILTER_LABEL[f]}
            {f === "review" && needsReview > 0 ? (
              <span class="badge text-bg-warning ms-1">{needsReview}</span>
            ) : null}
          </a>
        ))}
      </div>
    </div>

    {entries.length === 0 ? (
      <p class="text-secondary fst-italic">Nothing here.</p>
    ) : (
      <div class="table-responsive">
        <table class="table table-sm txn-table align-middle mb-0">
          <tbody>
            {entries.map((entry) => (
              <TransactionRow entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)
