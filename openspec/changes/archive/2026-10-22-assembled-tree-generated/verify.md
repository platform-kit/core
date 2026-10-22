# Verification

Applied autonomously on 2026-10-16, while James was away. Not archived: read the proposal, then `/opsx:archive`.

## Scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| a fresh checkout holds no assembled tree | **passed** | `node build/assembled-tree.test.mjs` — a copy of `sites/demo` with only `db/` and `supabase/config.toml`; assembly and `--check` both exit 0 |
| a stale local copy is replaced, not reported | **passed** | same test — `_shared/lib.ts` altered; the step passes and the file is current again |
| a hand-added file is refused | **passed** | same test — `functions/stray-test/index.ts` refused by name; the message names `assemble.mjs` and does not ask for a commit |
| a site migration out of order | **passed** | same test — a file in `supabase/migrations/` is refused and the directory named |
| a kit release after a site's own changes | **not verified** | unchanged by this change (the plan and reset logic were not touched); its schema test needs Docker and was not rerun |
| a reset on either site | **not verified** | unchanged by this change; needs `platformkit migrate reset` against a running stack, which was not run |

The test was also run against the previous behaviour (the conditional step and the "then commit" message restored): it failed on exactly those two checks, then passed again with the change restored.

## Other checks

- The test step's commands on `sites/demo`: assembly wrote 9 changed files of 393, and `--check` passed. On `sites/docs`, which declares no backend: both report nothing to assemble and exit 0.
- `openspec validate assembled-tree-generated --strict`: valid.
- `node build/docs-check.mjs --tree`: all 88 pages agree. It was run from `sites/docs`, because run from the workspace root it stops first: the fetched `dharmalab-site` checkout is ahead of its recorded commit until its new commits are pushed (see the session report).
