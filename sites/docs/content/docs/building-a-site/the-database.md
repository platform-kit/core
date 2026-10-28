---
title: The database
description: A declared schema instead of migrations — the files, the plan, renames, the destructive guard, the assembled supabase tree, and the local reset.
order: 48
sources:
  [
    packages/kit/supabase/schemas,
    packages/kit/supabase/data.sql,
    packages/kit/supabase/schemas/87-api-rate.sql,
    packages/kit/supabase/schemas/91-matrix.sql,
    packages/kit/supabase/schemas/92-encryption.sql,
    packages/kit/build/plan.mjs,
    packages/kit/build/runtime-paths.mjs,
    packages/kit/build/destructive.mjs,
    packages/kit/build/assemble.mjs,
    packages/kit/build/assembled-tree.test.mjs,
    packages/kit/build/cron.mjs,
    packages/kit/build/modules/manifest.mjs,
    packages/kit/build/modules/kit.mjs,
    packages/kit/build/schema.test.mjs,
    packages/kit/supabase/seed.sql,
    packages/kit/build/dev-account.mjs,
    packages/kit/supabase/schemas/12-content.sql,
    packages/kit/supabase/schemas/15-library.sql,
    packages/kit/supabase/schemas/20-instrument.sql,
    packages/kit/supabase/schemas/90-spaces.sql,
  ]
reviewed: 2026-10-27
---

The platform runs on Supabase — Postgres with auth, storage and edge functions. Locally a copy runs in Docker (`supabase start`, which `platformkit dev` does for you). The kit ships the whole data layer; a site adds to it.

## The database is declared, never migrated

There is no migration anywhere: none shipped by the kit, none written by a site, none generated. The kit's schema is a **declaration** — the end state, one file per module under `packages/kit/supabase/schemas/`:

