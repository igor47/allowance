/**
 * Everything Plaid knows about a transaction that Lunch Money does not surface
 * as a first-class field. It arrives as a JSON string in `plaid_metadata`.
 *
 * The important one is the posted date. Lunch Money's `date` is Plaid's
 * *authorized* date — when the card was swiped — while the issuer bills on the date
 * the charge *posts*, usually one or two days later. Using the posted date for
 * statement cycles reconciles them exactly.
 */

import type { LmTransaction } from "./types"

export interface TransactionDetails {
  /** When the bank posted it. Falls back to the Lunch Money date. */
  posted: string
  /** When the card was actually used. */
  authorized: string | null
  /** The descriptor as it appears on the statement. */
  raw: string | null
  merchant: string | null
  /** Merchant category code — the four-digit code the card network assigns. */
  mcc: string | null
  /** "in store", "online", "other". */
  channel: string | null
  place: string | null
  website: string | null
  logo: string | null
  /** Plaid's own taxonomy, distinct from the Lunch Money category. */
  plaidCategory: string | null
}

interface RawMetadata {
  date?: string
  authorized_date?: string
  name?: string
  merchant_name?: string
  merchant_category_code?: string
  payment_channel?: string
  website?: string
  logo_url?: string
  location?: { city?: string | null; region?: string | null; address?: string | null }
  personal_finance_category?: { detailed?: string }
  counterparties?: { logo_url?: string | null; website?: string | null }[]
}

function parseMetadata(txn: LmTransaction): RawMetadata {
  if (!txn.plaid_metadata) return {}
  try {
    return JSON.parse(txn.plaid_metadata) as RawMetadata
  } catch {
    return {}
  }
}

/** Plaid's category constants read like SHOUTING_SNAKE; soften them. */
function humanise(value: string | undefined): string | null {
  if (!value) return null
  return value.toLowerCase().replace(/_/g, " ")
}

function placeOf(location: RawMetadata["location"]): string | null {
  if (!location) return null
  const city = [location.city, location.region].filter(Boolean).join(", ")
  return city || location.address || null
}

export function detailsOf(txn: LmTransaction): TransactionDetails {
  const md = parseMetadata(txn)
  const counterparty = md.counterparties?.[0]
  return {
    posted: md.date ?? txn.date,
    authorized: md.authorized_date ?? null,
    raw: md.name ?? txn.original_name,
    merchant: md.merchant_name ?? null,
    mcc: md.merchant_category_code ?? null,
    channel: md.payment_channel ?? null,
    place: placeOf(md.location),
    website: md.website ?? counterparty?.website ?? null,
    logo: md.logo_url ?? counterparty?.logo_url ?? null,
    plaidCategory: humanise(md.personal_finance_category?.detailed),
  }
}

/**
 * The date the issuer bills on. Statement cycles use this; the daily allowance does
 * not — money is spent the day you spend it, not the day the bank agrees.
 */
export function postedDate(txn: LmTransaction): string {
  return detailsOf(txn).posted
}
