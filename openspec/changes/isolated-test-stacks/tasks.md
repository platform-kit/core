# Tasks

## 1. The environment

- [ ] 1.1 Move the reset's seed steps out of `bin/platformkit.mjs` into one function that `migrate reset` and the runner both call. Verified by `platformkit migrate reset` on the demo producing the same seed as before.
- [ ] 1.2 Add the runner (`platformkit test --e2e`, `npm run test:e2e`): select sites as the dev workspace does (`--site` for one, `--jobs` for how many at once); for each, a runtime project with an `_e2e` project id and ports from the test range with every dev port reserved; remove any leftover stack of that id without its backup; start, reset and seed it; write the run's test environment (a known value for every webhook secret, mail to the stack's catcher by container name, a refusal on any live key or production address); serve its functions and its app; start the provider services its configuration names. Verified by the runner's own test (task 4.1).
- [ ] 1.3 Tear down on success, failure and interruption; `--keep` leaves the stacks up and prints their addresses. Verified by the runner's own test.
- [ ] 1.4 Check Docker before each phase and fail naming it when it does not answer. Verified by the runner's own test with Docker withheld.

## 2. The tests

- [ ] 2.1 Add `build/test-stack.mjs`: a test's site, app URL, API URL, keys, database, functions and mail catcher from the run's variables; outside the run, "no stack" and the existing skip; inside it, a skip exits non-zero naming what was missing. Verified by its own unit test.
- [ ] 2.2 Move every stack-backed test onto it, removing `npx supabase status` and hard-coded ports (Mailpit at 54324 among them), and mark them in `test.mjs` as the e2e run's. Verified by task 4.1's check that no stack-backed test reads `supabase status` or a fixed port.
- [ ] 2.3 Run `schema.test.mjs` on the site's fresh database rather than a container of its own. Verified by it passing under the run.
- [ ] 2.4 Have `npm test` name the stack-backed checks in one line instead of reporting them. Verified by `npm test`.

## 3. CI and a second site

- [ ] 3.1 Add a minimal second fixture site with a different module selection, so a run exercises two stacks side by side. Verified by the runner's own test over both.
- [ ] 3.2 Add the e2e job to `.github/workflows/kit.yml`, running the same command over the demo and the fixture. Verified by the job's run.

## 4. Verify

- [ ] 4.1 Add the runner's own test: a dev stack untouched by a run; two sites isolated; a schema change seen with nothing run by hand; a crashed run's stacks replaced; a live key refused; a withheld service failing the run; an interrupted run torn down; no stack-backed test reading `supabase status` or a fixed port. Verified by running it.
- [ ] 4.2 Run `platformkit test --e2e` over every registered site and report each test as passed or failed, with every finding from a test that had only ever run against a stale database listed. Update the docs site's testing page and CLI reference. Run `openspec validate isolated-test-stacks --strict` and the docs check.
