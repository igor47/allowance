import type { Person } from "../config"
import type { ClassifiedTransaction } from "../domain/allowance"
import type { Bucket, TAG } from "../domain/policy"
import { detailsOf } from "../lunchmoney/details"
import { accountNameOf } from "../lunchmoney/types"
import { type FilterSummary, needsReview as isReviewItem, type View } from "../services/dashboard"
import { cents, money, shortDate } from "./format"

/*
 * Each bucket twice: filled when a person said so, outlined when the app
 * worked it out. See `.badge.inferred` in app.css for why an inferred pill
 * drops `text-bg-*` entirely rather than restyling it.
 */
const BUCKET_STYLE: Record<Bucket, { label: string; solid: string; inferred: string }> = {
  spending: {
    label: "spending",
    solid: "text-bg-primary",
    inferred: "bg-transparent text-primary-emphasis border-primary",
  },
  recurring: {
    label: "recurring",
    solid: "tag-teal",
    inferred: "bg-transparent tag-teal-outline",
  },
  irregular: {
    label: "irregular",
    solid: "tag-purple",
    inferred: "bg-transparent tag-purple-outline",
  },
  // Never filled: nobody has said anything, which is what the bucket means.
  unclassified: {
    label: "unclassified",
    solid: "text-bg-dark border border-secondary",
    inferred: "bg-transparent text-body-secondary border-dark-subtle",
  },
  deposit: {
    label: "deposit",
    solid: "text-bg-success",
    inferred: "bg-transparent text-success-emphasis border-success",
  },
  transfer: {
    label: "transfer",
    solid: "text-bg-secondary",
    inferred: "bg-transparent text-secondary-emphasis border-secondary",
  },
  // Structural, and never taggable — the outline is honest all the same, since
  // no person classified it either.
  ignored: {
    label: "ignored",
    solid: "text-bg-dark border border-secondary",
    inferred: "bg-transparent text-body-secondary border-dark-subtle",
  },
}

const VIEW_LABEL: Record<View, string> = {
  review: "Needs review",
  spending: "Spending",
  deposits: "Deposits",
  irregular: "Irregular",
  fixed: "Fixed",
  all: "All",
}

/**
 * The two you are in most of the time, and the rest a click away.
 *
 * Six views and the people is eight chips or more, which on a phone was two
 * ragged rows of something you glance at rather than read. The two that carry a
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
}

/**
 * People share one neutral tone rather than getting a colour each.
 *
 * The classifying colours mean something — they match the badge the row will
 * wear — and there is no such badge for a person. Giving each household member
 * a hue would spend the palette on the axis that carries no meaning, and the
 * config can hold any number of them.
 */
const PERSON_TONE = { active: "btn-light", preview: "preview-light" }

/**
 * How many buttons a row ends in, which is the one thing the stylesheet cannot
 * work out for itself: the four classifying ones, plus one per person.
 *
 * The column width and the flex weights on a phone are all derived from it,
 * because a household is not two people. Ours has three, one of whom is a dog,
 * and the layout that assumed two put his button off the right of the row.
 */
const classifyingButtons = Object.keys(TAG_TONE).length

const TagButton = ({
  id,
  tag,
  label,
  tone,
  active,
  month,
}: {
  id: number
  tag: string
  label: string
  tone: { active: string; preview: string }
  active: boolean
  month?: string
}) => (
  <button
    type="button"
    class={`btn tag-btn ${active ? tone.active : `btn-outline-secondary ${tone.preview}`}`}
    // The state wanted rather than "toggle", so a repeated click is harmless.
    hx-post={`/transactions/${id}/tag?tag=${tag}&set=${active ? "off" : "on"}${month ? `&month=${month}` : ""}`}
    hx-target="closest tr"
    hx-swap="outerHTML"
    // One tag write per row at a time. Every button on the row was drawn from
    // the same state, so a second click before the row comes back would be
    // computed from a picture that is about to change; it is dropped, and the
    // indicator dims the whole row so the drop is visible rather than silent.
    hx-sync="closest tr:drop"
    hx-indicator="closest tr"
    /*
     * The rows the summary line is a caption of, sent with every tag.
     *
     * The server cannot work them out: the list holds whatever was on screen
     * when it was last fetched, and tagging deliberately leaves a row in
     * place after it stops matching the filter — so re-running the filter
     * would count a different set from the one the reader is looking at.
     * `#txn-shown` is written by the list itself, which is the only thing
     * that knows.
     */
    hx-include="#txn-shown"
    title={active ? `Remove ${tag}` : `Tag as ${tag}`}
  >
    {label}
  </button>
)

