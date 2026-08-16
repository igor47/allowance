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
      <nav class="navbar navbar-expand border-bottom border-secondary-subtle mb-4">
        <div class="container-xl flex-nowrap gap-2">
          {/*
            The icon replaces the word: the first nav link already says
            "Allowance", and on a 390px screen the duplicated word was what
            pushed the clock off the edge. At 28px the mark costs a third of
            what the word did — but it is not free, so the nav gaps tighten
            below sm to keep the row inside 390px.
          */}
          <a class="navbar-brand me-2 d-flex align-items-center" href="/" aria-label="allowance">
            <img src="/static/icon.svg" width="24" height="24" alt="" />
          </a>
          <ul class="navbar-nav flex-row gap-2 gap-sm-3">
            <li class="nav-item">
              <a class={`nav-link ${page === "allowance" ? "active fw-semibold" : ""}`} href="/">
                Allowance
              </a>
            </li>
            <li class="nav-item">
              <a class={`nav-link ${page === "budget" ? "active fw-semibold" : ""}`} href="/budget">
                Budget
              </a>
            </li>
          </ul>
          <div class="ms-auto d-flex align-items-center gap-3">
            {user ? <span class="navbar-text small text-secondary">{user}</span> : null}
            {nav}
          </div>
        </div>
      </nav>
      <main class="container-xl pb-5">{children}</main>
    </body>
  </html>
)
