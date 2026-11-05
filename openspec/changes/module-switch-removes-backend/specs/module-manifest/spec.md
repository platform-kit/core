## ADDED Requirements

### Requirement: A module's switch removes its backend

Every Edge Function, schema file and cron job SHALL be owned by exactly one module or by `core`, and anything that joins two modules SHALL be owned by both. When a module is off, the site's assembled backend SHALL contain none of what it owns, and nothing that joins it to another module. Switching a module off SHALL NOT remove its data: on a live database its tables and rows SHALL stay, and switching it back on SHALL find them. Dropping a disabled module's tables SHALL be a separate command, refused while the module is on and guarded like any destructive change.

#### Scenario: a module off

- **WHEN** a site is assembled with a module off
- **THEN** none of that module's functions, schema files or cron jobs is in it, the declaration applies to a fresh database, and every function it serves boots

Verified by: `build/modules-off-db.test.mts` under `platformkit test --e2e`

#### Scenario: off keeps the data

- **WHEN** a module with rows is switched off and the site deployed, then switched back on
- **THEN** its functions are gone while it is off, and its rows are all there when it is on again

Verified by: `build/modules-off-db.test.mts` under `platformkit test --e2e`

#### Scenario: dropping the data

- **WHEN** `platformkit module drop <key>` is run for a module that is off
- **THEN** it lists the tables and row counts, refuses without consent, and with consent drops them

Verified by: `build/modules-off-db.test.mts` under `platformkit test --e2e`

#### Scenario: something nobody owns

- **WHEN** a function, schema file or cron job is added that no manifest claims
- **THEN** the manifests check fails, naming it

Verified by: `build/manifests.test.mts`
