# Design

## Context

`packages/kit/build/assemble.mjs` writes a site's `supabase/` from two owners: the kit's data layer and the site's `db/`. `dev`, `migrate` and `deploy` already run it before they use the tree. `platformkit test` (`build/test.mjs`) runs `assemble.mjs --check` when `supabase/.assembled.json` exists and a plain assembly otherwise. `--check` compares every planned file with the copy on disk, looks for strays, unresolved imports and a `migrations` folder, and checks the `config.toml` seed line.

Two statements contradict how the tree is actually produced: the assembler's header says "The assembled tree is committed", and the `--check` failure ends "then commit". The PlatformKit workspace already ignores each site's assembled tree, and `sites/demo` tracks only `supabase/config.toml`. A separately owned site has no such guidance; DharmaLab committed its tree, and the committed copy drifted from the kit.

## Decisions

**Data ownership.** The site owns `db/` (its schemas, rows, functions and seed) and `supabase/config.toml`, which the assembler writes from the kit's template once and then only adjusts the seed line of. The kit owns everything else under `supabase/`. Generated output has no owner in a repository: it is rebuilt by whichever command needs it.

**The test step always assembles, then checks.** `test.mjs` runs `assemble.mjs` and then `assemble.mjs --check`, whether or not a tree is on disk. After a fresh assembly the comparison passes by construction, so what the check still catches is what an assembly cannot fix: a hand-added file, a `migrations` folder, an unresolved import, a wrong seed line. The previous comparison against an older copy only reported that the copy was old, and the remedy it gave was to commit it.

**`--check` keeps its comparison.** Run on its own, `--check` still reports a tree that differs from its sources, which is useful before starting the local stack by hand. Only its message changes: it names the assembler as the remedy and says the tree is never edited or committed.

**Language.** The documentation calls the tree "generated" and says what a site repository ignores, by path. The failure message uses the same word. No copy says "commit" about the tree.

**Controls and motion.** None; this is a command-line and documentation change.

## Deliberately not built

- **No scaffold for a site's `.gitignore`.** The kit creates no site repositories today, so there is nothing to attach a scaffold to. The documentation lists the paths, which is what a site owner needs.
- **No guard against a committed tree.** Refusing a tree tracked by git would make the test step depend on the site's version control. The documentation and the generated-tree wording are enough; a committed copy is harmless while every command reassembles it.
- **No change to the workspace `.gitignore`.** It already ignores the sites' assembled trees.

## Risks

A site that ran the stack by hand with `supabase start` and no assembly will now find no tree in a fresh checkout. That has been true of every workspace site already; the documentation says `dev` or `migrate` assembles it.
