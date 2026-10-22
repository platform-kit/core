# kit-cli

## Purpose

One command a site runs for everything the kit does — so a developer never assembles the stack, the functions, the build or the deploy by hand, and the kit's own tests run against any site the same way.

## Requirements

### Requirement: The commands

`platformkit` SHALL offer `dev` (the site on one held port with its stack and functions), `build`, `deploy` (with the environment checks first), `test` (the kit's tests plus the site's), `migrate` (assemble and apply; `reset`), `functions` (assemble and serve or deploy), `print`, `tts`, `enrich`, `probe` (the phone probe) and `spec` (OpenSpec validate over both roots), each taking `--site <path>` and defaulting to the current directory.

#### Scenario: a site with no code

- **WHEN** `platformkit dev` runs in a directory holding only a config and content
- **THEN** the site serves on the first free port from 5173 with its stack up and its functions served

Verified by: the demo in the kit's CI

### Requirement: The deploy checks read the modules

`platformkit deploy` SHALL demand only what the site's modules and content switch on: no printer for a site without print, no cal.com for one without sessions, Stripe only when something is for sale; the mail relay and push always.

#### Scenario: a content-only site

- **WHEN** a site has every commerce module off
- **THEN** the checks ask for Supabase, the site's origin, the mail relay and the VAPID pair, and nothing else

Verified by: `deploy-checks --test` extended with module cases

### Requirement: PlatformKit runs directly from its GitHub source

The Core repository SHALL expose a `platformkit` executable that can be invoked through `npx` from the repository's GitHub source, without publishing PlatformKit packages or depending on those packages being available from the npm registry. Running the executable for a site SHALL make the kit and theme source available to that site's build without changing its package manifest or lockfile.

#### Scenario: use the GitHub source without published packages
- **WHEN** a user invokes `npx --package=github:platform-kit/core platformkit` for a site while PlatformKit packages are unavailable from npm
- **THEN** the command runs using the kit and theme from the GitHub source and leaves the site's package manifest and lockfile unchanged
- **Verified by**: `packages/kit/build/source-cli.test.mjs` using a local Git source fixture and a site with no published PlatformKit packages

### Requirement: Site management is rooted in the Core repository

The site registry SHALL be stored at the Core repository root, and separately fetched site checkouts SHALL be placed in a dedicated external-sites directory under `sites/`. Generic tracked fixture sites SHALL remain in the repository and SHALL NOT be treated as disposable fetched checkouts.

#### Scenario: fetch an independently owned site
- **WHEN** a user fetches a site through the PlatformKit CLI
- **THEN** its checkout and registry entry are stored in the Core repository's visible site-management locations without adding the checkout to the workspace's package installation
- **Verified by**: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: preserve generic fixture sites
- **WHEN** external site checkouts are ignored by Git
- **THEN** the ignore rule excludes only the dedicated external-sites directory and leaves tracked fixture sites visible to Git
- **Verified by**: `packages/kit/build/site-repositories.test.mjs`

### Requirement: Registered site repositories can be fetched and updated

The `platformkit sites` commands SHALL fetch and update site repositories using the remote and exact revision recorded for each site. The commands SHALL report the site's name, checkout location, and resolved commit, and SHALL fail explicitly for an unknown site, an unreachable remote, or a revision that cannot be resolved.

#### Scenario: Fetch a registered site

- **WHEN** `platformkit sites fetch <name>` is run for a registered site that has no checkout
- **THEN** it fetches the registered revision into the managed site location and reports the checkout and commit

Verified by: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: Update to a new pin

- **WHEN** `platformkit sites update <name>` is run after the registration's pin changes
- **THEN** it updates to that pin only if the checkout can be changed without losing local work

Verified by: `packages/kit/build/site-repositories.test.mjs`

### Requirement: PlatformKit is one package, run from npm or from GitHub

PlatformKit SHALL be published as one npm package, `platformkit`, from this one repository: the engine and its default theme together, at one version. The `platformkit` command SHALL run the same way from either source: `npx platformkit <command>` from npm, and `npx github:platform-kit/core#<branch-or-tag> <command>` from GitHub. A site SHALL depend on that one package alone, from either source, and SHALL reach the engine as `platformkit/…` and the default theme as `platformkit/theme`.

#### Scenario: from npm

- **WHEN** `npx platformkit dev` runs in a site's folder
- **THEN** the site starts, with nothing else installed by hand

Verified by: `node build/one-package.test.mjs`, which packs the package and runs its command from the packed file in an empty folder

#### Scenario: from GitHub

- **WHEN** `npx github:platform-kit/core#<ref> --help` runs in an empty folder
- **THEN** the `platformkit` commands are listed

Verified by: `npx --yes github:platform-kit/core#main --help` from an empty folder

#### Scenario: one name

- **WHEN** the repository is searched outside its history
- **THEN** no import, dependency or configuration names `@platform-kit/kit` or `@platform-kit/movable-types`

Verified by: `node build/one-package.test.mjs`
