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
| `mise run fixtures:record` | refresh test fixtures from the live API (manual) |
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
- **Never** run `mise run fixtures:record`, `mise run smoke`, or any other live
  API call from a test or from CI. The Lunch Money rate limit is undocumented
  and aggressive.

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

These are pure and fixture-tested. Keep API shapes, HTTP, and rendering out of
them; anything that reaches for `fetch` or `Date.now()` directly belongs in a
caller, and the current date is always an argument.

### The one rule that will bite you

Inclusion is **per-account**, not global. On Card, untagged means
discretionary and counts. On Fidelity, untagged means *fixed* — rent and the
card autopay live there — and only an explicit `spending` tag counts. Applying
the Chase rule globally overstates spend by an order of magnitude. See
`ACCOUNT_POLICY` in `src/domain/policy.ts`.

## Testing

Offline, always. Three layers:

1. Committed fixtures in `src/test/fixtures/`, recorded via
   `mise run fixtures:record`.
2. Pure-function tests over `src/domain/` — hand-built edge cases plus the real
   fixture. This is where the value is.
3. Route tests against a fake `LunchMoneyClient`, using `linkedom` for DOM
   assertions.
