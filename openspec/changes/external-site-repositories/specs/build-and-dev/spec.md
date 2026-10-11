# Spec Delta

## ADDED Requirements

### Requirement: Local development can use separately fetched sites

Workspace development SHALL discover registered site checkouts fetched from their own repositories, alongside any local site fixtures explicitly kept by PlatformKit. A fetched site SHALL behave as a site selected by its declared name, without being tracked as PlatformKit source. The workspace SHALL report registered sites that have not yet been fetched rather than silently omitting them.

#### Scenario: Start a fetched site

- **WHEN** `platformkit dev` starts with a registered site checked out at its pinned revision
- **THEN** the site is available by its declared local name and receives the same isolated development setup as other selected sites

Verified by: `packages/kit/build/dev-workspace.test.mjs` and `packages/kit/build/site-repositories.test.mjs`

#### Scenario: A registered site has not been fetched

- **WHEN** the workspace lists sites and a registered site has no local checkout
- **THEN** the listing identifies it as not fetched and provides the fetch command instead of implying it is running

Verified by: `packages/kit/build/site-repositories.test.mjs`


### Requirement: Workspace commands use a configurable default site

When a PlatformKit site command or root npm site shortcut runs from the workspace root, it SHALL select the site named by `PLATFORMKIT_DEFAULT_SITE`, defaulting to `docs` when unset. The selected site MAY be a local `sites/<name>` directory or a fetched managed checkout. An explicit `--site <path>` selection and execution from within a site directory SHALL take precedence. An unfetched registered default SHALL fail with the command needed to fetch it. The workspace development command SHALL use the default site unless `PLATFORMKIT_SITES` explicitly selects a multi-site set.

#### Scenario: The workspace default is unset

- **WHEN** a site command runs from the workspace root without `PLATFORMKIT_DEFAULT_SITE`
- **THEN** it runs against the local `docs` site

Verified by: `packages/kit/build/workspace-root.test.mjs`

#### Scenario: A local or fetched site is selected

- **WHEN** `PLATFORMKIT_DEFAULT_SITE` names a local site or a fetched managed checkout
- **THEN** root CLI commands and root npm site shortcuts run from that site directory

Verified by: `packages/kit/build/workspace-root.test.mjs`

#### Scenario: Explicit and multi-site selection take precedence

- **WHEN** `--site <path>` is supplied, or `PLATFORMKIT_SITES` explicitly names multiple sites for workspace development
- **THEN** the explicit selection is honored instead of the default site

Verified by: `packages/kit/build/workspace-root.test.mjs` and `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: A registered default has not been fetched

- **WHEN** `PLATFORMKIT_DEFAULT_SITE` names a registered checkout that is absent locally
- **THEN** the command refuses to run and prints `platformkit sites fetch <name>`

Verified by: `packages/kit/build/workspace-root.test.mjs`