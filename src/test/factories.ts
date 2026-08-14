import type { LmTag, LmTransaction } from "../lunchmoney/types"

let nextId = 1

export function tag(name: string): LmTag {
  return { id: nextId++, name, description: null, archived: false }
}

/** Tags may be given as plain strings; the factory promotes them. */
export type TxnOverrides = Partial<Omit<LmTransaction, "tags">> & { tags?: (string | LmTag)[] }

export function txn(overrides: TxnOverrides = {}): LmTransaction {
  const tags = (overrides.tags ?? []).map((t) => (typeof t === "string" ? tag(t) : t))
  return {
    id: nextId++,
    date: "2026-08-05",
    amount: "25.00",
    currency: "usd",
    payee: "Andronico's",
    original_name: "ANDRONICOS 1234",
    category_name: "Groceries",
    notes: null,
    is_income: false,
    exclude_from_totals: false,
    is_pending: false,
    status: "cleared",
    account_display_name: "Card",
    plaid_account_display_name: "Card",
    asset_display_name: null,
    institution_name: "Chase",
    ...overrides,
    tags,
  }
}
