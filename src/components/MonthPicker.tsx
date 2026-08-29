/**
 * Which month the page is showing, and how to go to another one.
 *
 * A plain GET form rather than anything clever: the month is in the URL, so a
 * past month is linkable and the back button does what it looks like it does.
 */

export interface MonthPickerProps {
  /** The month on display, as YYYY-MM. */
  month: string
  /** The latest month that can be asked for, as YYYY-MM. */
  latest: string
  /** The earliest month that can be asked for, as YYYY-MM. From the config. */
  historyStart: string
  /** The list selection, carried through so changing month keeps your view. */
  filter?: string
  who?: string
  /** Where the form submits — the page keeps you on it. */
  action?: string
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export const monthLabel = (month: string): string => {
  const [year, m] = month.split("-")
  return `${MONTHS[Number(m) - 1]} ${year}`
}

export const MonthPicker = ({
  month,
  latest,
  filter,
  who,
  historyStart,
  action = "/",
}: MonthPickerProps) => {
  const [year, m] = month.split("-")
  const firstYear = Number(historyStart.split("-")[0])
  const lastYear = Number(latest.split("-")[0])
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i)

  return (
    <div class="dropdown">
      <button
        type="button"
        class="btn btn-sm btn-link text-body text-decoration-none dropdown-toggle px-1"
        data-bs-toggle="dropdown"
        data-bs-auto-close="outside"
        aria-expanded="false"
      >
        {monthLabel(month)}
      </button>
      <form
        class="dropdown-menu dropdown-menu-end month-menu p-2"
        method="get"
        action={action}
        data-autosubmit
      >
        {filter ? <input type="hidden" name="filter" value={filter} /> : null}
        {who ? <input type="hidden" name="who" value={who} /> : null}
        <div class="d-grid gap-2">
          <select class="form-select form-select-sm" name="m" aria-label="Month">
            {MONTHS.map((name, i) => (
              <option value={String(i + 1).padStart(2, "0")} selected={i + 1 === Number(m)}>
                {name}
              </option>
            ))}
          </select>
          <select class="form-select form-select-sm" name="y" aria-label="Year">
            {years.map((y) => (
              <option value={String(y)} selected={String(y) === year}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {/*
          No Show button: changing either select submits, which also closes the
          dropdown, because the page navigates. A month outside the range is
          clamped rather than refused — the year select cannot know which months
          of the current year exist yet, and an error page is a poor answer to
          "December, please" in August.
        */}
        <noscript>
          <button type="submit" class="btn btn-sm btn-primary w-100 mt-2">
            Show
          </button>
        </noscript>
      </form>
    </div>
  )
}
