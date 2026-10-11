# Spec Delta

## ADDED Requirements

### Requirement: Core explains its purpose and supported features

The Core repository SHALL include accessible purpose and feature documents that describe PlatformKit rather than a downstream site. Feature claims SHALL be grounded in current specifications and implementation evidence, and SHALL distinguish capabilities available to sites from capabilities enabled only by configuration, registration, published content, or generic fixtures. These documents SHALL not identify or reproduce a downstream site's product identity, content, or policies.

#### Scenario: a reader learns what Core offers

- **WHEN** a reader consults Core's purpose and feature documents
- **THEN** they can understand PlatformKit's purpose and its supported capabilities without mistaking a downstream site's product features for Core behavior

Verified by: `packages/kit/build/site-boundary.test.mjs`, `packages/kit/build/docs-check.mjs`, and a feature-claim audit against the named specs and implementation tests

#### Scenario: a site-specific reference is added to Core

- **WHEN** a maintained Core document names or reproduces a downstream site's identity or product content
- **THEN** the boundary check refuses the change

Verified by: `packages/kit/build/site-boundary.test.mjs`
