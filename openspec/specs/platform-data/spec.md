# platform-data

## Purpose

The data layer's conventions: migrations that are the schema's only history, RLS as the gate for readers and the service role behind a function for everyone else, the buckets, the cron jobs, the reader's own state as a CRDT synced to the account, and the entitlement ladder every gate reads.

## Requirements

### Requirement: The database is declared

The kit SHALL ship its database as a declaration — the end state, one file per module: tables, functions, policies, triggers, indexes — and never as migrations; a site SHALL declare its own additions as files loaded after the kit's, so that a site's tables may reference the kit's. Every database SHALL be brought to the declaration by a diff: a fresh local database by applying the declaration, its data and its seed in that order; a live database by the plan the deploy computes against it (see `deploy`). The declaration SHALL never be applied by hand and never through the SQL editor; extension functions SHALL be schema-qualified in every declaration; `app_settings` SHALL hold the functions url and secret as before.

**Intent.** Two owners evolving one database can never be ordered against each other by hand; there is no history to order, only an end state and the distance from it.

#### Scenario: the declaration covers everything the kit has

- **WHEN** the kit's declaration is diffed against a database against a database produced from the site's current schema state
- **THEN** the diff is empty — every table, function, policy, trigger, index and storage policy the kit has is in the declaration and the tool sees it — and any gap is named before anything else is built

Verified by: the coverage check, first task of the change: the pg-delta diff of a reset a site database against a shadow holding the declaration, over public, storage and auth, empty

#### Scenario: a fresh database

- **WHEN** `platformkit migrate reset` runs on the demo and on a site
- **THEN** the declaration, the data script and the seed apply in order, and every seeded surface is testable

Verified by: `supabase db reset` locally on both

#### Scenario: a kit change reaches a site

- **WHEN** a kit release changes its declaration (a column added, a policy changed, a function rewritten) and the site plans
- **THEN** the plan holds exactly that change and nothing else, and a reset lands on the same end state

Verified by: a kit test — a schema file edited, the plan's statements the expected ones, a reset clean

#### Scenario: a site's own table

- **WHEN** a site declares a table with a foreign key to a kit table and a policy that uses the kit's `is_admin()`
- **THEN** the plan holds it, a reset applies it after the kit's, and nothing of the site's is needed in the kit

Verified by: the same kit test, on the demo, with a site schema file added

#### Scenario: a hosted difference

- **WHEN** a declaration uses a pgcrypto function unqualified
- **THEN** the plan fails on the hosted project though it passes locally — a fault caught by `deploy` before now, and to be written `extensions.` from the start

Verified by: `supabase db reset` (local); the hosted plan (observed)

### Requirement: Who may read what

A signed-in reader SHALL reach their own rows under RLS (answers, user_docs, entitlements, purchases, bookings by the people on them, **what the site has worked out they are interested in**, a coach's hours and exceptions by that coach alone (an administrator reads them, the open times a reader sees come from a function, never the rows), chat by `in_conversation()`, push subscriptions by owner); the staff by `is_staff()` / `is_admin()`; in cloud mode (`cloud-content`) the site's content as rows of `public.content` — a row's live version (`text`, `data`, `body`) and, beside it in `content_drafts`, its draft (the edit's text, data and body, who and when, `deleted` for a removal); published rows **with a live version** by anyone, every row by an administrator, a draft by no client at all (RLS on, no policy), written by the `admin` function with the service role and by nothing else. A client SHALL NOT change a guarded column — the columns the server keeps (`escalated_at`, `acknowledged_at`, `email_verified_at`, `notes` apart) refused by trigger.

What the site has worked out somebody is interested in SHALL be readable by that person and by nobody else — never by another member, and today by no staff surface either, since none asks. It SHALL take no argument naming whose interests to read, so there is nothing to pass somebody else's account in. A reader SHALL NOT be able to set it: it is derived from what they have done, and a value anybody could write is not derived.

