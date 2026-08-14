import type { LmPlaidAccount, LmTag, LmTransaction, LunchMoneyClient } from "./types"

const BASE = "https://api.lunchmoney.dev/v1/"
const PAGE_SIZE = 500

export class LunchMoneyError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "LunchMoneyError"
  }
}

export interface HttpClientOptions {
  apiKey: string
  /** Retries on 429. Their rate limit is undocumented and unforgiving. */
  maxRetries?: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class HttpLunchMoneyClient implements LunchMoneyClient {
  private readonly apiKey: string
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: HttpClientOptions) {
    if (!options.apiKey) throw new Error("LUNCHMONEY_API_KEY is not set")
    this.apiKey = options.apiKey
    this.maxRetries = options.maxRetries ?? 6
    this.sleep = options.sleep ?? defaultSleep
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let delay = 5_000
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(BASE + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      })
      if (response.status === 429 && attempt < this.maxRetries) {
        const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10)
        await this.sleep(Number.isNaN(retryAfter) ? delay : retryAfter * 1000)
        delay = Math.min(delay * 2, 120_000)
        continue
      }
      if (!response.ok) {
        throw new LunchMoneyError(
          `${init?.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`,
          response.status
        )
      }
      return (await response.json()) as T
    }
  }

  async transactions(start: string, end: string): Promise<LmTransaction[]> {
    const out: LmTransaction[] = []
    for (let offset = 0; ; ) {
      const query = new URLSearchParams({
        start_date: start,
        end_date: end,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      const page = await this.request<{ transactions: LmTransaction[]; has_more?: boolean }>(
        `transactions?${query}`
      )
      out.push(...page.transactions)
      if (!page.has_more || page.transactions.length === 0) return out
      offset += page.transactions.length
    }
  }

  async plaidAccounts(): Promise<LmPlaidAccount[]> {
    const body = await this.request<{ plaid_accounts: LmPlaidAccount[] }>("plaid_accounts")
    return body.plaid_accounts
  }

  async tags(): Promise<LmTag[]> {
    return await this.request<LmTag[]>("tags")
  }

  async setTags(transactionId: number, tags: string[]): Promise<void> {
    await this.request(`transactions/${transactionId}`, {
      method: "PUT",
      body: JSON.stringify({ transaction: { tags } }),
    })
  }
}
