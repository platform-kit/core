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

| Point | Replaces |
|---|---|
| `routes`: path, match, component, precedence | the `v-else-if` chain in `App.vue`, the `*_ON` flags and route helpers in `router.ts` |
| `admin`: rail sections and their screens | the `MODULE_OF` map in `AdminPage.vue` |
| `nav`, `places` (community places), `panels` (member card) | hand-placed entries in the shell and in spaces |
| `steps`, `models`, `emails`, `strings`, `cron` | entries in `build/steps`, `build/models/core`, `content/emails`, `theme/src/content/ui`, `owns.cron` |

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

Deno needs one directory. The assembler already copies functions into the site's tree, and it now copies each module's `functions/*` there, with `functions/_shared/` placed at `_shared/<module>/`. Kit-wide shared function code stays in core.

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
