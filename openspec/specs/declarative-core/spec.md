# declarative-core Specification

## Purpose

One question decides where anything lives: if the database were deleted and the repository redeployed, should this come back? Yes makes it a declaration and a file under `content/`; no makes it state and a row. A third answer, derived, is neither — nobody edits it and whatever writes it owns it. This capability is that line, and the machinery that holds it: every table classified as projected or state, no module building a synchronisation path of its own, and a new table unable to avoid the question in the commit that adds it.

## Requirements

### Requirement: A declaration is a file; the database may hold only a projection of it

Anything that describes what a site **is** SHALL be authored as a file under `content/`, and a site
SHALL be deployable from its repository alone. The database MAY hold a projection of a declaration,
for the operational reads that need one, and that projection SHALL be one-way: written by the build
or a service role from the compiled collection, never edited, never merged, and never consulted
about what the site is.

Anything that records what people **did** SHALL live in the database and SHALL NOT be authored as a
file. A declaration SHALL name only classes of people — a tier, an offer, a role — and never a
person; associating a person with anything is an act, and acts are rows.

#### Scenario: the folder is the site

- **WHEN** a deployment is made from the repository against an empty database
- **THEN** every room, channel, role, grant, offer, page, funnel, session type and string the site
  declares is there, and the only things missing are the things people had not yet done

Verified by: `build/declarations.test.mjs` for the classification; a deploy against an empty database

#### Scenario: a projection cannot be authored

- **WHEN** any client — the admin included — attempts to insert, update or delete a row of a
  projected table
- **THEN** the database refuses it, because no such policy exists for a signed-in role

Verified by: `build/declarations.test.mjs`

### Requirement: Every table is classified, and a new one cannot avoid the question

The kit SHALL keep one manifest naming every table it declares as projected from a content path,
state, or **derived** — a cache of what is already here, which nothing with a session may read or
write and which an empty table is a correct state for. A table appearing in none of the three, or in
more than one, SHALL fail the build. A table named as projected SHALL name a content path that a
collection actually produces.

A **projected** table SHALL be projectable wherever a publish can happen, including where there is
no machine to run a script: the kind that owns its source says how, and a kind that does not SHALL
fail the build unless the gap is **declared as an exception** in the deployment matrix, with its kind
and the change that closes it, and printed on every run. A projection SHALL happen on a **publish**
and never on a save, since a save is a draft nobody has agreed to show.

#### Scenario: a table arrives unclassified

- **WHEN** a table is added to a schema and named in none of the three lists
- **THEN** `npm test` fails and says which table and which decision is missing

Verified by: `build/declarations.test.mjs`

#### Scenario: a projection with no source

- **WHEN** a table is named as projected from a content path no collection produces
- **THEN** `npm test` fails, because a projection with no source is a table pretending to be a
  declaration

Verified by: `build/declarations.test.mjs`

#### Scenario: a derived table nothing may depend on

- **WHEN** a derived table grants a read or a write to a signed-in role
- **THEN** `npm test` fails, because a cache the site may empty is not something a session may rely on

Verified by: `build/declarations.test.mjs`

#### Scenario: a projection that could not run without a machine

- **WHEN** a kind owning a projected table's source cannot project itself, and no exception declares
  the gap
- **THEN** `npm test` fails and says which kind and what it needs

Verified by: `build/content-kinds.test.mjs`

### Requirement: One loop, and no module builds a second

A declaration SHALL reach the database by being a file under `content/`, so that cloud mode's own
machinery carries it: a row holding a live version and a draft, an admin that edits the draft, a
publish that goes live and pushes to the repository as one commit. No module SHALL build a
synchronisation path of its own for declarative data, and no admin surface SHALL write a projected
table directly.

#### Scenario: an admin edits a declaration

- **WHEN** a declaration is changed in the admin, in git mode and in cloud mode
- **THEN** in both the file is what changed; in cloud mode it is a draft until published, and the
  publish moves the repository

Verified by: the content pipe's own tests, and `build/declarations.test.mjs` for the absence of a
second path

### Requirement: What is on the wrong side today

