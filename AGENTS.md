# PlatformKit engineering guide

## Specs and changes

OpenSpec specifications under `openspec/specs/` describe current platform behavior. A change that alters a requirement follows the repository's OpenSpec workflow: propose, implement, verify each named scenario, and archive the completed delta. Keep proposals reader-focused and keep implementation details in design notes or code.

## Repository boundaries

PlatformKit owns `packages/kit`, `packages/movable-types`, shared workspace tooling, and the generic demo and documentation sites. A downstream site owns its content, configuration, site-specific code, tests, documentation, and product requirements. Do not add a downstream site's identity or product details to PlatformKit's maintained docs, configuration, or specifications.

Separately owned sites are fetched into the local managed-site area. They are not npm workspaces, and package releases and production deployments run from the site's own repository.

## Verification

Run the narrowest relevant test or check. Do not run the full workspace suite unless requested. When a targeted failure points to a specific wider issue, report the evidence before expanding the test scope.

For a visible interface change, render and inspect the changed states at the relevant sizes and themes before reporting it complete. Keep reader-facing defaults in editable content, and keep data-entry controls aligned with the structure of the data.

## Documentation

Update the documentation site and repository references when platform behavior changes. Each documentation page names the code it describes, and `packages/kit/build/docs-check.mjs` verifies those sources and the reference material.

## Workspace layout

- `packages/kit` contains shared mechanics, build tooling, CLI, and backend declarations.
- `packages/movable-types` contains the default theme and reusable interfaces.
- `sites/demo` exercises the platform with generic content and enabled modules.
- `sites/docs` is the standalone documentation site.

The workspace root coordinates packages and generic fixtures; it is not itself a site.
