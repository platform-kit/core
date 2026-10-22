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
2. **Config edits are insertions at parsed positions.** The config is a JavaScript module full of comments. The command parses it with Rollup's parser (which Vite brings, so nothing is added) only to find where an entry belongs, then inserts the entry as text at that offset, after any comment that ends the line before it. Nothing else in the file is reprinted, so every comment and line stays as it was. If the config is not an object literal it can find, it writes nothing to the config and prints the lines to add by hand. Alternatives: reprinting the file from its syntax tree (needs a comment-keeping printer the workspace doesn't have) and regular-expression edits (fragile against comment-heavy configs).
5. **A site's content types share one file.** A site registers its models through one file (`admin.models`). A new content type is appended to that file's `models` list; a site with none gets `build/admin-models.mjs`, registered in the config. PlatformKit's loader is unchanged.
6. **Core pieces go where PlatformKit keeps them, and the docs follow.** A module joins `MODULES` and gets a row on the modules page and in the config-keys modules row; a step and a content type join their indexes with an import; a function needs `--module` and joins that module's `owns.functions`; a test joins the test list; a page is declared and routed in `App.vue` (PlatformKit's pages are wired there by hand) and its strings scope is listed on the strings page. Every new file is named by a stub docs page (the owning module's when there is one), because the docs check refuses an undocumented file.
3. **A generated module is off-safe and complete.** It answers `true` in all three shapes with a `needs` line, owns only what was generated, and requires nothing. The structural checks would refuse anything less.
4. **The proof is generating at both levels.** The test generates every kind into a copy of `sites/demo` and checks what the build reads (the config loads, the module, route, model and step are registered, the page compiles, the function is assembled, the test runs). It generates every kind at the core level into a copy of the workspace and runs the coverage, manifest, deployment-shape and docs checks there. A full production build of a generated site was run once by hand, since it takes minutes.

## Risks / Trade-offs

- A template can drift from what the checks require. The test above fails the day it does.
- Config parsing adds a dependency (a JavaScript parser that keeps comments). The workspace already has one through Vite's toolchain; the design uses it rather than adding another.
