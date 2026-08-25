# allowance — project guidelines

A shared daily spending allowance for Igor and Serena, computed live from the
Lunch Money API. Deployed to the `igor` stack behind authentik.

Design plan of record: [`docs/plans/0001-initial-plan.md`](docs/plans/0001-initial-plan.md).

## How to work in this repo

**Commit as you go.** One logical change per commit, with `mise run check` and
`mise run test` green before each one. Do not accumulate a session's worth of
work into a single uncommitted diff and hand it over at the end — it is
unreviewable, it cannot be bisected, and the reasoning that produced each step
is gone by the time it lands. A change that is finished and passing is a change
that should be committed, even if the next one is about to start.

**Live API calls are manual, one-shot and read-only.** Never from a test, never
from CI, never in a loop — see Runtime below. Reaching for real data to settle a
question is right; reaching for it repeatedly is how the rate limit bites.

**When the data contradicts a comment, the comment is part of the bug.** Several
of the doc comments in `src/domain/` state facts about the real feed ("every row
on that account is named after a person"). Those are load-bearing — the next
person will trust them — so when one turns out to be false, correct it in the
same commit as the code, and say what the counterexample was.

## mise owns every recurring operation

**If you find yourself typing a command more than once, it becomes a mise task.**
No justfile, no loose shell scripts invoked by hand, no README-only incantations.
`mise.toml` is the single index of what you can do to this project, and the same
tasks run locally and anywhere else (including CI, if it ever exists).

| Task | Does |
|---|---|
| `mise run setup` | install deps, vendor htmx/idiomorph into `static/` |
| `mise run dev` | dev server, hot reload — talks to the **live** API |
| `mise run preview` | dev server over a synthetic world, for looking at the UI offline |
| `mise run check` | biome lint + `tsc --noEmit` |
| `mise run check:fix` | biome `--write`, then typecheck |
| `mise run test` | `bun test` — offline, never touches the live API |
| `mise run smoke` | one-shot live fetch + print, to eyeball real numbers (manual) |
| `mise run migrate:verify` | diff API v1 against v2 over one window, live (manual) |
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

## The API is v2, and the client is a hydration layer

`src/lunchmoney/client.ts` is the only file that knows what Lunch Money sends,
and `v2.ts` holds the wire shapes. Everything downstream speaks `LmTransaction`
and friends from `types.ts` — the app's own shapes, which did not change when
the API did, which is why the domain and its tests were untouched by the
migration.

v2 **de-hydrates** the transaction. Category name, `is_income`,
`exclude_from_totals`, the account display name and the tags are all gone from
it, replaced by ids; the client fetches `/categories`, `/tags`,
`/plaid_accounts` and `/manual_accounts` once, holds them for fifteen minutes,
and joins them back. `plaidAccounts()` deliberately does *not* use that cache —
the freshness clock and the cash figures are built from it.

Three things that will catch you out:

- **`include_pending=true` is required.** v2 excludes pending transactions by
  default and v1 did not. They are money that has left, so they count the day
  they appear; without the flag every current month quietly understates.
- **`include_metadata=true` is required** for `plaid_metadata`, which carries
  the posted date the statement cycles bucket on. v2 sends it as an object
  where v1 sent a JSON string.
- **`cadence` no longer exists.** See below.

The v2 API is documented as open alpha and still subject to change, so `v2.ts`
is the blast radius on purpose.

### The cadence trap

v1 sent a free-text `cadence` ("twice a month"), and `budget.ts` led on it
because `granularity`+`quantity` reports twice-monthly as (month, 1) — identical
to plain monthly. v2 removed the string and added
`matches.expected_occurrence_dates`, which is better: the dates are computed
rather than pattern-matched.

`perMonth()` therefore takes the larger of the amortised rate and the observed
count, but only for items firing at least monthly — a yearly bill stays at a
twelfth every month rather than landing in full in one of them.

**A count of occurrences is meaningless without the window it was counted in.**
Ask for three weeks of a month and a twice-monthly item reports one date,
indistinguishable from monthly, which halves a fortnightly salary. `perMonth()`
refuses a partial range and falls back to amortising, which is wrong small
rather than wrong invisibly. `LmRecurringItem.expected_range` is what it checks.

The same dates give the budget page a second, genuinely different figure:
`totals.committed` is the steady monthly rate and `totals.committedThisPeriod`
is what actually lands in the month on screen. The headline daily target is
built from the amortised one on purpose — an allowance should not lurch because
an annual bill happens to fall this month — and the actual figure is shown
beside it only when the month is materially heavier or lighter.

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

`card.ts` also holds `reconcile()`, which checks the reconstruction against the
autopay Chase actually debited — the one figure in the data that did not come
from us. See its doc comment for why that is a real oracle and not a tautology.

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

### Transfers are matched, not recognised

Money moving between two accounts we own is caught by `findTransfers()`, which
asks a structural question — is there an equal and opposite amount in another
account within three days? — rather than asking whether a payee looks like a
transfer. That subsumes the card autopay, the Venmo cashout and a plain
bank-to-bank move under one rule that names no bank, which is most of what made
`policy.ts` unshippable to anyone else.

**Classification therefore goes through `classifyAll()`, not `classify()`.**
Whether a row is a transfer is a property of the *set*; `classify()` still takes
one transaction so the domain tests can, and silently loses only this rule.

Three things it deliberately will not do:

- **A match must be unambiguous in both directions.** A leg with two possible
  partners matches neither. Ambiguity falls back to asking a human rather than
  to ignoring money.
- **Amounts must agree to the cent**, so a transfer that charges a fee — Venmo's
  instant option takes ~1.75% — falls through to the payee rules and counts.
  Wrong small rather than wrong invisibly, as with `perMonth()`.
- **Structure alone is not enough.** A $300 restaurant charge and a $300 cheque
  three days later meet every arithmetic condition and are two separate things,
  so one leg must also read as a transfer to `looksLikeTransfer()`. That
  function may never drop a row on its own — a real charge a month lands in
  "Payment, Transfer" — but the same category *on a row that also has an equal
  and opposite partner elsewhere* is a much stronger claim.

Matching cannot catch a movement whose far side is not in Lunch Money, and the
answer to that is **the `transfer` tag**, not a cleverer pattern. There used to
be a `^venmo$` rule that ignored every bank row paid to Venmo; it was deleted
because those rows are ambiguous in a way no pattern can resolve. `Checking
→ Wallet` is a transfer — the wallet is tracked, so the spend lands there
and counting the bank row too would double it. `Savings → Serena's Venmo`
is a spend — that wallet is not in Lunch Money, so the bank row is the only
record there will ever be. Identical payee, identical category, opposite
meaning. They go to review, and a human says which.

Structural verdicts — untracked account, zero amount, matched pair — sit *above*
the tag block and beat it, because they are facts rather than readings. The
exception is `spending`, the only tag that can put money back into the count and
the escape hatch reimbursements depend on. Everything below the tag block is a
guess about a payee, and a tag still wins there.

### `transfer` and `ignored` are different, and the difference is reachability

Everything in `transfer` got there by inference — a matched pair, a payee that
reads as an autopay, a Fidelity core sweep — so **every row in it stays
taggable**. An inferred verdict that cannot be corrected from the list is a
one-way door: before the split, a wrongly-ignored row could only be fixed in
Lunch Money's own app, which is exactly the trap the pairing rule made more
likely by making a wrong ignore possible at all.

`ignored` is now only the two cases no tag could change: an account we do not
track (checked before the tags, so a button there would do nothing) and a
zero-amount row. It is the one bucket that renders no buttons, and now that is
a statement rather than an accident.

Transfers are excluded from `needsReview()`, from `summarise()` — summing both
legs would double the money — and from the deposits filter, where a cashout
landing or an autopay's card credit would otherwise read as money coming back.

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
