# deploy

## Purpose

What a production deploy must have, and what it must never do: refused whole before anything runs when the environment lacks what the content switches on, migrations that apply cleanly and can be applied again, and nothing that reaches production from a developer's machine by accident.

## Requirements

### Requirement: The deploy is refused before it runs anything

The deploy SHALL check the environment against what the content switches on before it links, pushes, builds or deploys anything, and SHALL refuse with every missing or wrong setting named at once. Anything for sale needs Stripe's live key and webhook secret; a book in print needs a printer for every printed format it sells; a published booking type that cal.com schedules needs cal.com's webhook secret and API key — a site whose every type the site itself schedules needs nothing of cal.com's; a published type whose call happens in the site's video room needs LiveKit's address, key and secret, and — when the type records — the storage keys the room lands the film with; a site whose room types are all links needs nothing of LiveKit's; a mock switched on is refused. **A feature that is off asks for nothing, and that SHALL include the backend itself**: a site with no accounts, nothing for sale, nothing booked and nothing mailed SHALL be asked for no database, no mail relay and no push keys. A site that DOES switch on something needing a backend and has none SHALL be refused by what it has on, in those words, rather than by the name of a missing variable.

#### Scenario: a bare environment

- **WHEN** `DEPLOY=1 node build/deploy.mjs` runs with the target guards satisfied and nothing else set
- **THEN** it prints the missing settings and exits 1 having run no command

Verified by: by hand once per change to the checks

#### Scenario: the rules

- **WHEN** `node build/deploy-checks.mjs --test` runs
- **THEN** every rule passes (`npm test` runs it), the steps' needs among them — a native-only site asks for no `CAL_*`, a site with one cal.com type asks for both; a site with no room type asks for no `LIVEKIT_*`, one room type asks for the three, one that records for the storage keys too

Verified by: `deploy-checks --test`

#### Scenario: a site with nothing on

- **WHEN** the checks run over a site with every module off and an empty environment
- **THEN** nothing is missing: no database, no shadow, no relay, no push pair

Verified by: `deploy-checks --test`, the case added for it

#### Scenario: a feature with nowhere to keep anything

- **WHEN** a site has the store on, or accounts, or a booking type, and no backend is configured
- **THEN** the deploy is refused and says which feature needs one, not which variable is unset

Verified by: `deploy-checks --test`

### Requirement: Migrations apply cleanly and again

The deploy SHALL bring the production database to the declaration by a plan computed against that database: the declared renames first, then the diff of the database against the declaration, then the kit's data script — and SHALL apply nothing when the plan is empty.

A plan holding a destructive statement SHALL be weighed against the target before it is judged: the rows a table holds, the values a column holds and how many of them differ from that column's own default, the non-null values a type change would convert. A statement that would lose nothing — no rows, or no value that differs from the default — SHALL be applied without consent, as a generated column already is, and the log SHALL say what it counted. A statement that would lose values SHALL be refused whole, each statement named with its object and what it would cost, unless consent is given for that plan. A count that cannot be taken SHALL be treated as unknown and refused, never as nothing.

Consent SHALL be `PLATFORMKIT_ALLOW_DESTRUCTIVE=<digest>`, where the digest is a short hash over the destructive statements the plan holds, printed by the refusal that asks for it, and SHALL be honoured only for that exact set of statements. It MAY name the objects it permits (`<digest>:<object>,<object>`), so that a destructive statement the allowance did not name still refuses. A commit sha SHALL also be accepted, matched against the commit being deployed (git `HEAD`, else the sha the host provides), for a deployment that would rather tie consent to a release. An allowance that matches neither SHALL be ignored, and the log SHALL say what it named and what this plan is. The bare `1` SHALL remain accepted everywhere, and the log SHALL say that it is a standing permission rather than consent for this plan, and print the digest that would have scoped it.

The digest is over the statements and NOT over the commit because a removal has two sources and only one of them is a commit of the site's: the other is a kit upgrade, which may drop a column with no site commit at all — a range resolving to a newer version gives one site sha two different schemas — and a commit-scoped allowance would permit it silently. The statements are the same from either side, and a digest of them needs no git on the machine that applies them.

