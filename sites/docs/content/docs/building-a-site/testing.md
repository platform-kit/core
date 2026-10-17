---
title: Testing
description: What platformkit test runs, the phone probe, screenshots before reporting, and the specs as the edge of what is verified.
order: 52
sources:
  [
    packages/kit/build/browser.mjs,
    packages/kit/build/manifests.test.mjs,
    packages/kit/build/modules/manifest.mjs,
    packages/kit/build/modules-off.test.mjs,
    packages/kit/build/dryrun-db.test.mjs,
    packages/kit/build/sales.test.mjs,
    packages/kit/build/reads-db.test.mjs,
    packages/kit/build/money-db.test.mjs,
    packages/kit/build/webhooks.test.mjs,
    packages/kit/build/interaction.test.mjs,
    packages/kit/build/signed-in-as.test.mjs,
    packages/kit/build/webhook-doors.test.mjs,
    packages/kit/build/edition-id.test.mjs,
    packages/kit/build/doors-db.test.mjs,
    packages/kit/build/marketing.test.mjs,
    packages/kit/build/ranking.test.mjs,
    packages/kit/build/twice-db.test.mjs,
    packages/kit/build/unpublished.test.mjs,
    packages/kit/build/guards-db.test.mjs,
    packages/kit/build/sell-rules.test.mjs,
    packages/kit/build/suppliers.test.mjs,
    packages/kit/build/identity-probe.mjs,
    packages/kit/build/test.mjs,
    packages/kit/build/models/yaml-keep.mjs,
    packages/kit/build/yaml-keep.test.mjs,
    packages/kit/build/site-nav.test.mjs,
    packages/kit/build/variants.test.mjs,
    packages/kit/build/dev-directory.test.mjs,
    packages/kit/build/dev-stop.test.mjs,
    packages/kit/build/source-cli.test.mjs,
    packages/kit/build/runtime-paths.test.mjs,
    packages/kit/build/dev.test.mjs,
    packages/kit/build/bootstrap-env.test.mjs,
    packages/kit/build/workspace-root.test.mjs,
    packages/kit/build/phone-probe.mjs,
    .github/workflows/kit.yml,
    .github/workflows/publish.yml,
    packages/kit/build/docs-check.mjs,
    packages/kit/build/docs-review-date.mjs,
    packages/kit/build/docs-review-date.test.mjs,
    packages/kit/build/sql-columns.mjs,
    packages/kit/build/sql-columns.test.mjs,
    packages/kit/build/content-rules.mjs,
    packages/kit/build/content-rules.test.mjs,
    packages/kit/build/fonts.test.mjs,
    packages/kit/build/typefaces.mjs,
    packages/kit/build/proposal-trace.test.mjs,
    packages/kit/build/site-boundary.test.mjs,
    packages/kit/build/source-install.mjs,
    packages/kit/build/runtime-paths.mjs,
  ]
reviewed: 2026-10-16
---

## A proposal promises nothing it does not require

`proposal-trace.test.mjs` holds the loop to itself: every change's proposal declares, in a table,
the requirement each of its promises lands in, and the check confirms each one exists, that no
requirement went unpromised, and that the capabilities agree. It exists because four Stripe features
asked for by name were never built — named in a proposal's prose, covered by no requirement, and
missed by every green check. [The spec workflow](/content/docs/building-a-site/the-spec-workflow)
has the whole of it.

`docs-check.mjs` compares the frontmatter reference against shared collection schemas. Content-model
collections are generated from a site's own model files, so their field names vary by site; the
reference documents their shared model grammar rather than listing one site's fields. The check
continues to verify every field on the shared collections.

## One timeout for every browser

Playwright's default is **30 seconds**, and it applies to any call given no explicit budget. A file
that carefully writes 60 on the waits it thought about therefore still runs everything else at 30 —
and under load, which is exactly when the suite is slowest, the calls nobody wrote a number on are
the ones that fail. That cost an afternoon: an act of the interaction lane failed at 30s inside
`npm test` while every wait written in the file said 60, and what it reported was a failure of the
surface under test.

Two numbers was the fault. `build/browser.mjs` is the one: `context(browser, opts)` sets both the
default and the navigation default to `BROWSER_WAIT_MS` (60000), and `launch()` reads
`PLAYWRIGHT_CHROMIUM_PATH` so fourteen files no longer each remember to. It is a **floor**, not a
cap — a call that genuinely needs longer still passes its own `{ timeout }`.

