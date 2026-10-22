# kit-extension-model

## Purpose

The contract between PlatformKit's core, a theme and a site: what a site declares in one config file, what it may add or replace, what it may never touch, and how core honours it — so that a business can be built on the kit without forking it, and the kit can change without breaking the sites on it.

## Requirements

### Requirement: A site is one config file and its folders

A site SHALL declare itself in `platformkit.config.js`: its name, its theme, which modules are on, its looks, where its strings and content are, and its extensions (collections, overrides, routes, app tabs, nav, landing sections and skins, admin sections and handlers, event types, analytics panels, email kinds, the enrichment voice, build steps, tests, seed). Core SHALL read nothing about a site from anywhere else.

#### Scenario: the demo site

- **WHEN** `sites/demo` holds a config, sample content and no code of its own
- **THEN** `platformkit dev` serves the whole product with every module on, and `npm test` in the kit passes against it

Verified by: the kit's CI against `sites/demo`

#### Scenario: the registrations the config carries today

- **WHEN** a site's config names `routes` (`{ path, component, prefix?, prerender? }`), `nav` (`links` and `cta`, or neither for the theme's default), `landing.sections` and `landing.schemas`, `analytics.panels`, `app.tabs`, `overrides`, `looks`, `instrumentComponent`, `enrichment.briefs` and `build.tests`
- **THEN** the page answers at its path and is prerendered, the header shows the links and the call to action, a landing page may name the section and the admin's page builder offers it, the panel renders after the kit's on Content analytics, `/app` mounts the site's instrument, the enrichment writes in the site's voice, and `npm test` runs the site's checks after the kit's — each reached through a `#site/*` module the Vite plugin answers from the config and a Node fallback answers for the build scripts

Verified by: on 2026-09-17 a stub of each (a `/hello` page, a `Hello` link and a redirected CTA, a `Stub` section on /pricing and in the builder, a panel on Content analytics) seen in the browser and then removed; `packages/kit/build/test.mjs` in `npm test`

### Requirement: Every module has a switch, and the switch removes the whole module

Every module — the kit's own and any a site or theme registers — SHALL be switched off in the
config, and switching one off SHALL remove its routes, its theme pieces, its admin sections, its
analytics panels, its schema's use, its deploy requirements and its nav items together, never
leaving a dead link, an empty tab or a demanded secret. What a module owns SHALL be read from its
manifest rather than from a list of module names written into the code, so the set of modules is
open and a twenty-fifth needs no edit to the router, the deploy's check, the build steps or the
deployment matrix.

#### Scenario: no instrument

