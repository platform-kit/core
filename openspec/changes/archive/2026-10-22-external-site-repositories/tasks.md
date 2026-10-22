# Tasks

## 1. Separate repository ownership and enable Core-source CLI installs

- [x] 1.1 Provision the independent PlatformKit and site Git remotes from separate current snapshots; site Git history preservation is not required. Verify both remotes clone successfully and representative files are present only in their owning repository.
- [x] 1.2 Support installing the kit and theme from the public Core GitHub source through the CLI; verify source receipt creation and CLI source-root behavior with `packages/kit/build/source-cli.test.mjs` and `packages/kit/build/deploy-pins.test.mjs`.
- [x] 1.3 Move site-owned source, content, tests, documentation, current specifications, and applicable active changes into the site's repository, while retaining generic fixtures in PlatformKit; verify the site repository has its own OpenSpec root and that both repositories' ownership boundaries match their tracked files.
- [x] 1.4 Replace PlatformKit root workspace dependencies and scripts that target the moved site with kit-only workspace definitions and generic fixture checks; verify root install and targeted kit checks do not require a site repository.

## 2. Fetch and develop separately owned sites locally

- [x] 2.1 Add a validated, gitignored local site registry and managed checkout location that record each site's remote and full commit pin; verify registry parsing rejects malformed names, remotes, and non-commit pins without changing existing entries.
- [x] 2.2 Implement `platformkit sites fetch` and `platformkit sites update` for the local registry, including explicit errors and refusal on dirty or untracked checkout contents; verify with temporary local Git remotes that fetch pins the requested commit, update moves only to a new pin, and failures leave checkout files unchanged.
- [x] 2.3 Integrate managed checkouts with site listing and `platformkit dev` while keeping cloned projects out of npm's tracked workspaces; verify fetched sites start by their declared local name and missing checkouts are reported with the fetch command.
- [x] 2.4 Document local registration, fetch, update, dependency installation, pin changes, and recovery from dirty checkouts in the PlatformKit site-neutral CLI and development guides; verify `docs-check.mjs` passes for the changed source and documentation.
- [x] 2.5 Resolve per-site Git URLs and private GitHub HTTPS credentials from environment variables without persisting secrets; verify environment-based fetch and token isolation with `site-repositories.test.mjs` and keep the CLI, multi-site and environment-variable guides current with `docs-check.mjs`.
- [x] 2.6 Add `PLATFORMKIT_DEFAULT_SITE` resolution for root CLI operations and workspace development, preserving explicit `--site` and `PLATFORMKIT_SITES` selections; verify the default docs site, local and fetched sites, explicit precedence, and unfetched-site errors with the targeted workspace tests.
- [x] 2.7 Replace root npm shortcuts that name a specific site with selected-site CLI commands or a generic site-script runner; document the selector and verify root scripts do not name any site package.

## 3. Build and deploy from the site's own repository

- [x] 3.1 Keep the site's own manifest and lockfile authoritative for its dependencies while installing Core packages from source without editing either file; verify this behavior in `packages/kit/build/source-cli.test.mjs`.
- [x] 3.2 Make the existing `platformkit deploy` command usable from the checked-out site via `npx --yes --package=github:platform-kit/core platformkit deploy`, with the Core-source receipt checked before production-facing steps and no host-specific configuration; verify source installation and preflight with `packages/kit/build/source-cli.test.mjs` and `packages/kit/build/deploy-pins.test.mjs`.
- [x] 3.3 Document the Core-source `npx` invocation and standalone deployment flow in the CLI guide; verify `docs-check.mjs` and the source CLI regression tests.

## 4. Enforce the PlatformKit and site documentation boundary

- [x] 4.1 Move product-specific purpose, feature, and operating documents to the site repository, and rewrite PlatformKit's current documentation, configuration, and specifications to describe generic capabilities only; verify the boundary check rejects downstream-site references across all maintained material without history exemptions, and verify the sanitized public snapshot excludes site-specific artifacts and inherited history.
- [x] 4.2 Add and run boundary and ownership tests for the maintained documentation/configuration and repository contents; verify the tests pass for both the generic PlatformKit fixtures and the site-owned documents in their separate repository.

## 5. Verify the separation end to end

- [x] 5.1 Run focused verification for this change: OpenSpec strict validation, source CLI and deploy-receipt tests, site fetch/update and workspace tests, ownership-boundary test, and documentation check; report each scenario as passed, failed, or not verified, compare the deploy change with the `design-rules`, `admin-editing`, and `deploy` cross-cutting specifications, and do not run a production deployment. Verification passed: OpenSpec strict validation (34 items), source CLI, deploy pins, site repositories (10 cases), workspace root (8 cases), dev workspace, boundary scan (1,512 files), and docs freshness (84 pages); no production deployment was run. The deploy requirements align with the `deploy` cross-cutting spec; `design-rules` and `admin-editing` are unaffected because no UI or admin behavior changed.