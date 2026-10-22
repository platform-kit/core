# PlatformKit engineering guide

## Specs and changes

OpenSpec specifications under `openspec/specs/` describe current platform behavior. A change that alters a requirement follows the repository's OpenSpec workflow: propose, implement, verify each named scenario, and archive the completed delta. Keep proposals reader-focused and keep implementation details in design notes or code.

## Repository boundaries

PlatformKit owns `packages/kit`, `packages/kit/theme`, shared workspace tooling, and the generic demo and documentation sites. A downstream site owns its content, configuration, site-specific code, tests, documentation, and product requirements. Do not add a downstream site's identity or product details to PlatformKit's maintained docs, configuration, or specifications.

Separately owned sites are fetched into the local managed-site area. They are not npm workspaces, and package releases and production deployments run from the site's own repository.

## Verification

Run the narrowest relevant test or check. Do not run the full workspace suite unless requested. When a targeted failure points to a specific wider issue, report the evidence before expanding the test scope.

For a visible interface change, render and inspect the changed states at the relevant sizes and themes before reporting it complete. Keep reader-facing defaults in editable content, and keep data-entry controls aligned with the structure of the data.

## Documentation

Update the documentation site and repository references when platform behavior changes. Each documentation page names the code it describes, and `packages/kit/build/docs-check.mjs` verifies those sources and the reference material.

## Working through blockers

The goal is the outcome the user asked for, not the design already in progress. When something fails, ask first whether the design is wrong, not only whether the surroundings are.

- **Two strikes, then redesign.** If a path fails twice, or a fix needs a third supporting change (another service, a proxy, a rewrite, a config workaround), stop and list two or three different ways to reach the outcome. Pick the one that removes the obstacle instead of working around it.
- **A stated constraint is a design direction.** When the user says what must not happen ("don't handle raw card data", "use V2"), change the design so the problem cannot occur. Do not keep the old design and satisfy the constraint around its edges.
- **Check the vendor's own recommended path early.** Before building infrastructure, read the vendor's documentation for how a typical site does this, including the prerequisites for the account or service. Ask what an ordinary integration looks like.
- **Do not stop to report a blocker you can design around.** Report a blocker only after the alternatives are tried. Where the user is unavailable, choose the option that works and say what the tradeoff is.
- **No disguises.** Never make a request describe itself as something it is not to get past a limitation, such as carrying one vendor's token in another payment method's fields. If the product has no supported input for what is needed, say so and use the vendor's documented route, or stop and tell the user.
- **Prove the real flow first.** Run the real user journey, such as a real browser payment in test mode, as early as possible, so a wrong design shows up in the first hour.

## Workspace layout

- `packages/kit` contains shared mechanics, build tooling, CLI, and backend declarations.
- `packages/kit/theme` contains the default theme and reusable interfaces.
- `sites/demo` exercises the platform with generic content and enabled modules.
- `sites/docs` is the standalone documentation site.

The workspace root coordinates packages and generic fixtures; it is not itself a site.
