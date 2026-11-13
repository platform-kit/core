# Proposal: modules as packages

**Status:** approved in outline on 2026-11-12; not yet built.
**Tracks:** [AUDIT.md](../AUDIT.md) items 13–14, and the module half of item 1.
**Spec change:** [`openspec/changes/modules-as-packages`](../../openspec/changes/modules-as-packages/) (proposal, design, spec deltas, tasks).

This document explains the change in full: the problem, the target design, how it works with Supabase and Vite, how development works afterwards, how the move is made safely, and what it means for sites.

## 1. Summary

Today a PlatformKit module is a naming habit spread across six or more folders. After this change, a module is one folder that holds everything it is: tables, server functions, browser logic, pages, components, admin screens, wording, content models, emails, build steps, integrations with other modules, and tests.

The kit discovers module folders, composes what each one contributes (routes, admin sections, slots and so on), and copies backend files to where Supabase needs them. Developers edit every file in its module folder, and every edit reaches the running dev site without a restart. Modules talk to each other only through a public front door and named slots. The theme stops holding feature screens and becomes the look. A site's own module works exactly the same way as a kit module.

## 2. The problem

### 2.1 A module cannot be seen

Courses, the most recently rebuilt module, is about 30 files in these places:

| Where | What |
|---|---|
| `theme/src/components/courses/` (11 files) | player, library, overview, workbook, covers, styles |
| `theme/src/pages/CoursesPage.vue` | the page |
| `theme/src/components/admin/CourseEnrollments.vue` | the admin screen |
| `theme/src/components/spaces/panels/MemberCourses.vue` | courses' panel, filed under spaces |
| `theme/src/content/ui/courses.md` | its default wording |
| `src/lib/courses-paths.ts` | browser logic |
| `build/courses-io.mts`, `courses-push.mts`, `site-courses-node.mts`, `steps/courses.mts` | build and publishing |
| `build/models/core/courses.mts` | its content model |
| `build/courses.test.mts`, `courses-db.test.mts`, `course-workbook-db.test.mts` | its tests |
| `supabase/schemas/46-courses.sql` | its tables and SQL functions |
| `supabase/schemas/glue/courses+{spaces,forms,sessions}.sql` | what it adds to three other modules |
| `supabase/functions/course-notify/` | its notification function |
| `content/emails/course-{complete,lesson}.json` | its emails |

To understand or change courses, a developer has to know all of these places. Nothing in the code says that they belong together.

### 2.2 Ownership has holes

The manifest in `build/modules/kit.mts` claims routes, admin keys, build steps, functions, schema files and cron jobs. Everything else (components, logic, wording, models, emails, tests) is courses' by file name only. `MemberCourses.vue` is courses code living in spaces' folder; nothing records it as a link between the two modules, and nothing removes it cleanly when courses is off.

### 2.3 Wiring is by hand

- `theme/src/App.vue` chooses the page through a 29-branch `v-if`/`v-else-if` chain. Every module's page is named there.
- `src/lib/router.ts` holds per-module flags (`STORE_ON`, `FORMS_ON`, `SESSIONS_ON` and others) and route helpers such as `coursesRoute`.
- `AdminPage.vue` maps admin sections to modules in its own table (`MODULE_OF`).
- A site's own module needs four separate config entries. The demo's stockists module is registered in `routes`, `admin.sections`, `build.modules` and `build.steps`.

Adding a kit module means editing all of these. A site module cannot be added to some of them at all, except through these special config entries.

### 2.4 No boundaries

Any file may import any other. Modules reach into each other's internals, and the package exports `./*`, so sites can too: DharmaLab imports 41 different internal kit files. No one can tell which files are safe to change.

### 2.5 Links between modules grow with every pair

There are 26 glue files of the form `glue/<a>+<b>.sql`, each owned by both modules. Spaces alone appears in 10 of them and sessions in 7. Each new module can add one per module it touches.

### 2.6 The theme is not a theme

The theme holds every module's screens: 312 Vue files. A theme should be the look of a site. Here it is also every feature's front end, so a replacement theme would have to re-implement every feature.

