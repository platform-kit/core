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
