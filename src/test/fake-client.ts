import type { LmPlaidAccount, LmTag, LmTransaction, LunchMoneyClient } from "../lunchmoney/types"
import { fixtureAccounts, fixtureTransactions } from "./fixtures"

/** An in-memory Lunch Money. Writes are visible to subsequent reads. */
export class FakeLunchMoneyClient implements LunchMoneyClient {
  readonly writes: { transactionId: number; tags: string[] }[] = []
  private readonly store: LmTransaction[]
  private readonly accounts: LmPlaidAccount[]

  constructor(transactions: LmTransaction[] = fixtureTransactions, accounts = fixtureAccounts) {
    this.store = transactions.map((t) => ({ ...t, tags: [...t.tags] }))
    this.accounts = accounts
  }

  async transactions(start: string, end: string): Promise<LmTransaction[]> {
    return this.store.filter((t) => t.date >= start && t.date <= end)
  }

  async plaidAccounts(): Promise<LmPlaidAccount[]> {
    return this.accounts
  }

  async tags(): Promise<LmTag[]> {
    const names = new Set(this.store.flatMap((t) => t.tags.map((tag) => tag.name)))
    return [...names].map((name, i) => ({ id: i + 1, name, description: null, archived: false }))
  }

  async setTags(transactionId: number, tags: string[]): Promise<void> {
    const target = this.store.find((t) => t.id === transactionId)
    if (!target) throw new Error(`no such transaction: ${transactionId}`)
    target.tags = tags.map((name, i) => ({ id: i + 1, name, description: null, archived: false }))
    this.writes.push({ transactionId, tags })
  }
}
