# Proposal

## Why

The tests that need a database, the functions and a browser run against whatever local stack happens to be up — usually a dev stack whose database was made once and never brought to the schema since — and in CI they never run at all, because `npm test` runs before any stack exists and every one of them skips itself. A guarantee proven that way proves nothing: the access and billing tests passed on a database months behind its files until it was reset by hand.

## What Changes

- **One command runs every end-to-end test in a test environment of its own**: `platformkit test --e2e` (`npm run test:e2e` at the workspace root). It never touches a dev stack, a dev port or a dev database.
- **Every selected site gets its own isolated stack**, as the dev workspace gives each site one: its own Supabase project in Docker, its own ports, its own volumes, its own functions, its own mail catcher. Several sites run side by side in one environment, and a test for one site can never reach another's.
- **Each stack is built from scratch on every run**: the site's assembled declaration, its data and its seed, then the seed steps that `platformkit migrate reset` runs — so the tests always see exactly what the files declare.
- **The functions are served with a test environment made for the run**: a known test value for every webhook secret, mail to the stack's own catcher by name, and the provider services a site's configuration names (the Hyperswitch router, a LiveKit dev server) started inside the same environment — so every check runs rather than skipping for want of a secret.
- **Tests find their stack only from the runner**: no test asks `supabase status` in whatever folder it was started from, and no test hard-codes a port. One helper gives each test its site's URL, keys, database and mail catcher.
- **In this run a skip is a failure**: a missing stack, service or secret fails the run, naming what is missing. The quick checks that need no stack stay in `npm test` as they are.
- **The schema check joins the same environment**: `schema.test.mjs` runs on the site's fresh stack instead of making a container of its own.
- **CI runs the same command** on every push, for the kit's own sites.
- **Torn down afterwards**: stacks and volumes are removed when the run ends, unless asked to keep them for a look.

## Non-goals

- Keeping the dev database in step with the schema (review finding F9 of `harden-access-and-billing`). It is a separate change; this one makes testing independent of the dev stacks.
- Rewriting the tests themselves, beyond pointing them at the runner's stack and removing hard-coded ports.
- Testing a fetched site in this repository's CI: a separately owned site runs the same command in its own repository.

## What James should look at

Whether the selection of sites is right — every registered site locally, the kit's own sites in CI — and whether a run that needs a payment provider's test key (the Stripe tamper test) should fail without one, or report it as not covered.

## Capabilities

### New Capabilities

- `test-environment`: the end-to-end test environment — isolated per-site stacks built fresh each run, the runner every stack test reads its site from, and the rule that a skip in that run is a failure.

### Modified Capabilities

- `build-and-dev`: `npm test` no longer claims the stack-backed checks; they belong to `test --e2e`.

## Impact

- `packages/kit/build/test.mjs` and a new runner beside it; `packages/kit/bin/platformkit.mjs` (`test --e2e`); the root `package.json`.
- Every stack-backed test under `packages/kit/build/` (how it finds its stack); `schema.test.mjs`.
- The seed steps of `platformkit migrate reset`, shared rather than copied.
- `.github/workflows/kit.yml`.
- The docs site's testing page and the CLI reference.
