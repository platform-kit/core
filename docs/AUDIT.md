# PlatformKit audit

An audit of PlatformKit's design decisions and how well each is carried out, measured against a mature framework such as Laravel Spark. It accompanies [ARCHITECTURE.md](ARCHITECTURE.md), which describes the intended design. Each finding ends in a to-do; the [checklist](#checklist) at the end tracks them.

Figures were measured from the code on 2026-11-12. Judgements are marked as such.

## Summary

The design is ambitious and mostly sound, and a few ideas go beyond what Spark offers: modules that remove their backend when switched off, a declared rather than migrated schema, tests on real throwaway stacks, and documentation checked against the code. The execution is not yet at Spark's level. Spark's quality comes from four things PlatformKit does not have yet:

- a small surface;
- conventional code;
- a stable public interface;
- a predictable upgrade path.

## Design philosophy

| Decision | Sound? | Executed well? |
|---|---|---|
| A framework, not a site | Yes | Partly: see [1](#1-no-public-interface) |
| Modules that remove their backend when off | Yes, beyond Spark | Yes |
| Content as files | Yes | Mostly: see [2](#2-two-content-paths) |
| The database enforces the rules | Sound for security; a heavy bet | Mixed: see [3](#3-business-rules-in-sql) |
| Every change specified | Yes | Partly: see [4](#4-module-specs-not-official) |
| The vendor's standard path | Yes | Yes |

### 1. No public interface

A framework has to promise sites what they can rely on: these exports are stable, and everything else is internal. PlatformKit promises nothing.

- The package exports `./*` and `./build/*`, so every internal file is importable.
- DharmaLab already imports 41 different internal kit files. Examples include the assessment wording (`theme/instrument/ui/strings.js`, 19 times), the assessment engine (`instrument/engine/session.js`, 11 times), and small page parts such as `PageHero.vue` and `EmptyState.vue`.
- No one can tell which kit files are safe to change. Every refactor risks breaking a site with no warning.
- The version is 0.1.0, with no release notes or upgrade guides (deferred on 2026-10-22).

**To do:**

1. Write the short list of what a site may import.
2. Restrict `package.json` exports to it.
3. Add a version policy and an upgrade note for each release.
4. Move DharmaLab's 41 imports onto the list, promoting some files to official status and removing others.

### 2. Two content paths

A site's content can live as files in its repository, checked at build, or as rows in the database (`content: 'rows'`), editable live. The demo uses rows. Every content feature therefore has two paths, and a bug can live in one only. The file path gets build-time checks (such as refusing a price rule of "fifty"); the live path has to repeat them itself.

**To do:** confirm that every content check runs on both paths, and test both modes for each content kind.

### 3. Business rules in SQL

What a basket costs, who may read a lesson, what a provider earns and whether a purchase counts are all Postgres functions. Because the browser cannot decide anything, tampering with the page gains nothing, and that part is right. The cost is about 23,000 lines of SQL across 595 functions:

- **No safety net when changing things.** Nothing finds every use of a renamed field, and a mistake shows only when the function runs.
- **Harder to debug.** There is no stepping debugger, and error messages can be unrelated to the cause.
- **Hard for a site to customize.** A rule such as "10% off courses on a member's birthday" means replacing one of the kit's SQL functions, and that copy falls behind when the kit improves the original.

**To do (a design decision):** keep the database as the gatekeeper for permissions, and choose one of these for the calculations: keep them in SQL, move them to TypeScript server code, or add official plug-in points for site rules. Recommended: plug-in points first.

### 4. Module specs not official

The specs for spaces, network, events, emails, funnels, coaching, push and others are written but sit in the unarchived change `specify-every-module`. Eleven of their scenarios have no test, for example:

- a full event refuses further RSVPs;
- a suspended member cannot post;
- an order confirmation lists its lines and total.

Some tests cite spec names that never existed (`social-network`, `community-layouts`, `atproto-api`, `streamline-social-layout`).

**To do:** write the 11 tests, correct the spec names, then archive the change.

## Architecture

**Strong:**

- The schema as a declaration with a plan ([build/plan.mts](../packages/kit/build/plan.mts)): it handles renames through annotations and refuses destructive changes unless told otherwise.
- Tests on real, isolated stacks.

**Findings:**

5. **Database tables are the interface.** The browser queries tables directly: 115 calls in 48 Vue files. Every table layout is therefore public, and renaming a column can break the theme and any site override. Spark puts controllers between the page and the data. **To do:** a data layer in `src/lib` (functions or views) so that pages never depend on table layouts.
6. **Three runtimes share code by relative imports.** The browser, the Node build and the Deno functions all reach into `supabase/functions/_shared`, which costs a Deno type shim and `.js`/`.ts` import juggling. **To do:** give shared code one home with one import style, consumed by all three.
7. **Data migrations have no proper home.** The plan handles schema shape well, but a backfill or a column split has only the idempotent `data.sql`. **To do:** a supported way to write a one-off data change that runs once per database and is recorded.

## Separation of concerns

By owner (kit, theme, site), the separation is clean. By layer, it leaks.

8. **The theme does not only draw.** Admin screens query the database themselves (see 5).
9. **Oversized files** mix drawing, logic and data access. **To do:** split each along those lines:

   | File | Lines |
   |---|---|
   | `theme/src/components/admin/SocialAdmin.vue` | 5,351 |
   | `supabase/functions/social/index.ts` | 2,789 |
   | `theme/src/pages/SpacesPage.vue` | 2,018 |
   | `theme/src/pages/AdminPage.vue` | 1,812 |
   | `src/lib/spaces/api.ts` | 1,287 |

10. **The site's contract is mostly untyped.** In [src/config.mts](../packages/kit/src/config.mts), 25 configuration sections are `Record<string, unknown>`, so a site author gets no autocomplete and no error for a mistyped key. Nuxt, Astro and Next type their configuration fully. **To do:** a full schema for every configuration section.
11. **6,544 `any`s across 567 files** switch off strict checking where it matters most. The heaviest are SocialAdmin.vue (174), spaces/api.ts (147), AdminPage.vue (145) and SpacesPage.vue (128). **To do:** narrow them, starting with the oversized files as they are split. This is an open task in `typescript-throughout`.
12. **Seven JavaScript files remain**, including `supabase/functions/_shared/recurrence.js`. **To do:** convert them.

## Modularization

**Strong:** the module manifest ([build/modules/kit.mts](../packages/kit/build/modules/kit.mts)) declares what each module is, what it requires, where it can run and what it owns. The ownership test enforces it (66/66), and switching a module off removes its backend while keeping its data locked.

**Findings:**

13. **A module is not a package.** One module's code is spread across many folders. Courses, for example, has about 30 files in six places:

    - `theme/src/components/courses/`, `theme/src/pages/CoursesPage.vue` and `theme/src/components/admin/CourseEnrollments.vue`;
    - `src/lib/courses-paths.ts`;
    - `build/courses-*.mts`, `build/steps/courses.mts` and `build/models/core/courses.mts`;
    - `supabase/schemas/46-courses.sql` and three glue files;
    - `supabase/functions/course-notify/`;
    - `content/emails/course-*.json` and `theme/src/content/ui/courses.md`.

    The manifest lists only routes, steps, functions, schema and cron, so the rest is owned by convention alone. A component in another module's area, such as `theme/src/components/spaces/panels/MemberCourses.vue`, is cross-module glue that nothing tracks. **To do:** see [Modules as packages](#modules-as-packages).
14. **Glue between modules grows with every pair.** There are already 26 glue files, and each new module can add one per module it touches. **To do:** addressed by the same redesign.

## Extensibility

**Strong:**

- A site can add a whole module of its own; the demo's `stockists` proves it.
- A site can also add its own data, suppliers and palettes, plus admin screens drawn from its models.

**Findings:**

15. **Overrides replace a whole component.** An override is a copy that silently falls behind the kit, the same problem as Laravel's `vendor:publish`. **To do:** a checked contract, with named slots and props and a warning when an overridden component's original changes.
16. **There is no way for site code to react to events.** There are only outgoing webhooks, and nothing like Laravel's events and listeners or Spark's hooks for "order paid" or "member joined". **To do:** an in-app event and hook system.

## Code quality

17. **Unconventional style:**
    - 2,638 lines are over 200 characters, many of them whole functions on one line.
    - Long all-caps prose comments are thorough but slow a newcomer down.

    **To do:** conventional formatting and shorter comments, applied as files are touched.
18. **A home-made test harness.** 143 of 148 tests use an `ok()` helper instead of `node:test`, so the standard reporting, filtering and coverage tools do not apply. **To do:** move them to `node:test`, an open task in `typescript-throughout`.

The documentation check, which ties every page to the code it describes and dates each review, is stronger than Spark's documentation process.

## Features

There are 29 modules at version 0.1.0. Spark does about three things very well; here the breadth outruns proven depth:

- payouts cannot be proved without Stripe Connect;
- translation is declared unbuilt;
- the Hyperswitch adapter has its own open change.

19. **To do (a decision):** choose between raising all 29 modules to production depth and making a core set Spark-grade first. Then review each module against its category leader, as courses was reviewed against Kajabi.

## Code-level findings

20. **Tests not green.**
    - `generate` and `test-coverage` fail because of the unfinished `course-workbook` change.
    - `payouts-db` needs Stripe Connect on the test account.
    - The full end-to-end suite has not run since the TypeScript conversion.
    - Docker volumes hold about 168 GB of reclaimable space, which blocks a full run.
21. **A site's name in the kit.** A comment in [build/e2e.mts](../packages/kit/build/e2e.mts) names DharmaLab, contrary to AGENTS.md. **To do:** reword it.
22. **Payout arithmetic duplicated in the browser.** *Done* in 87924aba. The two cases the deleted unit test alone checked, an inactive rule and a rule for another booking type earning nothing, still need tests against the database; they go with item 4.
23. **A backlog of open changes.** 18 OpenSpec changes are open, several of them complete and awaiting archive.

## Modules as packages

The ideal is for each module to be one self-contained package: one folder holding everything the module is, which the kit discovers and loads the same way it loads a site's own module. A sketch of the target:

```
packages/kit/modules/courses/
  module.ts        the manifest: what it is, requires, integrates with
  schema/          its tables and SQL functions
  data/            its rows and seed
  functions/       its edge functions
  lib/             its browser logic and data layer (its only public API: index.ts)
  ui/              its pages, components, admin screens and default strings
  models/          its content models
  emails/          its email templates
  steps/           its build steps
  integrations/    what it adds when another module is on: spaces/, forms/, sessions/
  tests/
```

Principles:

- **The folder is the ownership.** What is in the folder belongs to the module, so the manifest no longer lists files and nothing can be unowned.
- **Integrations are owned by one side.** Glue becomes the module that adds something to another (`courses/integrations/spaces/`), installed only when both are on, and declared by the dependent, as `requires` already is.
- **Modules meet through slots, not file imports.** A module declares places others can contribute to (a member panel, an admin rail entry, a notification), and others fill them. `MemberCourses.vue` becomes courses' contribution to a spaces slot.
- **Each module has a public `index.ts`.** Other modules, and sites, import only from it, and a boundary lint enforces that.
- **Kit modules and site modules are identical.** The loader treats `packages/kit/modules/*` and a site's `src/modules/*` the same way, as `stockists` already shows is possible.
- **One repository, released in lockstep.** Each module folder can become a workspace package (`@platformkit/courses`) with one shared version, as Laravel splits `illuminate/*` from one repository. That gives separation without a version matrix between modules.

Migration, one module per commit:

1. A loader that reads both the old layout and module folders.
2. A pilot module.
3. The boundary lint.
4. The remaining modules.
5. Manifests whose ownership comes from their folders.

The existing assembled-tree test proves each move changes nothing a site receives.

## Checklist

- [ ] 1. Public interface, version policy and upgrade notes; DharmaLab's 41 imports moved onto it
- [ ] 2. Content checks on both content paths; both modes tested
- [ ] 3. Decide where business calculations live; plug-in points for site rules
- [ ] 4. The 11 untested scenarios (plus the two payout cases), spec names corrected, change archived
- [ ] 5. A data layer between pages and tables
- [ ] 6. One home for code shared by the browser, the build and the functions
- [ ] 7. One-off data changes, recorded per database
- [ ] 9. The five oversized files split
- [ ] 10. A typed schema for every configuration section
- [ ] 11. The `any`s narrowed
- [ ] 12. The last JavaScript files converted
- [ ] 13–14. Modules as self-contained packages
- [ ] 15. Override contracts with slots, props and drift warnings
- [ ] 16. An event and hook system
- [ ] 17. Conventional formatting and comments
- [ ] 18. Tests moved to `node:test`
- [ ] 19. Decide the feature scope; review each module against its category leader
- [ ] 20. Tests green; full suite run; Docker space freed
- [ ] 21. The site name removed from the kit
- [x] 22. The unused payout arithmetic removed
- [ ] 23. Finished OpenSpec changes archived
