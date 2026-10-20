# Design

## Context

See proposal.md — Why. What exists to build on:

- **The dev workspace already runs several sites side by side** (`build/dev-workspace.mjs`): each site gets a runtime project (`prepareRuntimeProject`), a stable project id (`stableProjectId`, `pk_<site>_local`), its own block of free ports (`findFreePort` from 20000), its own Supabase stack in Docker and its own functions server.
- **`schema.test.mjs` already makes a scratch database** from the kit's schema files in a container of its own (`pk-schema-test`), and throws it away.
- **`platformkit migrate reset`** resets a stack and runs fourteen seed steps (spaces, teams, events, comments, providers, achievements, bots, search, print templates, the dev account) — written out inline in `bin/platformkit.mjs`.
- **The Hyperswitch router** has a Docker test stack of its own (`build/hyperswitch-test-stack.mjs`).
- **The stack-backed tests** each find a stack their own way: `npx supabase status` in the current folder, `VITE_SUPABASE_URL` from the environment, or a hard-coded Mailpit port (54324).

## Decisions

**The test environment is the dev workspace's machinery, pointed somewhere else.** The runner reuses `prepareRuntimeProject` and the per-site loop rather than writing a second way to start a site, with three differences: the project id is `pk_<site>_e2e` (never a dev id), the ports come from a range of their own (from 40000) with every port a running dev record holds reserved, and the runtime projects live under `node_modules/.cache/platformkit/e2e/<site>`. A second copy of how a site is started would drift from the first, which is exactly the failure this change fixes. *Alternative:* a docker-compose file of our own for the stack — rejected, because the Supabase CLI is how every site's stack is made in dev and in deploy, and a stack made differently in tests would test something else.

**From scratch means from scratch.** Before starting, the runner stops any leftover `pk_<site>_e2e` stack with `--no-backup` (the Supabase CLI otherwise restores the last volume), then `supabase start` and `supabase db reset` — the vendor's own route, which applies the declaration, the data and the seed — and then the seed steps. The fourteen steps move out of `bin/platformkit.mjs` into one function both `migrate reset` and the runner call, so they cannot drift.

**Each stack gets a test environment file made for the run.** It is the site's own settings over a fixed set of test values the run owns: a known secret for every webhook (`CAL_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `HYPERSWITCH_WEBHOOK_SECRET` and the rest the deploy checks name), mail to that stack's own Mailpit **by container name** on its Docker network (an address goes stale when a container restarts; a name does not), and no live key ever — a `sk_live_` or any production URL in the site's environment refuses the run. The functions are served with that file.

**Provider services run inside the environment.** Where a site's configuration selects Hyperswitch, the runner starts the router through the existing test stack; where it names LiveKit, a LiveKit dev server container. Where it names neither, the tests of the no-account path run instead.

**Tests learn their stack from the runner alone.** One helper (`build/test-stack.mjs`) gives a test its site's app URL, API URL, keys, database URL, functions URL and mail URL from variables the runner sets (`PLATFORMKIT_E2E=1`, `PLATFORMKIT_TEST_*`). Every stack-backed test is moved onto it; `npx supabase status` and hard-coded ports are removed from the tests. Outside the e2e run the helper answers "no stack", and the test skips with a note as it does today.

**A skip in the e2e run is a failure.** Under `PLATFORMKIT_E2E=1` the helper's "no stack" and a test's own skip both exit non-zero, naming what was missing. `test.mjs` marks the stack-backed tests; `npm test` runs the rest and prints one line naming `test:e2e` for the others.

**Several sites at once, each alone.** Sites run in parallel up to a limit (two by default, `--jobs`), each with its own stack; the tests of one site run one after another, because they share its seed accounts. A site's tests are given only its own stack, so a test cannot reach another site's.

**The app server is the site's own, on a test port.** Browser tests need the site: the runner starts its Vite server with the run's environment on a port from the test range and gives its URL to the tests.

**Teardown always happens.** On success, failure or a signal, every stack the run started is stopped with `--no-backup` and its provider services brought down; `--keep` leaves them up and prints their addresses.

**The schema check uses the site's fresh database** rather than its own container.

**CI runs the same command.** `kit.yml` gains an e2e job: the demo, and a second, minimal fixture site with a different module selection, so two stacks side by side are exercised on every push. A fetched site runs `platformkit test --e2e` in its own repository's CI.

## Risks / Trade-offs

- [Several stacks are heavy on a laptop: a Supabase stack is a dozen containers] → two at a time by default, `--jobs` to change it, `--site` to run one.
- [Docker stops answering mid-run, as OrbStack did during this work] → the runner checks Docker before each phase and fails naming it, rather than reporting test failures that are not.
- [A run takes minutes rather than seconds] → it is a separate command from `npm test`; the quick checks stay quick.
- [The Stripe tamper test needs a Stripe test-mode key the run cannot invent] → the site's own `STRIPE_SECRET_KEY` is used when it is a `sk_test_` key; see proposal, "What James should look at", for what happens without one.
- [A test that leaves rows behind affects the next test on the same stack] → every stack test already makes and removes its own fixtures; the run starts from scratch, so nothing survives into the next run.

## Migration Plan

Additive: the runner and helper land first, then the tests move onto the helper one by one (each still runs under `npm test`'s skip rule meanwhile), then CI. Nothing a deployed site runs changes. Rollback is removing the CI job and the command.
