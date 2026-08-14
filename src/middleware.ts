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

declare module "hono" {
  interface ContextVariableMap {
    user?: string
  }
}
