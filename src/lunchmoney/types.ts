/** The subset of the Lunch Money API we actually use. */

export interface LmTag {
  id: number
  name: string
  description: string | null
  archived: boolean
}

export interface LmTransaction {
  id: number
  /** YYYY-MM-DD */
  date: string
  /** Stringified decimal. Positive is an outflow. */
  amount: string
  currency: string
  payee: string | null
  original_name: string | null
  category_name: string | null
  notes: string | null
  is_income: boolean
  exclude_from_totals: boolean
  is_pending: boolean
  status: string
  /** Display name of the owning account, e.g. "Card". */
  account_display_name: string | null
  plaid_account_display_name: string | null
  asset_display_name: string | null
  institution_name: string | null
  tags: LmTag[]
}

export interface LmPlaidAccount {
  id: number
  name: string
  display_name: string | null
  type: string
  subtype: string | null
  mask: string
  institution_name: string
  status: string
  limit: number | null
  balance: string
  to_base: number
  currency: string
  balance_last_update: string
}

export interface LunchMoneyClient {
  transactions(start: string, end: string): Promise<LmTransaction[]>
  plaidAccounts(): Promise<LmPlaidAccount[]>
  tags(): Promise<LmTag[]>
  setTags(transactionId: number, tags: string[]): Promise<void>
}

/** Account display name, resolved consistently across plaid and manual assets. */
export function accountNameOf(txn: LmTransaction): string {
  return (
    txn.account_display_name ??
    txn.plaid_account_display_name ??
    txn.asset_display_name ??
    "(unknown account)"
  )
}
