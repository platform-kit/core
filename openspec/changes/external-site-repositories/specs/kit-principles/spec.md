# Spec Delta

## ADDED Requirements

### Requirement: PlatformKit's maintained material does not depend on downstream sites

PlatformKit's living documentation, configuration, and specifications SHALL describe the kit in generic terms and SHALL NOT name, quote, or require a particular downstream site's product, content, or operating details. Site-specific material SHALL be owned by that site's repository. A sanitized public Core snapshot SHALL exclude downstream-specific changelogs, archived change records, generated verification workspaces, and site-specific deployment templates, and SHALL have no inherited Git history. Any retained legacy refs containing those records or site source SHALL remain private and SHALL NOT be published from the Core remote.

#### Scenario: PlatformKit is understood without a downstream site

- **WHEN** a reader uses PlatformKit's current guides, feature overview, or specifications
- **THEN** they can understand PlatformKit without encountering or needing a particular site's identity or product documentation

Verified by: `packages/kit/build/site-boundary.test.mjs`

#### Scenario: A public Core snapshot excludes downstream-specific history

- **WHEN** a sanitized public snapshot is prepared from the current PlatformKit tree
- **THEN** the snapshot contains no downstream-specific changelogs, archived change records, generated verification workspaces, site deployment templates, or inherited commits

Verified by: `git grep` and `git rev-list --count` against the sanitized snapshot, plus `packages/kit/build/site-boundary.test.mjs`

#### Scenario: A site-specific document is moved

- **WHEN** a purpose, feature, or operating document describes only one site
- **THEN** it is present in that site's repository and is absent from PlatformKit's living documentation

Verified by: `packages/kit/build/site-boundary.test.mjs`
