## Tasks

Starts after `modules-as-packages` is applied. Each task is committed on its own, locally; nothing is pushed or published. A task the environment prevents verifying is marked not verified, with the reason, and work continues.

### 1. Code standards
- [ ] Prettier over all code in one commit, listed in `.git-blame-ignore-revs`; `lint-staged` extended to code. Verified by `prettier --check` clean and the static lane unchanged.
- [ ] ESLint with typescript-eslint, eslint-plugin-vue and the boundary rule. Verified by `platformkit check` running it.
- [ ] Ratchets in `build/standards-baseline.json` (`any`s, files over 600 lines, direct table calls in `ui/`), enforced by `platformkit check`. Verified by `build/standards.test.mts` with planted increases.
- [ ] Comment guideline in `AGENTS.md`.

### 2. Shared code
- [ ] Code used by the browser, the build and the functions moved to `modules/core/shared/`, imported as `@pk/shared/*` in all three; relative-path variants removed. Verified by the static lane, the assembled tree booting every function under `platformkit test --e2e`, and `build/shared-imports.test.mts`.

### 3. Data layer
- [ ] Every direct database call in `ui/` files moved into its module's `lib/`, typed; ratchet at zero. Verified by `standards.test.mts`, each module's tests, and the changed screens rendered on the demo in both themes at phone and desktop width.

### 4. Oversized files
- [ ] `SocialAdmin.vue`, the `social` function, `SpacesPage.vue`, `AdminPage.vue` and `spaces/api.ts` split under 600 lines each. Verified per file by its module's tests and the screens rendered in both themes at both widths.

### 5. Typed site configuration
- [ ] A zod schema for every section, with modules contributing their own; `SiteConfig` derived; unknown keys suggested; JSON Schema generated. Verified by `build/site-config.test.mts` and every fixture site loading clean.

### 6. Typing
- [ ] `any`s narrowed, with none in front doors; the ratchet recorded. Verified by `vue-tsc` and `tsc` clean and `standards.test.mts`.
- [ ] The seven JavaScript files converted. Verified by the static lane.
- [ ] `typescript-throughout`'s narrowing and JavaScript tasks marked done there, pointing here.

### 7. Tests
- [ ] Every `ok()` test moved to `node:test`, check names kept. Verified by the static and e2e lanes passing with the same count of checks.
- [ ] `typescript-throughout`'s `node:test` task marked done there.

### 8. Content parity
- [ ] `build/content-parity.test.mts`: every model's rules refused identically by the build and the admin save path, for files and rows; gaps fixed. Verified by the test.

### 9. Site rules
- [ ] The four hook functions declared, called by the kit's price, promotion, payout and access functions, and redefinable from a site's `db/`. Verified by `build/site-rules-db.test.mts` under `platformkit test --e2e`, with a fixture site redefining each.

### 10. One-off data changes
- [ ] `data/once/` files run once per database by the plan, recorded, guarded and checksum-checked. Verified by `build/data-once-db.test.mts`.

### 11. Override contracts
- [ ] Contracts computed and checked at build; `platformkit.overrides.lock`; drift warnings; `platformkit overrides accept`. Verified by `build/override-contracts.test.mts` with planted breaks and drift.

### 12. Kit events
- [ ] The catalogue, `emit_event`, the outbox, the `events` function with retries, manifest listeners; the first entries emitted at their sources. Verified by `build/kit-events-db.test.mts` under `platformkit test --e2e`, with a demo module listening to `order.paid`.

### 13. Releases
- [ ] Changesets with one fixed group; the API report committed and enforced; the version policy page. Verified by `build/releases.test.mts` (an interface change without a changeset fails).

### 14. Spec coverage
- [ ] The 11 scenarios in `specify-every-module` tested; the two payout cases tested against the database; wrong spec names corrected; its tasks marked done there except the archive. Verified by each test, under `platformkit test --e2e` where it needs a stack.

### 15. Smaller items
- [ ] The downstream site's name removed from the comment in `build/e2e.mts`. Verified by a search.

### 16. Documentation
- [ ] Docs: code standards, configuration reference, site rules, data changes, overrides, events, releases and the version policy, plus every page whose sources moved; `docs/ARCHITECTURE.md`; `docs/AUDIT.md` checklist. Verified by `docs-check.mjs`.

### 17. Verification
- [ ] Every scenario in this change and in `code-standards`, `site-config`, `site-rules`, `data-changes`, `kit-events`, `releases`, `content-models` and `theme-contract` reported as passed, failed or not verified, with the reason; the full static and `platformkit test --e2e` runs, with every failure shown.