#### Scenario: a client changes a guarded column

- **WHEN** a staff client updates `support_conversations.escalated_at`
- **THEN** the guard trigger refuses it

Verified by: NOT VERIFIED by a pinned test

#### Scenario: an administrator reads every order

- **WHEN** an administrator selects from `purchases` and `bookings`
- **THEN** every row comes back; a member selecting the same tables gets their own rows and no one else's

Verified by: the seed's accounts against the local stack (admin, member) in a kit test of the policies

#### Scenario: a drafted row and a reader

- **WHEN** an anonymous client selects from `content` while one row has a draft and no live version, and another has a live version and a draft
- **THEN** the first is not returned; the second is returned with its live version, and its draft is not readable — not from `content_drafts`, not through the join

Verified by: `store.test.mjs` against the local stack

#### Scenario: a member reads a coach's hours

- **WHEN** a member's client selects from the hours table
- **THEN** it receives no rows, while the coach's own client receives theirs and an administrator's every coach's

Verified by: `build/scheduling.test.mjs` with the seed's accounts

#### Scenario: a reader asks what they are interested in

- **WHEN** a signed-in reader asks for their interests
- **THEN** they get their own and no others, and an attempt to set one is refused

Verified by: `build/recommendations.test.mjs` against the local stack — another account seeing none of it, the call refused when given an argument naming somebody, a guest getting nothing, and the index itself not writable by a reader

### Requirement: The buckets

`audio` and `models` SHALL be public; `chat`, `support`, `print`, `recordings` (a call's recording and transcript under the booking's uid, 2 GB per file, written by the functions alone) and `content-assets` (the uploads and covers of cloud mode, written by the `admin` function, each with a public copy the rows point at) private, read through signed urls or the signed-in client under their policies; a reader may insert an audio recording under exactly `books/<slug>/<hash>.mp3` and never update or delete.

#### Scenario: a reader replaces a recording

- **WHEN** an authenticated client tries to overwrite an existing audio object
- **THEN** the policy refuses it

Verified by: `build/webhook-doors.test.mjs` — a signed-in reader uploads a recording nobody has made, and is then refused a second upload, an `upsert` (the single call that replaces, which a policy written only against insert would let through) and a delete

### Requirement: The clocks

pg_cron SHALL run `chat-followups` every minute, `email-funnels` hourly at :07,
`support-escalate` every five minutes and `support-retain` nightly at 04:20, each calling its
function over pg_net with the settings in `app_settings`. Each scheduled job SHALL be declared by
exactly one enabled kit, site or theme module with its stable name, schedule and database action.
The assembled database declaration SHALL install or update every declared job once and remove jobs
that are no longer declared by an enabled module, without changing jobs owned by other modules.

#### Scenario: after a reset

- **WHEN** the local database is reset
- **THEN** `cron.job` lists the four named jobs and every other scheduled job declared by an enabled module, each exactly once, and no job owned only by a disabled module

Verified by: `build/guards-db.test.mjs` and `build/cron-registration.test.mjs`, reading `cron.job` directly from Postgres

#### Scenario: a schedule changes or is removed

- **WHEN** a module's declared schedule or database action changes, or the module stops declaring a job, and the assembled database declaration is applied
- **THEN** the job has the current schedule and action or is absent, there are no duplicates, and jobs owned by unrelated modules are unchanged

Verified by: `build/cron-registration.test.mjs` against the local database, applying declarations repeatedly and checking updates, removal and an unrelated job

### Requirement: The reader's state is a CRDT, synced to the account

The device's state SHALL be a Loro document (the `dl.*` keys: places, marks, settings, shown prompts) that stays the offline buffer; for a signed-in reader the cloud copy (`user_docs`) is the source of truth — pulled and merged on sign-in so a guest's work survives their first login, pushed after every commit, pulled on focus; answers are rows in `answers` as the record of truth for the diagnostic; the support token and the analytics anon id live outside the store on purpose; sign-out stops the sync and clears the device.