`manifests.test.mjs` refuses a `newContext` made anywhere else, so a file written next year cannot
quietly inherit the 30 back.

## Three things that make a suite lie

**A module is on unless it says `false`.** `deploy-checks`, `steps.mjs` and the router all read the
switch that way; the test runner read `!!modules[m]`, which makes a module ABSENT from the config
_off_. A site never lists `articles`, `books`, `wiki`, `docs`, `models` or `api` because they are
on by default — so their checks were skipped on the one site that uses them. A runner that
disagrees with the rest of the kit about what is switched on will always skip the checks nobody
thought to list.

**A test that makes a row in a rate-limited table removes it.** The desk caps new guests and new
threads per address per hour, and the count is simply the rows made in that window — so a test
that leaves its guest behind is spending another test's budget. The interaction lane did: four
checks of `support-api.test.mjs` went 429 in the full suite, and the failure appeared in a test
nobody had touched. Shared, time-windowed limits make test interference look like an unrelated
regression, which is the worst kind to chase.

**A test that disturbs the edge runtime settles it before it returns.** `webhooks.test.mjs` writes
`_shared/webhooks.json` — that is the point of it — and where a dev server is running `functions
serve`, every write to the functions tree reloads every function. The next test to call one is
answered "an invalid response was received from the upstream server" by a runtime that is still
starting. It passed alone and broke `print-cloud` in the full suite, which cost two runs before
anybody looked at what ran before it. It now waits for the watcher to NOTICE first and then for
sustained health, because polling straight away sees a runtime that has not begun reloading yet,
returns happy, and lets the restart land on the next test.

## The interaction lane

The static lane builds a site, serves it, walks every public route and fails on a console error or
a request to a backend. That catches a page that will not render. It cannot catch a page that
renders perfectly and dies the moment somebody types into it — and that is what had happened to the
palette: `offPalette is not defined` fired on the first keystroke, the page looked right, the whole
suite was green, and the site's search had been dead for weeks.

`build/interaction.test.mjs` is the browser that USES the site. One real interaction per surface — ⌘K and
a typed word, a guest's line sent and shown in the thread, a diagnostic screen answered, the bag
opened — with the console and page errors watched throughout, and each act in its own context so a
modal one act leaves open cannot fail the next.

Two things it does deliberately. **An act that could not find what it needed is NOT a pass**: it is
counted apart and named at the end, because "7 passed" over a lane that did nothing is the shape of
check this lane exists to replace. And it **dismisses** the support teaser the way somebody would
rather than deleting it from the DOM — the first version removed `.ck`, which is the command
palette and not a cookie banner, so the palette act deleted the thing it was asking about and then
reported that a word matched nothing.

**Two rules the acts follow, both learned the hard way.** _Every wait is for a condition, never a
duration_ — a fixed pause fits an idle machine and is too short when the rest of the suite is
loading it, which is how two acts passed alone and failed inside `npm test`. And _an act removes
what it makes, and finds it by its own handle_: the desk caps new guests per address per hour, so
an act that leaves its guest behind spends another test's budget — and one that tidies up "the
newest guest" deletes whichever act ran last. Each finds its own contact by the hash of its own
token.

It needs a dev server and the stack, and skips loudly naming what went uncovered.

## `platformkit test`

`admin-cms-mode.test.mjs` and the site deployment check pin the three delivery shapes: a backend with rows and a repository, rows with no repository, and static output. A site that registers admin models is refused if a backend build resolves to files, preventing a successful build with the editor rail silently removed.

The navigation editor's options are checked against the pages and membership tiers the site actually declares. Declared routes are checked across all options: `/` is supplied by the shared Home link, not duplicated in the separate `Your pages` group. A site with no landing-page records or store offers should not need to invent either just to pass the shared suite.

The module-manifest checks match build steps to their declared owners across the kit, theme and site, validate registered payment-provider declarations, and hold a site-registered module to the same ownership rules as a kit module. The YAML front-matter writer is also checked for no-op saves: unchanged records retain their original formatting, including the spacing inside inline maps.

