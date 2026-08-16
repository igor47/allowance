/**
 * How stale the data is, as a navbar clock.
 *
 * This used to be a full-width line above the allowance, which was a lot of
 * prime screen space for a number that is usually "fine". The state that
 * matters at a glance is one of three, so it is a coloured clock; the detail
 * and the refresh button live behind it, a click away.
 *
 * Refreshing queues a background job on Lunch Money's side — there is nothing
 * to show synchronously, which is why the queued state says so plainly and
 * then re-checks itself rather than pretending to have finished.
 */

import { ago, staleness } from "../domain/freshness"
import type { Dashboard } from "../services/dashboard"
import { shortDate } from "./format"

export interface SyncProps {
  dashboard: Dashboard
  queued?: boolean
}

const TONE = {
  fresh: { color: "text-success", word: "Up to date" },
  aging: { color: "text-warning", word: "Worth a refresh" },
  stale: { color: "text-danger", word: "Stale" },
} as const

/** Drawn rather than imported: one clock is not worth an icon dependency. */
const Clock = ({ alert }: { alert: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="9" cy="9" r="6.75" stroke="currentColor" stroke-width="1.5" />
    <path
      d="M9 5.25V9.3l2.6 1.65"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    {/* A shape cue as well as a colour one, for anyone who cannot see the red. */}
    {alert ? <circle cx="15" cy="3.5" r="2.75" fill="currentColor" /> : null}
  </svg>
)

const Row = ({ label, value }: { label: string; value: string }) => (
  <div class="d-flex justify-content-between gap-4">
    <span class="text-secondary">{label}</span>
    <span class="text-body">{value}</span>
  </div>
)

export const Sync = ({ dashboard, queued = false }: SyncProps) => {
  const { freshness } = dashboard
  const state = staleness(freshness)
  const { color, word } = TONE[state]

  return (
    <div
      id="sync"
      class="dropdown"
      hx-swap-oob="true"
      {...(queued
        ? { "hx-get": "/sync", "hx-trigger": "load delay:20s", "hx-swap": "outerHTML" }
        : {})}
    >
      <button
        type="button"
        class={`btn btn-sm btn-link p-1 lh-1 ${color}`}
        data-bs-toggle="dropdown"
        data-bs-auto-close="outside"
        aria-expanded={queued ? "true" : "false"}
        aria-label={`Data sync: ${word.toLowerCase()}. Checked ${ago(freshness.lastFetchAt)}.`}
        title={`${word} · checked ${ago(freshness.lastFetchAt)}`}
      >
        <Clock alert={state !== "fresh"} />
      </button>

      {/*
        `show` is rendered server-side after a refresh so the queued message is
        visible without a second click — the swap that delivers it also closes
        whatever the click had opened.
      */}
      <div class={`dropdown-menu dropdown-menu-end sync-menu p-3 small ${queued ? "show" : ""}`}>
        <div class={`fw-semibold mb-2 ${color}`}>{word}</div>
        <Row label="Checked" value={ago(freshness.lastFetchAt)} />
        <Row
          label="Newest transaction"
          value={freshness.newestTransaction ? shortDate(freshness.newestTransaction) : "none"}
        />
        <Row label="Last new one arrived" value={ago(freshness.transactionsAt)} />
        <Row label="Balances read" value={ago(freshness.balancesAt)} />

        {queued ? (
          <div class="text-info mt-2">
            Queued. Nothing new appears until Chase posts it, which takes a day or two.
          </div>
        ) : null}

        <button
          type="button"
          class="btn btn-sm btn-outline-secondary w-100 mt-3"
          hx-post="/refresh"
          hx-target="#sync"
          hx-swap="outerHTML"
          hx-disabled-elt="this"
        >
          <span class="spinner-border spinner-border-sm me-1 htmx-indicator" aria-hidden="true" />
          Refresh from bank
        </button>
      </div>
    </div>
  )
}
