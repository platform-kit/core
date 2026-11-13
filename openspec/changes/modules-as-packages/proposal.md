# Proposal

## Why

A module is a naming habit, not a thing you can open. Courses is about 30 files in six folders: the theme, `src/lib`, `build`, `supabase/schemas`, `supabase/functions` and `content/emails`. Its manifest claims five kinds of file; the rest is courses' by name only. Kit pages are wired by hand into `App.vue` and `router.ts`, and a site's module takes four config entries. Any file may import any other, so modules depend on each other's insides, and a site depends on 41 internal kit files. The theme holds every module's screens, so it is every feature's front end as well as the look.

## What Changes

- **One folder per module**, `core` included, in `packages/kit/modules/<key>/`, holding everything the module is: manifest, schema, rows, functions, logic, pages, components, admin screens, wording, models, emails, steps, integrations and tests.
- **The folder is the ownership.** Manifests stop listing files. A file outside every module folder and the named shared mechanics is refused.
- **Modules contribute; the kit composes** routes, admin sections, navigation, community places, member panels, steps, models, emails and wording. The hand-written page chain and per-module flags go.
- **Slots between modules.** A module declares places others may fill; courses' member panel fills a spaces slot.
- **Integrations owned by one side,** in `<module>/integrations/<other>/`, installed only when both are on, replacing `glue/<a>+<b>.sql`.
- **One front door per module.** Others import a module only through its `index.ts`, and a boundary check refuses the rest.
- **The theme is the look:** tokens, palettes, layout shell and shared building blocks. Module components stay overridable by name.
- **A site's module is the same thing,** loaded from `src/modules/<key>/` by one config entry.
- **Lockstep packages.** Each module folder becomes a workspace package released under the kit's one version.

## Non-goals

- Independent module versions, or a third-party module registry.
- Changing what any module does: the built site and assembled backend stay identical.
- Override drift warnings and an event system (audit items 15 and 16), which build on this change.

## Review focus

- The folder layout and what counts as a module's.
- Route precedence once routes are contributed.
- The boundary rule and the shared mechanics.
- DharmaLab's 41 imports, each mapped to a front door or an official export.

## Affected specifications

- `module-manifest`: ownership by folder, contributions, slots, integrations, the front door, and a site's module from one folder.
- `theme-contract`: the theme as look and shared parts; module components overridden by name.

## Surfaces

The build and dev server, the assembled backend, the router, the admin rail, community places and the member card, `generate` and `test`, the documentation site, and DharmaLab's imports.