`packages/kit/build/test.mjs`, what every site's `npm test` calls. Run it from the site directory: the runner takes `process.cwd()` as the site root and resolves shared packages, docs and specs from the workspace root. CI runs it from the generic `sites/docs` and `sites/demo` fixtures; the workspace-root, dev-directory and stop tests cover the shared front door and managed local processes. The source-CLI test invokes a local Git source without requiring publication and checks that standalone help does not need workspace Vite dependencies; the runtime-path test pins the shared cache location. Before the demo bundle build, CI starts and resets its local Supabase stack and passes the local URL and keys to the build; it does not use hosted backend credentials.

CI installs Deno because `social-provider-matrix.test.mjs` runs a real SDK capability probe with `deno eval`.

In order:

`deploy-pins.test.mjs` checks that a production deploy refuses missing, ranged, stale, linked or non-registry PlatformKit pins before it reaches a Supabase or build command.

The docs check treats `reviewed:` as a human calendar date. When it runs in UTC, it accepts the adjacent date that could still be today in a timezone from UTC−12 to UTC+14; `docs-review-date.test.mjs` pins those boundaries. Its environment reference check also accounts for settings whose names are assembled from a declared prefix, such as per-site Git URL variables, while requiring the reference to document the usable pattern.

The `content-refresh.test.mjs`, `steps.test.mjs` and `projection-safety.test.mjs` cases pin local Markdown refresh, nested input matching, local-only projection opt-in and the refusal to continue after projection failures. Social publishing runs its provider permission and security suites behind its module switch; `desk-social.test.mjs`, `social-capabilities.test.mjs` and `social-edge-runtime.test.mjs` run only when both `spaces` and `social-publishing` are enabled, pinning the opt-in adapter, provider capability gates and Edge Function behavior without mirroring provider messages into Spaces tables.

