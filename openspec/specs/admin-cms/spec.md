# admin-cms

## Purpose

The admin: in dev a content management system over the markdown files, with an editor built for each kind of thing and a live preview; in production a desk of what needs a person — analytics for admins, the support inbox for the staff, notifications for both. It never shows a file's grammar, and it does not exist off localhost except as that desk.

## Requirements

### Requirement: The CMS is a dev-server middleware in git mode, and the `admin` function in cloud mode

The content API (`build/admin-server.mjs`: `/__admin/collections`, `list`, `file`, `preview`, `upload`, `options`, `action`, `asset`, `upload-image`, `run`) SHALL be mounted while Vite serves in git mode — so the whole read/write surface does not exist in a production build — and, in cloud mode (`cloud-content`), served by the `admin` Edge Function behind the administrator's JWT — the same pipe either way, shared through `_shared/pipe/`, with `publish` and `drafts` beside the rest; it SHALL serve every model of the registry (`content-pipe`) through the same endpoints, reading and writing the markdown under `content/` through each model's grammar, validating every write against the model's fields and checks, and preserving what the model does not model, so a file round-trips without loss. In cloud mode the drawer SHALL offer **Save draft** and **Publish** (the latter saving and publishing the one record after a confirm that names it), a row with a draft SHALL wear a *Draft* mark in the grid, and the Site group SHALL hold **Publishing** — every draft listed with who and when, a message, Publish everything, the repository's settings, the pushes' state — with the count of drafts on its rail item; in git mode the drawer's button SHALL be Save and Publishing SHALL say it is cloud mode's. The words SHALL be the `publishing` scope's and the drawer's in the `models` scope; a literal in a component is a bug.

#### Scenario: a production build

- **WHEN** `dist/` is served
- **THEN** in git mode `/__admin/*` answers as any unknown path and `/admin` is the desk alone; in cloud mode `/admin` is the CMS with the desk's tabs and the client talks to the `admin` function, refused without an administrator's JWT

Verified by: NOT VERIFIED by a pinned test — needs a built `dist/` served in two deployment shapes. It belongs beside the static and cloud lanes, which already build and walk a site, rather than in a unit check.

#### Scenario: a key the schema does not know

- **WHEN** a file with an extra frontmatter key is opened and saved in the admin
- **THEN** the key is still in the file

Verified by: `build/pipe.test.mjs` (the round trip)

#### Scenario: the drawer in cloud mode

- **WHEN** an administrator opens a record's drawer on a cloud-mode site
- **THEN** it offers Save draft and Publish; Save draft leaves the grid's row marked *Draft* and Publishing counting it; Publish asks *Publish "{title}"?* and, confirmed, clears the mark and the count

Verified by: Playwright on the demo in cloud mode, screenshots both themes

### Requirement: The rail and its sections

The admin SHALL assemble its rail from what the signed-in person may do, section by section, rather
than admitting administrators to everything and carving exceptions out for anybody else. A section
SHALL declare the capability it needs, and a person without it SHALL NOT see the section, SHALL NOT
reach it by its address, and SHALL be refused by the database if they ask for its data anyway.

A person holding neither a staff role nor an active module-scoped admin capability SHALL be shown
the gate, as now.

#### Scenario: four people, four different rails

- **WHEN** an administrator, a coach, an editor and an analyst each open the admin
- **THEN** each is shown only the sections their roles reach, and the first section they land on is
  one of those

Verified by: screenshots of each in both themes

#### Scenario: the address is not a way in

- **WHEN** an editor opens the address of a section only an administrator reaches
- **THEN** they are refused there, and the reads behind it answer them nothing

Verified by: `build/policies.test.mjs`

#### Scenario: the content pipe admits an editor

- **WHEN** an editor saves an article through the admin
- **THEN** the pipe writes it, as it does for an administrator
- **AND** the same editor is refused a write to anything that is not content

Verified by: `build/pipe.test.mjs`

#### Scenario: a module-scoped publisher enters only its section

- **WHEN** an invited social publisher with no staff role opens the admin
- **THEN** the Social section is the only section shown, its publishing views and data are available,
  its administrator-only Settings view and controls are not shown or reachable, and every unrelated
  section and backing operation remains refused

Verified by: `build/social-publishing.test.mjs` against the served local functions and CMS, plus
screenshots of the invitee's rail and Social navigation in both themes

#### Scenario: the rail's rows

- **WHEN** the rail is measured expanded and collapsed
- **THEN** every row's icon, heading and exit start on the same x expanded, and every icon is centred on one axis collapsed

Verified by: a Playwright measurement (no pinned test)

#### Scenario: a model's row

- **WHEN** a model is saved as published in the builder
- **THEN** the rail shows a row with the model's name under Content, opening its grid; unpublished, the row is gone and the entries' files stay

