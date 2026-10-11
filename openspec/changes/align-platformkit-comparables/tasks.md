# Tasks

## 1. Align the comparable contract

- [x] 1.1 Update the `kit-principles` comparables table and requirement with the reviewed Circle and Bluesky/Mastodon rows; keep both overview copies' first three columns aligned and their limitations prose intact, then verify with `cd sites/docs && node ../../packages/kit/build/docs-check.mjs --tree`.

## 2. Verify the change

- [x] 2.1 Run `openspec validate --all --strict` and the documentation check; report the table-parity scenario as passed or failed and confirm the change adds no runtime behavior.
