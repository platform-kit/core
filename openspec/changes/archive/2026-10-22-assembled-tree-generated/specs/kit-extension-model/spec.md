## MODIFIED Requirements

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
