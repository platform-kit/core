# Design

## Context

The Core CLI resolves workspace and fetched sites in `packages/kit/build/sites.mjs`; development runs, asset downloads, and database shadows also currently write below `.platformkit`. The root package is a private npm workspace and has no CLI bin, while the kit and theme are workspace packages.

## Goals / Non-Goals

**Goals:**
- Keep managed site metadata and checkouts visible at the Core repository root while leaving the tracked fixture sites intact.
- Make the root package's CLI usable from GitHub source and let it install the matching kit and theme into a selected site's `node_modules` without saving dependency changes.
- Relocate transient state while preserving existing local files during the transition.

**Non-Goals:**
- Publishing npm packages, creating a release or tarball, pushing changes, deploying, or moving site source into Core.
- Installing or updating a site's unrelated dependencies as part of `platformkit` invocation.

## Decisions

- Keep the current site registry format, move it to `platformkit.sites.json` at the repository root, and put fetched repositories under `sites/external/<name>`. Ignore only `/sites/external/`; explicit workspace declarations continue to include only the tracked fixtures.
- Resolve a default site value as an existing site name first, then as an absolute or root-relative path. Fall back to `sites/docs`; explicit CLI selection remains higher priority.
- Use `node_modules/.cache/platformkit` as the shared location for runtime records, ports, downloaded assets, and database shadows. Move the existing ignored directory there before any cleanup, after checking that no process is using it.
- Add the `platformkit` bin to the root package and dispatch to the existing kit CLI. The source checkout remains the code source; a site-targeted setup command installs both workspace packages from local file paths with `--no-save --package-lock=false`, so npm resolves the theme's kit dependency from the same source and does not edit the site's manifest or lockfile.
- Keep the source install free of required registry versions for PlatformKit. Verify Git-source installation and site setup using local Git/file fixtures, not a publication or remote write.

## Risks / Trade-offs

- [A Git dependency may run lifecycle scripts while npm prepares the source] → Keep the root lifecycle safe without a `.git` assumption and verify `npx` against a local Git repository.
- [A partially failed local package installation could leave `node_modules` incomplete] → Report npm's failure and leave the site's manifest/lockfile untouched; subsequent invocation may safely retry.
- [Old runtime records can contain absolute paths] → Relocate rather than delete existing state, and treat records as stale unless their recorded process is alive.

## Migration Plan

1. Update path resolution and focused tests.
2. Move `.platformkit` to `node_modules/.cache/platformkit` only after confirming there is no live PlatformKit process.
3. Verify state paths, fetch/update behavior, root default selection, and a local Git-source CLI installation.
4. Update affected docs and OpenSpec verification references.

Rollback consists of reverting the code and moving the preserved cache back; no remote state or site content is changed.
