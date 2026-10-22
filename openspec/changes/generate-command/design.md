# Design

## Context

See proposal.md for why. Today:

- **A site's own module** is the demo's `stockists`: `src/stockists/module.js` (the manifest), `StockistsPage.vue`, `sections.js` (an admin section), `step.js` (a build step), and config entries in `modules`, `routes`, `admin.sections` and `build.modules` / `build.steps`.
- **The checks** a generated piece must pass: `manifests.test.mjs` and `modes.test.mjs` (a manifest answers for all three shapes), `test-coverage.test.mjs` (every function named by a test; a test that reaches a stack imports `test-stack`), and the docs check for the kit's own docs.
- **The CLI** dispatches on a `case` per command in `packages/kit/bin/platformkit.mjs`.

## Goals / Non-Goals

**Goals:** six kinds, files that pass the checks as written, config edits that keep the file's comments, templates a site can override.

**Non-Goals:** removing what was generated (`git` already undoes it); writing finished features at either level.

## Decisions

0. **Two levels, site by default.** `--level site` writes into the site's repository and registers through its config, the same registrations the demo's `stockists` uses. `--level core` writes into `packages/kit`: the manifest in `build/modules/kit.mjs`, schema in `supabase/schemas`, functions in `supabase/functions`, tests in `build`, and a stub page under `sites/docs/content/docs` naming its sources. Core is refused unless the working copy is a PlatformKit checkout (the workspace root with `packages/kit`), so a site that installed PlatformKit from npm never edits `node_modules`. Alternative: core by default. Rejected because most users build sites.
1. **Templates are files, not code.** Each kind is a folder of template files with `{{name}}`-style placeholders under `packages/kit/build/generators/<kind>/`. A site's `generators/<kind>/` replaces the kit's folder whole. Alternative: templates in JavaScript strings. Rejected because a site could not override them without writing code.
2. **Config edits go through the file's syntax tree.** The config is a JavaScript module full of comments. The command parses it, inserts the entry in the right object, and prints the file back with every comment kept. If the config is not a plain object literal it can parse, it writes nothing to the config and prints the lines to add by hand. Alternative: regular-expression edits. Rejected as fragile against the comment-heavy configs sites write.
3. **A generated module is off-safe and complete.** It answers `true` in all three shapes with a `needs` line, owns only what was generated, and requires nothing. The structural checks would refuse anything less.
4. **The proof is generating at both levels.** The test generates every kind into a copy of `sites/demo` (as `assembled-tree.test.mjs` copies it) and into a copy of `packages/kit`, then runs the build, the structural checks and the docs check on each copy.

## Risks / Trade-offs

- A template can drift from what the checks require. The test above fails the day it does.
- Config parsing adds a dependency (a JavaScript parser that keeps comments). The workspace already has one through Vite's toolchain; the design uses it rather than adding another.
