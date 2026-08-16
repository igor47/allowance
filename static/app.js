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
