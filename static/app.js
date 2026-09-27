/*
 * Bootstrap tooltips, kept alive across htmx swaps.
 *
 * Bootstrap attaches a JS instance per element, so anything that arrives from
 * the server after page load has no tooltip until it is initialised, and the
 * instances belonging to elements htmx just replaced would otherwise leak —
 * along with any tooltip left visible when its element vanished.
 */
function initTooltips() {
  for (const el of document.querySelectorAll('[data-bs-toggle="tooltip"]')) {
    bootstrap.Tooltip.getInstance(el)?.dispose()
    // container: body because the chart's card clips overflow, and a tooltip
    // anchored inside it would be cut off at the card edge.
    //
    // strategy: fixed because the absolute one positions against the tooltip's
    // offsetParent, and on this page that resolves to something the height of
    // the document — which threw the tooltip thousands of pixels up, out of
    // sight. Fixed positions against the viewport and has no such dependency.
    new bootstrap.Tooltip(el, {
      container: "body",
      popperConfig: (defaults) => ({
        ...defaults,
        modifiers: [
          ...(defaults.modifiers ?? []),
          // Popper's adaptive mode anchors a top-placed tooltip to its
          // offsetParent's *bottom* edge. When the body and the document
          // disagree about their height — which they do on this page — the
          // tooltip lands thousands of pixels away, at the foot of the page.
          // Plain top/left has no such dependency.
          { name: "computeStyles", options: { adaptive: false, gpuAcceleration: false } },
        ],
      }),
    })
  }
}

document.addEventListener("DOMContentLoaded", initTooltips)
document.body.addEventListener("htmx:afterSettle", initTooltips)

/*
 * Selects that submit their own form, so picking a month takes one click
 * instead of two. Delegated from the document because the form is re-rendered
 * on every navigation.
 */
document.addEventListener("change", (event) => {
  const form = event.target.closest?.("form[data-autosubmit]")
  if (form) form.submit()
})

/*
 * The note editor each transaction row carries, hidden until its pencil is
 * clicked. Delegated from the document because rows are swapped in by htmx.
 *
 * Enter submits the form on its own. Leaving the field saves too, but only
 * when something changed — otherwise it just closes — and Escape restores the
 * saved text before closing, so it never writes.
 */
function noteParts(el) {
  const row = el.closest("tr")
  return row && { row, form: row.querySelector(".note-form"), note: row.querySelector(".txn-note") }
}

function closeNote(parts) {
  parts.form.classList.add("d-none")
  parts.note?.classList.remove("d-none")
}

document.addEventListener("click", (event) => {
  const button = event.target.closest?.(".note-edit")
  if (!button) return
  const parts = noteParts(button)
  if (!parts?.form) return
  parts.form.classList.remove("d-none")
  parts.note?.classList.add("d-none")
  const input = parts.form.querySelector("input")
  // The cursor at the end, not the text selected: adding to a note is the
  // common edit, and a selection would let the first keystroke erase it.
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
})

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return
  const input = event.target.closest?.(".note-form input")
  if (!input) return
  input.value = input.defaultValue
  input.blur()
})

document.addEventListener("focusout", (event) => {
  const input = event.target.closest?.(".note-form input")
  if (!input) return
  const parts = noteParts(input)
  if (input.value.trim() !== input.defaultValue.trim()) htmx.trigger(parts.form, "submit")
  else closeNote(parts)
})
