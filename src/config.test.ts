/**
 * The loader is checked for what it *rejects*, not for what it accepts.
 *
 * Config that fails to parse is a non-event: the process dies at boot with a
 * message. Config that parses and means something else is the expensive one —
 * a policy typo that silently reads as `fixed` takes a month of spending out of
 * the number and nothing anywhere says so. Every example below is a way that
 * could happen.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseConfig } from "./config"
import { statementAccounts } from "./domain/policy"

const parse = (toml: string) => parseConfig(Bun.TOML.parse(toml), "test.toml")

/** The smallest thing that is a valid config, for a test to spoil one field of. */
const MINIMAL = `
daily_target = 200
period_start = "2026-08-01"
rollover_cap_days = 14
history_start = "2025-01"

[accounts."Card"]
policy = "spending"
statement = { close_day = 12, due_day = 9 }
`

describe("a valid config", () => {
  test("reads the allowance, the accounts and the statement", () => {
    const config = parse(MINIMAL)
    expect(config.allowance).toEqual({
      periodStart: "2026-08-01",
      dailyTarget: 200,
      rolloverCapDays: 14,
    })
    expect(config.accounts.Card?.policy).toBe("spending")
    expect(statementAccounts(config.accounts)).toEqual([
      { name: "Card", statement: { closeDay: 12, dueDay: 9 } },
    ])
  })

  test("two cards, because a household of two usually carries one each", () => {
    // This was rejected until the summary boxes learned to sum across cards.
    const config = parse(`${MINIMAL}
[accounts."Other Card"]
policy = "spending"
statement = { close_day = 3, due_day = 28 }
`)
    expect(statementAccounts(config.accounts)).toEqual([
      { name: "Card", statement: { closeDay: 12, dueDay: 9 } },
      { name: "Other Card", statement: { closeDay: 3, dueDay: 28 } },
    ])
  })

  test("a household of one needs no people at all", () => {
    expect(parse(MINIMAL).people).toEqual([])
  })

  test("person tags are lowercased, because Lunch Money's are compared that way", () => {
    const config = parse(`${MINIMAL}\n[[people]]\ntag = "Alex"\nlabel = "Alex"\n`)
    expect(config.people).toEqual([{ tag: "alex", label: "Alex", short: "A" }])
  })

  test("a config with no card at all still parses — the allowance does not need one", () => {
    const config = parse(`
daily_target = 200
period_start = "2026-08-01"
rollover_cap_days = 14
history_start = "2025-01"

[accounts."Checking"]
policy = "fixed"
`)
    expect(statementAccounts(config.accounts)).toEqual([])
  })
})

describe("what it refuses", () => {
  test("a misspelled policy, rather than quietly treating it as fixed", () => {
    expect(() =>
      parse(`
daily_target = 200
period_start = "2026-08-01"
rollover_cap_days = 14
history_start = "2025-01"

[accounts."Card"]
policy = "spendng"
`)
    ).toThrow(/policy must be one of spending, fixed, ignore, got "spendng"/)
  })

  test("no accounts, because nothing would ever count", () => {
    expect(() =>
      parse(`
daily_target = 200
period_start = "2026-08-01"
rollover_cap_days = 14
history_start = "2025-01"

[accounts]
`)
    ).toThrow(/\[accounts\] is empty/)
  })

  test("a close day that is not a day of the month", () => {
    expect(() =>
      parse(`
daily_target = 200
period_start = "2026-08-01"
rollover_cap_days = 14
history_start = "2025-01"

[accounts."Card"]
policy = "spending"
statement = { close_day = 0, due_day = 9 }
`)
    ).toThrow(/close_day must be a day of the month/)
  })

  test("a period_start that is a month rather than a date", () => {
    expect(() => parse(MINIMAL.replace('"2026-08-01"', '"2026-08"'))).toThrow(
      /period_start must be YYYY-MM-DD/
    )
  })

  test("a history_start that is a date rather than a month", () => {
    expect(() => parse(MINIMAL.replace('"2025-01"', '"2025-01-01"'))).toThrow(
      /history_start must be YYYY-MM/
    )
  })

  test("a daily target given as a string, which TOML makes easy to do", () => {
    expect(() => parse(MINIMAL.replace("daily_target = 200", 'daily_target = "200"'))).toThrow(
      /daily_target must be a number/
    )
  })

  test("two people sharing a tag, which would make the button ambiguous", () => {
    expect(() =>
      parse(`${MINIMAL}
[[people]]
tag = "alex"
label = "Alex"

[[people]]
tag = "Alex"
label = "Alexandra"
`)
    ).toThrow(/two people share the tag "alex"/)
  })

  test("every message names the file, so a bad deployment says where to look", () => {
    expect(() => parse("daily_target = 200")).toThrow(/^test\.toml: /)
  })
})

describe("the shipped example", () => {
  // The example is the documentation. If it stops parsing, every new
  // installation's first step is a stack trace.
  test("parses, and describes the same accounts the suite uses", () => {
    const config = parseConfig(
      Bun.TOML.parse(readFileSync("allowance.example.toml", "utf8")),
      "allowance.example.toml"
    )
    expect(Object.keys(config.accounts).sort()).toEqual([
      "Card",
      "Checking",
      "Old Card",
      "Savings",
      "Wallet",
    ])
    expect(statementAccounts(config.accounts).map((c) => c.name)).toEqual(["Card"])
  })
})
