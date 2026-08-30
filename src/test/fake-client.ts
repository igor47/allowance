import type {
  LmAccount,
  LmRecurringItem,
  LmTag,
  LmTransaction,
  LunchMoneyClient,
} from "../lunchmoney/types"
import type { World } from "./world"

/**
 * An in-memory Lunch Money, serving one world. Writes are visible to
 * subsequent reads, so tag round-trips work as they do against the real API.
 *
 * There is deliberately no default world: `new FakeLunchMoneyClient()` used to
 * mean "820 real transactions", which made every test that forgot an argument
 * quietly assert against a recording.
 */
export class FakeLunchMoneyClient implements LunchMoneyClient {
  readonly writes: { transactionId: number; tags: string[] }[] = []
  private readonly store: LmTransaction[]
  private readonly balances: LmAccount[]
  private readonly recurring: LmRecurringItem[]

  constructor(world: World) {
    this.store = world.transactions.map((t) => ({ ...t, tags: [...t.tags] }))
    this.balances = world.accounts
    this.recurring = world.recurring
  }

  reads = 0

  async transactions(start: string, end: string): Promise<LmTransaction[]> {
    this.reads += 1
    return this.store.filter((t) => t.date >= start && t.date <= end)
  }

  async recurringItems(_start: string, _end: string): Promise<LmRecurringItem[]> {
    this.reads += 1
    // The range is not re-applied: a recurring item spans periods rather than
    // falling inside one, and the API answers "what is planned" either way.
    return this.recurring
  }

  async accounts(): Promise<LmAccount[]> {
    return this.balances
  }

  async tags(): Promise<LmTag[]> {
    const names = new Set(this.store.flatMap((t) => t.tags.map((tag) => tag.name)))
    return [...names].map((name, i) => ({ id: i + 1, name, description: null, archived: false }))
  }

  fetches = 0

  async triggerFetch(): Promise<void> {
    this.fetches += 1
  }

  async setTags(transactionId: number, tags: string[]): Promise<void> {
    const target = this.store.find((t) => t.id === transactionId)
    if (!target) throw new Error(`no such transaction: ${transactionId}`)
    target.tags = tags.map((name, i) => ({ id: i + 1, name, description: null, archived: false }))
    this.writes.push({ transactionId, tags })
  }
}
