/**
 * Configuration: a TOML file for policy, the environment for plumbing.
 *
 * The split is the point. Which accounts exist, what an untagged row on each
 * one means and what the daily number is are *policy* — long-lived decisions
 * that want comments next to them, and one of which is a map of arbitrary size
 * that no environment variable can hold legibly. The API key, the port and the
 * cache timings are *plumbing*: they change per deployment, and they belong
 * where the rest of a container's environment lives. Nothing is settable in
 * both places, so there is never a question of which one won.
 *
 * Nothing here reads the file at import time. `loadConfig()` is called by the
 * entrypoints, which means a test can build a `Config` literal and never touch
 * the disk — see `TEST_CONFIG` in `src/test/world.ts`.
 */

import { readFileSync } from "node:fs"
import type {
  AccountConfig,
  AccountPolicy,
  Accounts,
  StatementConfig,
  TransferCategories,
} from "./domain/policy"

export interface AllowanceConfig {
  /** Start of the budgeting period. Declared, not derived. */
  periodStart: string
  /** Dollars per day. */
  dailyTarget: number
}

/** Someone a transaction can be attributed to. Orthogonal to the math. */
export interface Person {
  /** The tag written back to Lunch Money. */
  tag: string
  /** What the filter chip says. */
  label: string
  /**
   * What the per-row button says — there is room for about one character.
   * Defaults to the first letter of the label, which is only wrong for a
   * household whose names collide, so the config can override it.
   */
  short: string
}

