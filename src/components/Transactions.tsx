import type { ClassifiedTransaction } from "../domain/allowance"
import { STATEMENT_ACCOUNT } from "../domain/card"
import type { Bucket, TAG } from "../domain/policy"
import { detailsOf } from "../lunchmoney/details"
import { accountNameOf } from "../lunchmoney/types"
import {
  type FilterSummary,
  needsReview as isReviewItem,
  PEOPLE,
  type Person,
  type View,
} from "../services/dashboard"
import { cents, money, shortDate } from "./format"

const BUCKET_STYLE: Record<Bucket, { label: string; class: string }> = {
  spending: { label: "spending", class: "text-bg-primary" },
  recurring: { label: "recurring", class: "tag-teal" },
  irregular: { label: "irregular", class: "tag-purple" },
  unclassified: { label: "unclassified", class: "text-bg-dark border border-secondary" },
  deposit: { label: "deposit", class: "text-bg-success" },
  transfer: { label: "transfer", class: "text-bg-secondary" },
  ignored: { label: "ignored", class: "text-bg-dark border border-secondary" },
}

const VIEW_LABEL: Record<View, string> = {
  review: "Needs review",
  spending: "Spending",
  deposits: "Deposits",
  irregular: "Irregular",
  fixed: "Fixed",
  all: "All",
}

const PERSON_LABEL: Record<Person, string> = { igor: "Igor", serena: "Serena" }

/**
 * The two you are in most of the time, and the rest a click away.
 *
 * Six views and two people is eight chips, which on a phone was two ragged
 * rows of something you glance at rather than read. The two that carry a
 * session stay out; the other four go behind a menu — but the menu's button
 * wears the name of whatever is chosen, so nothing is ever selected without
 * being visible. A disclosure that can hide the current state is the reason
 * these are usually a bad idea; one that cannot is just a longer list.
 */
const PRIMARY: View[] = ["review", "spending"]
const SECONDARY: View[] = ["deposits", "irregular", "fixed", "all"]

/** Keyed off the domain's own vocabulary, so a new tag must pick a colour. */
type TagName = keyof typeof TAG

/**
 * What each tag looks like when it is on, and what it promises on the way.
 *
 * The resting state stays a uniform muted outline — six lit buttons on every
 * row would be a lot of colour for a list you scan — but hovering one shows
 * the colour that tag will actually be, so the badge the click is about to
 * produce is visible before the click. `preview` sets only Bootstrap's three
 * `--bs-btn-hover-*` variables, so the rest of the outline variant is left
 * alone; the colours themselves live in app.css beside the solid ones.
 *
 * Only the off state carries it. A lit button already wears its colour and
 * has a hover of its own, which this would otherwise overwrite.
 */
const TAG_TONE: Record<TagName, { active: string; preview: string }> = {
  spending: { active: "btn-primary", preview: "preview-primary" },
  recurring: { active: "tag-teal", preview: "preview-teal" },
  irregular: { active: "tag-purple", preview: "preview-purple" },
  transfer: { active: "btn-secondary", preview: "preview-secondary" },
  igor: { active: "btn-light", preview: "preview-light" },
  serena: { active: "btn-light", preview: "preview-light" },
}