Verified by: a Playwright run; a screenshot of the rail with two models

#### Scenario: the orders page

- **WHEN** an administrator opens Sales → Orders on a stack whose seed holds a paid purchase
- **THEN** the purchase is a row with its buyer, product, amount and status, the filters narrow the list by kind, and a new purchase appears without a reload

Verified by: a screenshot of the page on the demo's seed; a purchase inserted under the mock while the page is open

#### Scenario: the bookings page

- **WHEN** an administrator opens Sales → Bookings on a stack whose seed holds a booking next week
- **THEN** it is a row under Upcoming with the attendee, the coach, the type and a join link; a past one sits under Past with its status and, when it has them, its recording and transcript

Verified by: a screenshot of the page on the demo's seed, both tabs

#### Scenario: the media row

- **WHEN** an administrator opens Content → Media
- **THEN** the file manager opens on Uploads, with Site files as its other root

Verified by: Playwright on the demo, a screenshot

#### Scenario: the API page

- **WHEN** an administrator opens Settings → API
- **THEN** the page says the site's space, environment and base address, lists every key with its name, kind, creation and last use, offers New key (a name, a kind, whether gated content is allowed) and shows a made key once with a copy control; a site with the `api` module off has no such row

Verified by: screenshots of the list, the form and the one-time reveal, both themes, 1280 and 390; the rail on the docs site with the module off

### Requirement: Every class in the admin is prefixed

Every class in the admin's stylesheets SHALL be `ui-`prefixed (or the editor's own prefix), including modifiers, because the site's global stylesheet owns bare names (`.wrap`, `.warn`, `.title`, `.empty`) and restyles anything that borrows them.

#### Scenario: a borrowed name

- **WHEN** an admin panel uses a bare `.title`
- **THEN** it is a fault: the site's rule restyles it

Verified by: reading (no lint yet)

### Requirement: A collection is a grid, a record is a drawer, a single file is inline

Every collection SHALL list as an ag-grid (the shared theme) with a Published switch per row and New; a record opens in a drawer with a form from the schema; a single-file collection (site settings, storefront) lands inline; the Books grid runs scripts on ticked rows (Enrich, Introductions only); a new file makes the dev server reload within a moment, so an action that navigates afterwards records its destination first.

#### Scenario: a new record

- **WHEN** New is pressed on a collection and saved
- **THEN** the file exists under the collection's directory with the schema's defaults and the grid shows it after the reload

Verified by: the admin daily (no pinned test) — and an attempt at a node-level one was abandoned rather than shipped half-right. The drawer’s blank does not validate on its own and should not (`title: ''` is compacted away and a required string is still required), so a check has to fill what the schema asks for; doing that from outside means guessing valid values for every enum, which is testing the guesser. This wants the browser, driving the real drawer.

### Requirement: Each kind of thing has the editor it deserves

The admin SHALL edit: a book's body by chapter (`ChapterEditor`, one TipTap instance for the open chapter, every other chapter byte-identical), its introduction and share image as fields, its print block on the Print editions page; a companion as chapters and Summary · Essence · Quiz tabs (`CompanionEditor`); the topics as the grid navigator, All levels, and Settings (`DiagnosticEditor`, `TopicsAdmin`), personality and word association on the same primitives (`PersonalityEditor`, `WordsEditor`), results copy and UI strings as string groups (`StringsEditor`); a landing page as a page builder (`PageBuilder`: blocks with a sketch of their layout, a gallery of the section types to add from — `SectionPicker` — a form per section drawn from its zod schema by the kit's own renderer, `SectionFields`, drag to reorder, and a live preview the builder points at and that points back); an experiment as a cards view with actions and a variants editor; an email as the Templatical designer with Test; a funnel as Audience · Emails · Settings with the audience as its own controls (`AudienceEditor`), chat steps as trigger rows and a choice tree (`ChatPromptEditor`, `ChoiceTree`), a span as number and unit (`SpanField`); a blast as Email · Audience · Send with a count and a confirm; the print block as five panels with live quotes and the book to turn; print orders and the support inbox live.

#### Scenario: a grammar shown

- **WHEN** any editor asks for a value as the text of its file grammar
- **THEN** it is a fault (admin-editing)

Verified by: `admin-editing`

### Requirement: The live preview shows the draft as the site would

Every drawer SHALL offer a preview pane that frames the page (`/__preview`) with the draft injected (`dl-preview`), a switch between looks when there is more than one, and never saves.

#### Scenario: a draft product

- **WHEN** a product's price is changed in the drawer
- **THEN** the framed store page shows the new price before saving

Verified by: the admin daily (no pinned test)

### Requirement: Production's `/admin` is the desk, in the one shell

