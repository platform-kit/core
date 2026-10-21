# Verification

Applied on 2026-10-20 and 2026-10-21 at James's request. Not archived: read it, then `/opsx:archive`.

Every test named below that guards a fix was also run against the code as it was before the fix, and failed there. Each says so.

## Scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| a dev stack is running | **passed** | `node build/e2e-runner.test.mjs` starts a stand-in dev database named and ported like `npm run dev`'s, with rows in it, and compares every dev stack's containers, start times, ports and rows before and after four runs. `node build/e2e-runner.test.mjs` passes all 24 checks. |
| two sites in one run | **passed** | `platformkit test --e2e --only demo,club`: two stacks side by side, on different ports (40000 and 40001 up), each with its own database and mail catcher, reported separately. The runner's own test also checks that a row one site writes is absent from the other's database, and that the demo has the store's tables while the club does not. |
| a schema change | **passed** | It adds a table and column to the club's `db/schemas` and finds them on the next run's stack, with nothing run by hand. |
| a crashed run | **passed** | It keeps a run's stacks, writes a row, and the next run finds the row gone. |
| a webhook test | **passed** | `webhook-doors.test.mjs` under the run, with the run's own secrets: cal.com, Stripe (at `stripe-webhook` and at `payment-provider-webhook`) and the forms webhook accept a signed event and refuse a wrong secret, an altered body and a stale one. Nothing skipped. |
| a live key | **passed** | A `sk_live_…` in the club's `.env` refuses the run before any stack starts, naming the key. |
| a test started from another folder | **passed** | `test-coverage.test.mjs` fails any test that reaches a stack without taking it from `build/test-stack.mjs`, and any stack test that reads `supabase status` or falls back to a dev port (543xx or 5173). It failed on two planted tests and passes on the suite. |
| a missing service | **passed** | Docker withheld fails the run naming Docker; a browser missing fails it naming the browser; a site that takes payments through Stripe with no test key fails naming the key; the runner's own test withholds the mail catcher from its probe and the run fails naming the test and the service. |
| an interrupted run | **passed** | SIGINT mid-test, then no container of the run left. The run's tests now run asynchronously: before, a signal waited until the whole suite had ended and the stacks stayed up. |
| a new function with no test | **passed** | `test-coverage.test.mjs` names every function no test mentions. |
| a function no test calls | **passed** | The run's coverage gate, read from the functions' own log after warm-up: over the demo and the club, every one of the 57 functions served was called. It is computed over the whole run, since most functions belong to no module in the manifests and the club has most modules off. |
| a test that stops early with a pass | **passed** | `test-coverage.test.mjs`, and under the run a skip, a `NOT RUN` act or an early `leave()` fails. The one accepted stand-down is `notHere()`, a fact about the site, printed as "not on this site". |
| a claim with no test behind it | **passed, one gap named** | `test-coverage.test.mjs`. `print-production`'s "Verified by" names `print-jobs-db.test.mjs`, which does not exist: the print_jobs design was never built. It is listed in `KNOWN_GAPS` and printed on every run until James decides. |

`openspec validate isolated-test-stacks --strict` passes. `node build/docs-check.mjs` passes on all 88 pages. `test-coverage.test.mjs` passes its 9 checks.

## The runs

`npm run test:e2e` over every site with a backend (the demo, the club and DharmaLab), two at a time: the coverage gate passed (every one of the 57 functions served was called). The demo failed 1 of 76 checks, payouts, which needs Stripe Connect on the test account. The club failed payouts and, under the load of two sites at once, an administrator's browser sign-in timing out, which passes when the club runs alone.

DharmaLab, in the same run: payouts (Connect), its own booking test's import (fixed in its checkout since), and pictures its committed print.json addressed at the runtime's internal gateway (test data a print test had left; removed in its checkout, and the test now puts print.json back). The fixes after this run (the agents-db settle, print.json restored) were checked one test at a time.

## Every finding from a test that had only ever run against a stale database

These were in the code, some since the first snapshot, behind a suite that passed. Each is fixed, and each has a test that fails on the old code.

