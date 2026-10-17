# Tasks

## 1. The test step and the check

- [x] 1.1 In `packages/kit/build/test.mjs`, replace the conditional assembled-tree step with an assembly followed by `assemble.mjs --check`, for every site with a backend. Verified by `node build/assembled-tree.test.mjs` (task 2.1).
- [x] 1.2 In `packages/kit/build/assemble.mjs`, rewrite the header's statement that the tree is committed, and change the `--check` failure message to the copy quoted in the proposal. Verified by the stray-file case in `node build/assembled-tree.test.mjs`, which asserts the message names the assembler and does not tell the reader to commit (no "then commit").

## 2. A test of the generated tree

- [x] 2.1 Add `packages/kit/build/assembled-tree.test.mjs`: copy `sites/demo`'s site sources (config, `db/`, `supabase/config.toml`, content) into a temporary directory, then run the test step's assembled-tree commands there in three states — no generated tree, one assembled file altered, and a stray function file added — asserting pass, pass, and refusal by name. Register it in `test.mjs`. Verified by running it.

## 3. Documentation

- [x] 3.1 Update `sites/docs/content/docs/building-a-site/the-database.md` with the "The tree is generated, never committed" paragraph quoted in the proposal, and correct its description of what `--check` does in `platformkit test`. Verified by `node build/docs-check.mjs`.
- [x] 3.2 Update item 1 of the test list in `sites/docs/content/docs/building-a-site/testing.md` to say the step assembles and then checks. Verified by `node build/docs-check.mjs`.

## 4. Verify

- [x] 4.1 Run `node build/assembled-tree.test.mjs`, the test step's assembled-tree commands on `sites/demo` and on a backend-free site (`sites/docs`), `openspec validate assembled-tree-generated --strict`, and `node build/docs-check.mjs`. Report each scenario in the delta spec as passed, failed, or not verified, with the reason for any not verified.
