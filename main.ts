import { createApp } from "./src/app"
import { config } from "./src/config"
import { HttpLunchMoneyClient } from "./src/lunchmoney/client"

const client = new HttpLunchMoneyClient({ apiKey: config.lunchMoneyApiKey })
const app = createApp({ client, config })

Bun.serve({ fetch: app.fetch, port: config.port })
console.log(`allowance listening on http://localhost:${config.port}`)
