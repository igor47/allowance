import type { PropsWithChildren } from "hono/jsx"

export interface LayoutProps {
  title: string
  /** From authentik's forward-auth headers, when present. */
  user?: string
  /** Status controls that belong in the navbar rather than the page body. */
  nav?: unknown
  /** Which of the two pages is showing, for the navbar's active state. */
  page?: "allowance" | "budget"
}

export const Layout = ({ title, user, nav, page, children }: PropsWithChildren<LayoutProps>) => (
  <html lang="en" data-bs-theme="dark">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="dark" />
      <title>{title}</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
      />
      <link rel="stylesheet" href="/static/app.css" />
      {/*
        SVG first for anything modern; the PNG and .ico are for the browsers
        and bookmark bars that still ask. The tab-sized cut drops the dashed
        target line — at 16px it renders as a smudge across the bars.
      */}
      <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
      <link rel="icon" href="/static/favicon-32.png" sizes="32x32" type="image/png" />
      <link rel="icon" href="/static/favicon.ico" sizes="16x16 32x32 48x48" />
      {/* Both of us add this to a home screen, so it is worth being installable. */}
      <link rel="apple-touch-icon" href="/static/apple-touch-icon.png" />
      <link rel="manifest" href="/static/site.webmanifest" />
      <meta name="theme-color" content="#212529" />
      <script src="/static/htmx.min.js" defer />
      {/* Popper is inside the bundle; it is what positions the chart tooltips. */}
      <script
        src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"
        defer
      />
      <script src="/static/app.js" defer />
    </head>
    <body class="bg-body">
      {/*
        The links collapse; the controls do not.

        Everything used to sit on one `flex-nowrap` line, which at 390px with a
        username in it ran off the right edge — and what fell off was the month
        picker and the sync clock, the two controls the page has. Behind
        authentik the username is always there and is the widest thing in the
        row, so this was the normal case on a phone, not the edge one.

        Which half collapses matters. The clock is a status light and its
        colour is the whole point of it being in the navbar, so putting it
        behind a toggle would cost it the glance it exists for; the refresh
        button lives under it and would go from one tap to two. The month is
        what the numbers below are *about*. The page links, by contrast, are
        used a few times a session, which is exactly what a collapse is for.

        `order-sm-*` puts the links back on the left once there is room, so the
        wide layout is unchanged. The order classes cannot be dropped in favour
        of DOM order: `.navbar-collapse` is `flex-basis: 100%` while collapsed,
        so anything after it in the source wraps to a third line when the menu
        opens.
      */}
      <nav class="navbar navbar-expand-sm border-bottom border-secondary-subtle mb-4">
        <div class="container-xl gap-2">
          {/*
            The icon replaces the word: the first nav link already says
            "Allowance", and the duplicated word was what pushed the clock off
            the edge. At 24px the mark costs a third of what the word did.
          */}
          <a class="navbar-brand me-0 d-flex align-items-center" href="/" aria-label="allowance">
            <img src="/static/icon.svg" width="24" height="24" alt="" />
          </a>
          <div class="d-flex align-items-center gap-2 ms-auto order-sm-2">
            {nav}
            <button
              type="button"
              class="navbar-toggler border-0 p-1 ms-1"
              data-bs-toggle="collapse"
              data-bs-target="#nav-menu"
              aria-controls="nav-menu"
              aria-expanded="false"
              aria-label="Pages"
            >
              <span class="navbar-toggler-icon" />
            </button>
          </div>
          <div class="collapse navbar-collapse order-sm-1" id="nav-menu">
            <ul class="navbar-nav flex-row gap-3 mt-2 mt-sm-0">
              <li class="nav-item">
                <a class={`nav-link ${page === "allowance" ? "active fw-semibold" : ""}`} href="/">
                  Allowance
                </a>
              </li>
              <li class="nav-item">
                <a
                  class={`nav-link ${page === "budget" ? "active fw-semibold" : ""}`}
                  href="/budget"
                >
                  Budget
                </a>
              </li>
            </ul>
            {user ? (
              <span class="navbar-text small text-secondary ms-sm-auto text-truncate">{user}</span>
            ) : null}
          </div>
        </div>
      </nav>
      <main class="container-xl">{children}</main>
      {/*
        Quiet on purpose. The page is a number you glance at, and a footer that
        competed with it would be worse than none — so this is small, muted,
        and below the fold of everything that matters.
      */}
      <footer class="container-xl py-4 mt-4 text-secondary small">
        made with{" "}
        <span role="img" aria-label="love">
          &#9829;
        </span>{" "}
        by{" "}
        <a class="link-secondary" href="https://igor.moomers.org" rel="me">
          igor47
        </a>
      </footer>
    </body>
  </html>
)