```
10-foundation.sql   profiles, the role, the verified address, the person's document, app_settings, is_admin/is_staff/is_support/is_subscribed, admin_people (who a set of accounts are, for an administrator), the trigger on auth.users
12-content.sql      cloud mode's content: every file under content/ as a row — its live version (path, collection, slug, published, the frontmatter as JSON, the body, the exact text, whether the push has it) — and content_drafts, its draft beside it (the edit's text, data and body, who and when, deleted for a removal not yet published); published rows with a live version readable by anyone, every row by an administrator, a draft by no client (RLS on, no policy), no client write; run_content_push (the pending rows to the repository as one commit, asked by cron) Only administrators read the rows; a visitor is sent them through reader-content, without gated text.
15-library.sql      the audio bucket's sharing policy
20-instrument.sql   answers, results, signals
25-forms.sql        a form's responses and answers, the analytics, the Forms API's webhook subscriptions
30-analytics.sql    events (with `source` and `distinct_id` for another site's), experiments, the dashboards' reads (the channel rule, a session's facts and the filter predicate, the audience predicate, the KPIs and the registered goals, right now, a piece, the members, the events, the retention cohorts)
40-commerce.sql     purchases (own, or every row as an administrator), subscriptions, entitlements, `payment_events` deduplicated by provider and event id, `payment_provider_refs` for provider-scoped external ids, the legacy Stripe event and identifier fields, print orders
46-courses.sql      courses, course_lessons and course_cohorts (projected from content/courses by courses-push; no client writer), enrollments and lesson_progress (a person reads their own), course_notices, certificates; course_lessons_for decides what is open and why not, course_lesson is the one way a lesson's text leaves the database, course_complete checks what the server can see (a form passed, a session booked), and a trigger on purchases and entitlements enrolls a buyer or member on the way in
50-chat.sql         the coaching chat
55-sessions.sql     bookings (the people on one, or every row as an administrator; a row whether the site or cal.com made it — provider, type, host_id, where, a group's seat_of, room — the video provider's own name for the room), a host's SETS of hours and their exceptions (provider_schedules — any number per host, one theirs by default, each with its own week, buffers before and after, notice and caps — and provider_overrides, each day off belonging to the set it was written on; the host's own, an administrator reading), the hold a booking takes on each of its hosts (booking_holds: one per host, a GiST exclusion so nobody's time is taken twice, and for a collective type one per host of the same booking), the reminders sent, book_native (a native booking made whole under a lock on its time; btree_gist and an exclusion constraint on host × time so a one-to-one is never booked twice), admin_hosts, the follow-ups, the refusals, a call's recording (its path, when it was pulled, the pull's state) and the three crons' callers; the Scheduling API's webhook subscriptions (scheduling_webhooks)
60-emails.sql       the audience, the log, the links, the funnel members, the funnel analytics reads
70-support.sql      the support desk (contacts with their custom attributes, conversations, messages, the inbox reads; support_webhooks and the support_api_notify triggers that tell the Support API of every write)
72-tickets.sql      the desk's tickets: support_tickets (a piece of work with a number, a state, a priority, a due date and what is owed), support_ticket_assignees (one or more, a row each), support_ticket_events (one timeline — what was said, what was noted internally, and every change of state) and support_ticket_links (which conversations it came out of, many to many); the reads for the desk and for a person's own, and a write for each act, because a state change is both a column and the line that explains it
80-push.sql         the staff's browsers and the triggers
85-api.sql          the APIs' keys (a hash, a kind — delivery, preview, management, forms, scheduling — whether gated content is allowed, the last use); content_webhooks, the Management API's subscriptions (name, url, topics, headers, active, the last delivery and its error; administrators read, the service role writes); sweep_uploads, the daily sweep of the API's uploads (pg_cron asks the content function); storefront_carts, the Store API's carts (a token, the lines, the buyer; the service role alone; thirty days, then the same sweep)
95-events.sql       the calendar: calendar_events (an event as its file declares it — who it is for, where it happens, and either a date or a repeat), calendar_occurrences (what the repeat makes, expanded over a rolling year by build/events-push.mjs and rewritten when the file changes; one somebody is coming to, or one called off by hand, survives the rewrite), calendar_rsvps (who said they are coming, and whether they came); event_for_me (the same predicate a space's membership is filled by, asked of one audience), events_upcoming and events_mine (the reads a community's home makes), event_rsvp (through a function because three things must hold at once — it is for you, it is not called off, and there is room) and event_occurrence_set (one called off by whoever keeps the space)
90-spaces.sql       spaces (rooms with their own membership rule — a role, a tier, something bought, an entitlement, or invitation only; and, for one open to people who did not sign a contract, whether it is discoverable, the room to start in, its headings and what is on — every one of them its file's), space_members, channels (a stream or a forum, open or private, each carrying its own last_seq), channel_members (last_read_seq, mention_count, the notify level), space_messages (one table for a stream's line, a forum's post and a thread's reply; the seq assigned under a lock on the channel, the stored tsvector), space_mentions, space_reactions, space_hooks (which channel takes which of the platform's events — a room's own `hears` line), space_roles (a role is a record of its space — name, colour, rank — declared in the space's own file, so a site invents its own), space_member_roles (holding one is a row, so who holds it is a query), space_grants (what a person may do beyond speaking — one row per grant, at the scope the site means it at: everyone, a space, a room, a tier, something bought, a role, one person — every one but the last declared in a file (source 'file'), the last an act made through space_grant_person (source 'hand') — read by space_may, which the insert policy, the storage policy and space_unread all ask so they cannot disagree), desk_done (what a member of staff has finished with, for the three status-less sources — coaching, space and Social provider conversations), space_invites (a link somebody made, as its sha256 — the token is made in the browser and never sent here — with how many uses are left and until when; accepting is source 'invite', which the sweep leaves alone), space_moderation (every act: a report, a message withdrawn, a member muted or removed from the space — who did it, to whom, why, when and until when, never edited and never deleted, written by functions rather than a policy because a policy that lets somebody insert a record lets them insert a false one; a mute is a row of it and the insert policy on space_messages asks it, so there is one fence rather than three); space_joined, which gives the space's `member` role and puts the new member into its open rooms (a trigger on the membership rather than on whatever made one, since four things make one) and space_room_made, which does the other half for a room declared after people are already there; space_sync_one, which brings ONE person's rooms to the rules and is run by a trigger the moment their standing changes — a purchase paid or refunded, a membership begun or ended — so a paid room is entered the moment it is paid for rather than on the next hour's sweep; the reads — space_unread, space_catchup, space_history, space_posts, space_thread, space_search — and the sets every policy is written against (my_space_ids, my_channel_ids, my_readable_channel_ids), security definer so a policy neither recurses nor evaluates a second policy per row; space_wake, the private broadcast topic per channel, with the receive and send policies on realtime.messages
93-network.sql      the social network, every row of it state: network_posts (everyone or here, what a post answers, its counts; never edited), network_likes, network_reposts, network_follows, network_blocks (mutual, ending the follows), network_mutes (private), network_pins (a space run through a timeline), network_seen, network_moderation (report, remove a post, suspend, lift — never edited), network_identities (a joined member's portable identity), network_app_passwords and network_sessions; network_can_read, the one sentence every read asks, and network_timeline / network_notifications, which run as the reader
92-encryption.sql   what an encrypted channel keeps, which is as little as it can and still work: space_devices (a person's devices and their PUBLIC identity, signing and cross-signing keys — readable by anybody sharing a room with them, because sealing a message to somebody means knowing their public key, and by nobody else, so the table is not a directory of everybody who ever signed up), space_one_time_keys (claimable exactly once, which is a property of the `delete … returning` and not of anybody's good manners — a `select` then `delete` hands the same key to two callers and two sessions built on one key is the failure this table exists to prevent; a fallback key is the exception, served when the rest have run out and never deleted, so a device that has been offline too long is still reachable), space_to_device (a room key on its way between devices, queued per device and deleted once delivered — the body is already sealed, so this table holds a ciphertext it cannot read; sending is not a client write, because an insert policy letting one person write into another's queue lets anybody deliver anything as anybody), space_key_backups (a reader's own sessions, sealed under a recovery key shown to them once and never again — the site cannot show it twice because the site never had it); channels.encrypted, projected from the channel's own file; space_messages.cipher, and the constraint that a row carries its words either in the open or sealed and never both; and the trigger that makes the seal one-way
```

