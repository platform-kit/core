# Tasks

## 1. The command

- [x] 1.1 Add `generate` to `packages/kit/bin/platformkit.mjs`: the kinds, `--dry-run`, `--site`, the refusals and the printed summary. Verified by `generate.test.mjs`: no kind lists the kinds; a taken name and an existing file write nothing; a dry run changes nothing.
- [x] 1.2 Config edits through a comment-keeping parser, with the hand-edit fallback for a config that is not a plain object literal. Verified by `generate.test.mjs`: comments and order unchanged; the fallback prints the entries and writes the files.

## 2. The templates

- [x] 2.1 Templates for module, page, content type, function, test and step under `packages/kit/build/generators/`. Verified by `generate.test.mjs`: each kind generated into a copy of the demo, then the build and the structural checks pass on the copy.
- [x] 2.2 Site overrides from `generators/<kind>/`. Verified by `generate.test.mjs` with a site page template.
- [x] 2.3 Core-level templates writing into `packages/kit` with a stub docs page, and the refusal outside a PlatformKit checkout. Verified by `generate.test.mjs`: every kind generated into a copy of `packages/kit` passes the structural and docs checks; `--level core` with no checkout writes nothing.

## 3. Docs and verification

- [x] 3.1 The CLI reference and the "Extending a site" page. Verified by `node packages/kit/build/docs-check.mjs`.
- [x] 3.2 Report each scenario as passed, failed or not verified, with why. Verified by `verify.md`.
