# Design

## Layout

```
packages/kit/
  modules/
    core/                  accounts, content, the ledger, comments, analytics: what every site has
    courses/
      module.ts            the manifest: key, what, requires, shapes, contributions, slots
      index.ts             the front door: the only file another module, the theme or a site imports
      schema/              its tables and SQL functions, in load order
      data/  seed/         its rows and its seed
      functions/           its edge functions; functions/_shared/ for code only its functions use
      lib/                 browser logic and its data layer
      ui/                  pages, components, admin screens
      strings/             its default wording (today theme/src/content/ui/courses.md)
      models/              its content models (today build/models/core/courses.mts)
      emails/              its email designs
      steps/               its build steps
      integrations/
        spaces/            what courses adds when spaces is on: schema, ui, functions
        forms/  sessions/
      tests/
  build/  vite/  src/      shared mechanics: the loader, the assembler, the build, the CLI, the router core
  theme/                   tokens, palettes, layout shell, shared building blocks
```

What stays outside module folders is mechanism with no feature of its own: the loader, assembler, plan, build pipeline, CLI, router core, Supabase client, design tokens and shared building blocks. Each of those is listed by name in `build/modules/shared.mts`. Anything else outside a module folder is refused.

## Ownership

The folder is the ownership. The manifest keeps `key`, `what`, `needs`, `requires`, the three shapes, `env` and `paymentProviders`, and drops the file lists: `routes`, `admin`, `schema`, `functions`, `cron` and `steps` come from contributions and folders. The manifests test changes from "every file is listed by one owner" to "every file is under one owner's folder, or named as shared".

## Contributions

A manifest contributes to points the kit composes:

| Point                                                      | Replaces                                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `routes`: path, match, component, precedence               | the `v-else-if` chain in `App.vue`, the `*_ON` flags and route helpers in `router.ts`                |
| `admin`: rail sections and their screens                   | the `MODULE_OF` map in `AdminPage.vue`                                                               |
| `nav`, `places` (community places), `panels` (member card) | hand-placed entries in the shell and in spaces                                                       |
| `steps`, `models`, `emails`, `strings`, `cron`             | entries in `build/steps`, `build/models/core`, `content/emails`, `theme/src/content/ui`, `owns.cron` |

A disabled module contributes nothing. Its components are never imported, so they leave the bundle as they do today through the guarded dynamic imports.

**Route precedence.** Today it is the order of the chain. Contributed routes are matched by explicit precedence (the most specific match wins), with ties refused at build. A test records every path the chain answers today and checks that the registry answers each one with the same page.

## Slots

A module declares a slot in its manifest (`slots: { 'member-card': {...} }`) and renders whatever fills it. Another module fills it from an integration (`courses/integrations/spaces/` contributes to `spaces:member-card`). The filler is installed only when both modules are on. A fill naming an undeclared slot is refused at build.

## Integrations

`supabase/schemas/glue/<a>+<b>.sql` becomes `<a>/integrations/<b>/schema.sql`, owned by the module that depends on the link, matching `requires`. An integration loads after both modules' own schema. Today's glue that was co-owned picks one owner: the module whose feature it serves, recorded per file in the move.

## Front door and boundaries

Each module's `index.ts` exports what others may use. A boundary check (part of `platformkit check` and the static lane) refuses:
- any import into another module's folder except its `index.ts`;
- any import from a site into the kit other than the package's declared exports.

The package's `exports` shrinks from `./*` to the module front doors plus the named shared mechanics. That is audit item 1's public interface.

## The theme

The theme keeps the tokens, palettes, looks, layout shell (`App.vue`, header, footer, page frame) and the shared building blocks (buttons, fields, drawers, grids, `PageHero`, `EmptyState`). Module screens move into their modules and draw with those blocks. Overrides keep working by name: the override resolver looks components up across the theme and every enabled module, and two components of one name are still refused.

## Edge functions

The Supabase CLI serves and deploys functions from one directory, `supabase/functions/<name>/`, and the site's `supabase/` tree is already generated by the assembler, never edited. So module folders are the source and the assembled tree is the output, as today:

