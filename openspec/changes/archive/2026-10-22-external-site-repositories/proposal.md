# Proposal

## Why

PlatformKit already supports running a site from a path, but its workspace and deployment workflow still assume site projects live inside the PlatformKit checkout. Separating ownership requires a safe local fetch/update workflow and a way to run the existing deploy command from a site's own repository using PlatformKit directly from its public GitHub source.

## What Changes

- Give each site its own repository, documentation, tests, and OpenSpec root; keep PlatformKit's living documentation and configuration generic.
- Let a site invoke the existing PlatformKit CLI and deploy flow through `npx --yes --package=github:platform-kit/core platformkit deploy`, without requiring published PlatformKit packages.
- Add a site registry and `platformkit sites fetch` / `update` workflow that checks out the configured repository at an explicit revision for local multi-site development. It must preserve local edits and refuse unsafe updates.
- Allow machine-local environment variables to provide repository URLs and private GitHub authentication without storing credentials in the registry.
- Build and deploy from the site repository, independently of a PlatformKit workspace checkout; do not add hosting-provider-specific deployment configuration.
- Move product-specific purpose, feature, and planning documents with their site. Exclude site-specific historical records and deployment artifacts from the sanitized public Core snapshot; keep any needed legacy records only in private refs.

No reader-facing copy or product behavior changes are proposed.

## Non-goals

This does not redesign the site's features, automatically advance a site's pinned revision, rewrite archived planning records, or publish/rewrite the repository's existing history.

## What James should look at

The key decisions are that local development fetches the revision the registry names, while production runs the existing deploy flow from the site's repository through the Core GitHub-source CLI. A dirty local checkout is never overwritten silently, and no host-specific deployment setup is introduced. The public Core snapshot is a clean root commit with no inherited history; legacy refs are not part of the public push.

## Capabilities

### New Capabilities

- `site-repositories`: independently owned site repositories, pinned revisions, safe local fetch/update, and the boundary between site-owned and PlatformKit-owned material.

### Modified Capabilities

- `kit-cli`: commands for fetching and updating registered site checkouts.
- `build-and-dev`: discovery and development of fetched sites outside the tracked PlatformKit workspaces.
- `deploy`: a site repository builds and deploys using its pinned PlatformKit releases.
- `kit-principles`: PlatformKit's maintained documentation and configuration remain generic and do not identify downstream sites.

## Impact

The site registry, CLI, workspace discovery, source-install verification, OpenSpec roots, and living documentation are affected. Site manifests and lockfiles remain owned by the site; no package release or host-specific configuration is required. No reader-facing API or database change is intended.
