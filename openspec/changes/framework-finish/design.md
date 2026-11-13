# Design

This change starts after `modules-as-packages` is applied: it relies on module folders, front doors, slots and the boundary check. Every choice below is made here, so the tasks can be carried out without stopping for a decision. Where a task cannot be verified because of the environment (Stripe Connect, disk space), it is recorded as not verified with the reason, and work continues.

## 1. Code standards

- **Prettier** formats every `.ts`, `.mts`, `.vue`, `.css` and `.sql` file in `packages/kit` and the fixture sites, using the existing `.prettierrc.json` (print width 100). The whole tree is formatted in one mechanical commit, listed in `.git-blame-ignore-revs`. `lint-staged` then formats staged code on every commit.
- **ESLint** uses typescript-eslint and eslint-plugin-vue, plus the module boundary rule from `modules-as-packages`. Its rules include `no-explicit-any` and `max-lines` (600 per file); line length is left to Prettier.
- **Ratchets.** `build/standards-baseline.json` records, per file:
  - the count of `any`s;
  - the line count of files over 600 lines;
  - direct `supabase.from(` and `supabase.rpc(` calls in `ui/` files.

  `platformkit check` fails when any count rises or a new file exceeds a limit. A count that falls is written back, so the baseline only ever tightens.
- **Comments.** A short guideline in `AGENTS.md`: a comment says why in plain sentence case; headings in capitals are not used. Comments are rewritten as files are touched by later tasks, not in a sweep.

## 2. One home for shared code

Code used by the browser, the build and the functions moves to the core module's `shared/` folder, written in TypeScript with `.ts` import extensions (`rewriteRelativeImportExtensions`). All three runtimes import it by one name, `@pk/shared/<file>.ts`:
- the browser and the build through the Vite and tsconfig paths;
- the functions through the import maps `modules-as-packages` writes.

The type shims for the npm packages stay, and the relative-path variants are removed.

## 3. A data layer

Every `supabase.from(`, `.rpc(`, `.functions` and `.storage` call in a `ui/` file moves into a function in that module's `lib/`, typed from `database.types.ts` and the shapes files. Components call those functions. The ratchet holds the count of direct calls in `ui/` at zero once it reaches it. Row-level security is unchanged.

## 4. The five oversized files

Each file is split into components of under 600 lines, logic in `lib/`, and data access in the data layer:
- `SocialAdmin.vue`;
- the `social` function;
- `SpacesPage.vue`;
- `AdminPage.vue`;
- `spaces/api.ts`.

Each split is behaviour-neutral, proven by the module's tests and by rendering the changed screens on the demo in both themes at phone and desktop width.

## 5. A typed site configuration

- Each configuration section gets a zod schema. Kit-wide sections (`deployment`, `build`, `nav`, `routes` and others) are defined in core. A module's own section (`courses`, `spaces`, `store` and others) is contributed by its manifest.
- `SiteConfig` is derived from the schemas, so `defineSite()` gives autocomplete and type errors.
- At load, an unknown key fails with the nearest known key ("`modules.cources` — did you mean `courses`?"), and a wrong value fails with its path.
- A JSON Schema is generated for editors.

## 6. Typing and the last JavaScript

- `any`s are narrowed where the shape is known: database rows from `database.types.ts`, function returns from the shapes files, content from the generated content types. The ratchet records progress, and the front doors carry no `any` at all.
- The seven remaining JavaScript files are converted.
- These complete the unfinished `typescript-throughout` tasks.

## 7. Tests on `node:test`

Each `ok()`-style test becomes `node:test` with `node:assert/strict`, keeping its check names as test names, so the standard reporters, filtering and coverage apply. The runner keeps its lanes. This completes the unfinished `typescript-throughout` task.

## 8. Content parity

The `content-models` spec already requires every check to run in two places. A parity test proves it: for every model, it plants one invalid entry per rule and checks that both the build and the admin save path (files and rows) refuse it with the same message. Any gap found is fixed by making both paths call the model's single validator.

## 9. Site rules as SQL hooks