1. **Six functions never booted** (content, storefront-api, agent-run, admin, providers and images): the local runtime ignores a function's `deno.json` import map. The assembler now writes every bare import as its explicit target. `assembled-tree.test.mjs`.
2. **Every funnel and blast audience failed on every site.** `email_audience_match` read `b.roles`, which its own base never selected. The schema loads with `check_function_bodies` off, so it was created and failed only when called. Fixed, and `function-bodies.test.mjs` now compiles all 455 SQL functions against the tables as built; it names the old function.
3. **The gateway refused `matrix-api`, `social-oauth` and `payment-provider-webhook`** on every site whose `config.toml` predated them: 401 before the function ran, so no Matrix client, no OAuth return and no provider webhook could reach them. The assembler now keeps every public function's `verify_jwt = false` in a site's own `config.toml`, and `--check` refuses one that is missing. `assembled-tree.test.mjs`.
4. **A new site with a scheduled module off could not build its database**: the cron block unscheduled jobs that were never made, and `cron.unschedule` raises on those. `cron-registration.test.mjs`.
5. **A site with the emails, bots or spaces module off could not boot most of its functions**: they import those data files statically, and nothing wrote them. Each is now written empty in its own shape.
6. **The run's data was stale.** The catalog, compiled emails and the rest were never made by the run, so the demo was tested against files an earlier dev build left; the club, never built, would not start. The run now makes them from the site's content.
7. **The support widget, analytics script and comments embed named the dev stack**: the dev server serves them from `dist/`, built by an earlier dev build. The run now builds its own against its own stack (`PLATFORMKIT_DIST`), never touching the dev build's.
8. **The two sites' stacks were given the same ports** (40000…): `findFreePort` claimed a port after its checks, which await. `dev-workspace.test.mjs`.
9. **An unknown checkout session answered 502**, a server fault, instead of 404. `function-doors.test.mjs`.
10. **The cloud projection of spaces failed** on a `bought:` grant: it compiled with no catalog. The admin now hands the catalog to the model. The cloud lane passes 36 of 36.
11. **A site's own atproto handle `localhost` made Bluesky's client reject the whole feed list.** The lexicon's `handle.invalid` stands in.
12. **A printed book's cover could not be drawn with no machine**: Storage's image transform was off in the kit's template. On, in the template and the demo.
13. **`product-keys.mjs` crashed on a site with no books**, and the catalog accepted a print edition named `chapters` (not an edition) without a word. Both fixed; an unknown edition is refused by name.
14. **The demo's seed gave the buyer a purchase but not what a purchase grants** (the paid class, the book).
15. **13 stack tests had dropped out of the run** after they moved to `statusOf()`: the run found stack tests by guessing from their source. It now finds them by their import of `build/test-stack.mjs`, and `test-coverage.test.mjs` fails any test that reaches a stack without it.
16. **Six tests opened a browser ignoring `PLAYWRIGHT_CHROMIUM_PATH`**, and one built its own browser context below the shared timeout floor. All go through the path now; `test-coverage.test.mjs` holds every launch to it.
17. **`print-cloud.test.mjs` passed on nothing**: it read a fixed port and exited 0 when no stack answered or the runtime ran out of workers. It is a stack test now, and those are failures.

18. **print-render recorded picture addresses no browser can reach** (the local runtime's own name for the gateway, `http://kong:8000`), so every page showing a printed book's pictures failed once a book was set. It records the public address now. `print-cloud.test.mjs`.
19. **print-render read a WebP cover as a PNG** and Typst refused it; DharmaLab's covers are WebP files named `.png`. A picture is named by its bytes now.
20. **The function and the build bound a book's pages differently** (DharmaLab's: 80 against 78). The function had its own copy of the rule and asked each printer for its product without naming the format. One shared rule now, `bindingFor` beside `padFor`. `print-jobs.test.mjs` (60 checks), `print-parity.test.mjs` (13).
21. **The ownership test called three guarded functions unchecked**: it knew guards only from a hand-kept list that lacked the kit's `may_see_member`. It now derives the guards from the database (any true-or-false function that checks the caller, directly or through another). DharmaLab's `member_read`, `member_working` and `member_bought` were never unguarded.
22. **A test's skip was only text-matched**, and caught a Matrix log line (`skipped_message_keys`); whole words only now. And an interaction act reported `NOT RUN` passed the run; under the run it fails now.
23. **The schema test leaked a Docker network every run**, until Docker had no addresses left. It and the runner remove their networks now.
24. **The club's browser checks were refused sign-ins** by the auth server's own limit (30 in five minutes, from one address). Lifted on test stacks only.
25. **A fetched site's dependencies were never checked**: DharmaLab's admin imported a package its checkout did not have, answered 500, and every browser check timed out. The run stops naming missing dependencies now.

## Found in DharmaLab's own repository

- `build/guest-session-booking.test.mjs` imported the kit by a relative path that broke when the site moved under `sites/external/`. Changed to the package name, in DharmaLab's checkout, uncommitted.
- Its `supabase/config.toml` gained the three public functions' sections from the assembler, uncommitted there.
- Its checkout cannot install its own dependencies: npm fetches the kit's packages, which are not published. Open, for James.

## Tests that now stand down on a site, by name

A check about a module or content a site does not have prints "not on this site" with the reason (`moduleOn()`, `notHere()` in `build/test-stack.mjs`): the store's purchases, coaching threads, the emails module's letters, a site's own achievements, comments, spaces and rooms, offerings off by policy, the instrument's diagnostic, books. The demo has every module on and runs each of them; the club has most off and stands each down.

## Still open, and why

- **`payouts-db.test.mjs` fails on every site**: Stripe answers "You can only create new accounts if you've signed up for Connect". It is a fact about the test account, not the code, and the run fails rather than hiding it. James: enable Connect on the Stripe test account.
- **CI (task 3.2, unticked)**: the `e2e` job is in `.github/workflows/kit.yml`, unrun until a push. It needs a `STRIPE_TEST_SECRET_KEY` repository secret.
- **The club's administrator sign-in under load**: with two sites' browser checks at once, one sign-in can exceed a minute while the admin page first compiles. It passes alone; noted, not fixed.
- **print_jobs**: the known gap above.
