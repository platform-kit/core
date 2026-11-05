## ADDED Requirements

### Requirement: PlatformKit is written in TypeScript and ships its types

The kit's source SHALL be TypeScript, the published package SHALL ship compiled JavaScript with type declarations, and a site SHALL get types for its configuration, the module manifests, the registries, the theme contract and the adapters. A type error SHALL fail CI.

#### Scenario: a site's config with a typo

- **WHEN** a site's `platformkit.config.ts` names a module or a registry field that does not exist
- **THEN** `npm run typecheck` fails, naming the field

Verified by: `build/typecheck.test.mts`

#### Scenario: installed from npm or GitHub

- **WHEN** the package is installed into a site from npm or from GitHub
- **THEN** its CLI runs from compiled JavaScript, and its types resolve

Verified by: `build/source-cli.test.mts`