The channel a platform event is announced in, the repository and branch cloud mode publishes to, the
webhook subscriptions a deployment ships already wired, and the hours a session type is bookable at
by default SHALL each be declared rather than written by hand. A secret SHALL remain an environment
variable and SHALL NOT be declared: cloud mode's token, the API keys' hashes and every provider
credential stay where they are.

#### Scenario: each moves

- **WHEN** a site declares an event's channel, a push target, a shipped webhook and a session type's
  default hours, and deploys from the repository
- **THEN** all four are in place with nobody having opened the admin, and no secret is in the
  repository

Verified by: `build/declarations.test.mjs`, and the demo site declaring one of each

### Requirement: Wherever there is a database, a publish is enough to reach it

A site runs in three shapes and only two hold a database: content in the repository with a backend,
and content in rows with a backend. (The third is a static site with no backend at all, where these
features do not exist; what that shape owes is its own capability.)

In **both** shapes that have one, publishing a declaration SHALL make the database agree with it
before anybody has to do anything else — no deploy, no commit, no hook. A deployment whose
repository is out of the cycle and which has no deploy hook never builds again, and a projection
deferred to a build there is a projection that never happens.

What is **state** SHALL stay state and SHALL NOT be made a file for this: what people said in a
room, what a bot did, who replied to an event.

The kit SHALL carry no projection that only a machine can run. Where one is owed the gap SHALL be
declared rather than kept as a comment, and SHALL be printed on every run.

A declared gap SHALL be held in **both** directions. A claim the code does not back SHALL fail; so
SHALL a declaration still standing after the change that was to close it has been archived, because
a gap that has quietly been closed is a feature nobody knows they have — which is how a finished
cloud path came to be read back off a stale list and repeated as fact.

#### Scenario: each declaration, on a deployment that will never build

- **WHEN** a space and its rooms, an event, a bot, an achievement or a team is published in the admin
  of a deployment with no repository and no deploy hook
- **THEN** the rows behind it agree with what was published, and the surfaces that read them — the
  community, the calendar, a bot's runner, the awards, the booker — show it without anything else
  happening

Verified by: `build/spaces-db.test.mjs`, `build/events-db.test.mjs`, `build/agents-db.test.mjs`,
`build/awards-db.test.mjs` and `build/teams-db.test.mjs`, each against a publish through the admin
function in cloud mode on the demo

#### Scenario: a draft moves nothing

- **WHEN** any of those is saved but not published
- **THEN** every row is as it was, and the admin shows the draft

Verified by: the same runs, reading the rows between the save and the publish

#### Scenario: nothing is owed in silence

- **WHEN** the suite runs
- **THEN** every gap the kit carries on purpose is printed by name with the change that closes it,
  and no projection is among them

Verified by: `build/modes.test.mjs`, which prints every declared exception on every run and fails a
module claiming `cloud` whose projected table carries no `projected()` hook; and
`build/content-kinds.test.mjs`, which requires the hook of every projected table a model owns.

There is no hand-written list behind this any more. `PROJECTION_DEBT` named the five that could not
project without a machine — spaces, the calendar, the bots, the achievements, the search index — and
it went with them, because a list kept by hand is a second opinion and the second opinion is the one
that goes stale.

#### Scenario: a gap outliving the change that was to close it

- **WHEN** a declared exception names a change, and that change is archived while the exception still
  stands
- **THEN** `npm test` fails, naming the change, what the gap says, and the two ways out — raise the
  claim and delete the exception, or say which change closes it now

Verified by: `build/modes.test.mjs`, asserted by archiving a live change's folder for one run and
watching the check name it

### Requirement: What the server can search is what has been published

The site SHALL keep one index of published content that anything running on the server may ask — a
bot answering a question about the site, above all — and publishing SHALL bring it up to date in
every shape, including where nothing rebuilds. A reader's own search is not this index and is
already answered from the rows the browser holds.

#### Scenario: a bot asked about something published a minute ago

- **WHEN** an article is published on a deployment that does not rebuild, and a bot is asked about it
- **THEN** the bot finds it

Verified by: `build/search.test.mjs` over a publish in cloud mode, and `build/agents-db.test.mjs`
for the tool that asks
