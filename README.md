# allowance

A shared daily spending allowance for Igor and Serena, computed live from the
[Lunch Money](https://lunchmoney.app) API.

One number: how much discretionary money is available today. Unspent money rolls
over up to a cap, overspend carries forward in full. Alongside it, the three
things that determine whether that number is affordable — cash on hand, the
credit card statement about to be debited, and the one quietly accruing behind it.

There is **no database**. Lunch Money is the store, so anything either of us
changes in their app shows up here, and vice versa.

## Running it

```sh
mise run setup
LUNCHMONEY_API_KEY=... mise run dev      # http://localhost:3005
```

| Task | Does |
|---|---|
| `mise run setup` | install deps, vendor htmx/idiomorph |
| `mise run dev` | dev server, hot reload |
| `mise run check` | biome lint + `tsc --noEmit` |
| `mise run check:fix` | auto-fix, then typecheck |
| `mise run test` | offline tests — never touches the live API |
| `mise run migrate:verify` | diff API v1 against v2 live (manual) |
| `mise run smoke` | print the live numbers as text |
| `mise run publish` | build + push the image (gated on check + test) |

## How the number is computed

Each day adds the target and subtracts what was spent. Banked money stops at
`ROLLOVER_CAP_DAYS × DAILY_TARGET` so a frugal stretch cannot fund one blowout;
overspend carries forward uncapped, because a floor would make the number
meaningless. The cap is applied day by day, not to the final balance.

**Inclusion is per-account, and this is the part to understand before changing
anything.** On Card — the discretionary card — an untagged transaction
counts, so a classification you have not gotten to yet makes the number
conservative rather than flattering. On Fidelity the same rule would be absurd:
rent and the card autopay leave from there. Fidelity is opt-in, and only an
explicit `spending` tag counts, which is how ATM withdrawals enter the number.

| Tag | Meaning | Counts? |
|---|---|---|
| `recurring` | autopay, subscriptions, memberships | no |
| `irregular` | memory care, vet emergencies, dental | no |
| `spending` | explicitly marked discretionary | yes |
| *(untagged)* | not yet reviewed | yes on Chase, no elsewhere |
| `igor` / `serena` | who spent it | no effect |

Tags are written straight back to Lunch Money, so they survive this app entirely.

## Configuration

| Variable | Default | |
|---|---|---|
| `LUNCHMONEY_API_KEY` | — | required |
| `DAILY_TARGET` | `200` | dollars per day |
| `PERIOD_START` | `2026-08-01` | start of the budgeting period |
| `ROLLOVER_CAP_DAYS` | `14` | days of target that can be banked |
| `STATEMENT_CLOSE_DAY` | `12` | Card statement close |
| `STATEMENT_DUE_DAY` | `9` | autopay debit, following month |
| `CACHE_TTL_SECONDS` | `300` | their rate limit is aggressive |
| `REFRESH_AFTER_MINUTES` | `30` | age at which the dashboard offers a refresh |
| `PORT` | `3005` | `3000` in the container |

Account policy lives in `ACCOUNT_POLICY` in `src/domain/policy.ts` rather than
in env, because adding an account is a decision that deserves a commit.

## Deployment

Runs in the `igor` stack on purr, behind authentik — the app has no login of its
own, and identity arrives as `X-authentik-username` from the forward-auth
outpost. Stateless, so there is no volume and nothing to back up.

```sh
mise run publish     # builds, pushes ghcr.io/igor47/allowance
```

Registry auth comes from `gh auth token` at push time, so there is no PAT to
manage and nothing stored in `~/.docker/config.json`. See
[`docs/deploy.md`](docs/deploy.md).

Then pin the new tag in `compose.stacks/hosts/igor/compose.yml` and:

```sh
mise run deploy      # streams the image to purr over ssh, reloads the container
```

purr cannot pull from ghcr — it holds no credentials and the package is
private — so `deploy` is the delivery path and `publish` is the backup.

## Reading the reconciliation line

The dashboard shows what Chase says is owed next to what it reconstructs from
transactions, and the gap between them. They will not agree, and that is fine:
Plaid dates a charge when it is authorised, Chase bills it when it posts, and
the last day or two has usually not synced. A gap that grows month over month is
worth investigating; a four-figure gap on any given day is not.
