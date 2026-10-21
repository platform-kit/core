# Tasks

## 1. The environment

- [x] 1.1 Move the reset's seed steps out of `bin/platformkit.mjs` into one function that `migrate reset` and the runner both call. Verified by `platformkit migrate reset` on the demo producing the same seed as before.
- [x] 1.2 Add the runner (`platformkit test --e2e`, `npm run test:e2e`): select sites as the dev workspace does (`--only` for some, `--jobs` for how many at once — `--site` is the CLI's own); for each, a runtime project with an `_e2e` project id and ports from the test range with every dev port reserved; remove any leftover stack of that id without its backup; start, reset and seed it; write the run's test environment (a known value for every webhook secret, mail to the stack's catcher at its network address, read at start, a refusal on any live key or production address); serve its functions and its app; start the provider services its configuration names. Verified by the runner's own test (task 4.1).
- [x] 1.3 Tear down on success, failure and interruption; `--keep` leaves the stacks up and prints their addresses. Verified by the runner's own test.
- [x] 1.4 Check Docker before each phase and fail naming it when it does not answer. Verified by the runner's own test with Docker withheld.

## 2. The tests

- [x] 2.1 Add `build/test-stack.mjs`: a test's site, app URL, API URL, keys, database, functions and mail catcher from the run's variables; outside the run, "no stack" and the existing skip; inside it, a skip exits non-zero naming what was missing. Verified by its own unit test.
- [x] 2.2 Move every stack-backed test onto it, removing `npx supabase status` and hard-coded ports (Mailpit at 54324 among them), and mark them in `test.mjs` as the e2e run's. Verified by task 4.1's check that no stack-backed test reads `supabase status` or a fixed port.
- [x] 2.3 Run `schema.test.mjs` under the end-to-end run, on a throwaway database of its own (it renames and drops what it works on), and out of `npm test`. Verified by it passing under the run.
- [x] 2.4 Have `npm test` name the stack-backed checks in one line instead of reporting them. Verified by `npm test`.

## 3. CI and a second site

- [x] 3.1 Add a minimal second fixture site with a different module selection, so a run exercises two stacks side by side. Verified by the runner's own test over both.
- [ ] 3.2 Add the e2e job to `.github/workflows/kit.yml`, running the same command over the demo and the fixture. Verified by the job's run.

## 5. Nothing untested by construction

- [x] 5.1 Add `build/test-coverage.test.mjs` to `npm test`: every function named by a test; no test exiting successfully before its end except through `skip()` or `notHere()`; every specification's "Verified by" naming a test that exists and is registered. Verified by running it, and by it failing on a function with no test, an early exit and a missing test.
- [x] 5.2 Move every stack test's early exits onto `skip()` / `notHere()`. Verified by 5.1 passing.
- [x] 5.3 Add the runner's coverage gate: every function called during the run, read from the functions' log. Verified by the run failing on an uncalled function.
- [x] 5.4 Write the tests that close the coverage gate for every function it names. Verified by the run passing the gate over every site.

## 4. Verify

- [x] 4.1 Add the runner's own test: a dev stack untouched by a run; two sites isolated; a schema change seen with nothing run by hand; a crashed run's stacks replaced; a live key refused; a withheld service failing the run; an interrupted run torn down; no stack-backed test reading `supabase status` or a fixed port. Verified by running it.
- [x] 4.2 Run `platformkit test --e2e` over every registered site and report each test as passed or failed, with every finding from a test that had only ever run against a stale database listed. Update the docs site's testing page and CLI reference. Run `openspec validate isolated-test-stacks --strict` and the docs check.