export interface Config {
  port: number
  timezone: string
  lunchMoneyApiKey: string
  /**
   * Seconds to hold API responses in memory. Their rate limit is aggressive and
   * transactions only change when Plaid imports, so this can be generous —
   * tag writes patch the cache rather than waiting for it to expire.
   */
  cacheTtlSeconds: number
  /** Ask Lunch Money to pull from Plaid if it has not for this long. */
  refreshAfterMinutes: number
  /** The header a forward-auth proxy puts the username in. See `identity()`. */
  authUserHeader: string
  allowance: AllowanceConfig
  /**
   * How far back the month picker offers to go, as YYYY-MM. Declared because
   * the app has no way to ask Lunch Money when the data actually begins without
   * a wide query against a rate limit that does not welcome one.
   */
  historyStart: string
  accounts: Accounts
  people: Person[]
  /**
   * Which Lunch Money categories mean a movement rather than a spend. Together
   * with `accounts`, this is what makes `Config` satisfy the domain's `Policy`.
   */
  categories: TransferCategories
  /**
   * Things in the file that are not wrong enough to refuse but that the person
   * who wrote it should hear about — a key that no longer does anything. Shown
   * on the dashboard, as an unconfigured account is, because the log of a
   * container is somewhere nobody looks.
   */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Environment: plumbing only.

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer, got ${raw}`)
  return n
}

// ---------------------------------------------------------------------------
// The file: policy.
//
// Hand-rolled rather than schema'd, because the failure this must avoid is not
// "invalid config" but "config that parsed and means something else". A policy
// of "spendng" that silently became `fixed` would take a month off the number
// and nothing would say so, so every field is checked and every error names
// the file, the key and what was found.

const POLICIES: AccountPolicy[] = ["spending", "fixed", "ignore"]

/** Errors carry the path so a misconfigured deployment says where to look. */
class ConfigError extends Error {
  constructor(source: string, detail: string) {
    super(`${source}: ${detail}`)
  }
}

const isTable = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function str(source: string, table: Record<string, unknown>, key: string): string {
  const v = table[key]
  if (typeof v !== "string" || v === "") {
    throw new ConfigError(source, `${key} must be a non-empty string, got ${JSON.stringify(v)}`)
  }
  return v
}

function num(source: string, table: Record<string, unknown>, key: string): number {
  const v = table[key]
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ConfigError(source, `${key} must be a number, got ${JSON.stringify(v)}`)
  }
  return v
}

function dayOfMonth(source: string, table: Record<string, unknown>, key: string): number {
  const v = num(source, table, key)
  if (!Number.isInteger(v) || v < 1 || v > 31) {
    throw new ConfigError(source, `${key} must be a day of the month (1–31), got ${v}`)
  }
  return v
}

function statementOf(source: string, name: string, raw: unknown): StatementConfig | undefined {
  if (raw === undefined) return undefined
  if (!isTable(raw)) {
    throw new ConfigError(source, `accounts."${name}".statement must be a table`)
  }
  const dueDay = dayOfMonth(source, raw, "due_day")
  // Exactly one way of saying when it closes. Both would be two answers to one
  // question, and picking a winner is how a config comes to mean something
  // other than what it says.
  const fixed = "close_day" in raw
  const floating = "close_days_before_due" in raw
  if (fixed === floating) {
    throw new ConfigError(
      source,
      `accounts."${name}".statement needs exactly one of close_day and close_days_before_due`
    )
  }
  if (floating) {
    const days = num(source, raw, "close_days_before_due")
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      throw new ConfigError(
        source,
        `close_days_before_due must be a whole number of days from 1 to 60, got ${days}`
      )
    }
    return { closeDaysBeforeDue: days, dueDay }
  }
  return {
    closeDay: dayOfMonth(source, raw, "close_day"),
    dueDay,
  }
}

function accountsOf(source: string, raw: unknown): Accounts {
  if (!isTable(raw)) throw new ConfigError(source, "[accounts] is missing or is not a table")
  const accounts: Record<string, AccountConfig> = {}

  for (const [name, value] of Object.entries(raw)) {
    if (!isTable(value)) {
      throw new ConfigError(source, `accounts."${name}" must be a table`)
    }
    const policy = str(source, value, "policy")
    if (!(POLICIES as string[]).includes(policy)) {
      throw new ConfigError(
        source,
        `accounts."${name}".policy must be one of ${POLICIES.join(", ")}, got "${policy}"`
      )
    }
    // Any number of accounts may carry a statement: a household of two usually
    // has a card each rather than sharing one. This used to reject the second,
    // because the summary boxes would otherwise have been about whichever the
    // object happened to enumerate first — a limitation of three fixed boxes,
    // enforced here for want of anywhere better. The boxes now sum across
    // cards and the reconciliation is reported per card, so nothing has to
    // choose and the guard is gone.
    const statement = statementOf(source, name, value.statement)
    const settled = policy as AccountPolicy
    accounts[name] = statement ? { policy: settled, statement } : { policy: settled }
  }

  if (Object.keys(accounts).length === 0) {
    throw new ConfigError(source, "[accounts] is empty; nothing would ever count")
  }
  return accounts
}

function peopleOf(source: string, raw: unknown): Person[] {
  // Absent is legitimate: a household of one wants no attribution buttons.
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new ConfigError(source, "[[people]] must be an array of tables")

  const people: Person[] = []
  for (const entry of raw) {
    if (!isTable(entry)) throw new ConfigError(source, "each [[people]] entry must be a table")
    const tag = str(source, entry, "tag").toLowerCase()
    if (people.some((p) => p.tag === tag)) {
      throw new ConfigError(source, `two people share the tag "${tag}"`)
    }
    const label = str(source, entry, "label")
    const short = entry.short === undefined ? label.slice(0, 1) : str(source, entry, "short")
    people.push({ tag, label, short: short.toUpperCase() })
  }
  return people
}

function names(source: string, raw: unknown, key: string): string[] {
  // Absent is legitimate and common: a household with no brokerage needs no
  // internal-sweep category, and the app simply never classifies one.
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || v === "")) {
    throw new ConfigError(source, `categories.${key} must be a list of category names`)
  }
  return raw as string[]
}

function categoriesOf(source: string, raw: unknown): TransferCategories {
  // No [categories] at all means nothing is ever recognised as a movement by
  // category. Legitimate — matched pairs still work — but it is worth being an
  // explicit empty shape rather than a special case downstream.
  if (raw === undefined) {
    return { cardPayment: [], internalTransfer: [], suggestsTransfer: [] }
  }
  if (!isTable(raw)) throw new ConfigError(source, "[categories] is not a table")
  return {
    cardPayment: names(source, raw.card_payment, "card_payment"),
    internalTransfer: names(source, raw.internal_transfer, "internal_transfer"),
    suggestsTransfer: names(source, raw.suggests_transfer, "suggests_transfer"),
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Parse an already-read TOML document. Exported so tests can check the errors. */
export function parseConfig(raw: unknown, source: string): Omit<Config, keyof EnvConfig> {
  if (!isTable(raw)) throw new ConfigError(source, "not a TOML table")

  const periodStart = str(source, raw, "period_start")
  if (!DATE.test(periodStart)) {
    throw new ConfigError(source, `period_start must be YYYY-MM-DD, got "${periodStart}"`)
  }
  const historyStart = str(source, raw, "history_start")
  if (!MONTH.test(historyStart)) {
    throw new ConfigError(source, `history_start must be YYYY-MM, got "${historyStart}"`)
  }

  // Said rather than ignored: a file that still sets a cap belongs to someone
  // who believes they have one. Not refused, because an upgrade should not take
  // the app down over a line that has merely stopped mattering.
  const warnings: string[] = []
  if ("rollover_cap_days" in raw) {
    warnings.push(
      "rollover_cap_days no longer does anything — the balance banks all month and resets on the 1st. Remove it from allowance.toml."
    )
  }

  return {
    allowance: {
      periodStart,
      dailyTarget: num(source, raw, "daily_target"),
    },
    historyStart,
    accounts: accountsOf(source, raw.accounts),
    people: peopleOf(source, raw.people),
    categories: categoriesOf(source, raw.categories),
    warnings,
  }
}

/** The half of `Config` that comes from the environment. */
type EnvConfig = Pick<
  Config,
  | "port"
  | "timezone"
  | "lunchMoneyApiKey"
  | "cacheTtlSeconds"
  | "refreshAfterMinutes"
  | "authUserHeader"
>

function envConfig(): EnvConfig {
  return {
    port: int("PORT", 3005),
    timezone: process.env.DISPLAY_TZ ?? "America/Los_Angeles",
    lunchMoneyApiKey: process.env.LUNCHMONEY_API_KEY ?? "",
    cacheTtlSeconds: int("CACHE_TTL_SECONDS", 300),
    refreshAfterMinutes: int("REFRESH_AFTER_MINUTES", 30),
    authUserHeader: process.env.AUTH_USER_HEADER ?? "X-authentik-username",
  }
}

export const DEFAULT_CONFIG_PATH = "./allowance.toml"

/**
 * Read the config file and the environment. Called once, at boot.
 *
 * Synchronous on purpose: this runs before the server exists, and making it
 * async would colour every caller for no benefit.
 */
export function loadConfig(path = process.env.ALLOWANCE_CONFIG ?? DEFAULT_CONFIG_PATH): Config {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (cause) {
    throw new Error(
      `cannot read config at ${path} — copy allowance.example.toml to allowance.toml, ` +
        `or set ALLOWANCE_CONFIG`,
      { cause }
    )
  }

  let document: unknown
  try {
    document = Bun.TOML.parse(text)
  } catch (cause) {
    throw new Error(`${path}: not valid TOML`, { cause })
  }

  return { ...envConfig(), ...parseConfig(document, path) }
}
