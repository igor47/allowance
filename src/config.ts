/** Configuration. Deliberately code-and-env, not a database. */

export interface AllowanceConfig {
  /** Start of the budgeting period. Declared, not derived. */
  periodStart: string
  /** Dollars per day. */
  dailyTarget: number
  /** Positive rollover is capped at this many days of target. Negative is uncapped. */
  rolloverCapDays: number
}

export interface Config {
  port: number
  timezone: string
  lunchMoneyApiKey: string
  /** Seconds to hold API responses in memory. Their rate limit is aggressive. */
  cacheTtlSeconds: number
  allowance: AllowanceConfig
  /** Day of month the Card statement closes. */
  statementCloseDay: number
  /** Day of the following month the autopay debits. */
  statementDueDay: number
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer, got ${raw}`)
  return n
}

export const config: Config = {
  port: int("PORT", 3005),
  timezone: process.env.DISPLAY_TZ ?? "America/Los_Angeles",
  lunchMoneyApiKey: process.env.LUNCHMONEY_API_KEY ?? "",
  cacheTtlSeconds: int("CACHE_TTL_SECONDS", 60),
  allowance: {
    periodStart: process.env.PERIOD_START ?? "2026-08-01",
    dailyTarget: int("DAILY_TARGET", 200),
    rolloverCapDays: int("ROLLOVER_CAP_DAYS", 14),
  },
  statementCloseDay: int("STATEMENT_CLOSE_DAY", 12),
  statementDueDay: int("STATEMENT_DUE_DAY", 9),
}