`/admin` SHALL be the same shell everywhere — the rail and the page beside it — with what the rail offers decided by the mode and the role, never by a second layout. In production (git mode: no content pipe) the rail SHALL hold the views that read live data alone: Dashboard (Analytics, Content analytics), Settings (Notifications), Engagement (Support) and Sales (orders, print orders, bookings) — no content, no models; in cloud mode the CMS whole (`cloud-content`). A support agent SHALL see Settings → Notifications and Engagement → Support and nothing else, wherever they open it, and land on the inbox; a signed-in reader who is not on the staff SHALL see an empty rail and be told the desk is the team's; a guest the same with a way to sign in; the server re-checks the role on every admin call.

#### Scenario: a support agent in production

- **WHEN** a `support`-role account opens `/admin`, in production and in the CMS alike
- **THEN** the inbox opens in the rail's shell with Notifications and Support as its only rows, Analytics and every content row absent, and `/app/chat` is still refused; a member opening `/admin` sees an empty rail and *For the team only*

Verified by: Playwright against `vite preview` (observed once; no pinned test)

### Requirement: Placement in PlatformKit

**Module switch:** admin (always on).

**Layers.** core: the server, its validation, the section host, the editors' logic. theme: the admin's screens, `admin-ui.css`, the rail. site: its own sections (the quiz editors, recommendations) with their handlers.

**Extension points this needs:** sections and handlers registered; the generic bank editor in the kit; production's desk composed from the modules on.

**What the kit's module leaves to its comparable, on purpose:** WordPress's admin: no plugin marketplace, no user-facing settings screens beyond the site file; the CMS exists only in dev.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a site admin section

- **WHEN** a site admin section
- **THEN** it appears in the rail under its group with its own server handler and nothing else knows it

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change

### Requirement: Settings → Site settings edits the header

The site's header SHALL be edited where its footer already is, and SHALL be edited as fields rather
than as the grammar the file keeps.

Each item SHALL be a row with its **Label**, its **Link**, its **Icon** and who sees it. Rows SHALL be
added, removed and dragged into order, and the order on the page SHALL be the order of the rows.

The **Link** SHALL be chosen from the routes the site actually answers — its pages, the library, the
store, the community, whatever its modules add — or written as a path; a route a module has switched
off SHALL NOT be offered. The **Icon** SHALL be chosen from the same glyph palette the landing
sections use, drawn at its real size, and MAY be left empty. Who sees it SHALL be a control listing
the rungs and the site's own membership tiers by name — never a field somebody types `subscribed`
into.

The editor SHALL say, without being asked, what the header looks like now: a site that has written no
nav SHALL be shown the list it is inheriting and told where it comes from, so that starting one is
editing what is there rather than facing an empty box.

Saving SHALL write `content/site.md` through the same pipe as every other record, and SHALL be a draft
in cloud mode until it is published, like every other record.

**Intent.** The one site that set its own header had a page in it that nobody could remove without a
developer, because the only place to say so was a file of code.

#### Scenario: adding an item

- **WHEN** an administrator adds a row, names it, picks a route and saves
- **THEN** `content/site.md` carries the item, the header shows it in that position, and no other line of the file has moved

Verified by: `packages/kit/build/yaml-keep.test.mjs` (the save moves no line it did not change); the editor and the header screenshotted, light and dark

#### Scenario: nothing is typed as its grammar

- **WHEN** the editor is open
- **THEN** there is no field whose placeholder teaches a syntax and no free text but the label and a path — the audience is a control, the icon is a palette, the route is a list

Verified by: the editor screenshotted at 1280 and 390, light and dark

#### Scenario: an inherited header

- **WHEN** a site has written no nav
- **THEN** the editor shows the links it is inheriting, says they are the theme's, and offers to start from them

Verified by: the editor screenshotted on a site with no nav

### Requirement: The typefaces are chosen, never typed

Settings → Site settings SHALL offer the site's three typefaces as **chosen** faces — a list of
Google Fonts families searched by name, each shown set in its own letterforms — and SHALL NOT ask
anybody to type a font stack, a family string or a weights list.

This is the project's standing rule about structured data applied to type: the fallback stack, the
weights and the link are a grammar for the build, and an editor is asked for the part that is a
decision — which face — with a control that fits it.

#### Scenario: an editor changes the heading face

- **WHEN** an editor picks a family from the list and saves
- **THEN** `content/site.md` carries the family name alone, and the build makes the stack, the weights and the link from it

Verified by: pixels of Site settings with the picker open, both themes; `build/fonts.test.mjs` for what is written

#### Scenario: nothing asks for a font stack

- **WHEN** Site settings is rendered
- **THEN** no field asks for a comma-separated stack, a weights list or a stylesheet url, and no placeholder teaches one

Verified by: pixels; `build/fonts.test.mjs` refuses a field whose placeholder is a stack