Each holds its tables, functions, policies, triggers, indexes, grants and revokes, the publication's tables, and the policies on `storage.objects` — everything the diff can see. Beside them, `data.sql` holds the **rows that are not schema** — the extensions, the buckets, the cron jobs, `app_settings` — every statement idempotent, run whole on every reset and every plan. Every file opens with `SET check_function_bodies = false`, so a function may name a table a later file makes. Extension functions are written `extensions.`-qualified. No file says who owns an object: whoever creates it does (`postgres`, locally and hosted), and a hosted session through the pooler may not assign ownership.

### Two guarantees that are properties of the data

An encrypted room is only as private as the row it leaves behind, and two of the ways it could leak
are closed in the schema rather than in the code that writes it.

**The index holds nothing.** `space_messages.fts` is a generated column over the title, the body and
the attachment's name, so a sealed message leaves all three null and the full-text index holds
nothing for it — search misses the room for free, with no change to the index and no exception
anywhere in the search path. The attachment's name is the one that is easy to write by accident, and
it is the one that matters most: "severance-agreement.pdf" findable in a room whose words nobody can
read is the kind of half-guarantee that reads as a bug and is one. A check constraint refuses a row
that carries a cipher and any of the three together, so it cannot be done by one careless insert.

(`space_messages_body_check` — a text message must have a body — is REPLACED in `92-encryption.sql`
rather than loosened in `90-spaces.sql`, because `cipher` does not exist until the later file runs
and the earlier one is applied first. A sealed message's words ARE the ciphertext.)

**The seal is one-way once anything is behind it.** Turning `encrypted` off would make the room
readable from now on and leave every message already in it a ciphertext nobody will ever decrypt
again, because the clients stop asking: a timeline of "cannot read this" with no way back, and the
person who flipped the switch told nothing. A trigger refuses it the moment the room holds a sealed
message, and allows it while the room is still empty, which is the only time it costs nothing.

A site declares its own tables in `db/schemas/*.sql` (config `data.schemas`), loaded after the kit's, so a site table may reference a kit table and a site policy may call `is_admin()`; its own rows in `db/data.sql` (`data.rows`). The kit never needs anything of the site's.

> **`41-inventory.sql`** holds what is left: three stored numbers per shape, `available` derived and never stored, a movement per change with its reason, and `inventory_sweep()` on cron — the floor under a checkout that died without its payment provider reporting the outcome.

## Who may call a function

**Revoking PUBLIC alone is not a fence.** Postgres grants `EXECUTE` to `PUBLIC` on every new
function, and Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` and `authenticated` on top of
it. A file that revokes PUBLIC and then grants to `authenticated` has been open to a signed-out
visitor the whole time — and so has one that simply grants, with no revoke at all.

So every function in these files that says who may call it comes as a pair, and then the grant:

```sql
REVOKE ALL ON FUNCTION "public"."my_teams"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."my_teams"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."my_teams"() TO "authenticated", "service_role";
```

A function that is open on purpose — somebody's public page, the site's own class — says so by
granting `anon` by name, and needs nothing taken back. `build/declarations.test.mjs` refuses any
that does neither, so a new function cannot quietly inherit the default again.

A `GRANT ALL … TO "service_role"` with no revoke reads as closed and is open to everybody — that is
how the native scheduler's `book_native`, the agent worker's claim and the order reads were reachable
by a signed-out visitor — so the file check refuses that too. And the database is asked as well:
`build/ownership.test.mjs` lists every `SECURITY DEFINER` function a visitor or a reader can call on the
running stack and fails on any whose body does not ask who is calling (`auth.uid()`, `is_admin()` and
the other role helpers), unless it is on the test's reviewed list of public reads, each with why.

A reader's own row is not all theirs to write. `guard_profile_privileged` refuses a change to a
profile's roles, its payment customer, its proven flag and its **address** — the account's own, which
guest purchases are claimed by and session hosts are named by. A member's `channel_members` row takes
updates to how the room tells them things (a column grant), never to which room it is or how they came
to be in it. `comments` is read, never written, from a client: `comment_say` and the moderators' functions
write it. A provider's offering is guarded on insert as on update, so it cannot be created already on sale.

## Membership is the only gate a space has

The spaces module is worth reading as an example of the shape the kit prefers for anything with rooms in it. **Visibility is scoped to a space and never to the site**: a channel marked open is open _within its space_, and there is no query, view or policy by which a signed-in person reaches a channel of a space they are not a member of. Every policy is written against a membership set and nothing else — never a role at the site's level, never "signed in". **And the structure is a file.** A space, its rooms, its roles and the grants a site ships are declared under `content/spaces` and projected into those five tables by the build; there is no insert, update or delete policy on any of them for a signed-in role, so an admin screen cannot author the declaration into the database. What an administrator still writes is the acts — a membership, a role given, a capability handed to one person — because those name a person. See [Declarations and state](/content/docs/building-a-site/declarations-and-state). A private channel stays invisible to anybody outside it, an administrator included, and they cannot add themselves to one either — which is the same hole by a longer path. Moderation is therefore over the rooms they can already read, and it is a withdrawal and never a rewrite: the edit guard refuses a body change by anybody but the author.

Those sets are `my_space_ids()`, `my_channel_ids()` and `my_readable_channel_ids()`, each `STABLE SECURITY DEFINER`. Both words matter. Definer, because a policy on `space_members` that queried `space_members` would recurse for ever, and because a policy that reached another table through _its_ policy would evaluate a second policy for every row. Stable and set-returning, because Postgres then computes the set once per statement and hashes the lookup, instead of asking the question again for each row it considers.

The same module shows how unread is counted, which is to say not counted at all: each channel carries `last_seq`, each membership `last_read_seq`, and the unread figure is the subtraction. `space_unread()` costs what a person's channel count costs and nothing more, whatever the history holds. Live works the same way — one private broadcast topic per channel, sent by the database itself, authorised by a policy on `realtime.messages` that asks the same question reading asks, so there is never a second gate to keep in step. The tables are deliberately **not** in the realtime publication: nothing fans out per row.

One trap the module is worth knowing for: `auth.role()` reads the request's own claim, not the effective database role, so a `SECURITY DEFINER` trigger still looks like the caller inside a guard. A guard that refuses a client's edit will therefore refuse the module's own write — a thread's reply count, say — and take the whole insert down with it. `pg_trigger_depth()` is what tells the two apart.

A paid session selected in the app and purchased through the selected payment provider is fulfilled once per provider-scoped checkout identity. The service-role-only `booking_checkout_fulfilments` table records that idempotency claim and its outcome; it is separate from the booking row, so webhook and success-page confirmation cannot create the same booking twice.

## The plan

Every database is brought to the declaration by a **plan** — `platformkit migrate` (`packages/kit/build/plan.mjs`) — in three parts, applied in order, each in its own transaction:

1. **Renames.** A table or column carries its former names on its own line:
   ```sql
   CREATE TABLE IF NOT EXISTS "public"."memos" ( -- renamed from: notes, scribbles
       "id" bigint …,
       "body" "text", -- renamed from: text
   ```
   The plan asks the database which names exist: the current alone → nothing; a former one alone → `ALTER … RENAME` for the object and for every index, constraint and sequence prefixed with the old name; more than one → refused, naming them. So a fresh database, one renamed already and one two names behind all end identical, and nobody writes a migration. Former names are kept as long as any database might still carry them. A change no declaration expresses — a value recomputed, a column split — is a one-off script, never a general mechanism.
2. **The diff**, from the database to the declaration, by **pg-delta** (bundled in the Supabase CLI) over `public`, `storage` and `auth` — the managed schemas contributing their policies and triggers alone. The declaration becomes a **shadow** through the CLI: the assembled files, in order, written as the one file of a throwaway project under `node_modules/.cache/platformkit/shadow` (gitignored, fresh each run), then either the CLI's own Docker shadow (`db diff --to migrations`, a developer's machine) or — where there is no Docker, the deploy box — a **shadow database**: `PLATFORMKIT_SHADOW_DB_URL`, a Postgres kept for nothing else — a Supabase project (its user is `postgres`, which the diff needs), or a plain one whose user is `postgres` or can create that role (a managed Postgres whose cluster already owns `postgres`, Render's included, cannot), which the plan gives the platform's shape on first use (the roles the declaration grants to, `auth` and `storage` stubs with the one table and the functions the policies call, pgcrypto under `extensions`, the realtime publication, Supabase's default privileges) and marks as its own, or a Supabase project — brought to the declaration by the plan's own reset (`public` emptied object by object, our policies on `storage.objects` dropped, the declaration applied as `postgres`, since production's objects are owned by `postgres` and the diff compares owners; a plain shadow's user is named `postgres` or may create roles so the plan can become it) and diffed by url. The reset refuses any database holding users, applied migrations, or tables in `public` it did not make. Statements on a schema itself — its comment, its grants — are the platform's and left out. Same engine, same output either way. A shadow url that is the target's, or the local stack's when the target is not it, is refused: a reset empties what it is pointed at.
3. **The data script**, verbatim.

A diff reads committed state only, so `--plan` shows the diff with the renamed objects' statements set aside, and the apply commits the renames on their own (they lose nothing and are the declaration's), then computes the diff afresh over them and guards it like the rest.

## The destructive guard

`destructive.mjs` is a statement-level match over the plan with comments and string literals stripped, deliberately dumb: `drop table`, a column dropped from a table, `drop schema`, `truncate`, a column's type changed. `drop function|policy|trigger|index|view|constraint` loses no rows and passes; a dollar-quoted body is scanned as text.

**A generated column is not data either.** Its value is a function of its own row, computed by the database and written by nobody, so dropping one loses no more than dropping an index does — and because such a column's expression cannot be altered in place, _changing_ one is emitted as a drop and a re-add. The guard cannot read that off the SQL (the text of a drop says nothing about what the column was, and guessing from a re-add would wave through a kept column being replaced by a computed one), so it is **told**: `plan.mjs` reads `information_schema.columns` for `is_generated = 'ALWAYS'` on the target and passes them in, and a `DROP COLUMN` naming one of those is not a hit. A kept column of the same table, a generated column of another table, and dropping the table itself all still refuse the plan. **And a statement that would lose nothing is not destructive** — which, like the generated column above, is a question about the database and not about the SQL, so the guard is told that too. Before the verdict, `plan.mjs` counts what each hit would cost against the target, in the same connection: the rows a table holds; for a column, how many rows hold a value _differing from that column's own default_ (a `role text default 'member' not null` whose every row says `member` holds nothing anybody wrote, and dropping it loses a shape, not information); for a type change, the non-null values it would convert. A hit that would lose nothing is applied with no consent asked for and the log says what was counted. A hit that would lose values is refused whole — nothing applied, each statement printed with its object and its count. **A count that could not be taken is `unknown` and refuses**, because a guard that read a permissions error as "nothing to lose" would be a trap rather than a net.

Consent is `PLATFORMKIT_ALLOW_DESTRUCTIVE`, and the refusal prints the value to set. A **digest** — eight hex over that plan's own destructive statements — names _those_ statements and nothing else, so it expires the moment they change: a later deploy carrying a different drop gets a different digest and refuses, which is why an allowance left behind on a deploy host permits nothing. `<digest>:<object>,<object>` narrows it to some of them. A **commit sha** is accepted too, matched against the commit being deployed, for tying consent to a release — though the digest is the surer form, because a removal has two sources and only one is a commit of the site's: a kit upgrade can drop a column with no site commit at all. And **`1`** still allows everything, for a real case like a first declared deploy against years of drift; the log says it is a standing permission rather than consent for this plan, and prints the digest that would have scoped it. `destructive.test.mjs` pins the shapes, the costs, the digest and each form of allowance.

## The commands

| Command                               | Does                                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platformkit migrate --plan`          | prints the plan against the local stack and applies nothing (exit 1 when refused)                                                                                                                                             |
| `platformkit migrate`                 | applies it to the local stack                                                                                                                                                                                                 |
| `platformkit migrate --plan --linked` | the plan against production (`SUPABASE_DB_URL`), through the shadow database when set                                                                                                                                         |
| `platformkit migrate reset`           | `supabase db reset`: a fresh local database from the declaration, the rows and the seed — then the content that is a declaration too (the spaces, compiled and projected), and the seed's own rooms asked for once they exist |
| `platformkit deploy`                  | computes the plan against production, guards it, prints it, applies it — where `db push` used to be                                                                                                                           |

Locally the CLI's Docker shadow takes about fifteen seconds the first time and a few after (its catalog is cached). A fresh database brought up by the plan rather than a reset needs a second pass: the platform's default privileges grant every new function to `anon` and `authenticated` as it is made, and the second plan holds the revokes. A reset is the designed path for a fresh database.

## `supabase/` is assembled, not written

`platformkit assemble` (run by `dev`, `migrate`, `deploy` and `test`, each before it uses the tree) writes the site's `supabase/` from two owners: `supabase/schemas` (the kit's files, the site's under `site/`), `supabase/data.sql` (the kit's rows, then the site's), `supabase/functions` (the kit's tree, then the site's `db/functions`; `_shared` the kit's; files, never cross-package imports — Deno sees one directory; under `_shared/pipe/` the content pipe's own files copied for the `admin` function — the kit's build and src modules it imports, the site's models under `pipe/site/`, the site's config as `pipe/site.js`, the theme's strings as `pipe/theme-strings.json`, and external imports rewritten to the explicit targets in the functions' Deno import maps (those maps do not extend into `_shared`; an unmapped or conflicting import refuses assembly). The same is done for every other assembled file: a bare import in the rest of `_shared` and in each function's own files is written as the `npm:` target its function's `deno.json` names, because the local functions runtime applies no `deno.json` at all — five functions failed to boot on a bare `marked` until it did — and `assembled-tree.test.mjs` fails on any that is left — so the function and the build run the same code, and a copy that differs from its source is a drift `--check` refuses — which is a comparison against the assembler's own plan, so it sees a file that drifted from its source and cannot see a file the plan should never have held: what the pipe carries is declared once, in `build/pipe-closure.mjs`, and a second copy of that list is the one drift nothing catches), `supabase/seed.sql` (the kit's accounts, then `db/seed.sql`), and the `[db.seed] sql_paths` line of `config.toml` so a reset applies the declaration, the rows, then the seed. A `config.toml` is written from the kit's template for a site that has none, with the site's id and its `data.ports` base; after that it is the site's own. The assembler removes a `supabase/migrations` it once wrote. `platformkit test` assembles and then runs `--check`, which refuses what no assembly fixes: a file neither owner declared, an unresolved import, a `supabase/migrations` folder, or a `config.toml` whose seed line does not name the declaration. Run on its own, `--check` also reports a tree that differs from its sources. Never edit under `supabase/`; edit the kit's files or `db/` and assemble. For payments, assembly generates `_shared/payment-provider-registry.ts` for the single selected provider and refuses a registration whose adapter file is missing; provider credentials stay in the server function environment. What the build writes into the functions tree (the catalog, the compiled emails, the funnels, the strings) is the site's and left alone. Two more files ride along for the share card: `_shared/share-card.js`, the fit rule SharePage and the share-image function both size the card with, and `_shared/pipe/theme-brand.json`, the theme's faces and the site's mark.

**The tree is generated, never committed.** Every command that needs `supabase/` assembles it first, so a site repository keeps `db/` and `supabase/config.toml` and ignores the rest: `supabase/functions/`, `supabase/schemas/`, `supabase/data.sql`, `supabase/seed.sql` and `supabase/.assembled.json`, with `supabase/templates/` and the CLI's `.temp/` and `.branches/`. A committed copy only records the kit it was assembled from, and drifts from the next one.

**A site that declares no backend is never assembled.** `deployment: { backend: false }` is the static shape — a checkout, a build, a static host, no Supabase anywhere — so there is no data layer to assemble, and the assembler says so and stops. That decision lives in the assembler itself, which is why `dev`, `test --check` and `deploy` all agree on it: the deploy already skipped assembling for such a site, while dev and the test check did not, so running either in `sites/docs` or `sites/brochure` wrote a six-megabyte `supabase/` tree — a declared schema, every Edge Function, a `config.toml` naming ports — for a database that site has declared it does not have. `--check` passes for such a site rather than demanding a tree it should never hold.

## Scheduled jobs are generated from module declarations

Recurring jobs are not a hand-maintained list in the kit's row script. An enabled kit, site or theme module declares its pg_cron job in its manifest; assembly resolves the active module set and appends generated reconciliation after both owners' row scripts. The committed `supabase/data.sql` is the assembled result, not another source of schedules.

The reconciler records only PlatformKit-owned job names in `app_settings.platformkit_cron_jobs`. It adopts the known declared legacy names the first time it runs, updates jobs by name and removes obsolete managed jobs on later applications. If an unrelated job already uses a declared name, reconciliation refuses rather than overwriting it. It never sweeps or alters jobs outside its ownership record. `supabase db reset` and deploy use the same assembled SQL.

## Which tables are a projection, and which are state

Every table the kit declares appears in `build/declarations.mjs` as one or the other, and four
checks in `platformkit test` hold it: see
[Declarations and state](/content/docs/building-a-site/declarations-and-state). The short of it is
that a projected table is written by the build or a service role and has no write policy for a
signed-in role at all, and that any table tying a person to something carries a **source** — so a
projection only ever removes what a file owns and never what somebody did by hand.

## The seed

`packages/kit/supabase/seed.sql` makes the seven accounts and their roles (`public.seed_user` is kept so a site's seed can make accounts of its own), and a morning in the staff space, which every surface of the spaces module is tried on — a conversation with a thread, two mentions, a reaction and one line the platform wrote itself. The **rooms** are not in the seed: a space and its channels are a declaration and live in the site's own files, so the seed's conversation is a function (`seed_spaces_demo`) the reset asks for after the declaration has been projected, and it does nothing when the rooms are not there or already hold something. A **site** has the same problem and the same answer: anything of its own that names a space goes in a function too — `seed_site_spaces`, which the projection asks for right after the kit's, and which a site without one simply does not have. (A site might use it to put its coaches in its community, which no membership rule can do, since a coach holds no membership.) `db/seed.sql` adds the site's own rows — coaching threads, support threads, a purchase, a booking. Between them they leave every surface in a state worth looking at: one of the seeded mentions is unanswered, so the staff's desk has something from each of its three sources without anything being made by hand. A reset runs it; a deploy never does.

A reset also empties `auth.users`, which takes the account you signed up with while working — so `platformkit migrate reset` ends by putting it back. Set `DEV_ACCOUNT` (and optionally `DEV_ACCOUNT_NAME`, `DEV_ACCOUNT_PASSWORD`, `DEV_ACCOUNT_ROLE`) in `.env`, and `build/dev-account.mjs` makes that account again, makes it staff, gives it a live membership and puts it in every space and every open room — after the declaration has been projected, so the rooms it joins exist. It is driven by the environment and not by a file because the address is a real person's, and a real address belongs in neither a declaration nor a seed; `.env` is where the rest of them live too. It refuses outright any database that is not a local stack, and does nothing at all when `DEV_ACCOUNT` is unset. `platformkit dev-account` runs it by hand for an account lost to a reset run some other way.

### What a reset costs besides the tables

`platformkit migrate reset` is the quickest way to bring a local database to a changed declaration, and it takes more with it than the rows. It puts back everything the _files_ own — the spaces, the teams, the events, the comment subjects, the bots, the search rows, the typesetting fonts and your own account — because all of those are projections of a declaration and a projection that is missing does not fail: the table or the bucket is simply empty, and whatever reads it finds nothing and says nothing.

| Gone                                           | Put back by the reset?                                           | What breaks if it is not                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **The typesetting fonts** (the `print` bucket) | yes — `build/print/templates.mjs --fonts`                        | a book cannot be set in the cloud: _"there is no type in the bucket"_                               |
| **The projections the files own**              | yes — spaces, teams, events, comment subjects, bots, search rows | a bot with no tools, a library its own search cannot find                                           |
| **Your own account**                           | yes — from `DEV_ACCOUNT`                                         | described above                                                                                     |
| **The content rows** (cloud mode)              | **no** — `node build/content-export.mjs`                         | the cloud lane has no content to read, so its checks fail on an empty site rather than a broken one |

The buckets are the one that surprises people, and the fonts were the one that kept surprising us: a reset is about the _declaration_, and a bucket's contents are neither declaration nor state — they are files somebody or some build put there. The fonts turned out to be a declaration after all (they are the same files in every deployment, shipped with the kit), so the reset now restores them like any other projection. Anything genuinely uploaded — a reader's picture, a book's cover — is not, and cannot be.

**Prefer `platformkit migrate`** where you can: it computes the difference and applies only that, so the rows, the buckets and the accounts all stay. A reset is for when the declaration has moved somewhere a diff cannot follow, or when you want the seed's own state back.

### The API's rate limit is a table, not a variable

`api_rate` counts what a key or an address has asked for in this second and this hour, and `api_rate_take` increments both windows and returns the new counts in **one statement** — never read-then-write, because two requests that both read 77 and both write 78 have let 79 through.

It lives in the database because the doors do not share memory. It used to be a `Map` in module scope, which is one isolate's; the edge runtime runs as many as it likes, so the headers promised 78 requests a second while the door actually allowed 78 times however many workers were up. It was not a limit, and it held on a quiet machine only because one worker happened to serve the burst.

A second is a **sliding window**, not a calendar second: a plain bucket per clock second lets 156 requests through across a boundary — 78 at `.999` and 78 at `.001` — and, the other way, splits a genuine burst so neither half reaches the limit and nothing is refused at all. So the count is this second's plus the part of the previous second still inside the trailing second, which is two rows rather than a scan.

`api_rate_take` takes **the instant** as a second argument, defaulting to `now()`, and nothing in the running system passes it. It is there because a sliding window can only be checked at a moment somebody chose: taking eighty in a loop over a network takes longer than the second it is meant to be measuring, so the window slides, nothing is refused, and the test has asserted the speed of the machine rather than the rule. That is not a hypothetical — the carry was written as `1 - extract(milliseconds from now()) / 1000` and was wrong for every second but the first of each minute, because `extract(milliseconds)` is the **seconds field times a thousand plus the milliseconds** (1400 at `:01.400`, not 400). The fraction went negative and the window _subtracted_ the previous second's count instead of carrying it. A test that raced the clock could never see it; a test that names the instant found it on the first run.

A database that will not answer **fails open**: the request is served and the headers say the allowance is full. A rate limiter that took the site down when it could not count would be a worse outage than the one it exists to prevent.

## The kit's test

`schema.test.mjs` runs the whole loop on a database of its own — a container the CLI starts for a scratch project holding a copy of the declaration (never the site's stack): emptied, the plan creates everything; a column added is the plan's one statement; a site table with a foreign key and a policy on `is_admin()` lands; a table renamed by annotation keeps its rows and its `_pkey`, converges from two names behind and from a fresh reset; both names present refuses; a column removed is refused, then allowed with the variable; the data script changed runs twice. About two and a half minutes; in `platformkit test` when Docker is up, skipped with a note otherwise or with `SCHEMA_TEST=0`.

## What is measured, not assumed

Three facts about Supabase CLI 2.117 shaped the design and are worth knowing: `db diff` never reads the declarative `schema_paths` — its only baseline is a shadow built from a migrations folder, or a database by url; the CLI's `db reset --db-url` drops a hosted project's `auth` and `storage` schemas as well as `public` (so the plan resets its shadow itself); and `pg_dump` cannot express a revoke that the platform's default privileges would undo, so the explicit revokes in the schema files are there on purpose.
