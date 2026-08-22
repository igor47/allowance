import { createApp } from "../app"
import { FakeLunchMoneyClient } from "./fake-client"
import type { World } from "./world"

/**
 * A real Hono app over one world.
 *
 * `today` and `clock` come from the world rather than from globals, so a
 * scenario cannot get its clock out of sync with its data — which it could,
 * and did, when both were module-level constants every new test had to
 * remember to respect.
 */
export function useTestApp(world: World, client = new FakeLunchMoneyClient(world)) {
  /** Collected rather than printed, so a test can assert on what was logged. */
  const logs: string[] = []
  const app = createApp({
    client,
    config: world.config,
    today: () => world.today,
    clock: () => world.now,
    log: (line) => logs.push(line),
  })

  const get = (path: string, init?: RequestInit) => app.request(path, init)
  const post = (path: string, init?: RequestInit) => app.request(path, { method: "POST", ...init })

  return { app, client, get, post, logs }
}
