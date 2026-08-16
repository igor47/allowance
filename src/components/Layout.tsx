import type { PropsWithChildren } from "hono/jsx"

export interface LayoutProps {
  title: string
  /** From authentik's forward-auth headers, when present. */
  user?: string
  /** Status controls that belong in the navbar rather than the page body. */
  nav?: unknown
}

export const Layout = ({ title, user, nav, children }: PropsWithChildren<LayoutProps>) => (
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
        <div class="container-xl">
          <a class="navbar-brand fw-semibold" href="/">
            allowance
          </a>
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
