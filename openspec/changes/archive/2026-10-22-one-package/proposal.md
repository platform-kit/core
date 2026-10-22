# Proposal

## Why

PlatformKit is meant to be one thing from one repository, but it publishes as two npm packages, the engine (`@platform-kit/kit`) and the theme (`@platform-kit/movable-types`), with two names, two versions to keep in step, and two dependencies for every site. Neither has been published, so a separately owned site cannot install them at all, and DharmaLab's checkout has been running on whatever packages the workspace happened to hold.

## What Changes

- **BREAKING:** PlatformKit is one npm package, `platformkit`, published from this repository: the engine, with the default theme inside it.
- It runs two ways, and both install the same package:
  - from npm: `npx platformkit dev`;
  - from GitHub: `npx github:platform-kit/core#<branch-or-tag> dev`.
- **BREAKING:** sites depend on `platformkit` alone, from npm or as `github:platform-kit/core#<ref>`. Imports change from `@platform-kit/kit/…` to `platformkit/…`, and the theme from `@platform-kit/movable-types` to `platformkit/theme`.
- The release publishes one package. The two scoped names are retired.
- The workspace's fixture sites, the docs and the CLI's source route move to the new name. DharmaLab moves in its own repository.

## Non-goals

- Splitting the theme back out for third-party themes. A site may still name another theme package in its config.
- Renaming the repository or the npm organisation.

## Review focus

That both npx forms run `dev` from an empty folder; that a separately owned site installs from GitHub with nothing placed by hand; that no `@platform-kit/kit` or `@platform-kit/movable-types` remains outside history.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kit-cli`: the commands are run from one package, by npm or by GitHub, and a site depends on that package alone.

## Impact

- Surfaces: the CLI (`platformkit`), every site's `package.json`, imports and config, the release workflows, the docs.
- Code: `packages/kit/package.json` (name, exports for `./theme`, the theme's dependencies), the theme's files moved to `packages/kit/theme/`, `build/source-install.mjs`, the release workflows, every import.
