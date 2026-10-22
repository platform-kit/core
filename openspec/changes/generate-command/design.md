# Design

## Context

See proposal.md for why. Today:

- **A site's own module** is the demo's `stockists`: `src/stockists/module.js` (the manifest), `StockistsPage.vue`, `sections.js` (an admin section), `step.js` (a build step), and config entries in `modules`, `routes`, `admin.sections` and `build.modules` / `build.steps`.
- **The checks** a generated piece must pass: `manifests.test.mjs` and `modes.test.mjs` (a manifest answers for all three shapes), `test-coverage.test.mjs` (every function named by a test; a test that reaches a stack imports `test-stack`), and the docs check for the kit's own docs.
- **The CLI** dispatches on a `case` per command in `packages/kit/bin/platformkit.mjs`.

## Goals / Non-Goals

**Goals:** six kinds, files that pass the checks as written, config edits that keep the file's comments, templates a site can override.

**Non-Goals:** generating kit modules inside PlatformKit itself (the kit's own modules follow its own review); removing what was generated (`git` already undoes it).

## Decisions

1. **Templates are files, not code.** Each kind is a folder of template files with `{{name}}`-style placeholders under `packages/kit/build/generators/<kind>/`. A site's `generators/<kind>/` replaces the kit's folder whole. Alternative: templates in JavaScript strings. Rejected because a site could not override them without writing code.
2. **Config edits go through the file's syntax tree.** The config is a JavaScript module full of comments. The command parses it, inserts the entry in the right object, and prints the file back with every comment kept. If the config is not a plain object literal it can parse, it writes nothing to the config and prints the lines to add by hand. Alternative: regular-expression edits. Rejected as fragile against the comment-heavy configs sites write.
3. **A generated module is off-safe and complete.** It answers `true` in all three shapes with a `needs` line, owns only what was generated, and requires nothing. The structural checks would refuse anything less.
4. **The proof is generating into a copy of the demo.** The test generates every kind into a copy of `sites/demo` (as `assembled-tree.test.mjs` copies it) and runs the build and the structural checks on the copy.

## Risks / Trade-offs

- A template can drift from what the checks require. The test above fails the day it does.
- Config parsing adds a dependency (a JavaScript parser that keeps comments). The workspace already has one through Vite's toolchain; the design uses it rather than adding another.
