## ADDED Requirements

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