The deploy SHALL need a connection to the production database for this (`SUPABASE_DB_URL`) and to a shadow database (`PLATFORMKIT_SHADOW_DB_URL`, a second project kept for nothing else, reset to the declaration and diffed against production, since the deploy box has no Docker for a shadow of its own), both demanded by the environment checks like any other setting, and a shadow that is production itself refused. Nothing under `supabase/migrations` is pushed, ever again.

**Intent.** The person who removes a column from the declaration and the person who ships it may be days apart; each says yes — and neither should have to count rows by hand to find out whether the question matters.

#### Scenario: a clean reset

- **WHEN** `supabase db reset` runs
- **THEN** the declaration, the data script and the seed apply in order and the seed lands (a syntax error anywhere fails this)

#### Scenario: a retry over leftovers

- **WHEN** the plan is applied a second time to a database that already received it, or the data script runs twice
- **THEN** the plan is empty and the script completes without error

#### Scenario: the declaration matches production

- **WHEN** the deploy runs and the production database already matches the declaration
- **THEN** the plan is empty, nothing is applied, and the deploy goes on to the functions and the site

#### Scenario: a drop that would lose nothing

- **WHEN** the plan drops a column and no row holds a value differing from that column's default
- **THEN** the log says how many rows were counted and that nothing would be lost, and the plan applies with no consent asked for

#### Scenario: a destructive plan

- **WHEN** the plan holds `DROP COLUMN` over rows holding values that differ from the column's default, and no consent is given
- **THEN** the deploy prints the statement, its table, and how many values would be lost, and exits before applying anything, linking or building

#### Scenario: the count cannot be taken

- **WHEN** the target refuses the count, or the relation is not there to count
- **THEN** the cost is reported as unknown and the statement is refused as though it would lose everything

#### Scenario: consent given

- **WHEN** the same deploy runs with `PLATFORMKIT_ALLOW_DESTRUCTIVE` set to the digest the refusal printed, to a commit sha that names this deploy, or to `1`
- **THEN** it applies, and the log says which allowance it matched and which statements it allowed

#### Scenario: an allowance left behind on the host

- **WHEN** the variable still holds the digest of an earlier plan and a later deploy carries a different destructive statement
- **THEN** the digest does not match, the log says what the allowance was for and what this plan holds, and the plan refuses

#### Scenario: a removal that arrives without a commit

- **WHEN** the site's commit is unchanged and a kit upgrade — a version range resolving further on — brings a destructive statement
- **THEN** the digest is computed from the statements and refuses as it would for any other plan, and a commit-scoped allowance from an earlier deploy does not admit it

#### Scenario: an allowance scoped to what it was for

- **WHEN** the variable names a digest and an object (`<digest>:public.space_members.role`) and the plan holds a second destructive statement on another object
- **THEN** the named object is allowed and the other refuses

#### Scenario: the blanket permission

- **WHEN** `PLATFORMKIT_ALLOW_DESTRUCTIVE=1` is set, anywhere
- **THEN** the plan applies, and the log says this is a standing permission rather than consent for this plan and prints the digest that would have scoped it

Verified by: `build/destructive.test.mjs` (the verdict, the digest over the statements and its stability, the commit match, the object scope, the interactive rule, unknown-refuses); the kit's schema test (a column removed with values, the plan refused, nothing applied; the same column empty, applied); `platformkit migrate --plan --linked` against production, which counts and applies nothing

### Requirement: Nothing reaches production by accident

`npm run dev`, `npm run build` and the tests SHALL never link, push or deploy to the production project; only `build/deploy.mjs` with `DEPLOY=1` (or CI), a remote `VITE_SUPABASE_URL` and the allow-listed project ref may.

#### Scenario: a local run

- **WHEN** any script other than `deploy.mjs` runs
- **THEN** it reads the local stack or `.env` and never a production key

### Requirement: The seed leaves every surface testable

