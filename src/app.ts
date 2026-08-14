import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import type { Config } from "./config"
import type { IsoDate } from "./domain/dates"
import { today as todayIn } from "./domain/dates"
import { Cache } from "./lunchmoney/cache"
import type { LunchMoneyClient } from "./lunchmoney/types"
import { identity } from "./middleware"
import { dashboardRoutes } from "./routes/index"
import { DashboardService } from "./services/dashboard"

export interface AppEnv {
  Variables: {
    user?: string
    service: DashboardService
    today: () => IsoDate
  }
}

export interface AppOptions {
  client: LunchMoneyClient
  config: Config
  /** Overridden in tests so "today" is not the wall clock. */
  today?: () => IsoDate
}

export function createApp({ client, config, today }: AppOptions) {
  const app = new Hono<AppEnv>()
  const service = new DashboardService(client, config, new Cache(config.cacheTtlSeconds))
  const now = today ?? (() => todayIn(config.timezone))

  app.get("/healthz", (c) => c.text("ok"))
  app.use("/static/*", serveStatic({ root: "./" }))

  app.use("*", identity)
  app.use("*", async (c, next) => {
    c.set("service", service)
    c.set("today", now)
    await next()
  })

  app.route("/", dashboardRoutes)

  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} failed`, err)
    return c.text("Internal Server Error", 500)
  })

  return app
}
