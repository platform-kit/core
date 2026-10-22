# Spec Delta

## ADDED Requirements

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
