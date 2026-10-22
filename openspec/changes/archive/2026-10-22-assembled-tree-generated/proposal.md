# Proposal

## Why

A site's `supabase/` tree is assembled from the kit and the site's own `db/`, and every command that needs it — `dev`, `migrate`, `test` and `deploy` — assembles it first. Yet the assembler still says the tree is committed, `platformkit test` compares a tree already on disk against the kit and tells the reader to "commit" when they differ, and nothing tells a separately owned site what to keep out of its repository. A site that followed that advice committed a four-day-old copy of the kit's functions, which then drifted from the kit it was made from.

## What Changes

- The assembled tree is generated output. A site repository keeps `db/` and `supabase/config.toml` and ignores the rest of `supabase/`.
- `platformkit test` assembles a fresh tree and then checks it, instead of checking whatever copy is already on disk. The checks that matter stay: an unresolved import, a stray file under `supabase/`, a leftover `supabase/migrations`, and a `config.toml` whose seed line does not name the declaration.
- The check's failure message stops telling the reader to commit. Proposed copy:

  > ✖ supabase/ is not what its sources assemble to — run node packages/kit/build/assemble.mjs; the tree is generated, never edited or committed:

- The database documentation says what a site repository ignores. Proposed copy for the section that explains the assembled tree:

  > **The tree is generated, never committed.** Every command that needs `supabase/` assembles it first, so a site repository keeps `db/` and `supabase/config.toml` and ignores the rest: `supabase/functions/`, `supabase/schemas/`, `supabase/data.sql`, `supabase/seed.sql` and `supabase/.assembled.json`, with `supabase/templates/` and the CLI's `.temp/` and `.branches/`. A committed copy only records the kit it was assembled from, and drifts from the next one.

## Non-goals

This does not change what the assembler writes, how the deploy runs, or the workspace's own `.gitignore`, which already ignores each site's assembled tree. It adds no scaffold for new sites.

## What James should look at

Whether `platformkit test` should always assemble before it checks. The alternative, keeping today's comparison against the copy on disk, only catches a stale local copy, and a fresh assembly makes that copy current anyway.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kit-extension-model`: the assembled data layer is generated output that a site repository does not commit, and the test step assembles before it checks.

## Impact

- `packages/kit/build/assemble.mjs`: header and the `--check` failure message.
- `packages/kit/build/test.mjs`: the assembled-tree step.
- Documentation: `building-a-site/the-database.md` and `building-a-site/testing.md`.
- Surfaces to verify: `platformkit test` on `sites/demo` and a backend-free site, `assemble.mjs --check` on a tree with a stray file and with a `migrations` folder, and the docs check.
