## Tasks

### Foundations
- [x] A route census: every path the `App.vue` chain answers today on the demo, and the page it shows, recorded as a fixture. Verified by `build/module-routes.test.mts` passing on the old layout.
- [ ] The loader: reads `packages/kit/modules/*` and a site's `src/modules/*`, together with the old layout. Verified by an unchanged assembled tree and route census.
- [ ] Contribution points composed by the kit: routes with precedence, admin sections, nav, places, member-card panels, steps, models, emails, strings, cron. Verified by `module-routes` and `module-slots` tests and an unchanged demo build.
- [ ] The assembler and override resolver read module folders. Integrations load after both modules' schema, and module function code is placed under `_shared/<module>/`. Verified by `assembled-tree.test.mts` byte-identical and `theme-overrides.test.mts`.
- [ ] Dev watches module folders: browser code through Vite from its own folder, functions and their shared code re-copied on change, schema re-planned and applied when non-destructive, manifests re-composed. Verified by `build/dev-module-watch.test.mts` (function, component, destructive schema edit).
- [ ] Named shared mechanics listed in `build/modules/shared.mts`. Verified by `manifests.test.mts`.

### Pilot: courses
- [ ] Courses moved into `modules/courses/`: schema, the function, lib, ui (including admin enrolments), strings, models, emails, steps, tests. Its glue becomes `integrations/{spaces,forms,sessions}`, and `MemberCourses.vue` becomes a fill of the spaces member-card slot. Verified by assembled-tree with all modules on and each off, the route census, `courses*.test.mts`, `course-workbook-db.test.mts` and `modules-off-db.test.mts` under `platformkit test --e2e`, and the course pages rendered on the demo in both themes at phone and desktop width.
- [ ] Courses' `index.ts` front door, and the boundary check on. Verified by `module-boundaries.test.mts` with a planted import.

### The rest
- [ ] Each remaining module moved, one per commit, with the same proof as the pilot.
- [ ] `core` moved last.
- [ ] The demo's stockists moved to `src/modules/stockists/` and registered from one config entry. Verified by `site-module.test.mts`.
- [ ] The old layout, the manifest file lists, the `App.vue` chain and the `router.ts` flags removed. Verified by `manifests.test.mts` refusing any file outside a module or the shared list.

### Packages and the public interface
- [ ] Package `exports` reduced to the module front doors and the named shared mechanics. Verified by `module-boundaries.test.mts` against a fixture site.
- [ ] Each module folder made a workspace package `@platformkit/<key>` under the kit's one version. Verified by a clean `npm install` and the static lane.
- [ ] DharmaLab's 41 internal imports mapped to front doors or shared exports, as a table in the upgrade note.

### Documentation
- [ ] Docs: modules, building a module, the theme, overrides, the CLI reference, and every page whose sources moved; `docs/ARCHITECTURE.md` and `docs/AUDIT.md` item 13–14. Verified by `docs-check.mjs`.

### Verification
- [ ] Every scenario in this change, plus `module-manifest`, `kit-extension-model` and `theme-contract`, reported as passed, failed or not verified, with the reason; the full `platformkit test --e2e` run.
