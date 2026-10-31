# Proposal

## Why

The specs say a module's switch removes the whole module, and for the backend it removes almost nothing. 45 of the kit's 58 Edge Functions belong to no module, and most schema files belong to none. `assemble` copies every schema file and every function into every site: the club fixture, with store, print and sessions off, serves all 58 functions, `print-render` and `book-session` among them. Only the cron jobs follow the switch.

The schema cannot simply be split by module, because the modules are wired into each other's tables. Push puts triggers on bookings, support messages and purchases. Spaces listens to orders and support for its operations rooms. Bots put triggers on support and space messages. Comments and reactions, which every site has, point at spaces' tables.

## What Changes

- Every function, schema file and cron job is owned by exactly one module, or by `core`, the part every site has. A manifest test fails on anything unowned.
- What joins two modules moves into a glue file owned by both, loaded only when both are on: a trigger on another module's table, a foreign key across modules, a function reading two modules' tables.
- `assemble` leaves out every function, schema file and glue file whose owner is off.
- Switching a module off and dropping its data are separate acts. Off removes the module's behaviour: its functions, cron jobs, triggers, glue and routes. Its tables and their rows stay where they exist, untouched, so switching it back on finds them. A fresh site creates no tables for a module that is off.
- Dropping a module's data is its own command, `platformkit module drop <key>`, for a module that is off. It shows what it removes and needs consent like any destructive change.
- A test assembles each module off in turn, applies the result to a fresh database and boots the functions.

## Non-goals

- Making `core` optional: accounts, content, the admin, commerce's ledger, comments and analytics are every site's.