`supabase db reset` SHALL leave the coaching inbox, the support desk, the store's customer state and the bookings with something in them, through the seeded accounts, so nothing has to be made by hand to look at a surface: the coach with hours set (weekdays, mornings, their time zone) and a native booking next week beside the cal.com one, a member over an allowance, a shipped paperback, a thread each way. The demo's seed SHALL do the same for its own module set.

#### Scenario: after a reset

- **WHEN** `npm run db:reset` finishes
- **THEN** the seeded coach's Coaching tab shows their hours and next week's native call, and the booker offers their mornings

Verified by: Playwright after a reset (the scenario's screenshots)

### Requirement: Placement in PlatformKit

**Module switch:** —.

**Layers.** core: the checks by module, the order, the refusal. site: nothing.

**Extension points this needs:** `deploy-checks` reads `modules`; a site's own required settings declared in the config.

**What the kit's module leaves to its comparable, on purpose:** —.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a site's own secret

- **WHEN** a site's own secret
- **THEN** declared in the config as required, the deploy refuses without it

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change

### Requirement: A site with no backend deploys as what it is

Where a deployment has no backend, the deploy SHALL do the only thing there is to do — build the
site — and SHALL NOT link a project, compute a plan against a database, deploy functions or set
secrets. The build SHALL produce the same pages it produces for a backed site, less the surfaces
that need one.

#### Scenario: the deploy of a static site

- **WHEN** a site with every module off is deployed with no backend in the environment
- **THEN** it builds and the pages are written, and no database or function command runs

Verified by: `build/static-site.test.mjs`, which runs the deploy's own plan over that environment and
asserts which commands it would run

#### Scenario: the pages of a site with no backend

- **WHEN** such a site is built, prerendered and served
- **THEN** every route renders, no page logs an error, and nothing asks a backend for anything

Verified by: `build/static-site.test.mjs` — the docs site built with no Supabase in the environment,
served, and every route visited with the console and the network watched

### Requirement: The deploy knows which shape it is deploying

The deploy SHALL decide its shape before it runs anything, from the site's own declaration rather than from what the environment happens to hold, and SHALL run only the steps that shape has somewhere to put. In **static** it builds and does nothing else. In **git** and **cloud** it does what it does today. The decision SHALL be one branch taken once, not a condition repeated at each step, and a build step SHALL declare whether it needs a backend so that a step added later cannot silently break a shape.

#### Scenario: the shape is decided once

- **WHEN** the deploy runs with no backend in the environment
- **THEN** it links no project, computes no plan, deploys no function and sets no secret, and the target guards that demand a project ref and an access token do not run

Verified by: `build/modes.test.mjs`, asserting the commands the deploy plans in each shape

#### Scenario: a build step that needs a backend

- **WHEN** a build step declares that it needs one and the shape is static
- **THEN** the deploy skips it and says so, rather than running it against nothing

Verified by: `build/modes.test.mjs`

### Requirement: A cloud deployment may run a prerender sidecar

The nginx app SHALL be able to run a Chrome-backed prerender service beside the site: a crawler's request for a page SHALL be answered with rendered HTML, and a request under the share path SHALL be answered with the baked picture where one exists and otherwise with the sidecar's photograph of the app's own share route, cached. The sidecar SHALL be run in the **cloud** shape alone — a static or git-backed deployment bakes both at build time and SHALL NOT start it — and a deployment that cannot run it SHALL fall back to the `share-image` function without any page pointing at a picture that does not exist.

#### Scenario: a crawler on a page that was never baked

- **WHEN** a crawler requests a record published after the last build
- **THEN** it is served rendered HTML with that record's own head

Verified by: `build/share-cloud.test.mjs`, over the compose stack

#### Scenario: a reader on the same page

- **WHEN** a person requests it
- **THEN** they are served the app as before, not the prerenderer's output

Verified by: `build/share-cloud.test.mjs`

#### Scenario: the shapes that do not run it

- **WHEN** the deploy runs in the static or git shape
- **THEN** no sidecar is started and every picture is the build's

Verified by: `build/modes.test.mjs`, which asserts the commands each shape plans
