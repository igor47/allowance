import type { MiddlewareHandler } from "hono"

/**
 * Identity comes from authentik's forward-auth outpost, which traefik injects
 * as X-authentik-username. Traefik is configured with
 * `underscoreHeadersStrategy: delete` on the https entrypoint, so a client
 * cannot smuggle the underscore variant past it — the header is trustworthy
 * behind the proxy and absent everywhere else.
 */
export const identity: MiddlewareHandler = async (c, next) => {
  c.set("user", c.req.header("X-authentik-username"))
  await next()
}

/** Where a log line goes. Injected so tests can read what was written. */
export type Log = (line: string) => void

/**
 * One line per request: when, who, what, and how long it took.
 *
 * `docker logs` shows nothing but what the process prints, so the timestamp is
 * ours to supply — in UTC, matching what traefik and the authentik outpost
 * write, since correlating across the three is the whole point of having this.
 *
 * The user field is the other half. Blank means the forward-auth headers did
 * not arrive, which is indistinguishable from "logged in" on the page itself
 * until someone's tag lands under the wrong name.
 *
 * Registered after the static and health routes so it says nothing about
 * favicons and health checks, which are the bulk of the traffic and none of
 * the interesting part.
 */
export const accessLog =
  (log: Log): MiddlewareHandler =>
  async (c, next) => {
    const started = performance.now()
    try {
      await next()
    } finally {
      const ms = Math.round(performance.now() - started)
      // In a finally, so a handler that throws is still logged — onError has
      // already turned it into a 500 response by the time we get here.
      const url = new URL(c.req.url)
      log(
        `${new Date().toISOString()} ${c.req.method} ${url.pathname}${url.search} ` +
          `${c.res.status} ${ms}ms user=${c.var.user ?? "-"}`
      )
    }
  }

declare module "hono" {
  interface ContextVariableMap {
    user?: string
  }
}
