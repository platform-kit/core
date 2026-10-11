# Spec Delta

## ADDED Requirements

### Requirement: The default site can be selected by path

When a command runs from the Core repository root, `PLATFORMKIT_DEFAULT_SITE` SHALL accept either a site name or a path to a site directory. An explicit `--site` selection SHALL take precedence. With neither provided, the default site SHALL be the tracked documentation site at `sites/docs`.

#### Scenario: choose a site by path
- **WHEN** `PLATFORMKIT_DEFAULT_SITE` names a valid site directory
- **THEN** root-level PlatformKit commands use that site
- **Verified by**: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: explicit site overrides the default
- **WHEN** both `--site` and `PLATFORMKIT_DEFAULT_SITE` are provided
- **THEN** the command uses the explicit `--site` value
- **Verified by**: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: use the documentation site by default
- **WHEN** a root-level command has no explicit site selection and no `PLATFORMKIT_DEFAULT_SITE`
- **THEN** it uses `sites/docs`
- **Verified by**: `packages/kit/build/site-repositories.test.mjs`

### Requirement: Core runtime state does not create a hidden project directory

PlatformKit SHALL keep transient development, asset, and database-shadow state in the conventional `node_modules/.cache/platformkit` cache and SHALL NOT create a `.platformkit` directory in the Core repository. The external-site checkout directory MAY be ignored, but the generic tracked sites SHALL remain part of the Core repository.

#### Scenario: start and stop development
- **WHEN** PlatformKit starts and stops a local development run
- **THEN** its run records, port records, and generated runtime files are held in the conventional cache and no `.platformkit` directory is created
- **Verified by**: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: use the database shadow and asset cache
- **WHEN** a build needs a database shadow or cached assets
- **THEN** the transient data is stored under the conventional cache rather than `.platformkit`
- **Verified by**: `packages/kit/build/schema.test.mjs` and `packages/kit/build/assets.test.mjs`