- Each module's `functions/<name>/` is copied to `supabase/functions/<name>/`. A function name used by two modules is refused at assembly.
- Each module's `functions/_shared/` is copied to `supabase/functions/_shared/<module>/`. Core's shared function code stays at `_shared/`.
- Function code reaches shared code through import-map names, not relative paths, so one import resolves both in the source folder and in the assembled tree: `@pk/core/lib.ts`, `@pk/courses/notify.ts`. The assembler writes each function's `deno.json` imports (functions already carry one, for `#site` and npm pins) with those names mapped to `../_shared/` and `../_shared/<module>/`. The editor and type check map the same names to the module folders.
- A function's platform settings, such as `verify_jwt = false`, move from `config.toml.template` into the module's manifest, and the assembler writes them into the site's `config.toml`.
- Schema, rows and seed are copied into `supabase/schemas/`, `data/` and `seed/` under their current file names, so `sql_paths` and the load order are unchanged; integrations go where the glue files load today, after every module's own schema.

## Editing during dev

Every module file is edited where it lives, in its module folder, and nowhere else; the assembled `supabase/` tree is output, like `dist/`, and an edit made there is restored from the module folder with a message naming the file to edit. The source is what a developer edits, so an edit there has to reach the running dev site without a restart. Today it does not for functions: `dev` assembles `supabase/` once at start, so an edit to a kit function is served only after a restart. This change closes that gap for every kind of file:

- **Browser code** (pages, components, logic, wording): Vite loads it from the module folder itself, never from a copy, so HMR works as it does for the theme today. The kit's Vite plugin adds `packages/kit/modules/` and the site's `src/modules/` to the files it serves and watches.
- **Functions and their shared code:** `dev` watches every enabled module's `functions/` and re-copies a changed file into the assembled tree at once, rewriting that function's `deno.json` if its imports changed. `supabase functions serve` already reloads when its folder changes, so the edit is live on the next request. Links instead of copies were rejected: the CLI serves functions from inside a container that mounts only the site's `supabase/functions/`, so a link pointing outside it does not resolve there.
- **Schema, rows and seed:** a database cannot hot-reload. On a change, `dev` re-assembles the file and applies the plan to the dev database if it is non-destructive. If it would drop or rewrite something, `dev` prints the plan and the `platformkit migrate` command to run instead.
- **Manifests:** a change to `module.ts` (a route, a slot, a function setting) re-runs the composition. Routes and slots reload the page; function settings rewrite `config.toml`, and `dev` says the function server needs a restart, because the CLI reads that file only at start.
- **Content models and build steps** are rebuilt by the watch the content builder already runs.

## Packages

The first step is folders inside `packages/kit/modules/`. Once the boundary check passes on every module, each folder gets a `package.json` (`@platformkit/<key>`) as a workspace package. All are released together under the kit's one version, so modules never depend on different versions of each other.

## Migration

The loader reads module folders and the old layout side by side, so the kit works at every commit. Courses moves first, then each other module, one per commit. Every move is behaviour-neutral, proven by:
- the assembled backend being byte-identical (`assembled-tree.test.mts`, all modules on and each off in turn);
- the route registry answering every recorded path with the same page;
- the built demo's routes and prerendered pages being unchanged;
- each module's own tests passing from their new home.

Once nothing is left in the old layout, the old paths and file lists are removed.

## Downstream

DharmaLab's 41 imports each map to a module front door or a named shared export. The mapping table goes into the upgrade note for this change. The pinned fetched checkout is updated in DharmaLab's own repository, not here.

## Language, data, controls, motion

No reader-facing wording, data, controls or motion changes. Default wording moves files and keys unchanged.

## Deliberately not built

- **Independent module versions:** lockstep releases avoid a compatibility matrix.
- **A third-party module registry:** not needed until someone outside writes modules.
- **Drift warnings for overrides and an event system:** separate changes that build on the slots and front doors this one adds.