# allowance — project guidelines

A shared daily spending allowance for Igor and Serena, computed live from the
Lunch Money API. Deployed to the `igor` stack behind authentik.

Design plan of record: [`docs/plans/0001-initial-plan.md`](docs/plans/0001-initial-plan.md).

## mise owns every recurring operation

**If you find yourself typing a command more than once, it becomes a mise task.**
No justfile, no loose shell scripts invoked by hand, no README-only incantations.
`mise.toml` is the single index of what you can do to this project, and the same
tasks run locally and anywhere else (including CI, if it ever exists).

| Task | Does |
|---|---|
| `mise run setup` | install deps, vendor htmx/idiomorph into `static/` |
| `mise run dev` | dev server, hot reload |
| `mise run check` | biome lint + `tsc --noEmit` |
| `mise run check:fix` | biome `--write`, then typecheck |
| `mise run test` | `bun test` — offline, never touches the live API |
| `mise run smoke` | one-shot live fetch + print, to eyeball real numbers (manual) |
| `mise run publish` | build + push the image; **depends on check + test** |

`publish` *depends on* `check` and `test` rather than being run after them, so an
unchecked image cannot reach the registry. That dependency is the release gate.

Scripts that back a task live in `scripts/` and are invoked *only* through the
task, never directly.

## Runtime

Default to Bun over Node.

- `bun <file>`, `bun test`, `bun install` — not node/jest/npm.
- Bun loads `.env` automatically; don't add dotenv.
- **Never** run `mise run smoke`, or any other live API call, from a test or
  from CI. The Lunch Money rate limit is undocumented and aggressive. Nothing
  under `src/` knows how to reach the network, so no test can.

## Framework

**Hono** + `hono/jsx-renderer` for SSR, **HTMX** + idiomorph for interactivity.
Bootstrap 5 dark theme via CDN. No client-side build step, no bundler.

- Routes in `src/routes/`, registered in `src/app.ts`.
- Full pages use `c.render()`; HTMX partials use `c.html()`.
- Components in `src/components/`, props typed with an exported interface.

## No database

Lunch Money is the store. There is no SQLite, no migrations, no volume, no
backup. State that outlives a request is limited to an in-memory cache in
`src/lunchmoney/cache.ts`. If a feature seems to need persistence, it probably
belongs in Lunch Money as a tag or a note — which also means Serena can edit it
from her phone.

## The domain rules live in one place

`src/domain/` holds pure functions of `(transactions, config, today)`:

- `policy.ts` — which transactions count against the allowance
- `allowance.ts` — the rolling balance and rollover cap
- `cycle.ts` — credit card statement cycle boundaries

These are pure. Keep API shapes, HTTP, and rendering out of them; anything that
reaches for `fetch` or `Date.now()` directly belongs in a caller, and the
current date is always an argument.

### The one rule that will bite you

Inclusion is **per-account**, not global. On Card, untagged means
discretionary and counts. On the bank accounts, untagged means *fixed* — rent
and the card autopay both leave from Checking — and only an explicit
`spending` tag counts. Applying the Chase rule globally overstates spend by an
order of magnitude. See `ACCOUNT_POLICY` in `src/domain/policy.ts`, whose values
say what an account *is* (`spending`, `fixed`, `ignore`), not which way its
default falls.

## Testing

Offline, always, and entirely synthetic. There is no recorded data anywhere in
this repository, and none should be added: a number pinned from a recording can
only ever report *the code changed*, never *the code is wrong*, because the code
produced it. See [`docs/plans/0002-scenario-testing.md`](docs/plans/0002-scenario-testing.md).

A test says what should be true given a **world** — the four things Lunch Money
would tell us, plus the day and the instant:

```ts
const world = aWorld({ today: "2026-08-14" })
  .account(CHASE, { balance: "1200.00" })
  .charge({ on: "2026-08-03", amount: 100, payee: "A Grocer" })
  .charge({ on: "2026-07-12", amount: 250, posted: "2026-07-13" })
  .autopay({ on: "2026-08-09", amount: 1000, from: IGOR_PERSONAL })

const page = await dashboard(world)
expect(page.hero).toBe("$2,700")
```

| File | Holds |
|---|---|
| `src/test/factories.ts` | the four API shapes, and `plaid_metadata` |
| `src/test/world.ts` | `World`, `aWorld()`, and the verbs — also as free functions for the domain tests |
| `src/test/page.ts` | page objects; **every selector in the suite lives here** |
| `src/test/app.ts` | a real Hono app over one world |
| `src/test/fake-client.ts` | an in-memory Lunch Money; writes are visible to reads |

Three rules that are easy to get wrong:

- **Positive is money leaving**, on every verb. `charge({amount: 25})` and
  `refund({amount: 40})` and `deposit({amount: 5000})` all take a positive
  number; the verb applies the sign. No test should type a minus sign.
- **Accounts are named by the constants in `policy.ts`**, and the verbs only
  accept those. A world that invents an account name would land in
  `UNKNOWN_ACCOUNT_POLICY` and pass for the wrong reason; this makes it a type
  error instead.
- **`today` and `now` come from the world**, never from a global or the wall
  clock, so a scenario cannot get its clock out of sync with its data.

Worlds are built in a **thunk**, not a constant, so each example gets a fresh
one and no test leaves a tag behind for the next. That is deliberately as far as
the lifecycle sugar goes — bun already has nested `describe`, `beforeEach` and
`test.each`, and a homegrown `let`/DI layer would be a test framework someone
has to learn.

Amounts are round. `$200/day` over fourteen days is `$2,800`, so the arithmetic
in an assertion can be done in your head.