const TagButton = ({
  id,
  tag,
  label,
  active,
  month,
}: {
  id: number
  tag: TagName
  label: string
  active: boolean
  month?: string
}) => (
  <button
    type="button"
    class={`btn tag-btn ${
      active ? TAG_TONE[tag].active : `btn-outline-secondary ${TAG_TONE[tag].preview}`
    }`}
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
    isReviewItem(entry) ? "unreviewed" : "",
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
      {/*
        Every line here is one line: `text-truncate` on the payee and `nowrap`
        on the three below it, so a long descriptor ends in an ellipsis rather
        than growing the row. `title` is what makes the cut reversible — the
        whole string is a hover away, on the four lines that can lose text.

        Native rather than a Bootstrap tooltip on purpose. `app.js` disposes
        and rebuilds every tooltip instance on each htmx settle, so four per
        row over a few hundred rows would make each tag click pay for the whole
        list. A `title` costs nothing and survives the swap by being markup.
      */}
      <td>
        <div class="fw-medium text-truncate" title={name}>
          {name}
        </div>
        <div class="txn-line small text-secondary font-monospace" title={descriptor ?? undefined}>
          {descriptor}
        </div>
        <div class="txn-line small text-secondary" title={facts.join(" · ")}>
          {facts.join(" · ")}
        </div>
        <div class="txn-line small">
          {account !== STATEMENT_ACCOUNT ? (
            <span class="badge text-bg-dark border border-secondary me-1">{account}</span>
          ) : null}
          {txn.is_pending ? <span class="badge text-bg-warning me-1">pending</span> : null}
          <span class="text-secondary fst-italic" title={classification.reason}>
            {classification.reason}
          </span>
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
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="recurring"
                label="recur"
                active={tags.includes("recurring")}
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="irregular"
                label="irreg"
                active={tags.includes("irregular")}
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="transfer"
                label="xfer"
                active={tags.includes("transfer")}
              />
            </div>
            <div class="btn-group tag-group">
              <TagButton
                month={month}
                id={txn.id}
                tag="igor"
                label="I"
                active={tags.includes("igor")}
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="serena"
                label="S"
                active={tags.includes("serena")}
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

export interface Selection {
  view: View
  who?: Person
  /** Set only when a past month is being viewed, so links stay in that month. */
  month?: string
}

/** Where a chip points. Every link carries the whole selection, both axes. */
const linkTo = (sel: Selection): string => {
  const params = new URLSearchParams({ filter: sel.view })
  if (sel.who) params.set("who", sel.who)
  if (sel.month) params.set("month", sel.month)
  return `?${params}`
}

/**
 * A filter link swaps the list and leaves the URL saying where you are, so the
 * back button and a copied link both work. Shared by the chips and the menu,
 * which differ only in how they are dressed.
 */
const goes = (to: string) => ({
  href: `/${to}`,
  "hx-get": `/transactions${to}`,
  "hx-target": "#txn-list",
  "hx-swap": "outerHTML",
  "hx-push-url": `/${to}`,
})

/**
 * One chip. Clicking the selected one turns its own axis off, which is why
 * `to` is computed by the caller: only the caller knows which axis it owns.
 */
const Chip = ({
  label,
  active,
  to,
  children,
}: {
  label: string
  active: boolean
  to: string
  children?: unknown
}) => (
  <a
    class={`btn ${active ? "btn-secondary" : "btn-outline-secondary"}`}
    aria-current={active ? "true" : undefined}
    {...goes(to)}
  >
    {label}
    {children}
  </a>
)

/**
 * The review count, alone, so a tag click can swap it without touching the
 * rest of the bar. It is the number of things left to do and it drops as you
 * do them; a badge that only moved on a full page load was quietly wrong for
 * the whole of a triage session.
 *
 * Always rendered, empty when there is nothing left — htmx cannot swap an
 * element into a page that does not have one to swap.
 */
export const ReviewCount = ({ count, oob }: { count: number; oob?: boolean }) => (
  <span
    id="review-count"
    class={`badge text-bg-warning ms-1 ${count > 0 ? "" : "d-none"}`}
    {...(oob ? { "hx-swap-oob": "true" } : {})}
  >
    {count > 0 ? count : ""}
  </span>
)

export const FilterBar = ({ sel, needsReview }: { sel: Selection; needsReview: number }) => {
  const secondary = SECONDARY.includes(sel.view)

  return (
    <div class="btn-toolbar gap-2 filter-bar" role="toolbar" aria-label="Filter transactions">
      {/* What kind. Selecting the selected one goes back to everything. */}
      <div class="btn-group btn-group-sm">
        {PRIMARY.map((v) => (
          <Chip
            label={VIEW_LABEL[v]}
            active={sel.view === v}
            to={linkTo({ ...sel, view: sel.view === v ? "all" : v })}
          >
            {v === "review" ? <ReviewCount count={needsReview} /> : null}
          </Chip>
        ))}
        <button
          type="button"
          class={`btn dropdown-toggle ${secondary ? "btn-secondary" : "btn-outline-secondary"}`}
          data-bs-toggle="dropdown"
          aria-expanded="false"
        >
          {/* The button says what is chosen, so the menu never hides state. */}
          {secondary ? VIEW_LABEL[sel.view] : "More"}
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          {SECONDARY.map((v) => (
            <li>
              <a
                class={`dropdown-item ${sel.view === v ? "active" : ""}`}
                {...goes(linkTo({ ...sel, view: v }))}
              >
                {VIEW_LABEL[v]}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* Whose. Independent of the above: this narrows whatever is showing. */}
      <div class="btn-group btn-group-sm">
        {PEOPLE.map((p) => (
          <Chip
            label={PERSON_LABEL[p]}
            active={sel.who === p}
            to={linkTo({ ...sel, who: sel.who === p ? undefined : p })}
          />
        ))}
      </div>
    </div>
  )
}

export interface TransactionListProps {
  sel: Selection
  entries: ClassifiedTransaction[]
  needsReview: number
  summary: FilterSummary
}

export const TransactionList = ({ entries, sel, needsReview, summary }: TransactionListProps) => (
  <div id="txn-list">
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
      <h2 class="h6 text-secondary stat-label mb-0">Transactions</h2>
      <FilterBar sel={sel} needsReview={needsReview} />
    </div>

    {/*
     * Both figures always show. Hiding "against the allowance" when it equalled
     * the total made two filters look like they were measuring different
     * things — Igor read "$925 · $675 against the allowance" while Serena read
     * "$879" and you had to work out whether the rest was excluded or absent.
     */}
    <p class="small text-secondary mb-2">
      <span class="tabular">{summary.count}</span> transaction{summary.count === 1 ? "" : "s"}
      {summary.excluded > 0 ? (
        <span title="Transfers and untracked rows, which are in neither figure">
          {" "}
          ({summary.excluded} not in the totals)
        </span>
      ) : null}{" "}
      · <span class="tabular">{money(summary.total)}</span> total ·{" "}
      <span class="tabular">{money(summary.counting)}</span> against the allowance
    </p>

    {entries.length === 0 ? (
      // Naming the person matters: with two axes it is easy to land on an
      // empty list because of the one you were not thinking about, and
      // "Nothing here" would let the review badge say 11 while the page
      // showed none of them.
      <p class="text-secondary fst-italic">
        Nothing here{sel.who ? ` for ${PERSON_LABEL[sel.who]}` : ""}.
      </p>
    ) : (
      <div class="table-responsive">
        <table class="table table-sm txn-table align-middle mb-0">
          <tbody>
            {entries.map((entry) => (
              <TransactionRow entry={entry} month={sel.month} />
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)
