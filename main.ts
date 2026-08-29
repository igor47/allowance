import { createApp } from "./src/app"
import { loadConfig } from "./src/config"
import { HttpLunchMoneyClient } from "./src/lunchmoney/client"

/**
 * A missing or malformed config is the most likely first-run failure, and a
 * stack trace through `readFileSync` buries the one line that says what to do
 * about it. Everything else still throws normally.
 */
const config = (() => {
  try {
    return loadConfig()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
})()

const client = new HttpLunchMoneyClient({ apiKey: config.lunchMoneyApiKey })
const app = createApp({ client, config })

Bun.serve({ fetch: app.fetch, port: config.port })
console.log(`allowance listening on http://localhost:${config.port}`)
