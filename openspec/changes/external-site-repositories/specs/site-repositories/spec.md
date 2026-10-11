# Spec Delta

## Purpose

Sites are independently owned projects built on PlatformKit. This capability defines how a site stays in its own repository while being fetched for local work and built and deployed on its own.

## ADDED Requirements

### Requirement: A site repository is registered by remote and exact revision

The PlatformKit workspace SHALL let an operator register a site's Git remote and a pinned revision. The revision SHALL resolve to one commit; fetching SHALL NOT silently follow a moving branch or tag. The registration SHALL identify the site by its declared site name and SHALL NOT make the site part of PlatformKit's tracked source.

#### Scenario: A registered site is fetched

- **WHEN** an operator fetches a registered site
- **THEN** the checkout is made available at the revision recorded for that site and its name and source are reported

Verified by: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: The registered revision changes

- **WHEN** an operator changes a site's pinned revision and fetches it again
- **THEN** the checkout moves only to the newly pinned commit and the prior pin remains unchanged until the registration is edited

Verified by: `packages/kit/build/site-repositories.test.mjs`

### Requirement: Fetch and update preserve local work

Fetching a site that is not present SHALL create its checkout without changing the PlatformKit repository's tracked files. Updating an existing checkout SHALL preserve its local changes; if applying the newly pinned revision would overwrite local changes, the operation SHALL stop, identify the affected checkout, and leave it unchanged.

#### Scenario: A clean checkout updates

- **WHEN** an existing managed checkout has no local changes and its registered pin changes
- **THEN** the update checks out the new pinned revision and reports the resulting commit

Verified by: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: A checkout has local edits

- **WHEN** an update would replace a checkout with uncommitted or untracked changes
- **THEN** the update refuses before changing any file and tells the operator how to preserve or resolve the local work

Verified by: `packages/kit/build/site-repositories.test.mjs`

### Requirement: Environment configuration can supply site remotes and GitHub authentication

When `--url` is omitted, `platformkit sites fetch` SHALL read the remote from `PLATFORMKIT_SITE_<NAME>_GIT_URL`, where the site name is uppercased and hyphens are replaced with underscores. For private GitHub HTTPS remotes, fetch and update SHALL use `PLATFORMKIT_GITHUB_TOKEN`, falling back to `GITHUB_TOKEN` and then `GH_TOKEN`. Credentials SHALL be passed only to the Git process and SHALL NOT be included in the remote URL, local registry, or command output.

#### Scenario: A site remote is supplied by the environment

- **WHEN** `platformkit sites fetch <name> --ref <commit>` runs without `--url` and the matching remote environment variable is set
- **THEN** it fetches the pinned commit and records the credential-free remote and pin

Verified by: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: A private GitHub remote uses an environment token

- **WHEN** a managed site fetch or update uses a private GitHub HTTPS remote and a token is available in the environment
- **THEN** Git receives temporary authentication configuration, while the registry and remote URL contain no token

Verified by: `packages/kit/build/site-repositories.test.mjs`

### Requirement: A site remains buildable and deployable from its own repository

A site repository SHALL contain the site's content, configuration, code, tests, documentation, and site-owned specifications. Its own manifest and lockfile SHALL remain the authority for its dependencies, but it SHALL NOT require published PlatformKit packages. Site development, tests, build, and deployment SHALL run from that repository without requiring a PlatformKit monorepo checkout or a sibling site's files. The site SHALL be able to invoke the existing PlatformKit CLI from the canonical public Core GitHub source through `npx`.

#### Scenario: A site is built on its own

- **WHEN** the site repository is installed and its documented build and test commands run
- **THEN** they complete using the site's dependencies and the PlatformKit CLI and packages obtained from Core source, without a Core workspace checkout or sibling site files

Verified by: `packages/kit/build/source-cli.test.mjs` and the standalone site's targeted test/build commands

#### Scenario: The existing deploy flow runs from the site repository

- **WHEN** `npx --yes --package=github:platform-kit/core platformkit deploy` runs from the checked-out site repository
- **THEN** it uses that site's content, configuration, and code, installs PlatformKit from Core source without changing the site's manifest or lockfile, and does not read site files from the Core repository

Verified by: `packages/kit/build/source-cli.test.mjs` and `packages/kit/build/deploy-pins.test.mjs`

### Requirement: PlatformKit-owned material stays site-neutral

Living PlatformKit documentation, configuration, and specifications SHALL describe generic PlatformKit behavior and SHALL NOT identify or depend on a particular downstream site. Site-specific purpose, features, operating guidance, and specifications SHALL live in that site's repository. Historical changelogs and archived OpenSpec changes SHALL remain as historical records and SHALL NOT be rewritten by this separation.

#### Scenario: A PlatformKit guide is read without a site checkout

- **WHEN** a reader opens a living PlatformKit guide or specification
- **THEN** it describes PlatformKit and its generic examples without naming a downstream site or requiring that site's repository

Verified by: `packages/kit/build/site-boundary.test.mjs`

#### Scenario: A historical record names a site

- **WHEN** a changelog or archived OpenSpec change contains a site's name
- **THEN** the record remains intact and is treated as history, not as current PlatformKit documentation

Verified by: `packages/kit/build/site-boundary.test.mjs`
