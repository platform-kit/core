# Proposal

## Why

Core's site registry and development state currently create a hidden `.platformkit` directory, which was not requested and obscures the actual repository structure. The root package also has no source-installable CLI, so sites cannot use PlatformKit directly from its public GitHub repository when its npm packages are unpublished.

## What Changes

- Keep site management in the Core repository: store its registry at the root and fetched site checkouts under `sites/external/`, ignoring only that external-checkout directory while retaining tracked generic fixtures.
- Resolve `PLATFORMKIT_DEFAULT_SITE` from either a site name or path; default to `sites/docs` and preserve `--site` precedence.
- Move transient runtime, shadow, and asset state out of `.platformkit` into the standard `node_modules/.cache/platformkit` cache.
- Add a root `platformkit` executable installable with `npx` from GitHub source. It installs the kit and theme from that same source into the selected site's dependencies without requiring published PlatformKit packages or changing the site's manifests or lockfile.
- Update the separate site checkout's command wiring and documentation to use the GitHub-source CLI.

No npm publication, release tarball, remote push, or deployment is part of this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kit-cli`: root-level site management and a GitHub-source `npx` CLI that does not require published PlatformKit packages.
- `build-and-dev`: site selection by name or path, preserved tracked fixtures, and no `.platformkit` runtime directory.

## Impact

The root package manifest and CLI, site registry and checkout paths, development/runtime cache paths, generic fixture tests, the separately owned site's package scripts, and the CLI/development documentation.