## 3. Goals

1. Each module is one folder holding everything it is.
2. The folder is the ownership: nothing is owned by naming habit, and nothing is unowned.
3. The kit composes what modules contribute; no kit file names a module's pages.
4. Modules meet only through front doors, slots and integrations.
5. The theme is the look and the shared building blocks.
6. A site's module and a kit module are the same kind of thing.
7. Every module file is edited in place, and edits reach the running dev site without a restart.
8. Nothing a site receives changes during the move.

## 4. Non-goals

- **Changing what any module does.** Every step of the move is behaviour-neutral.
- **Independent version numbers per module, or a third-party module registry.** Modules are released together under one version.
- **Override drift warnings and an event system** (audit items 15 and 16). They are separate changes that build on this one.

## 5. The design

### 5.1 The layout

```
packages/kit/
  modules/
    core/                  what every site has: accounts, content, the ledger, comments, analytics
    courses/
      module.ts            the manifest
      index.ts             the front door
      schema/              tables and SQL functions
      data/                rows every site with courses gets
      seed/                development seed
      functions/           edge functions
        course-notify/
        _shared/           code only courses' functions use
      lib/                 browser logic and its data layer
      ui/                  pages, components, admin screens
      strings/             default wording
      models/              content models
      emails/              email designs
      steps/               build steps
      integrations/
        spaces/            what courses adds when spaces is on
        forms/
        sessions/
      tests/
    spaces/
    store/
    …
  build/  vite/  src/      shared mechanics
  theme/                   the look and the shared building blocks
```

### 5.2 What stays outside module folders

Only mechanism that has no feature of its own:
- the module loader and composer;
- the assembler and the schema plan;
- the build pipeline and the CLI;
- the router core (matching and navigation, not routes);
- the Supabase client;
- the theme's tokens, palettes, layout shell and shared building blocks.

Each is listed by name in `build/modules/shared.mts`. A file that is neither in a module folder nor on that list is refused by the manifests check.

### 5.3 The manifest

The manifest keeps what it says about the module (its key, description, requirements, deployment shapes, environment variables and payment providers) and gains what it contributes. It no longer lists files: the folder says what the module owns. An illustration of courses' manifest:

```ts
export default defineModule({
  key: 'courses',
  what: 'courses: lessons in order, released over time, tracked to completion, with certificates',
  needs: 'there is nowhere to keep who is enrolled, how far they are, or what is open to them',
  static: false, git: true, cloud: true,
  routes: [
    { path: '/courses', match: 'prefix', page: './ui/CoursesPage.vue' },
    { path: '/certificates', match: 'prefix', page: './ui/CoursesPage.vue' },
  ],
  admin: [{ sec: 'People', key: 'enrollments', label: 'Enrolments', screen: './ui/admin/CourseEnrollments.vue' }],
  cron: [{ name: 'course-notices', schedule: '*/15 * * * *', command: 'select public.run_course_notices()' }],
  functions: { 'course-notify': { verifyJwt: true } },
  slots: {},
  integrations: {
    spaces: { fills: { 'member-card': './integrations/spaces/MemberCourses.vue', places: './integrations/spaces/CoursesPlace.vue' } },
  },
})
```

The exact field names are settled in the first task. The point is that one file describes the module, and the kit reads it.

### 5.4 Contributions

A module contributes to named points; the kit composes them:

| Point | What a module gives | Replaces |
|---|---|---|
| `routes` | path, match rule, page, optional condition | the `App.vue` chain, the `*_ON` flags, route helpers |
| `admin` | rail sections and their screens | `MODULE_OF` in `AdminPage.vue` |
| `nav` | header and footer entries | hand-placed entries in the shell |
| `places` | community places (such as Courses in the community) | hand-placed places in spaces |
| `panels` | member-card panels | hand-placed panels |
| `steps` | build steps | `build/steps` entries and the site's `build.steps` |
| `models` | content models | `build/models/core/*` |
| `emails` | email designs | `content/emails/*` |
| `strings` | default wording | `theme/src/content/ui/*` |
| `cron` | scheduled jobs | `owns.cron` |
| `functions` | platform settings per function | entries in `config.toml.template` |

