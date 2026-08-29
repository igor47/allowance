import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import type { Config } from "./config"
import type { IsoDate } from "./domain/dates"
import { today as todayIn } from "./domain/dates"
import { Cache } from "./lunchmoney/cache"
import type { LunchMoneyClient } from "./lunchmoney/types"
import { accessLog, identity, type Log } from "./middleware"
import { dashboardRoutes } from "./routes/index"
import { DashboardService } from "./services/dashboard"

export interface AppEnv {
  Variables: {
    user?: string
    service: DashboardService
    today: () => IsoDate
    /** The whole config, so a route can render what the file says. */
    config: Config
  }
}

export interface AppOptions {
  client: LunchMoneyClient
  config: Config
  /** Overridden in tests so "today" is not the wall clock. */
  today?: () => IsoDate
  /** Likewise for the instant, which is what staleness is measured against. */
  clock?: () => Date
  /** Where the access log goes. Tests collect it instead of printing it. */
  log?: Log
}

export function createApp({ client, config, today, clock, log = console.log }: AppOptions) {
  const app = new Hono<AppEnv>()
  const service = new DashboardService(client, config, new Cache(config.cacheTtlSeconds), clock)
  const now = today ?? (() => todayIn(config.timezone))

  app.get("/healthz", (c) => c.text("ok"))
  app.use("/static/*", serveStatic({ root: "./" }))

  app.use("*", identity(config.authUserHeader))
  app.use("*", accessLog(log))
  app.use("*", async (c, next) => {
    c.set("service", service)
    c.set("today", now)
    c.set("config", config)
    await next()
  })

  app.route("/", dashboardRoutes)

  app.onError((err, c) => {
    log(`${new Date().toISOString()} ${c.req.method} ${c.req.path} failed: ${err.stack ?? err}`)
    return c.text("Internal Server Error", 500)
  })

  return app
}