#### Scenario: a guest's answers on first sign-in

- **WHEN** a guest who answered a round signs in on the same device
- **THEN** the answers are on the account and the sheet reads them

Verified by: NOT VERIFIED — and the scenario may no longer be reachable. A guest who opens `/app/quiz/teachings` is redirected to `/app/diagnostics` and shown Sign in, which is what AGENTS.md says should happen (“a round of the quiz needs one — every answer is written to the account”). If a guest cannot answer a round, there are no guest answers to carry in. Decide whether the guest path is meant to exist before writing a check for it.

### Requirement: The entitlement ladder

Access SHALL be one monotonic ladder — guest, authenticated, paid, subscribed — read from `get_my_entitlements` (`userClass`, `tiers`, `plan`, credits) and cached locally; every gate (a chapter's allowance, the chat, a session, the results) asks `canAccess(required)` or a tier and never a product; "Start over" removes every answer and reading, never books, marks or trophies.

#### Scenario: a lapsed member

- **WHEN** a subscription's entitlement expires
- **THEN** the reader is `authenticated`, reads the chat but cannot send, and the paid chapters close

Verified by: `build/doors-db.test.mjs` — the entitlement is dated into yesterday and the same person can still read their thread and can no longer write to it

### Requirement: Placement in PlatformKit

**Module switch:** —.

**Layers.** core: the conventions, the assembly of migrations and functions, the buckets, the clocks, the ladder, the Loro sync. site: its own migrations, functions, seed rows.

**Extension points this needs:** the CLI's assembly with the ordering rule; roles registered; the ladder's classes fixed (guest, authenticated, paid, subscribed) with tiers as content.

**What the kit's module leaves to its comparable, on purpose:** Supabase's dashboard: no schema editing outside migrations, ever.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a site migration

- **WHEN** a site migration
- **THEN** it applies after every kit migration and the assembly refuses one dated before the kit's newest

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change

### Requirement: A rename is declared

A table or a column SHALL carry its former names in its declaration (`-- renamed from: <newest>, <older>…`), and the plan SHALL rename — the object, and every index, constraint and sequence named after the old name — only where a former name exists and the current does not; where both exist it SHALL refuse and name them; where neither exists it creates. The rename SHALL come before the diff, so the diff then sees an object matching its declaration and plans nothing destructive for it. Former names are kept as long as any database might still carry them; a fresh database never meets one. A change no declaration expresses — a value recomputed, a column split — is a one-off script and never a general mechanism.

**Intent.** A diff cannot tell a rename from a drop and a create; the declaration can, and nobody writes a migration.

#### Scenario: the kit renames a table

- **WHEN** a kit release renames a table in its declaration with the former name annotated, and a database still carries the old name with rows in it
- **THEN** the plan holds the `ALTER … RENAME` for the table and for the objects named after it, nothing destructive, and the rows are there under the new name after it applies

Verified by: a kit test — a table renamed in a copy of the demo's declaration, rows inserted before, present after, the plan free of `DROP`

#### Scenario: the rename converges

- **WHEN** the same plan is computed for a fresh database, for one renamed already, and for one two releases behind (the annotation listing both former names)
- **THEN** the first creates, the second plans nothing for it, the third renames from the oldest name it finds — and all three end identical

Verified by: the same kit test, three databases

#### Scenario: both names present

- **WHEN** a database holds both the old name and the new
- **THEN** the plan refuses, names both, and applies nothing

Verified by: the same kit test

### Requirement: Nothing is dropped without a person saying so

A plan holding a destructive statement — a table, column or schema dropped, a table truncated, a type change that cannot keep its data — SHALL be refused whole: nothing applied, every such statement printed with its object. It SHALL be applied only when `PLATFORMKIT_ALLOW_DESTRUCTIVE=1` is set for that run, and the run SHALL say the variable was set and what it allowed. `platformkit migrate --plan` SHALL print the plan and the guard's verdict without applying anything.

**Intent.** Production data is lost only on purpose, by a person, on the day.

#### Scenario: a column removed from the declaration

- **WHEN** a schema file drops a column and the plan is computed without the variable
- **THEN** it is refused, the `DROP COLUMN` printed with its table, nothing applied, the exit non-zero

Verified by: a kit test — a column removed, the refusal, the statement named

#### Scenario: allowed on purpose

- **WHEN** the same run is repeated with `PLATFORMKIT_ALLOW_DESTRUCTIVE=1`
- **THEN** it applies, and the log names the variable and the statements it allowed

Verified by: the same kit test

### Requirement: The kit's data that is not schema

The extensions, the buckets, the settings rows the kit needs, and the scheduled jobs declared by enabled modules SHALL be present in one idempotent assembled script shipped beside the database declaration — every statement safe to run again. Modules SHALL own their scheduled-job definitions in their manifests; the assembled script SHALL be generated from those definitions rather than maintained as a separate cron list. The script SHALL be applied after the declaration on a reset and after the diff on every deploy, so a site never has to know which of the kit's needs are rows rather than shapes.

#### Scenario: a bucket added to the kit

- **WHEN** a kit release adds a bucket to its data declaration
- **THEN** the next deploy and the next reset both have the bucket, and the script run twice against one database raises nothing

Verified by: a kit test — the data declaration changed, run twice against one database, the bucket present

#### Scenario: a module declares a scheduled job

- **WHEN** an enabled kit, site or theme module declares a scheduled job and the database is reset or deployed
- **THEN** the assembled data script installs the job exactly once, and applying it again leaves the schedule unchanged

Verified by: `build/cron-registration.test.mjs` against the assembled data and local database

### Requirement: A derived column is not data

The destructive guard SHALL treat a column the database computes for itself as
derived rather than kept: dropping one SHALL NOT be refused, for the same reason
dropping an index, a constraint or a default is not — its value is a function of
its own row and is recomputed, so nothing is lost.

Because a generated column's expression cannot be altered in place, changing one
IS a drop and a re-add. A change that loses nothing SHALL NOT require the
variable that exists for changes that do; a guard that refuses a rebuilt index is
one people learn to wave through.

Which columns are derived SHALL NOT be inferred from the plan's text, which
cannot distinguish a generated column being rebuilt from a kept column being
replaced by a computed one. It SHALL be read from the database being changed, and
passed to the guard, which SHALL remain a pure function of what it is given.

Everything that loses rows SHALL still refuse the plan, including a kept column
of the same table, a generated column of another table, and dropping the table a
generated column lives in.

#### Scenario: a search index's recipe changes

- **WHEN** a generated column's expression changes in the declaration, so the
  plan drops the column, re-adds it and rebuilds its index
- **THEN** the guard reports nothing destructive and the plan applies without
  `PLATFORMKIT_ALLOW_DESTRUCTIVE=1`, and every existing row has the column
  recomputed

Verified by: `build/destructive.test.mjs`, and the same plan run against the
local stack — refused before the guard was told, applied after

#### Scenario: a column that holds something

- **WHEN** a plan drops a column the database does not compute
- **THEN** it is refused as before, whatever else the plan does

Verified by: `build/destructive.test.mjs`

### Requirement: What a Matrix client holds is state, and is classified as such

An access token, the device it was issued to, and where a person has read to in each room SHALL be
rows and SHALL be declared as state in `build/declarations.mjs` — they are made by an act, they are
never a file, and redeploying the repository must not bring them back. A key of kind `matrix` SHALL
be an `api_keys` row like every other key. None of these SHALL be projected from content, and no
client SHALL be granted a write to a projected table by this surface.

#### Scenario: the check answers for every new table in the same commit

- **WHEN** the tables this surface adds exist
- **THEN** each is classified as state with its reason, none is projected, and a table in neither
  list fails

Verified by: `build/declarations.test.mjs`

### Requirement: The store's new tables answer the declaration question

`inventory`, `inventory_movements` and `promotion_redemptions` SHALL be classified as state. A price list SHALL be projected from its file and SHALL grant no write to `authenticated`.

#### Scenario: every table is in one class

- **WHEN** `declarations.test.mjs` runs
- **THEN** each new table is state or projected, with its content path where it is projected

Verified by: `declarations.test.mjs`

### Requirement: The store still sells with no backend

A site in the static shape SHALL still build a storefront, a product page and a variant picker from files alone. Stock, price lists with an audience, and promotions SHALL be declared absent in that shape rather than failing.

#### Scenario: a static storefront

- **WHEN** the static lane builds a fixture with the store on and no Supabase in the environment
- **THEN** every store route renders, and no request reaches a backend

Verified by: `modes.test.mjs`; the static lane

### Requirement: A billable invocation is reserved against its site's provider chain and rates

A billable invocation SHALL resolve its operation policy, providers, fallback order, model tariffs, and customer markup from the site that owns the invocation. A site-funded operation SHALL record provider cost without charging reader credits or a reader's metered subscription. A prepaid or metered operation SHALL reserve enough authorization for the maximum cost of the configured attempts before the first external provider call. Each attempt SHALL be attributed to its actual provider and model. An unknown operation, provider, missing tariff, or reservation too small for the configured fallback chain SHALL refuse reader-billed work before provider work. A request or response SHALL NOT be able to substitute another site's or operation's policy.

#### Scenario: provider costs differ across sites

- **WHEN** the same operation and model name are invoked for two sites with different provider tariffs
- **THEN** each reservation and settlement uses only the owning site's provider chain and rates

Verified by: `build/usage-db.test.mjs` and the isolated multi-site provider configuration test

#### Scenario: a fallback attempt may also incur cost

- **WHEN** a provider attempt fails and the site's policy allows another provider
- **THEN** each attempt remains covered by an authorization reservation and is settled or conservatively estimated separately before unused reservation is released

Verified by: `build/usage.test.mjs` with a billed fallback chain and provider-call counters

#### Scenario: the chain cannot be fully reserved

- **WHEN** available credits or the active subscription policy cannot cover the configured maximum provider-attempt cost
- **THEN** the invocation is refused before any external provider call

Verified by: `build/usage-db.test.mjs` with an insufficient-balance provider-call counter

#### Scenario: a site-funded operation still records upstream spend

- **WHEN** an explicitly site-funded operation completes a provider attempt
- **THEN** the site can audit its provider cost and actual operation without debiting reader credits or reporting reader-metered units

Verified by: `build/usage-db.test.mjs` and the usage report fixture

#### Scenario: deleting a reader anonymizes but retains attempt accounting

- **WHEN** a reader account that has inference attempts is deleted
- **THEN** its attempts retain provider, operation, cost, sponsor, and measurement evidence while the reader identity is removed

Verified by: `build/usage-db.test.mjs`

### Requirement: Missing provider usage is never recorded as zero-cost work

When a provider may have processed a billable request but returns no valid usage measurement, the platform SHALL settle that attempt at its previously reserved maximum and mark the cost as estimated. A failure proven to occur before the provider received the request SHALL release that attempt's reservation. A fallback SHALL proceed only when its additional maximum cost is already authorized. The resulting ledger SHALL preserve the measured-versus-estimated distinction for site reporting and reconciliation.

#### Scenario: the provider completes without usage counters

- **WHEN** a provider may have performed billable work but its response has no valid usage counters
- **THEN** the user is not granted free work through a zero-cost settlement; the reserved maximum is charged and the event is marked estimated

Verified by: `build/usage-db.test.mjs` and `build/usage.test.mjs`

#### Scenario: a transport failure is known to precede provider receipt

- **WHEN** the server can establish that no provider received the request
- **THEN** that attempt's reservation is released and no provider cost is recorded for it

Verified by: `build/usage.test.mjs` with a pre-send transport failure fixture

### Requirement: Usage is a record of what happened, and nothing is billed twice

What somebody used SHALL be recorded as state — never anything a redeploy restores — append-only,
each record keyed uniquely on the single piece of work that produced it, so that a retried run, a
replayed provider notification or a listener that reconnected mid-conversation SHALL record nothing
the second time. A person SHALL be able to read their own usage and SHALL NOT be able to write any
of it.

#### Scenario: already-reported work is replayed

- **WHEN** a run is retried after a failure, or a provider notification arrives twice, for work already recorded and reported
- **THEN** no second record is written, no balance moves, and nothing further is reported to the provider

Verified by: `build/usage-db.test.mjs` against a reset stack — the same work submitted twice and the row count unchanged

#### Scenario: a meter-event acknowledgement is uncertain

- **WHEN** Stripe's response to a meter event is uncertain and the event is retried inside Stripe's rolling identifier-uniqueness window
- **THEN** the same stable identifier is reused so Stripe does not count the usage twice

Verified by: `build/usage.test.mjs`

#### Scenario: an uncertain meter event outlives Stripe's uniqueness window

- **WHEN** an unconfirmed meter event is still unresolved after the documented 24-hour minimum uniqueness period
- **THEN** automatic resubmission stops and the usage is surfaced for reconciliation rather than risking a duplicate charge

Verified by: `build/usage.test.mjs`

#### Scenario: a person reads their usage

- **WHEN** a person asks what they have used and what they have left
- **THEN** they see their own and nobody else's, and can change none of it

Verified by: `build/usage-db.test.mjs` under the policies, as each of two people

#### Scenario: a balance is derived, and whatever writes it owns it

- **WHEN** a balance is read
- **THEN** it equals what was granted less what was used, and nothing but the platform's own writer has ever written it

Verified by: `build/declarations.test.mjs` (state, not projected, no write granted to `authenticated`); `build/usage-db.test.mjs` recomputing the balance from the records and comparing

### Requirement: Speech is measured as well as thinking

Where a conversation is spoken, what was spent turning speech into text and text into speech SHALL
be recorded against the same person and the same bot as the thinking was, so that what a site bills
for a spoken minute is what a spoken minute cost it. A record of speech SHALL be keyed as every
other usage record is, so a reconnection bills nothing twice.

#### Scenario: a spoken conversation

- **WHEN** a person holds a spoken conversation with a billed bot
- **THEN** the speech and the thinking are both recorded against them, and the total is what the conversation cost rather than the thinking alone

Verified by: `build/usage.test.mjs` with a recorded session; one live spoken conversation whose recorded total is compared with the providers' own figures

#### Scenario: the listener reconnects

- **WHEN** the listener drops and rejoins the same conversation
- **THEN** the seconds already recorded are not recorded again

Verified by: `build/usage.test.mjs`

### Requirement: Speculative work is never charged to anybody

Where the platform does work speculatively — producing a reply or speech before it is known to be
wanted — what is discarded SHALL NOT be charged to the person, even though it was spent. What was
spent SHALL still be visible to the site, so the cost of speculation is somebody's decision rather
than a hidden loss.

#### Scenario: a speculative turn is discarded

- **WHEN** a reply or its speech is produced speculatively and then thrown away because the person had not finished speaking
- **THEN** nothing is charged to them, and the site can still see what it spent

Verified by: `build/usage.test.mjs` — a discarded speculative turn recorded as cost with no billed units

### Requirement: Every configured billable invocation is authorized before paid work

Any server-side operation configured for usage billing SHALL be able to use the same
surface-independent authorization and settlement contract, whether or not it belongs to a bot,
agent, voice session, page, or named module. The gate SHALL bind the operation to a
server-verified subject, stable offer identity, and idempotent invocation identity; bot or
surface metadata MAY be recorded but SHALL NOT be required for billing. Before paid provider
work begins, the gate SHALL atomically reserve enough prepaid units for the operation's bounded
maximum, or verify an active subscription for the same usage offer that authorizes the declared
metered usage. If neither authorization is valid, the operation SHALL be refused before its
provider is called. Long-running work SHALL obtain further authorization before exceeding its
reservation. Successful work SHALL settle server-measured usage idempotently and release unused
reservation; failed or abandoned work SHALL release unused reservation without recording a
second charge on retry.

#### Scenario: a non-bot operation uses the common gate

- **WHEN** a site server operation outside the bot and voice surfaces requests billable work for an authenticated subject
- **THEN** it can use the same gate with its offer and invocation identity, and the provider runs only after authorization

Verified by: `build/usage.test.mjs` with a non-bot invocation fixture

#### Scenario: neither prepaid units nor an active usage subscription exists

- **WHEN** an invocation has insufficient reservable credits and no active subscription authorizing that usage offer
- **THEN** it is refused before the provider call, with no billable usage or meter event recorded

Verified by: `build/usage-db.test.mjs` with a provider-call counter

#### Scenario: concurrent invocations compete for the last prepaid units

- **WHEN** concurrent invocations request reservations whose combined maximum exceeds the subject's available credits
- **THEN** authorization admits no more work than the credits can cover

Verified by: `build/usage-db.test.mjs` with concurrent reservation attempts

#### Scenario: an active subscription authorizes metered work

- **WHEN** the subject has an active subscription for the same usage offer and the offer permits metered usage
- **THEN** the invocation may proceed and its measured billable usage is reported once under that offer

Verified by: `build/usage-db.test.mjs` and `build/usage.test.mjs` with an active and an expired subscription

#### Scenario: a long-running invocation reaches its reservation

- **WHEN** a stream or other long-running invocation reaches its currently authorized maximum
- **THEN** further billable work proceeds only after another authorization succeeds; otherwise the work stops before more provider usage is incurred

Verified by: `build/usage.test.mjs` with a bounded streaming fixture

### Requirement: Automatic top-up charges are reader-authorized, capped by the reader, and idempotent

The platform SHALL attempt an automatic top-up only when both the site's configuration and
the reader's explicit preference enable it. The reader's preference SHALL identify an eligible
prepaid offer, a usage-balance threshold, explicit consent to off-session payment, and the
reader's own maximum top-up spend per calendar month. No site-owner setting SHALL impose or
raise a per-reader spending cap. The platform SHALL derive the reader, offer, price, and payment
method from trusted server-side records, serialize concurrent attempts, and use a stable
idempotency identity for each charge. A confirmed payment SHALL grant the declared pack once;
an unconfirmed, declined, or authentication-required payment SHALL grant nothing and SHALL NOT
authorize provider work.

#### Scenario: one low-balance event is observed concurrently

- **WHEN** multiple invocations observe the same reader below their configured threshold
- **THEN** the platform makes at most one charge for the top-up attempt and inserts at most one corresponding grant

Verified by: `build/usage-db.test.mjs` and mocked Stripe idempotency assertions in `build/usage.test.mjs`

#### Scenario: payment succeeds but grant persistence is delayed

- **WHEN** Stripe confirms a top-up payment but the grant write is retried after a transient failure
- **THEN** the same payment identity is used, the grant is recorded once, and no invocation is authorized until the grant is visible in the balance

Verified by: `build/usage-db.test.mjs` with repeated payment-grant delivery

#### Scenario: reader's cap or site switch blocks top-up

- **WHEN** the site disables automatic top-up or the reader's personal monthly cap is exhausted
- **THEN** the platform attempts no charge and refuses any invocation the available balance cannot cover before its provider is called

Verified by: `build/usage.test.mjs` with a provider-call counter
