---
title: Architecture
description: The three layers — the kit, the theme, a site — the rules that decided every placement, and how the repository is laid out.
order: 40
sources:
  [
    docs/PLATFORMKIT.md,
    packages/kit/package.json,
    packages/kit/src/lib/store.js,
    packages/kit/src/lib/store-light.js,
    packages/kit/src/lib/sync.js,
    packages/kit/src/lib/supabase.js,
    packages/kit/src/lib/toast.js,
    package.json,
    packages/kit/build/sites.mjs,
    packages/kit/build/runtime-paths.mjs,
    packages/kit/build/hyperswitch-test-stack.mjs,
    packages/kit/build/hyperswitch-v2-test.compose.yml,
    packages/kit/bin/platformkit.mjs,
    sites/docs/package.json,
    sites/docs/platformkit.config.js,
  ]
reviewed: 2026-10-29
---

PlatformKit sites use three packages. Before changing code, identify which package owns the behavior:

- **Kit** (`platformkit`): shared libraries, build pipeline, database declarations and functions, CLI, and deployment tools.
- **Theme** (`platformkit/theme`): pages, components, layouts, styles, instrument screens, and default interface text.
- **Site** (for example, `sites/demo`): `platformkit.config.js`, content, site-specific code and styles, database declarations, and tests.

Change a site's behavior through its config, content, or registered code. If a feature requires changing shared kit or theme behavior, make that change in the corresponding package rather than copying or patching the package inside a site.

## Repository layout

The workspace root contains tooling and package links. `packages/kit` is the one published package, `platformkit`: the reusable engine, with the default theme inside it at `packages/kit/theme`; `sites/` contains runnable sites and fixtures.

```text
package.json                 workspace tooling and scripts
openspec/                    capability specifications and proposed changes
packages/kit/                shared libraries, build tools, database, CLI
packages/kit/theme/      theme components, pages, styles, default strings
sites/<site>/                a site's config, content, registrations, and tests
  platformkit.config.js      enabled modules and site registrations
  content/                   site records and pages
  src/                        site components, styles, and application code
  db/                         site database declarations and functions
  supabase/                   assembled output; do not edit directly
platformkit.sites.json        local registry of separately owned site checkouts
sites/external/<name>/        fetched checkouts, outside the npm workspaces
deploy/                       shared hosting and deployment configuration
```

`sites/demo` is a generic example site. `sites/docs` is the documentation site, with its own config and content. Separately owned site repositories can be registered and fetched into `sites/external/`; those checkouts are managed locally and are not tracked as workspace packages.

## Package boundaries

Imports between the kit and theme use package specifiers such as `platformkit/lib/...` and `platformkit/theme/components/...`. The theme may import the kit; the kit must not depend on the theme or on a site. A site supplies its choices through `platformkit.config.js` and the registrations documented in [Configuration](/content/docs/building-a-site/configuration).

Some enabled features need extra packages at build time, such as `mjml`, the Typst compiler, or `onnxruntime-node`. Declare these in the site package that enables the feature. The build-step checks report missing packages.

The workspace root also provides an opt-in Docker-backed Hyperswitch v2 integration stack for
PlatformKit development. It builds from a local Hyperswitch checkout and is separate from site
builds and the default unit-test suite; the [payment-provider guide](/content/docs/building-a-site/payment-providers)
documents its setup and commands, including the Router prefix and Card Vault the Hyperswitch SDK's card fields need.

## Reader state

The browser stores reader state—such as answers, reading positions, and highlights—in a local Loro document (`packages/kit/src/lib/store.js`). After sign-in, the document syncs with the account's cloud copy (`sync.js`); local changes can be queued while offline. The forms embed uses a smaller local-storage implementation (`store-light.js`) so it does not load the full Loro runtime.

The kit's `supabase.js` provides the shared Supabase client, and `toast.js` provides the shared toast interface.

## Extending a site

1. Set module switches and registrations in `platformkit.config.js`.
2. Add site-owned content under `content/`; add site components, routes, or admin code under `src/` and register them in the config.
3. Add site database declarations and functions under `db/`. The build assembles these with the kit's sources into `supabase/`.
4. Add tests under the site's registered test paths.

Sites can disable modules, replace theme components by name, add looks and landing sections, and register routes, navigation, app tabs, admin sections, analytics panels, and database sources. They must not edit files under `packages/` from a site checkout. For a shared behavior change, follow the [spec workflow](/content/docs/building-a-site/the-spec-workflow).

## Related guides

- [Configuration](/content/docs/building-a-site/configuration) describes the config keys and registrations.
- [The theme and overrides](/content/docs/building-a-site/the-theme-and-overrides) explains theme imports and component replacement.
- [The content pipeline](/content/docs/building-a-site/content-pipeline) explains how content is compiled.
- [The database](/content/docs/building-a-site/the-database) explains schema declarations and assembly.
- [Dev, build and deploy](/content/docs/building-a-site/dev-build-and-deploy) covers local development and production builds.
