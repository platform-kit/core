# Spec Delta

## ADDED Requirements

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