export const TransactionRow = ({
  entry,
  month,
  people,
}: {
  entry: ClassifiedTransaction
  month?: string
  /** Who a row can be attributed to. Empty for a household of one. */
  people: Person[]
}) => {
  const { txn, classification } = entry
  const tags = txn.tags.map((t) => t.name.toLowerCase())
  const account = accountNameOf(txn)
  const details = detailsOf(txn)
  const style = BUCKET_STYLE[classification.bucket]
  /*
   * An inferred verdict is outlined; one a person tagged is solid.
   *
   * The row carries two independent facts — what it is, and whether anyone
   * said so — and they used to live in three places: the pill, the warning
   * stripe, and the reason text spelling out "tagged spending". Putting the
   * second fact on the same element as the first means one glance answers
   * both, and it is what lets the restating reasons go.
   */
  const pill = classification.reviewed ? `badge ${style.solid}` : `badge inferred ${style.inferred}`
  const taggable = classification.taggable
  const credit = classification.amount < 0
  /*
   * Dimmed means "not in the allowance". Deposits are the exception, because
   * money arriving is worth seeing even though it is not spending. The
   * exception used to be every credit, which lit the arriving leg of a
   * transfer and dimmed the leaving one — two halves of one movement looking
   * like two kinds of thing, for no reason the screen could explain.
   */
  const classes = [
    isReviewItem(entry) ? "unreviewed" : "",
    classification.counts || classification.bucket === "deposit" ? "" : "not-counted",
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
  // Everything on the second line, whole, for when the line runs out of room.
  const meta = [...facts, account, txn.is_pending ? "pending" : null, classification.reason]
    .filter(Boolean)
    .join(" · ")

  // The reason shares a line with the facts, so a tag that rewrites it
  // changes what the line says and never how many lines the row has —
  // letting it reflow made the rest of the list jump under the cursor.
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
        Two lines, and a third only for a note. What the payee is, on the
        first; everything the app knows about it, on the second — category,
        where, which account, whether it has settled, and why it was filed
        where it was. They used to be four lines, and the row had more
        furniture than the transaction had facts.

        The raw statement descriptor, which used to be a line of its own that
        read as unexplained noise, is the payee's `title`: it is there for the
        one row in fifty where the cleaned-up name is not enough.

        Native `title` rather than a Bootstrap tooltip on purpose. `app.js`
        disposes and rebuilds every tooltip instance on each htmx settle, so
        several per row over a few hundred rows would make each tag click pay
        for the whole list. A `title` costs nothing and survives the swap.
      */}
      <td>
        <div class="txn-payee">
          <span class="fw-medium text-truncate" title={descriptor ?? name}>
            {name}
          </span>
          {/*
            Faint until hovered, so a list of them is not a column of pencils,
            and always present, since a phone has no hover to reveal it with.
          */}
          <button
            type="button"
            class="btn btn-link note-edit"
            title={txn.notes ? "Edit the note" : "Add a note"}
            aria-label={txn.notes ? "Edit the note" : "Add a note"}
          >
            ✎
          </button>
        </div>
        <div class="txn-line small text-secondary" title={meta}>
          {facts.length > 0 ? <span class="txn-facts">{facts.join(" · ")}</span> : null}
          <span class="badge text-bg-dark border border-secondary txn-account">{account}</span>
          {txn.is_pending ? <span class="badge text-bg-warning">pending</span> : null}
          {classification.restated ? null : (
            <span class="fst-italic txn-reason">{classification.reason}</span>
          )}
        </div>
        {txn.notes ? (
          <div class="txn-note small" title={txn.notes}>
            {txn.notes}
          </div>
        ) : null}
        {/*
          Rendered hidden on every row and opened by `app.js`, so starting to
          type costs no round trip. Enter or leaving the field saves; Escape
          puts it back. An empty note clears the one in Lunch Money.

          No hx-sync with the tag buttons: a note and the tags are separate
          fields of the transaction, so the two writes cannot undo each other.
        */}
        <form
          class="note-form d-none"
          hx-post={`/transactions/${txn.id}/note${month ? `?month=${month}` : ""}`}
          hx-target="closest tr"
          hx-swap="outerHTML"
        >
          <input
            type="text"
            name="notes"
            class="form-control form-control-sm"
            value={txn.notes ?? ""}
            placeholder="Add a note"
            aria-label="Note"
            autocomplete="off"
          />
        </form>
      </td>
      <td class={`text-end tabular text-nowrap align-top${credit ? " text-success" : ""}`}>
        {cents(classification.amount)}
      </td>
      <td class="align-top">
        <span class={pill}>{style.label}</span>
      </td>
      <td class="text-end text-nowrap align-top">
        {taggable ? (
          <>
            <div class="btn-group tag-group me-1">
              <TagButton
                month={month}
                id={txn.id}
                tag="spending"
                tone={TAG_TONE.spending}
                label="spend"
                active={tags.includes("spending")}
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="recurring"
                tone={TAG_TONE.recurring}
                label="recur"
                active={tags.includes("recurring")}
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="irregular"
                tone={TAG_TONE.irregular}
                label="irreg"
                active={tags.includes("irregular")}
              />
              <TagButton
                month={month}
                id={txn.id}
                tag="transfer"
                tone={TAG_TONE.transfer}
                label="xfer"
                active={tags.includes("transfer")}
              />
            </div>
            {people.length > 0 ? (
              <div class="btn-group tag-group">
                {people.map((person) => (
                  <TagButton
                    month={month}
                    id={txn.id}
                    tag={person.tag}
                    tone={PERSON_TONE}
                    label={person.short}
                    active={tags.includes(person.tag)}
                  />
                ))}
              </div>
            ) : null}
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
  /** A person's tag, or undefined for everybody. */
  who?: string
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
/**
 * The caption over the list, which has to move when a tag does.
 *
 * It came back out of band with the row for the same reason the review count
 * does: a triage session is a sequence of clicks, and a line that only settled
 * on a full page load spent the session saying $503 against the allowance
 * while the rows underneath it added up to $90.
 */
export const SummaryLine = ({ summary, oob }: { summary: FilterSummary; oob?: boolean }) => (
  <p id="txn-summary" class="small text-secondary mb-2" {...(oob ? { "hx-swap-oob": "true" } : {})}>
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
)

export const ReviewCount = ({ count, oob }: { count: number; oob?: boolean }) => (
  <span
    id="review-count"
    class={`badge text-bg-warning ms-1 ${count > 0 ? "" : "d-none"}`}
    {...(oob ? { "hx-swap-oob": "true" } : {})}
  >
    {count > 0 ? count : ""}
  </span>
)

export const FilterBar = ({
  sel,
  needsReview,
  people,
}: {
  sel: Selection
  needsReview: number
  people: Person[]
}) => {
  const secondary = SECONDARY.includes(sel.view)

  return (
    <div class="btn-toolbar gap-2 filter-bar" role="toolbar" aria-label="Filter transactions">
      {/* What kind. Selecting the selected one goes back to everything. */}
      <div class="btn-group btn-group-sm">
        {PRIMARY.map((v) => {
          const lit = sel.view === v
          /*
           * Going to the review queue drops the person, and it is the one
           * chip that reaches across to the other axis.
           *
           * It earns the exception by being the default view: with no
           * parameters at all the page shows the queue, so a person left
           * over from the last thing you looked at makes the *home page*
           * empty. A default that shows nothing is a bug rather than a
           * preference, and no other view is arrived at by accident.
           *
           * Narrowing the queue afterwards still works — click a person while
           * it is showing and you get his — because that is a thing you
           * asked for rather than a thing you inherited.
           */
          const who = v === "review" && !lit ? undefined : sel.who
          return (
            <Chip
              label={VIEW_LABEL[v]}
              active={lit}
              to={linkTo({ ...sel, view: lit ? "all" : v, who })}
            >
              {v === "review" ? <ReviewCount count={needsReview} /> : null}
            </Chip>
          )
        })}
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
      {people.length > 0 ? (
        <div class="btn-group btn-group-sm">
          {people.map((person) => (
            <Chip
              label={person.label}
              active={sel.who === person.tag}
              to={linkTo({ ...sel, who: sel.who === person.tag ? undefined : person.tag })}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export interface TransactionListProps {
  sel: Selection
  entries: ClassifiedTransaction[]
  needsReview: number
  summary: FilterSummary
  /** Who a row can be attributed to. Empty for a household of one. */
  people: Person[]
}

export const TransactionList = ({
  entries,
  sel,
  needsReview,
  summary,
  people,
}: TransactionListProps) => (
  <div id="txn-list">
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
      <h2 class="h6 text-secondary stat-label mb-0">Transactions</h2>
      <FilterBar sel={sel} needsReview={needsReview} people={people} />
    </div>

    {/*
     * Both figures always show. Hiding "against the allowance" when it equalled
     * the total made two filters look like they were measuring different
     * things — one filter read "$925 · $675 against the allowance" while the
     * next read "$879", and you had to work out whether the rest was excluded
     * or absent.
     */}
    <SummaryLine summary={summary} />
    {/*
     * What the line above is counting, for the tag route to recount. Rendered
     * with the list, because the list is what changes the set: a tag swaps a
     * row in place and leaves the set alone.
     */}
    <input
      type="hidden"
      id="txn-shown"
      name="shown"
      value={entries.map((e) => e.txn.id).join(",")}
    />

    {entries.length === 0 ? (
      // Naming the person matters: with two axes it is easy to land on an
      // empty list because of the one you were not thinking about, and
      // "Nothing here" would let the review badge say 11 while the page
      // showed none of them.
      <p class="text-secondary fst-italic">
        Nothing here
        {sel.who ? ` for ${people.find((p) => p.tag === sel.who)?.label ?? sel.who}` : ""}.
      </p>
    ) : (
      <div class="table-responsive">
        {/* See `--tag-buttons` in app.css, and `classifyingButtons` above. */}
        <table
          class="table table-sm txn-table align-middle mb-0"
          style={`--tag-buttons: ${classifyingButtons + people.length}; --person-buttons: ${people.length}`}
        >
          <tbody>
            {entries.map((entry) => (
              <TransactionRow entry={entry} month={sel.month} people={people} />
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)
