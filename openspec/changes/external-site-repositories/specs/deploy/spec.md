# Spec Delta

## ADDED Requirements

### Requirement: A deployment builds the checked-out site independently

A production build SHALL use the site repository and commit selected by the deployment host. The existing PlatformKit deploy command SHALL be invocable from that repository through `npx --yes --package=github:platform-kit/core platformkit deploy` and SHALL install the kit and theme from the Core source without requiring package publication or modifying the site's manifest or lockfile. Before any production-facing step, deployment SHALL verify that the installed kit and theme match their recorded Core-source provenance and SHALL fail clearly if the receipt is missing or the installed contents differ. Deployment SHALL NOT depend on the Core workspace's site registry, local checkout cache, or another site's files. The deployment host's existing configuration remains unchanged.

#### Scenario: A site commit is deployed through the existing command

- **WHEN** the existing deploy command is invoked with the Core GitHub-source CLI from a standalone site repository
- **THEN** the deployment uses that site's checked-out content, configuration, and code, with the kit and theme installed from Core source

Verified by: `packages/kit/build/source-cli.test.mjs` and `packages/kit/build/deploy-pins.test.mjs`

#### Scenario: Source provenance is absent or inconsistent

- **WHEN** the deploy preflight finds no source-install receipt or finds that installed package contents no longer match it
- **THEN** deployment fails with the missing or inconsistent source installation identified before production-facing steps begin

Verified by: `packages/kit/build/deploy-pins.test.mjs`
