---
title: Architecture
description: The three layers — the kit, the theme, a site — the rules that decided every placement, and how the repository is laid out.
order: 40
sources:
  [
    docs/PLATFORMKIT.md,
    packages/kit/package.json,
    packages/movable-types/package.json,
    packages/kit/src/lib/store.js,
    packages/kit/src/lib/store-light.js,
    packages/kit/src/lib/sync.js,
    packages/kit/src/lib/supabase.js,
    packages/kit/src/lib/toast.js,
    package.json,
    packages/kit/build/sites.mjs,
    packages/kit/build/runtime-paths.mjs,
    packages/kit/bin/platformkit.mjs,
    sites/docs/package.json,
    sites/docs/platformkit.config.js,
  ]
reviewed: 2026-10-10
---

Where anything lives is decided by one question, and held mechanically rather than asked for:
[Declarations and state](/content/docs/building-a-site/declarations-and-state).

## The idea in one paragraph

PlatformKit is a platform in three layers. **The kit** (`@platform-kit/kit`) is everything with no pixels: the content pipeline, the build, the data layer, the store, the memberships, the chats, the funnels, the emails, the print production, the spoken books, the enrichment, the deploy, the CLI. **The theme** (`@platform-kit/movable-types`) is everything somebody or an admin sees: every page, component, screen and stylesheet, replaceable piece by piece or whole. **A site** is one config file, a folder of content, a palette, and whatever it registers on top — Northlight Press (`sites/demo`) is one, with no code of its own, and this documentation is another with every module off.

Three rules decided every placement, and decide every new one:

1. **If it has no pixels it is core.** A scoring engine, a build script, a database policy — the kit's.
2. **Mechanics are core, meaning is site.** The runner that asks a question and times the answer is the kit's; the questions, the levels and what a slow answer means are the site's.
3. **If a plain content or coaching business would use it unchanged, it is the kit's feature**, and a site's version of it is a registration — a config entry, an override, a strings file.

## The repository

One npm workspace with shared tooling at the root, reusable packages under `packages/`, and runnable sites under `sites/`. The docs and demo packages are generic fixtures; independent sites can be fetched into the local managed checkout area:

```
package.json               tooling-only npm workspace: packages/* and sites/*
openspec/                   the specs and the changes
packages/kit/                @platform-kit/kit
  src/lib, src/instrument    the libraries; the instrument's mechanics (session, timing, voice)
  build/                     every build script; steps/ the build steps' records and steps.mjs their runner; the Vite plugin's helpers; the CLI's commands
  vite/index.mjs             the Vite plugin (+ the kit's tailwind.config.js)
  supabase/                  the declared schema, the rows, every function with _shared, the seed's shape
  bin/platformkit.mjs        the CLI
packages/movable-types/ @platform-kit/movable-types
  src/theme.js               the manifest
  src/components, pages, layouts, instrument/ui   every component; the runner; the sheet shell
  src/content/ui/            the default strings, one file per scope
  src/looks/design.css       the one design every look shares
sites/<site>/               an independent site package and its own implementation
  platformkit.config.js      modules, looks, overrides and every site registration
  content/, src/, db/        the site's content, app, and declared database sources
  supabase/                  ASSEMBLED from the kit and db/ (committed, checked, never edited)
platformkit.sites.json      local registry of separately owned sites and pinned commits
sites/external/<name>/      fetched site checkouts, kept outside npm workspaces
  build/                     the site's own tests and scripts
node_modules/.cache/platformkit/ workspace- or site-local runtime records, assets and database shadows
sites/demo/                  Northlight Press: config + content + a look, no code
sites/docs/                  this documentation: config + docs + a look, every module off
deploy/                      shared workspace host and deployment infrastructure
```

Imports across a boundary are package specifiers (`@platform-kit/kit/lib/…`, `@platform-kit/movable-types/components/…`). The theme depends on the kit; the kit imports nothing of the theme (the router and the strings helper are the kit's, re-exported by the theme). **No package imports a site** — everything a package needs of a site comes through the config, and the check for that is that the root site's package name appears nowhere under `packages/`. And a site names what its modules need: the kit's heavy module-bound packages — the spoken books' runtime and ffmpeg, mjml, Typst — are optional peers of the kit, listed in the `package.json` of the site that switches the module on (see [the build steps](/content/docs/building-a-site/dev-build-and-deploy#the-build-steps)). The Social execution path uses the kit's direct `@opencoredev/social-sdk` dependency; a site opts into showing provider conversations in Spaces by registering `spaces.deskSources`.

## The person's own state

What somebody does that is theirs — answers, reading places, highlights, which tab was last open — lives in one Loro document in the browser (`lib/store.js`: a CRDT, persisted locally, read synchronously so the theme and the app are right before first paint) and, once signed in, in the cloud too (`lib/sync.js`: the cloud copy is the truth for an account, Loro the local engine that buffers offline work and merges — a guest's answers survive their first sign-in as a merge, every network failure is swallowed until the next commit or focus). The form embed on another site carries a light stand-in (`lib/store-light.js`, plain localStorage) so the CRDT and its wasm stay on the site. `lib/supabase.js` is the one Supabase client (the functions client pointed at the site's own domain when the rewrites are on); `lib/toast.js` the one toast the layout shows.

## What a site may and may not do

A site **may** switch any module off, replace any theme component by name, add looks and skins, override any string, add content collections, routes, app tabs, nav items, community places (a menu row, its address and its page), landing section types, admin sections with their handlers, analytics panels, declared schema files, rows, edge functions, seed rows and tests.

A site **may not** patch a kit or theme file. A need that cannot be met by registration is a change to the kit, proposed through its own [spec workflow](/content/docs/building-a-site/the-spec-workflow).

## Where each thing is documented

- The config and every registration: [Configuration](/content/docs/building-a-site/configuration).
- How the kit reaches a site (virtual modules, overrides, strings): [The theme and overrides](/content/docs/building-a-site/the-theme-and-overrides).
- The content pipeline and every collection: [Content pipeline](/content/docs/building-a-site/content-pipeline).
- The database: [The database](/content/docs/building-a-site/the-database).
- The build, the dev server and the deploy: [Dev, build and deploy](/content/docs/building-a-site/dev-build-and-deploy).
- The internals of each module: the pages after those.
