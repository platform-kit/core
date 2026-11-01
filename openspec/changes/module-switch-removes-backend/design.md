# Design

## Who owns what

`core` becomes a manifest of its own, not switchable, owning what every site needs: `10-foundation`, `12-compiled`, `12-content`, `13-search`, `15-library`, `30-analytics`, `40-commerce`, `87-api-rate`, `97-comments`, `98-achievements`, `99-reactions`, and the functions those serve (`admin`, `content`, `reader-content`, `images`, `ingest`, `confirm-checkout`, `create-checkout-session`, `create-portal-session`, `stripe-webhook`, `payment-provider-webhook`, `send-email`, `share-image`, `push-catalog`).

Every other file goes to its module (`55-sessions` and `56-teams` and `57-providers` to sessions, `90-spaces` and `91-matrix` to spaces, and so on), from the reference map in the audit.

## Glue files

A cross-module reference found at apply time (a foreign key, a trigger, a policy or a view on another module's table) moves into `<a>+<b>.sql`, owned by both and loaded when both are on. The ones found today:

| From | Reaches into | What |
| --- | --- | --- |
| 80-push | sessions, support, commerce | triggers that notify staff |
| 90-spaces | store (orders), support | operations-room triggers |
| 96-agents | support, spaces | the bots' triggers on messages |
| 97-comments, 99-reactions (core) | spaces | moderation and message reactions |
| 46-courses | forms | a passed quiz finishes its lesson |
| 55-sessions | forms | a booking's intake form |
| 72-tickets | support | a ticket's conversation |
| 93-network, 95-events, 92-encryption, 91-matrix | spaces | each builds on spaces' tables, so each `requires` spaces |

Where one module cannot exist without the other (network on spaces), the manifest says `requires` instead of a glue file.

A reference found only at run time, inside a function body, is a call the module must not make while the other is off: those functions move into glue files too, or check the module set the build compiles into `_shared`.

## Off, and dropping the data, are two acts

A module that is off is left out of the assembled declaration entirely. On a live database, the plan therefore sees its tables as undeclared. It **keeps** an undeclared table that a disabled module's manifest owns, and plans the drop of everything else that module owned: its functions, triggers, policies on other modules' tables, and glue. Its own tables keep their rows, indexes and policies. Switching the module back on declares them again, and the plan finds nothing to change. A fresh database gets no tables for a module that is off.

`platformkit module drop <key>` is the one way to remove a disabled module's tables. It refuses a module that is on, prints the tables and their row counts, and runs the drop through the existing destructive guard, so it needs `PLATFORMKIT_ALLOW_DESTRUCTIVE` like any other destructive change.

## Verification

`modules-off-db.test.mjs`, in the end-to-end run: for each module, assemble a site with that module off (and everything it is required by), apply the declaration to a fresh database, serve the functions, and check that every served function boots and none of the module's is served.

## As built

- Glue lives in `supabase/schemas/glue/` and is assembled under `schemas/glue/`, which every reader of the declaration (the seed paths, `readDeclaration`) loads after the kit's numbered files and before the site's. A glue file's name is its owners; `core` may be one of them.
- A reference inside a function body was the larger part of the work: 45 functions across 15 modules named another module's tables, found by checking every body against a database with that module off (plpgsql_check for PL/pgSQL, re-creation with `check_function_bodies` for SQL — a SQL function's whole body is parsed on its first call, so `space_fill_matches` failed every call where sessions were off). Each became a hook: the asking module declares a function answering nothing (no enrolments, no bookings, no push), and the glue declares it again reading the other module's table. One body per piece of SQL; no `to_regclass` guards.
- The audience grammar (`space_fill_*`, `audience_for_me`, `community_admitted`) moved to core (`14-audience.sql`): spaces, events, bots, copilot, teams and the network all ask it. A bot's audience is now `audience_for_me`; it had been asking the events' predicate, which also applied the Events place's entry rule.
- `payouts-sweep` moved from the store's cron to the sessions', whose ledger it sweeps. `storefront-api` is a glue function, served only with both `api` and `store` on.
- Kept tables keep rows, keys, indexes, owned sequences and column types; their rules and triggers go with the module's functions, so with RLS on nothing but the service role reads them while the module is off.