- **WHEN** `modules.instrument` is false
- **THEN** `/app` has no results or recommendations tabs (accomplishments are the reader's and stay), no quiz route answers, the admin has no Quizzes section, and `deploy-checks` asks for nothing the instrument needs (the analytics' Find panel is the library's round and stays)

Verified by: the demo run with `instrument: false` in the kit's CI; `deploy-checks --test`

#### Scenario: one module off touches no other

- **WHEN** any single module is switched off and every other left as it was
- **THEN** only that module's steps stop, only its secrets stop being demanded, and nothing starts

Verified by: `build/modules-off.test.mjs` over every module the manifests declare

### Requirement: A site overrides by name and extends by registration, never by patching

A site SHALL be able to replace any theme component by its registered name, override any string by its key, add a look, a route, an app tab, a nav item, a landing section type, an admin section with its own server handlers, an event type, an analytics panel, an email kind, a build step, a test, a migration, a function, a cron job and seed rows — and SHALL NOT need to modify any file of the kit or the theme to do so. A site that needs more is a request for an extension point, made through the kit's own change loop.

Where the kit has **behaviour of its own** at an extension point, a registration SHALL extend it rather than replace it, and the kit's behaviour SHALL keep working when the registration is removed. An extension point whose default is nothing may be replaced outright; one whose default does real work SHALL compose, so that a site does not lose what the kit knows by saying what it knows.

#### Scenario: an override

- **WHEN** a site's config names `SiteClose` with its own component
- **THEN** every place the theme renders the close renders the site's, and nothing else changes

Verified by: `packages/kit/build/overrides.test.mjs` (every component overridden by a stub, each import resolved to it through the real plugin); an override naming a component the theme has not is refused when the config is read

#### Scenario: a missing string override

- **WHEN** a site's strings file lacks a field the theme's default for that scope has
- **THEN** the theme's default renders — never blank, never `undefined`; a field the site writes wins, a group or a scope only the site has is the site's alone, and every build script that reads a word (the emails' tags, the checkout's line, the chat's follow-ups) reads the same merge

Verified by: `packages/kit/build/strings.test.mjs` in `npm test` (the grammar, the merge, no default lost and no site word overwritten over the real files); on 2026-09-17 the store hero's `from` line removed from the site's store.md showed the theme's default on /store

#### Scenario: a registration at a point the kit already answers

- **WHEN** a site registers at an extension point the kit has its own behaviour for, and the

  registration is then removed
- **THEN** with the registration both are in effect, and without it the kit's behaviour alone is,

  working as it does for a site that never registered

#### Scenario: a site's own module

- **WHEN** a site registers a module with its own manifest — a route, a build step, an environment variable — and switches it on
- **THEN** it behaves as one of the kit's: the route answers, the step runs, the deploy asks for the variable, and switching it off takes all three away and nothing else

Verified by: `build/modules-off.test.mjs` and `build/modes.test.mjs` against a fixture site that registers one

### Requirement: Core assembles the data layer from both owners

The CLI SHALL assemble one `supabase/` for the local stack and the deploy: the declaration — the kit's files first, then the site's — from which every database is brought to its end state (see `platform-data`); the functions of both into one directory with `_shared` copied from the kit, so a function never imports across a package boundary; the seed as the kit's shape followed by the site's rows. The kit SHALL ship no migration, and a site SHALL write none: a site adds tables, policies, buckets, cron jobs and functions by declaring them beside the kit's, and a kit release SHALL never require a site to rename, re-date or rewrite anything it already has.

The assembled tree SHALL be generated output and never a source. Every command that needs it — `dev`, `migrate`, `test` and `deploy` — SHALL assemble it before using it, so a site repository holds only its own `db/` and `supabase/config.toml`. The test step SHALL assemble a fresh tree before it checks one, and its check SHALL refuse what an assembly cannot fix: an unresolved import, a file under `supabase/` that neither owner declared, a `supabase/migrations` directory, and a `config.toml` whose seed setting does not name the declaration. No message from the assembler SHALL tell the reader to commit the tree.

#### Scenario: a kit release after a site's own changes

- **WHEN** a site has declared tables of its own and a kit release changes the kit's declaration
- **THEN** the site's next plan holds the kit's change beside the site's tables, untouched, and a reset lands on the same end state

Verified by: a kit test of the assembly — a site schema file, a kit schema change, one plan, a reset clean

#### Scenario: a site migration out of order

- **WHEN** a checkout still holds a `supabase/migrations` directory, or a site writes one (there is no order of migrations left to be out of)
- **THEN** `platformkit assemble --check` (in `npm test`) refuses the checkout and names the directory

Verified by: `assemble --check` in `npm test`

#### Scenario: a reset on either site

- **WHEN** `platformkit migrate reset` runs on `sites/demo` and on a site
- **THEN** the declaration, the data script and the seed apply, and every seeded surface is testable

Verified by: the kit's CI; `supabase db reset` locally

#### Scenario: a fresh checkout holds no assembled tree

- **WHEN** a site's checkout holds its `db/` and `supabase/config.toml` and no other file under `supabase/`
- **THEN** the test step assembles the tree and its check passes, with nothing for the reader to commit

Verified by: `node build/assembled-tree.test.mjs`, which runs the test step's assembled-tree commands on a copy of `sites/demo` with its generated tree removed

#### Scenario: a stale local copy is replaced, not reported

- **WHEN** the tree on disk was assembled from an older kit, so one assembled file differs from its source
- **THEN** the test step assembles over it and its check passes, rather than failing and asking for a commit

Verified by: `node build/assembled-tree.test.mjs`, with one assembled file altered before the step runs

#### Scenario: a hand-added file is refused

- **WHEN** a file under `supabase/functions` or `supabase/schemas` comes from neither the kit nor the site's `db/`
- **THEN** the check refuses it by name, says to run the assembler, and does not tell the reader to commit

Verified by: `node build/assembled-tree.test.mjs`, with a stray function file added before the step runs

### Requirement: A site registers what a member's card says about somebody

The private half of a member's card SHALL be seen only by that person and by staff, and SHALL show the kit's panels for the modules the site has on, in this order unless the site sets another:

- **Working**, where the site names an instrument of its own and the instrument module is on: the level the diagnostic last placed the person at, the level they have secured, and how many areas they have taken, each level named from the site's own instrument vocabulary.
- **Read**, where the library and analytics are on: the books and articles the person has opened, most recent first, each under the title it had when they read it.
- **Bought**, where the store is on: their paid purchases, newest first, with no payment provider's reference and nothing of any card.

Every panel's words SHALL be the site's strings, with the theme's defaults, and each title SHALL read differently on the person's own card and on somebody else's. A panel with nothing to show SHALL say so in its own sentence. A site SHALL be able to turn off any kit panel, add panels of its own (each a key, a title and a component), and set the order. A site's own panel SHALL be given the person's id and nothing else and fetch what it shows itself.

Every panel, the kit's and a site's, SHALL be drawn only after the database has said the reader may see the private half. Every read behind a panel SHALL ask the same rule again before answering, and a refusal SHALL look the same as nothing to show. A person's purchases SHALL be read from one source by the card's Bought panel and by the admin's person page, so the two never disagree.

#### Scenario: a site with no panels

- **WHEN** a site turns every kit panel off and registers none of its own, and a card is opened
- **THEN** the card draws its public half and nothing else, and no read for any panel is attempted

Verified by: `build/spaces.test.mjs` and `build/member-panels.test.mjs`

#### Scenario: the panels are site-registered

- **WHEN** a site registers panels of its own for its member card
- **THEN** the card draws them with the kit's, in the order the site set, for staff and for the person
- **AND** no site-specific name appears in the theme or the kit

Verified by: `build/sections.test.mjs`, `build/overrides.test.mjs` and `build/member-panels.test.mjs`

#### Scenario: a site with every module on

- **WHEN** a member opens their own card on a site with the library, analytics and store on and no instrument of its own
- **THEN** the private half shows Read and Bought, titled for them ("What you have read", "What you have bought"), and no Working panel

Verified by: `build/member-panels-db.test.mjs` under `platformkit test --e2e`, and the demo's card rendered at phone and desktop width in both themes

#### Scenario: a module that is off

- **WHEN** a site has the store off and a card is opened by staff
- **THEN** no Bought panel is drawn and no read of purchases is made for it

Verified by: `build/member-panels-db.test.mjs` under `platformkit test --e2e` on `sites/club`

#### Scenario: another member asks

- **WHEN** a signed-in member who is not staff asks for somebody else's read, bought or working answer directly
- **THEN** each answers exactly as it would for a person with nothing to show

Verified by: `build/member-panels-db.test.mjs` and `build/ownership.test.mjs` under `platformkit test --e2e`

#### Scenario: a site rewords, turns off and adds

- **WHEN** a site overrides a panel's strings, turns Bought off and registers a panel of its own after Read
- **THEN** the card shows its words, no Bought panel, and its own panel in the place it set
- **AND** no site's name, wording or panel appears in the kit, the theme or a kit specification

Verified by: `build/member-panels.test.mjs`

#### Scenario: the card and the admin agree on purchases

- **WHEN** a person's purchases are read by the card's Bought panel and by the admin's person page
- **THEN** both list the same purchases in the same order

Verified by: `build/member-panels-db.test.mjs` under `platformkit test --e2e`

#### Scenario: the instrument's own words

- **WHEN** a site names an instrument whose vocabulary names its levels
- **THEN** the Working panel shows the site's names for the levels, and never a level's internal key

Verified by: `build/member-panels.test.mjs`, and DharmaLab's card rendered before and after its copies are removed, which must match

### Requirement: A site declares its header

The links across the top of a site SHALL be a declaration with three layers, each more specific than
the last, and the most specific that exists SHALL be the whole list:

1. the theme's own, offered by rule — the library, pricing where a page claims that route, the store
   while the module is on;
2. a `nav` in the site's config, for a site that ships its header as code;
3. a `nav` in `content/site.md`, which an administrator edits and a publish carries.

A nav item SHALL carry what it is called, where it goes, optionally a glyph, optionally whether it
highlights for every path beneath it, and optionally who sees it. Their order on the page SHALL be
the order they are written. One item MAY be marked as the call to action, which is drawn as the
header's button rather than as a link.

Who sees an item SHALL be declared, never coded: an item MAY name the rung it needs on the platform's
own class ladder (guest · authenticated · paid · subscribed), a membership tier, or the staff. A rung
SHALL be a minimum, so an item asking for `paid` is also shown to a subscriber; `guest` SHALL mean
only somebody signed out. An item naming no audience SHALL be shown to everyone.

An item whose module is off SHALL NOT appear, whichever layer wrote it, and SHALL NOT be shown while
who is here is still unknown — it arrives with the rest of the header or not at all.

A label SHALL be reader-facing copy: an item of the theme's own is named by its string key so it stays
translatable, and an item a site writes is named in `content/site.md`, which is markdown like every
other word on the site. A label SHALL NOT be a literal in a template.

**Intent.** Three of these items were already conditional and each invented its own rule in the
layout; one of them hid a site's whole community from everyone who had not already joined it. A rule
about who sees a link belongs where the link is written.

#### Scenario: a site that writes none

- **WHEN** a site has no `nav` in its config and none in `content/site.md`
- **THEN** the header shows the theme's own links exactly as it does today, and nothing about the site changes

Verified by: `packages/kit/build/site-nav.test.mjs`; the demo and a site headers screenshotted at 1440, light and dark

#### Scenario: the administrator writes one

- **WHEN** a nav is written in `content/site.md`
- **THEN** it is the whole list — the theme's own and the config's are not merged into it — and it is live on the site at the next publish

Verified by: `packages/kit/build/site-nav.test.mjs`; the demo's header screenshotted before and after an item is added in the admin

#### Scenario: who sees it

- **WHEN** an item names an audience
- **THEN** a visitor on a lower rung never sees it, a visitor on that rung or higher does, an item naming `guest` disappears once somebody signs in, and a `tier:` item is shown only to a member of that tier or higher

Verified by: `packages/kit/build/site-nav.test.mjs` over the class ladder in `_shared/access.js`; the demo's header screenshotted signed out and as `member@example.com`

#### Scenario: a module goes off

- **WHEN** an item points at a module's route and that module is switched off
- **THEN** the item is not drawn, whether the theme, the config or the site's content wrote it — there is never a link to a route that does not answer

Verified by: `packages/kit/build/site-nav.test.mjs`; the demo run with `store: false`
