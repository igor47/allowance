# allowance

A shared daily spending allowance, computed live from the
[Lunch Money](https://lunchmoney.app) API.

One number: how much discretionary money is available today. Unspent money rolls
over up to a cap, overspend carries forward in full. Alongside it, the three
things that determine whether that number is affordable — cash on hand, the
credit card statement about to be debited, and the one quietly accruing behind
it.

There is **no database**. Lunch Money is the store, so anything anyone in the
household changes in their app shows up here, and vice versa.

---

## What you need

- A **Lunch Money** account with your accounts linked, ideally through Plaid.
  The app reads `/transactions`, `/plaid_accounts`, `/manual_accounts`,
  `/categories`, `/tags` and `/recurring_items`, and writes tags.
- An **API key**, from Lunch Money's Developers settings. It needs write access:
  the whole review workflow is tagging transactions, and the tags go back to
  Lunch Money rather than into a local store.
- **Bun** 1.3 or later, or Docker.

The API key is the only secret, and it grants full access to the account. Treat
it accordingly — and use a separate key for a deployment, so revoking one does
not lock you out of the other.

## Setting up the Lunch Money side

Very little, but the little there is matters.

**Name your accounts, then name them the same way in `allowance.toml`.** The
whole policy keys on Lunch Money's *display name* for an account, matched
exactly. Get one wrong and the account is treated as unknown: it will not count,
and the dashboard will say so under "unknown accounts" rather than silently
dropping the money.

**Exclude "Credit card payment" from budget and totals.** Lunch Money ships this
category; left in the budget it double-counts, because the charges it settles
were already counted on the card. In Lunch Money: Categories → Credit card
payment → exclude from budget and from totals.

**Set up the rules the `[categories]` config names.** This is the one piece of
real setup, and it is where the app deliberately leans on Lunch Money rather
than guessing from payees. Two rules:

| Match | Category | Why |
|---|---|---|
| payee contains `AUTOMATIC PAYMENT` (or whatever your issuer writes) | `Credit card payment` | Lunch Money files most autopays here already, but the occasional one arrives as "Income" — and read alone, that is a large refund crediting your allowance |
| the payee your brokerage uses for core-account sweeps | `Internal sweep` (create it) | A brokerage cash account sweeps money in and out of a money-market position on every movement, so each real transaction arrives paired with a bookkeeping row. Both halves look identical to a genuine deposit; only a rule separates them |

Rules have no API in either v1 or v2, so they have to be made in Lunch Money's
own app. That is the point: they live where the data lives, they are visible,
and you can edit them from your phone — which a regex compiled into this app
never was.

Without them nothing breaks loudly. Transfers with both legs in the data are
still matched structurally, by equal-and-opposite amount within three days;
what you lose is the single-legged case, which lands in review for you to tag
by hand.

**You do not need to create the tags.** `recurring`, `irregular`, `spending`,
`transfer` and the person tags are created on first use.

**Recurring items are worth filling in.** The budget page reads
`/recurring_items` and its `expected_occurrence_dates`; without them the
committed-cost figures are empty. That is Lunch Money's own recurring-expense
feature, and it has no API — it has to be done in their app.

## Running it

```sh
cp allowance.example.toml allowance.toml   # then edit it
mise run setup
LUNCHMONEY_API_KEY=... mise run dev        # http://localhost:3005
```

To look at the UI without spending the rate limit — or without an account at
all — `mise run preview` serves the same app over a synthetic world, offline,
with tagging that persists for the life of the process.

## Configuration

Split in two, and nothing is settable in both places.

**Policy** lives in `allowance.toml`: which accounts exist, what an untagged row
on each one means, who the people are, the daily number. These are long-lived
decisions that want a comment next to them, and the accounts table is a map of
arbitrary size. See [`allowance.example.toml`](allowance.example.toml), which is
commented at length and is the real documentation for this section. Point
`ALLOWANCE_CONFIG` elsewhere if you like; the default is `./allowance.toml`.

**Plumbing** comes from the environment:

| Variable | Default | |
|---|---|---|
| `LUNCHMONEY_API_KEY` | — | required |
| `ALLOWANCE_CONFIG` | `./allowance.toml` | path to the config file |
| `PORT` | `3005` | `3000` in the container |
| `DISPLAY_TZ` | `America/Los_Angeles` | what "today" means |
| `CACHE_TTL_SECONDS` | `300` | their rate limit is aggressive |
| `REFRESH_AFTER_MINUTES` | `30` | age at which the dashboard offers a refresh |
| `AUTH_USER_HEADER` | `X-authentik-username` | where the username comes from |

## How the number is computed

Each day adds the target and subtracts what was spent. Banked money stops at
`rollover_cap_days × daily_target` so a frugal stretch cannot fund one blowout;
overspend carries forward uncapped, because a floor would make the number
meaningless. The cap is applied day by day, not to the final balance.

**Inclusion is per-account, and this is the part to understand before changing
anything.** On an account marked `spending` — the discretionary card — an
untagged transaction counts, so a classification you have not gotten to yet
makes the number conservative rather than flattering. On a bank account the same
rule would be absurd: rent and the card autopay leave from there. Those are
marked `fixed`, where only an explicit `spending` tag counts, which is how ATM
withdrawals enter the number.

| Tag | Meaning | Counts? |
|---|---|---|
| `recurring` | autopay, subscriptions, memberships | no |
| `irregular` | care costs, vet emergencies, dental | no |
| `transfer` | money moved somewhere else you own | no |
| `spending` | explicitly marked discretionary | yes |
| *(untagged)* | not yet reviewed | yes on `spending` accounts, no elsewhere |
| person tags | who spent it | no effect |

Tags are written straight back to Lunch Money, so they survive this app
entirely.

Money moved between two accounts you own is never spending, and is usually
detected rather than tagged: two rows equal, opposite, in different accounts and
within three days are one movement, and both halves drop out. That covers the
card autopay, a wallet cashout and a bank-to-bank move without naming any of
them. When the far side is not in Lunch Money there is nothing to match against
and no pattern can help — money leaving for a wallet you track and one you don't
look identical — so those land in review and you tag them `transfer` yourself.

## Reading the reconciliation line

The dashboard shows what the card issuer says is owed next to what the app
reconstructs from transactions, and the gap between them. They will not agree,
and that is fine: Plaid dates a charge when it is authorised, the issuer bills it
when it posts, and the last day or two has usually not synced. A gap that grows
month over month is worth investigating; a four-figure gap on any given day is
not.

## Deploying

The image is built by CI and published to
`ghcr.io/igor47/allowance`. It is stateless — Lunch Money is the store, so there
is no volume and nothing to back up.

```sh
docker run -p 3000:3000 \
  -e LUNCHMONEY_API_KEY=... \
  -v /path/to/allowance.toml:/app/allowance.toml:ro \
  ghcr.io/igor47/allowance:latest
```

Pin a version tag rather than `:latest`: a bad release should require a
deliberate redeploy, not a restart.

**The app has no login of its own.** It expects to sit behind a forward-auth
proxy that authenticates the request and injects the username as a header —
`X-authentik-username` by default. That is only safe if the proxy *strips* that
header from inbound requests; exposing the app directly means anyone can claim
to be anyone. With traefik, `underscoreHeadersStrategy: delete` on the https
entrypoint is what does it.

## Working on it

Every recurring operation is a `mise` task; there is no justfile and no loose
scripts.

| Task | Does |
|---|---|
| `mise run setup` | install deps, vendor htmx/idiomorph |
| `mise run dev` | dev server, hot reload — talks to the **live** API |
| `mise run preview` | dev server over a synthetic world, offline |
| `mise run check` | biome lint + `tsc --noEmit` |
| `mise run check:fix` | auto-fix, then typecheck |
| `mise run test` | offline tests — never touches the live API |
| `mise run image` | build the container image locally |
| `mise run smoke` | print the live numbers as text (manual) |

Tests are offline and entirely synthetic — there is no recorded data in this
repository, and none should be added. A scenario is a *world*, not a transaction
list:

```ts
const world = aWorld({ today: "2026-08-14" })
  .account(CARD, { balance: "1200.00" })
  .charge({ on: "2026-08-03", amount: 100, payee: "A Grocer" })
  .autopay({ on: "2026-08-09", amount: 1000, from: CHECKING })

const page = await dashboard(world)
expect(page.hero).toBe("$2,700")
```

See [`CLAUDE.md`](CLAUDE.md) for the design rules that are easy to get wrong —
per-account inclusion, the transfer-matching rules, and why `perMonth()` refuses
a partial window.

## Licence

MIT. See [LICENSE](LICENSE).