Business rules stay in the database, because that is what makes them trustworthy. A site changes them through named hook functions with fixed signatures:
- `rule_price(item jsonb, basket jsonb) returns jsonb`;
- `rule_promotion_applies(promotion jsonb, basket jsonb) returns boolean`;
- `rule_payout_amount(rule jsonb, line jsonb) returns integer`;
- `rule_may_read(entry jsonb, member jsonb) returns boolean`.

The kit declares each as a default that returns its input unchanged (or `true`). The kit's own functions call them at the documented point, and a site's `db/` redefines any of them. Hook signatures are part of the public interface and appear in the API report. This was chosen over moving the calculations to TypeScript, which would rewrite tested money logic for no security gain, and it reuses the pattern the module split already uses: a function declared to answer nothing, redefined where needed.

## 10. One-off data changes

A module's `data/once/<yyyy-mm-dd>-<name>.sql` holds a data change that must run exactly once per database, such as a backfill or a split. The plan runs each pending file after the schema diff and before `data.sql`, inside the same destructive guard. Each run is recorded in `platformkit.once_runs (file, checksum, ran_at)`. A recorded file whose checksum has changed is refused.

## 11. Override contracts

- A component's contract is its props, emits and slots, read from `<script setup>` by the Vue compiler. The build computes each overridden original's contract and checks the override against it: a missing required prop, a renamed event or a removed slot fails the build.
- The site records the contracts it overrode in `platformkit.overrides.lock`. When the kit changes an original's contract, or its source, the build warns, naming the override and what changed. `platformkit overrides accept` updates the lock.

## 12. Kit events

- **The catalogue** is a typed list in core, extended by module manifests. It starts with:
  - `order.paid`, `order.refunded`;
  - `member.joined`, `member.tier_changed`;
  - `booking.confirmed`, `booking.cancelled`;
  - `course.enrolled`, `course.completed`;
  - `form.submitted`, `ticket.opened`.

  Each carries a typed payload.
- **Emitting:** the database writes the event to `platformkit.event_outbox` in the transaction that caused it, through the `emit_event(name, payload)` SQL function.
- **Delivering:** the `events` edge function, run by pg_net on insert and swept by cron every minute, delivers each event to every listener. It retries with backoff and marks the event done or dead after 8 attempts.
- **Listening:** a module, including a site's, declares listeners in its manifest (`listens: { 'order.paid': './functions/on-order-paid.ts' }`), which are bundled into the `events` function.
- The four existing webhook mechanisms are unchanged.

## 13. Releases

- **Changesets**, with every `@platformkit/*` package in one fixed group, so all share one version.
- **An API report** (API Extractor) of every front door and named shared export, plus the hook signatures and the event catalogue, committed as `packages/kit/api-report.md`. `platformkit check` fails when the report changes without a changeset.
- **The version policy** (a docs page), for 0.x:
  - a minor version may change the public interface, and must carry an upgrade note in its changeset;
  - a patch may not change it.

  From 1.0, only a major version may break it.
- **Upgrade notes** are collected from changesets into a docs page per release. The first is written for the first npm release, as agreed on 2026-10-22. Until then the tooling and policy exist and changesets accumulate.

## 14. Spec coverage

- The 11 untested scenarios in `specify-every-module` each get a test.
- Two payout cases get tests against the database: an inactive rule earns nothing, and a rule for another booking type earns nothing.
- The tests that cite the never-existing spec names `social-network`, `community-layouts`, `atproto-api` and `streamline-social-layout` are corrected.

These complete the unfinished `specify-every-module` tasks except its archive.

## 15. Smaller items

- The comment naming a downstream site in `build/e2e.mts` is reworded.
- `docs/AUDIT.md`'s checklist is updated as each item closes.

## Language, data, controls, motion

No reader-facing wording, controls or motion change. New data: `platformkit.once_runs` and `platformkit.event_outbox`, both service-role only.

## Deliberately not built

- **Feature-scope decisions and per-module reviews against category leaders:** product decisions.
- **A unified webhook system:** events deliver alongside the existing mechanisms; unifying them is separate.
- **npm publishing, deployment and pushes:** never part of an apply.
