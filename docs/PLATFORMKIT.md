# PlatformKit

PlatformKit is a reusable publishing platform made of a core package and a default theme. A site supplies its own content and configuration, then selects the modules and visual choices it needs.

## The platform and a site

The core package provides content handling, build tools, the command-line interface, data and backend services. The theme supplies reader and editor interfaces, reusable page sections, styles, and default interface language. A site connects those pieces through its configuration and registrations rather than by changing the platform packages.

The workspace includes the packages and generic sites used to develop and verify them. Separately owned sites can be registered and fetched for local development; those checkouts are not npm workspaces and do not become part of the PlatformKit source tree.

## Three deployment shapes

- **Static:** a built site is served as files. It has no live backend or production editing.
- **Git and backend:** the site's repository is the source of truth. The backend enables editing and publishing, and publishing returns changes to that repository so the normal build can deploy them.
- **Backend without Git:** content and editable state live in the backend. No repository checkout or build is required for content changes.

The site's configuration declares its deployment shape. Local checkouts and credentials used by developers do not determine how a production deployment behaves.

## Configuration and extension

A site configuration selects modules and can register routes, navigation, analytics panels, page sections, admin screens, content collections, and theme overrides. The platform resolves those registrations and exposes shared package interfaces. A site should add meaning and policy through its own content and registrations; reusable mechanics belong in PlatformKit.

Visible default interface text is authored as editable content, and structured records are edited through controls appropriate to their fields. The theme provides defaults that sites may override.

## Local development

Use `platformkit sites` to list, fetch, and update separately owned site checkouts. A registration pins a remote and a full commit revision. Fetching uses that pin; updating refuses a checkout with local changes.

Commands run from the workspace root select `PLATFORMKIT_DEFAULT_SITE`, defaulting to `sites/docs`. The setting accepts a site name or path; `--site <path>` takes precedence, and `PLATFORMKIT_SITES` selects a set for multi-site development. The root registry is `platformkit.sites.json`, and fetched site repositories live in `sites/external/`, separate from tracked fixture sites. A site outside the workspace can invoke the CLI with `npx --yes --package=github:platform-kit/core platformkit`; the kit and theme are sourced from that checkout without requiring their npm publication or changing the site's manifest and lockfile.

## Build and release boundary

A production build runs from the site's repository and uses that repository's dependency installation and lockfile. A site may use published PlatformKit packages or invoke the CLI from GitHub source; the latter installs the matching kit and theme into local `node_modules` without saving package entries. Package publication and deployment remain explicit release operations; a local site registry is only a development convenience.

PlatformKit maintainers own package releases. The kit CI tests both workspaces before a `kit-v<version>` tag publishes the core and theme packages to npm and GitHub Packages. npm publication requires the core repository's `NPM_TOKEN`; the workflow's GitHub token publishes to GitHub Packages. A tag is not a usable release until both publication steps have succeeded.

Site maintainers own the site repository and its lockfile. When a site consumes npm-published PlatformKit packages, its maintainers pin exact versions and commit the matching lockfile. Alternatively, the production host can run `npx --yes --package=github:platform-kit/core platformkit deploy` from the site checkout; that sources the kit and theme from Core without requiring npm publication or changing the site's manifest and lockfile. In either case, the host checks out the site's selected commit and builds from that repository, not from PlatformKit's local site registry or a sibling site. Git-backed publishing returns edits to the same site repository, keeping it the source of truth.

The maintained reference documentation is in the documentation site. The OpenSpec specifications describe observable platform behavior, while the repository guidance describes how changes are proposed, implemented, and verified.

---

**Sources:** `package.json`, `packages/kit/package.json`, `packages/movable-types/package.json`, `packages/kit/bin/platformkit.mjs`, `packages/kit/build/sites.mjs`, `packages/kit/build/dev-workspace.mjs`, `.github/workflows/kit.yml`
**Reviewed:** `2026-10-11`
