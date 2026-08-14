import { createApp } from "./src/app"
import { config } from "./src/config"

const app = createApp()
Bun.serve({ fetch: app.fetch, port: config.port })
console.log(`allowance listening on http://localhost:${config.port}`)
