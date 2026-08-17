import { createApp } from "../app"
import { config } from "../config"
import { FakeLunchMoneyClient } from "./fake-client"
import { FIXTURE_NOW, FIXTURE_TODAY } from "./fixtures"

/** Pinned so a stray env var cannot move the numbers the tests assert on. */
export const TEST_CONFIG = {
  ...config,
  cacheTtlSeconds: 0,
  statementCloseDay: 12,
  statementDueDay: 9,
  allowance: { periodStart: "2026-08-01", dailyTarget: 200, rolloverCapDays: 14 },
}

export function useTestApp(client = new FakeLunchMoneyClient(), cacheTtlSeconds = 0) {
  /** Collected rather than printed, so a test can assert on what was logged. */
  const logs: string[] = []
  const app = createApp({
    client,
    config: { ...TEST_CONFIG, cacheTtlSeconds },
    today: () => FIXTURE_TODAY,
    clock: () => FIXTURE_NOW,
    log: (line) => logs.push(line),
  })

  const get = (path: string, init?: RequestInit) => app.request(path, init)
  const post = (path: string, init?: RequestInit) => app.request(path, { method: "POST", ...init })

  return { app, client, get, post, logs }
}