1. **The assembled tree** — `assemble --check` where `supabase/.assembled.json` exists, else an assembly.
2. **The kit's checks, each behind its module switch:** that every record of the content validates (velite does not fail on a record it cannot parse — it DROPS it, and the site is built without that product, that event, that page, silently; two of those survived a green suite before this check existed, so the suite now runs the content build and any error is the failure, named by its file and its field), that the site runs on its own code (a client of a product this project stands in for is driven by the tests and imported by nothing that runs, and is a devDependency rather than a dependency — a drop-in is written so OTHER people's code can reach us), the line between a declaration and state (every table of the kit classified in one manifest, no projected table a client could write, no client code writing one, and every projection naming a content path a collection produces), every column a SQL function names against that same declaration (the kit's schemas and the site's read as one, since a site's SQL reads the kit's tables by column name), the three faces (the families the kit offers, a name nobody serves refused by name, a whole CSS stack refused as a family, a face left unset falling to the theme's rather than to nothing, and every stack ending in a generic so a face that never loads still sets type), whether a record's fields make sense together (a declaration that contradicts itself — a cal.com url beside the native scheduler's own settings — throws from velite's prepare and fails the build, since velite drops a bad record and exits 0 and the deploy runs the build and no tests), the subscriptions a deployment ships (declared, pushed, a secret reaching one from the environment and never from the file, one somebody made by hand never touched), what the browser writes down while somebody speaks (the transcript's own arithmetic, with no browser in it), product keys and the catalog (`store`), the emails' compile (`emails`), the funnels' compile (`funnels`), the Tailwind wiring, what may interrupt somebody (the pages where nothing appears, and the corner belonging to whoever takes it first in a page view), the analytics (what a session records on arrival — the UTM tags, device, browser and system families — on fixed inputs; then, with the stack up, the channel rule on thirty inputs, the audience partition, the filters' partition, a registered goal, the events read, the retention cohorts recomputed, recirculation and right now on rows written for the purpose, the channels over the seed, and the `ingest` door — a malformed batch, a JWT's user, a country header, an unknown key, a source's origin; `ANALYTICS_TEST=0` skips the stack half), the content index (every published entry rendered, an unpublished one absent, the ids stable across two builds; `CONTENT_API_TEST=0` skips it), the Support API (`support` and `api`: Chatwoot's shapes under Node; with the stack up a guest's life through the Client API, the desk through the Application API, the refusals, the webhooks with a local receiver, the guards; on Playwright Chatwoot's snippet on a page of another origin; `SUPPORT_API_TEST=0` skips it), the Store API (`store` and `api`: the products from a fixture of offers and the schema under Node; with the stack up `@shopify/storefront-api-client` against the served door and the cart's life, and on Playwright the checkout url followed — a guest's paperback paid under the Stripe mock, a book online on the bag with the sign-in, an expired token; `STOREFRONT_API_TEST=0` skips it), the Forms API (`forms` and `api`: a document of every kind to Typeform's definition and a row to its response item under Node; with the stack up, Typeform's official client against the served function, the refusals, a webhook delivered and verified with its secret, a response deleted, the insights, and Typeform's embed on a page of another origin under Playwright; `FORMS_API_TEST=0` skips it), the Scheduling API (`sessions` and `api`: a session type to cal.com's event type, a row to its booking, hours to its schedule, the webhook payload under Node; with the stack up and the demo's native type, the kit's own cal.js pointed at the site through the API — slots, a booking, its move, its cancellation — the judge's refusals, a person's JWT, the webhooks verified under X-Cal-Signature-256, and cal.com's embed on a page of another origin under Playwright; `SCHEDULING_API_TEST=0` skips it; both run whenever the api module is not off), the analytics script (the built `dist/analytics.js` loaded in a headless page against the served door: every method posthog-js declares, the size under 40 KB gzipped, a page view with its arrival facts, identify, an opted-out page still sending under a random id, PostHog's own snippet; `SDK_TEST=0` skips it), what somebody is interested in (`recommendations`, against the stack: a purchase outweighing any amount of browsing, a piece half read counting and a glance counting for less, an open below the floor counting for nothing — and the two the design exists for, a piece re-tagged after it was read changing the person's interests and a tag removed ceasing to count, neither with anything re-run; plus the ranking's own arithmetic under Node and a derivation that every collection offering Tags projects them, so a publish alone moves the ranking on a deployment that never builds; `RECOMMENDATIONS_TEST=0` skips it), a save keeping the file's own words (over every self-documenting record the default grammar writes: the comments above a key and at the end of its line with the column they were lined up in, the file's key order, a removed key taking its own comments with it — and the same over a rows store with no filesystem under it, since where the text came from is the store's business and not the grammar's), the companions' grammar, what a person may write in a message (the marks every chat surface offers, the ones it does not — a heading is not a heading in a chat line — and that nothing typed ever becomes markup), the print seam (`print`: nothing under build/print/ imports Typst but the two drivers, and given the same sources both set a document of the same page count and the same substance), a book cut into runs (`print`: the order kept, a long chapter never split, a run that overran moving only what follows it), a book set where there is no machine (`print`, against the running stack: who may ask, the page count, the padding, a cover per printed format drawn to the press that will make it, a paperback with no picture left unset rather than drawn blank, the worker not fetching the type twice, and **the same edition id the build gives the same book** — with the part of the hash that moved named when they differ; skipped where the stack is down or the book is not in rows), the speech names (`tts`), the chat model (`coaching`), the support model (`support`), what a run does next (`bots`: a run cancelled between a model call and the tool it asked for, one out of money mid-thought, a model asking for two tools at once, a worker that died holding a lease — every awkward case an ordinary input, because the decision is a pure function), the agent loop against the stack (`bots`: the real worker, a run answered, one killed mid-run and picked up by another, a cancel that stops a tool before it changes anything, a budget that holds — all on a scripted model, so nothing is bought; `AGENT_TEST=0` skips it), the desk’s tickets (`support`: what is owed on a piece of work, the order a list takes, the narrowing, and the counts — with the same vocabulary the queues use for lateness), a call that needs no account (`spaces` or `sessions`: the ICE servers a browser is handed and where they came from, the standard’s own credential pinned against a known HMAC vector because a relay elsewhere has to accept what we mint, the provider a room gets from what the site has, the mesh’s cap and its refusal to pretend it records, and a check that no relay provider is named in the kit’s code or in a variable it reads), the spaces’ declaration (`spaces`: the grammar round-tripped, the compile's refusals — a kind or capability the schema does not know, two roles with one slug, a grant naming a role no space declares, an offer the site does not sell, a file naming a person), when something happens again (`events`: the repeat read as fields, the occurrences it makes over a window, an hour the clocks skipped, and the plain words it is said back in), what is on as a surface asks for it (`events`: what "today" means to the person reading, how long until it starts, whether it is on now, the gathering by day), the spaces’ arithmetic (`spaces`: unread as a subtraction and never a count, the catch-up cursor and what it leaves to paging, where the unread divider sits, mentions as tokens rather than names, which message notifies whom, and what a search asks for once its narrowings have been chosen), the community against the stack (`spaces`: a community and a paid server beside the staff space with none of them seeing the others, the tier that fills one lapsing, invitations made, used, spent, expired and surviving a sweep, moderating and inviting reaching somebody only as a grant on a role the site invented, the four acts and the record each writes, a mute refused by the same rule in a channel, a thread and a direct message opened before it, and the directory disclosing nothing the site does not already show; `COMMUNITY_TEST=0` skips it), the spaces against the stack (`spaces`: the fill rule making and unmaking memberships, the isolation a space promises by every path a client uses, the counters checked against a walk of the rows they stand for, the cursor and what it marks for paging, a mention resolved from its token, the edit guard, and the live topic — a member hearing what the database sent and a stranger refused the same topic; `SPACES_TEST=0` skips it), the staff's desk (`spaces`: the one shape each source fills and the arithmetic over a mixed list — what is owed read from three different clocks into one sentence, the order, the badge — against real rows of each source; then, with the stack up, three of them in one list for a member of staff, each answered through the system that holds it and read back by the person who was waiting, and no desk and no disclosure for somebody; `DESK_TEST=0` skips the stack half), the People panel (every account in one read against the stack: the narrowings, the search, one person's whole picture, never the last administrator away, and nothing at all for somebody; `PEOPLE_TEST=0` skips it), what the business owes (the payout arithmetic on fixed numbers — a share of a week refused where it is written, a refund reversing in proportion and never more than was earned, and earned · payable · waiting · sent kept four different numbers; then the same ledger against the stack: the sweep run twice and paying once, a call the provider missed earning nothing and one the client missed earning, the payment a share is a share of followed rather than guessed, the delay, and a refund either side of the window; `PAYOUTS_TEST=0` skips the stack half), the funnel analytics (`funnels`: the journey and the last-touch credit recomputed from the local stack's seed, a member refused, the unsubscribe link marking its send against the served function; skipped when the stack is down, `FUNNELS_TEST=0` skips it), the forms (`forms`: forms.md's own tests for the vendored parts, the parser, the writer, the logic, the screens, the validation, the grade — and `forms.mjs --check`), the content models (`models`: the record's round trip, the refused fixtures, every rule family, the entry check, the carry, the JSON — and `models.mjs --check` over every entry), the docs (`docs-check.mjs`: every page's sources exist; the reference pages state what the code states; and coverage — every Edge Function, `_shared` module, schema file, build script or step, library module, theme page and deploy path is named by some docs-site page, since the docs site is the canonical documentation; a page reviewed today is read against today’s changes already, today being the machine’s own day rather than UTC’s; and **a change to the kit changes a page’s words, or says in its own commit message why none was needed** — a `reviewed:` flip is a page re-read, not a page written, and a dozen commits of one afternoon were measured going out with a kit change and a one-line date move, so the escape is now an explicit `Docs: none — <reason>` line that stays in the history), the rewrite rules (`deploy/_redirects` covers what the modules need and the nginx template is what it says; then the nginx image built and run in Docker against the local stack — each rule reaching its function, every other path the app; `REWRITES_TEST=0` skips the instance), the build steps (the order, the gating, a site's step merged, the needs, a failing step — and `steps.mjs --check`: every on step's tool and package is here), the deploy checks' 27 cases, the pipe (the registry on three sites, the route table, a refused save, and — since Deno resolves nothing from node_modules — that every bare name a function's import graph reaches is in its own import map, because a worker that cannot boot answers 503 to every request and one missing line takes down every function that shares the code), the override test (every theme component stubbed and resolved three ways on the real plugin), the strings merge, the destructive guard's 30 cases, and the schema test (the declaration's whole loop on a database of its own; when Docker is up, about two and a half minutes; `SCHEMA_TEST=0` skips it).
3. **The site's own** — `build.tests` in the config. A site with an instrument runs its own: the reading rules, the word association, the charts, the results sheet with every test on, the copy, the mechanism, the bank lint, the complexes.
4. **The specs** — `openspec validate --all --strict`, where an `openspec/` exists.

A failure stops the run and exits non-zero. Each test is a plain Node script that prints `N passed, M failed` and exits accordingly; no test framework.

## Who is here, told once

`node packages/kit/build/identity-probe.mjs` asks one question of every surface: **does signing in on a page give you the page you would have got by reloading it?**

It cannot be answered by reading code. Half a dozen modules each hold a slice of what a person may see — the spaces, the chats, the desk, the records, the support widget — and the question is whether every one of them heard that the person changed. A module that did not is invisible: the page simply shows a little less than it should, and only somebody who reloads finds out.

So the probe opens each route twice: as a guest who signs in **on the page**, and reloaded as the same person. The two readings must match. A reading is deliberately coarse — how many entries are in the rail, whether the account menu is there, how many tabs — because the fine detail is timing and the coarse detail is the bug.

It is not in `npm test`: it wants a browser, a dev server and about two minutes. Run it when you have touched what a module does on arrival. `IDENTITY_PROBE_ROUTES` narrows it, `IDENTITY_PROBE_USER` and `IDENTITY_PROBE_PASS` say who to sign in as, `IDENTITY_PROBE_WAIT` how long to let a surface settle, and `IDENTITY_PROBE=0` skips it.

It was checked against a deliberate fault rather than trusted: with **both** halves of the spaces surface deafened — the module's registration and the page's own — `/spaces` reads five rail entries in place against six reloaded, and the probe fails. With either half listening it passes, which is the truth: the surface works as long as one of them is told.

## The phone probe

`platformkit probe --url <url> --routes /,/content,…` opens every named page at 390 px in headless Chromium and fails on horizontal overflow or text at the edge, reading two lists from the theme’s manifest. `probe.allow` is what may run to the edge on purpose — a marquee, a carousel’s off-centre slides, the ground’s glow. `probe.rails` is narrower and is the one to reach for: a scroller whose cards leave on the **right** and come back with a swipe, held to its left gutter like everything else. The two are separate because a rail whose snap had scrolled its gutter away looked exactly like a rail behaving as intended, and the wider list would have hidden it. It runs in CI over the demo’s build.

## UI is looked at before it is shown

Never report UI work without having rendered it and looked at the screenshot yourself first — every state changed, including overlays, dropdowns, hovers, and both themes where relevant. A passing build or a DOM probe is not "checked"; only pixels are. If it was not seen, it is not done.

## Package release

`.github/workflows/publish.yml` is manually triggered with the exact version shared by both package manifests. It runs `npm test`, then publishes the core package before the theme to the public npm registry. The repository secret `NPM_TOKEN` is required; ordinary commits and pull requests do not publish packages. Site-specific suites and deployment belong to each site repository's own workflow.

## Testing money and mail without spending either

`STRIPE_MOCK=1` completes every buying path locally with Stripe's objects made up; `PRINT_MOCK=1` (or a printer's own `<ID>_MOCK`) answers every printer call locally and walks a mock order to shipped; with no relay set, mail is not sent and says so — or point `SMTP_HOST` at the local Mailpit container to read it. The deploy refuses every mock. Never run a real funnel or blast from a local stack: the relay is the real one.

## The specs are the edge

Each capability's spec (`openspec/specs/<capability>/spec.md`) names how every scenario is verified — a test script, the probe, a reset, screenshots — and a scenario marked NOT VERIFIED or "no pinned test" is the honest edge of what can be called production grade. See [The spec workflow](/content/docs/building-a-site/the-spec-workflow).

**`webhook-doors.test.mjs`** goes at the two doors that face the open internet, against the functions and the storage API as they are actually served. The specs said “the SDKs verify”, and they do — but what was being trusted is that we CALL them, on every path, before anything is read, and that is a property of our code one line away from not being true. Removing the signature line from `cal-webhook` makes it write five forged bookings. **`edition-id.test.mjs`** holds what makes a printed edition an edition, in both directions, because the hash has two ways to be wrong and they cost opposite things: too sensitive and every deploy re-sets every edition, paying a printer’s setup fee again and voiding every proof anybody has read; too blunt and a changed word ships under the old id, so the file in the bucket is not the book the proof was read at and nothing says so. **`doors-db.test.mjs`** asks the doors as the people the seed makes, and every case is a refusal to somebody who is NEARLY allowed — a member who signed in with a password rather than a link, an analyst with the figures but not the desk, a membership that lapsed yesterday, a forged tracking token. None of them are attackers; they are ordinary people one state away from being allowed, which is the boundary a change quietly moves. **`marketing.test.mjs`** pins the three things about marketing mail you cannot take back: a misspelt audience rule is dropped rather than quietly becoming everybody, an email’s uuid survives a rename and a reorder (which is all “once, ever” rests on), and the sign-in design keeps Supabase’s own link — checked by actually running `auth-config.mjs --dry` against a design whose button was moved. **`ranking.test.mjs`** pins the arithmetic behind Find your book — the properties rather than which three books come back, since a ranking cannot fail visibly: it always returns three, and if a half stopped counting nobody would know they were the wrong three. **`twice-db.test.mjs`** repeats webhook and cron writes to pin idempotency, then derives paid-session chat from the booking: it is only with that booking's coach, lasts until a week after the session ends, follows a move, ends on cancellation, and writes no membership entitlement. **`policies.test.mjs`** pins that a provider can reply in their coaching threads without a membership, while a reader needs a live membership or a paid session with that coach to open one. **`unpublished.test.mjs`** writes a probe record into each enabled public content collection, compiles it, and holds that `published: false` keeps it out of `.velite`, out of the palette’s rows and out of `publicRoutes()` — then publishes the same record and holds that it appears, so a filter that dropped everything would fail too. It derives the probes from the site’s module switches, so a docs-only site checks its docs without requiring unrelated `articles/` or `wiki/` folders. **`guards-db.test.mjs`** asks the running stack, as the people the seed makes, what a signed-in client may change: the desk’s guard trigger column by column, one coaching thread per pair whichever way round it is asked, a member who cannot grant themselves a role, and every scheduled job present after a reset. **`prices.test.mjs`** and **`promotions.test.mjs`** pin the two halves of what a thing costs,
and they are separate tests because they are separate questions: a price list says what a thing
costs for some people, a promotion says what comes off. Both were got wrong by being merged.
The price cases are Medusa’s resolution read off its source — an override always wins and may
be dearer, a sale is min(sale, default), the cheapest settles an equal pair — including the one
that caused the trouble: an override beats a cheaper sale, so a member CAN pay more than a
stranger, which is pinned so nobody re-derives it and reports it as a bug. The promotion cases
are written from what a shop would want, and the allocation ones are the point: "£10 off" is
three different instructions and a model that cannot tell them apart cannot be used.
**`promotions-db.test.mjs`** asks the database the only question that matters about a budget —
ten checkouts racing for three remaining uses, and exactly three win. A budget counted with a
read and then a write gives away four and nothing says so.

**`sell-rules.test.mjs`** pins what the shop refuses — a cloth or contents the book does not offer, a country outside the shipping list, a spine past the foil’s room, a proof gone stale — the decisions over plain data, every one of them a refusal that renders nothing when it works. One of them is there because it did not refuse: a variant key naming MORE choices than the book has options was accepted and silently truncated, so “parts.black.gold” against a paperback with no cloth list meant “parts” and the rest was dropped. Nothing the store writes is shaped like that — a hand-made request is — and it is refused now, which is the kind of change a test has to state outright or the next person reads the refusal as a regression. **`variants.test.mjs`** checks that print variant keys still round-trip through the general option rules when the site has published books set up for print; sites with print disabled or no such books report that compatibility comparison as skipped. **`suppliers.test.mjs`** pins the supplier seam three ways, because a plug-in seam is exactly the thing that rots quietly. The SHAPE each supplier wears; the VOCABULARY — checked against the source, that no method signature takes a word belonging to one kind of thing, since an interface that says `pages` can only ever be implemented by a printer; and the SEAM, that no module outside their directory names one. The two suppliers that are not printers are what make the first two mean anything: a post room that makes nothing and is moved by a person, and a download that is finished on arrival. **`manifests.test.mjs`** holds what a module declares about itself and whether it is true: a missing shape, a typo’d field, an exception with no reason and two manifests under one key are each refused rather than quietly meaning nothing, and a manifest claiming a step that is not one — or one another module claims — fails both ways. Its kit-source checks run in every site shape; assertions about assembled SQL run only when the selected site has a backend. **`modules-off.test.mjs`** switches each module off in turn and holds that nothing else moves — the answer to “will turning off the community break anything?”, which three fixture sites could not give, since they prove three points in a space of sixteen million ([Modules](/content/docs/building-a-site/modules)). Its couplings are read from the manifests rather than listed in the file, so one added later needs no edit to it. It asks a third question besides: what happens to a DECLARATION that asks for a module which is off. Most switches take a feature away and that is the end of it, but a channel’s file saying `encrypted: true` with `space-encryption` off would be served as plain text — sealed in the repository, readable in the database, nobody told — so the spaces compile must refuse it by name, and that refusal is pinned here along with the case that must NOT refuse: a compile told nothing at all about the modules, which is how it arrives in an Edge Function. It also lost 23 checks that could not fail: “only its own steps stop” read each step’s `module` and then asked whether the steps that stopped carried it, which is true by construction — the attribution judging itself. The mis-attribution they appeared to guard is caught in `manifests.test.mjs`, where a second source makes it falsifiable. **`sales.test.mjs`** pins that the Bestseller badge is earned rather than set — and that a site with no sales prints it on nothing, since the person who would notice a false badge is exactly the one with no sales to compare against. **`reads-db.test.mjs`** pins the arithmetic that stops the figures flattering us. Every number on the Content page can be wrong in the direction that feels good and nothing complains: somebody who leaves and comes back counted twice makes the library look twice as read as it is. It asks the page, writes one session in three segments on a real piece, and asks again — the difference is the arithmetic. **`money-db.test.mjs`** pins the other half of that: the database actually refusing the duplicate. A payment arrives more than once as a matter of course — Stripe retries, and the browser’s own `confirm-checkout` writes the same session the webhook does, on purpose — so what makes both writers safe is that the second cannot add anything. The failures sit in opposite directions: too loose and one payment becomes two purchases; too tight and three sessions bought together collapse into one credit, which is somebody paying for three hours of another person’s time and getting one, with nothing anywhere saying so. **`ledger.test.mjs`** pins what a payment means — who paid, which offer a line is, and what it grants — the decisions the ledger makes, taken out of the file so they can be checked without a stack. **`permissions-db.test.mjs`** asks the rules and the policies the same question, per seeded account and per table, and fails on any disagreement that is not declared with a reason (and on a declared one that has since been fixed). It found one on its first run. **`permissions.test.mjs`** holds the one ability to what the four vocabularies answered before it: for every shape of account the seed has, against every shape of gated entry, the ability's answer must equal the class ladder's — a parity check taken before the rewiring, so a difference is a bug. It also holds the seam: a site's rules adding, narrowing and revoking. **`sql-columns.test.mjs`** holds every column a SQL function names against the declaration, because Postgres cannot: a trigger’s `NEW` is a record whose shape is unknown until the trigger fires, so `new.printer` on a table whose column had been renamed to `supplier` compiled without complaint and raised on every insert into `fulfilments` — which is every print purchase — and `check_function_bodies` is off during apply anyway, correctly, since a function may reference an object created later in the same transaction. It reads the kit’s schemas and the site’s as one declaration, because a site’s own SQL reads the kit’s tables by column name and that makes the kit’s columns an API across the package boundary with nothing else watching it. It checks `new.`/`old.` against every table a trigger attaches the function to, an alias bound by `FROM`/`JOIN`/`UPDATE`/`INTO`, the column list of an `INSERT`, and the targets of an `UPDATE ... SET`; a name used both as a table alias and as a CTE or derived table anywhere in the body is **not** checked at all, since an alias is scoped to its query and a whole-body reading would check it against the wrong table. What it could not bind it counts and prints rather than passing over in silence, so the number it checked is a number and not a claim. **`collections.test.mjs`** holds the second content engine (`CONTENT_ENGINE=collections`) to the shape of the first: a relative directory, the body from the parser, an eager plain text, a single that is a record. Optional modules contribute their singleton records only when enabled; every site retains its site-settings singleton. The schema probe also uses Velite-compatible YAML date handling, so an unquoted date-like value remains a string rather than becoming a JavaScript Date.

## Repository ownership is checked

The PlatformKit test runner includes `site-boundary.test.mjs`: it checks maintained documentation, configuration, specifications, and changes for downstream-site identity without exempting archived records or historical changelogs. Core keeps site-neutral `docs/PURPOSE.md` and `docs/FEATURES.md`, and the boundary check requires and scans both; site-specific purpose and feature material remains with the site that owns it. The check also verifies that the npm workspace contains only PlatformKit packages and generic fixtures. Before publishing a sanitized Core snapshot, verify separately that excluded site artifacts are absent and the snapshot has no inherited Git history. A site repository can register its own build test to keep its documents and specifications with that site.