A module that is off contributes nothing. Its pages are imported only through contributions, so none of its files reach the browser bundle, which is the same guarantee today's guarded imports give.

### 5.5 Route precedence

Today, precedence is the order of the `App.vue` chain. Afterwards, routes are matched by explicit rules:

1. An exact match beats a prefix match.
2. A longer prefix beats a shorter one.
3. A route may carry a condition (today's `DOCS_ONLY`, `CMS` and `DEV` checks become conditions on core's routes).
4. If two routes match one path equally, the build fails and names both.

Before anything moves, a route census records every path the current chain answers on the demo and the page it shows. The census becomes a test: after every step, each recorded path must show the same page.

### 5.6 Slots

A module that wants others to add to it declares a named slot:

- spaces declares `member-card` (panels on a member's card) and `places` (sections of the community);
- the admin shell declares `rail`;
- the site shell declares `header` and `footer`.

Another module fills a slot from its integrations folder. For example, `courses/integrations/spaces/MemberCourses.vue` fills `spaces:member-card`. A fill is installed only when both modules are on. A fill naming a slot that no enabled module declares fails the build.

### 5.7 Integrations

What one module adds when another is on lives in the adding module's `integrations/<other>/` folder:
- schema (today's glue SQL);
- components that fill the other's slots;
- any function code for the link.

Each integration has one owner: the module whose feature it serves. That matches how `requires` already works, where the dependent declares the dependency. Each of today's 26 co-owned glue files is assigned one owner as its module moves, and the assignment is recorded in the move's commit. An integration's schema loads after both modules' own schema, where glue loads today.

### 5.8 The front door and boundaries

Each module's `index.ts` exports what others may use: functions, types and components. Other modules, the theme and sites import a module only through it.

A boundary check, part of `platformkit check` and the static test lane, refuses:
- an import into another module's folder other than its `index.ts`;
- an import from a site into any kit path the package does not export.

The package's `exports` shrinks from `./*` to the module front doors and the named shared mechanics. That is the public interface audit item 1 asks for: everything a site may rely on is listed, and everything else may change.

### 5.9 The theme after the change

The theme keeps:
- design tokens, palettes and looks;
- the layout shell: `App.vue` as a composer (it renders whatever route matched), the header, footer and page frame;
- shared building blocks every module draws with: buttons, fields, drawers, grids, dialogs, `PageHero`, `EmptyState`, `StepRow` and similar.

Every module's pages, components and admin screens move into that module. Overrides keep working by name: the override resolver searches the theme and every enabled module, so a site can still replace `CoursePlayer` or `PageHero` by naming it. Two components with the same name across the theme and the enabled modules are refused, as today.

## 6. How it works with Supabase

The Supabase CLI serves and deploys from one folder per site: `supabase/functions/<name>/`, `supabase/schemas/`, `config.toml`. PlatformKit already generates that folder rather than having anyone edit it: the assembler (`build/assemble.mts`) copies the kit's backend and the site's own into it before every dev run, test and deploy, and leaves out what disabled modules own. This change alters only where the assembler copies from.

| Source | Assembled to |
|---|---|
| `modules/courses/functions/course-notify/` | `supabase/functions/course-notify/` |
| `modules/courses/functions/_shared/` | `supabase/functions/_shared/courses/` |
| `modules/core/functions/_shared/` | `supabase/functions/_shared/` |
| `modules/courses/schema/46-courses.sql` | `supabase/schemas/46-courses.sql` |
| `modules/courses/integrations/spaces/schema.sql` | where glue loads today, after every module's schema |
| `modules/courses/data/`, `seed/` | `supabase/data/`, `supabase/seed/` |
| function settings in `module.ts` | `supabase/config.toml` |

File names and load order in the assembled folder stay as they are, so the output can be compared byte for byte.

### 6.1 Imports between functions and shared code

Function code reaches shared code by relative path today (`../_shared/lib.ts`). A relative path only works if the source and the assembled folder have the same arrangement, and after the move they do not.

The fix is Supabase's supported mechanism, an import map in each function's `deno.json`. Ten kit functions already carry one for `#site` and npm pins.
- Function code imports shared code by name: `@pk/core/lib.ts`, `@pk/courses/notify.ts`.
- The assembler writes each function's `deno.json` with those names mapped to `../_shared/` and `../_shared/courses/`.
- The editor and the type check map the same names to the module folders.

One import line therefore resolves correctly in the source and in the assembled folder.

### 6.2 Function names

Supabase function names are global per project. If two modules, or a module and a site, define the same function name, assembly fails and names both.

## 7. How it works with Vite

The kit's Vite plugin (`vite/index.mts`) already resolves the site, the theme and overrides. It gains:
- **Module folders as sources.** `packages/kit/modules/*` and the site's `src/modules/*` are served and watched where they are; nothing is copied.
- **A virtual route table** built from the enabled modules' `routes`, which `App.vue` renders.
- **Virtual slot tables** for `rail`, `member-card`, `places`, `header` and `footer`.
- **Override resolution** across the theme and the enabled modules.

The content builder (Velite) reads each enabled module's `models/` in place of `build/models/core/`.

## 8. Development

Every module file is edited in its own folder, and nowhere else. The assembled `supabase/` folder is output, like `dist/`.

| File | Edited in | Reaches the dev site by |
|---|---|---|
| `ui/` pages, components, admin screens | the module folder | Vite hot reload, from the file itself |
| `lib/` browser logic | the module folder | Vite hot reload |
| `strings/` wording | the module folder | Vite hot reload |
| `models/`, `emails/` | the module folder | the content builder's watch |
| `steps/` | the module folder | re-run on change |
| `module.ts` routes and slots | the module folder | recomposed; the page reloads |
| `module.ts` function settings | the module folder | `config.toml` rewritten; dev says to restart the function server, which reads that file only at start |
| `functions/` and `functions/_shared/` | the module folder | dev's watcher copies the file into `supabase/functions/`; live on the next request |
| `schema/`, `data/`, `seed/` | the module folder | re-planned; applied to the dev database if non-destructive |

Three rules make this safe:

1. **Copy on change, not links.** The CLI runs functions inside a container that mounts only the site's `supabase/functions/`. A link pointing into `packages/kit/modules/` does not resolve inside the container, so dev copies each saved file instead.
2. **Never destroy data automatically.** A schema change that would drop or rewrite something is not applied by dev; dev prints the plan and the `platformkit migrate` command.
3. **The generated folder is not editable.** If a file in `supabase/` is edited during dev, dev restores it from its module folder and names the file to edit.

This also fixes a gap that exists today: dev assembles once at start and watches nothing, so an edit to a kit function currently needs a restart.

## 9. Tests

- Each module's tests live in its `tests/` folder.
- The test runner discovers them by module and runs them only when the module is on, replacing the hand-kept list in `build/test.mts`.
- Static tests and stack tests keep their current lanes (`platformkit test`, `platformkit test --e2e`).

## 10. A site's own module

Before:

```ts
routes: [{ path: '/stockists', component: './src/stockists/StockistsPage.vue', module: 'stockists' }],
admin: { sections: './src/stockists/sections.ts' },
build: { modules: ['./src/stockists/module.ts'], steps: ['./src/stockists/step.ts'] },
```

After: the folder `src/modules/stockists/` holds `module.ts`, `ui/`, `steps/` and the rest, and the config needs only the switch:

```ts
modules: { stockists: true }
```

The kit finds `src/modules/*` the same way it finds `packages/kit/modules/*`. A site module may declare slots, fill other modules' slots and carry its own schema and functions.

## 11. Packages

The first steps use plain folders inside `packages/kit/modules/`. Once the boundary check passes on every module, each folder gets its own `package.json` and becomes a workspace package (`@platformkit/courses` and so on). All of them are released together under the kit's single version, the way Laravel releases its `illuminate/*` packages from one repository. This gives hard boundaries without modules ever depending on different versions of each other.

## 12. The migration

The kit works at every commit, and each commit proves it changed nothing a site receives.

### Phase 1: foundations

1. **Route census.** Record every path the current chain answers on the demo and the page it shows, as a test that passes on today's code.
2. **Loader.** Read module folders alongside the old layout, so modules can move one at a time.
3. **Composition.** Routes with precedence, admin sections, navigation, places, member-card panels, steps, models, emails, strings and cron, read from manifests.
4. **Assembler and overrides** read module folders; import maps are written for functions.
5. **Dev watcher** for every file kind in §8.
6. **The shared list** in `build/modules/shared.mts`.

### Phase 2: the courses pilot

1. Move every courses file into `modules/courses/`.
2. Turn its three glue files into `integrations/spaces`, `integrations/forms` and `integrations/sessions`.
3. Turn `MemberCourses.vue` and `CoursesPlace.vue` into fills of spaces' slots.
4. Add courses' `index.ts`, and turn the boundary check on for courses.

Proof:
- the assembled backend is byte-identical with every module on and with each off in turn;
- the route census passes;
- every courses test passes from its new folder, including the stack tests;
- the course pages render the same on the demo in both themes, at phone and desktop width.

### Phase 3: the remaining modules

Each module moves in its own commit, with the same proof. Modules with few links go first; spaces (10 integrations) and sessions (7) go late, and core goes last. The demo's stockists module moves to `src/modules/stockists/` and is registered by its switch alone.

### Phase 4: removing the old layout

The old paths, the manifests' file lists, the `App.vue` chain and the `router.ts` flags are deleted. The manifests check then refuses any file outside a module folder or the shared list.

### Phase 5: packages and the public interface

1. Package `exports` are reduced to the module front doors and the shared mechanics.
2. Each module becomes a workspace package.
3. An upgrade note maps each of DharmaLab's 41 imports to its new front door or official export.

### Phase 6: documentation and verification

1. The documentation site, `ARCHITECTURE.md` and `AUDIT.md` are updated.
2. Every scenario is reported, followed by a full end-to-end run.

## 13. What it means for sites

- **During phases 1–4, nothing changes for a site.** Old import paths keep working while both layouts are read.
- **In phase 5, imports of internal kit files stop resolving.** Each one is either replaced by a front-door import or promoted to an official export. For DharmaLab this is the 41 imports, mapped one by one in the upgrade note. The change to DharmaLab is made in DharmaLab's own repository.
- **A site's own module becomes simpler:** one folder and a switch.

## 14. Risks and how each is handled

| Risk | Handling |
|---|---|
| Route order subtly changes which page shows | The route census test covers every path the chain answers today. |
| A moved file changes what Supabase receives | The byte-identical assembled-tree comparison, with all modules on and each off. |
| Function imports break after copying | Import maps resolve the same names in source and output; the stack tests boot every function. |
| A module's component leaks into a site with the module off | The modules-off test checks that no file of a disabled module is in the bundle. |
| Cross-module imports creep back in | The boundary check fails the build. |
| A long-running migration leaves two layouts | The loader reads both only until phase 4, which deletes the old one; the checklist tracks each module. |
| DharmaLab breaks on upgrade | Phase 5 comes with the import map in the upgrade note, applied in DharmaLab's own repository. |
| Dev auto-applies a harmful schema change | Dev applies only non-destructive plans, using the existing destructive-change guard. |

## 15. Done means

1. Every kit file is in a module folder or on the shared list, and the check enforces it.
2. No kit file outside a module names that module's pages or components.
3. The theme holds no module's screens.
4. Every module has a front door, and the boundary check passes.
5. The demo's stockists module is one folder and a switch.
6. Editing any module file in place reaches the running dev site as §8 describes.
7. The assembled backend, the route census and every test are unchanged by the move, and a full end-to-end run passes.
8. The package exports only the front doors and the shared mechanics, and DharmaLab's upgrade note is written.
