# PlatformKit

PlatformKit is a full-stack TypeScript framework for building and deploying a complete online business: content and publishing, payments, subscriptions and memberships, a store, bookings and video sessions, forms, email marketing, customer support, community, analytics and AI assistants. The engine and its default theme ship as one package; a site supplies its own content and configuration, then selects the modules and visual choices it needs.

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

`npm run test:e2e` runs every check that needs a database, the functions or a browser on test stacks of their own — one per site with a backend, built fresh from that site's files on every run, side by side, never the development stacks, inside a container built from the project's files as git lists them and installed from scratch, with a Docker of its own — and counts a check that cannot run, or a function no check called, as a failure. CI runs it, in the same container, over the demo and `sites/club`, a second fixture with a backend and few modules.

The workspace root also provides opt-in Docker commands for Hyperswitch v2 integration testing.
They build the router from a local Hyperswitch checkout and run separately from the default tests;
the [payment-provider guide](../sites/docs/content/docs/building-a-site/payment-providers.md)
documents setup, private test profiles, and cleanup.

## Build and release boundary

A production build runs from the site's repository and uses that repository's dependency installation and lockfile. PlatformKit is one package, `platformkit`: the engine with its default theme inside it (`platformkit/theme`). A site depends on it from npm, or invokes the CLI from GitHub source, which installs the same package into local `node_modules` without saving package entries. The command runs either way: `npx platformkit dev`, or `npx github:platform-kit/core#<branch-or-tag> dev`. Package publication and deployment remain explicit release operations; a local site registry is only a development convenience.

PlatformKit maintainers own package releases. The kit CI runs the kit's tests against the demo and documentation sites, and builds and checks both, before a `kit-v<version>` tag publishes the core and theme packages to npm and GitHub Packages. npm publication requires the core repository's `NPM_TOKEN`; the workflow's GitHub token publishes to GitHub Packages. A tag is not a usable release until both publication steps have succeeded. A maintainer can also publish to npm alone by running the manual Publish workflow with an exact version, which first checks that both packages declare that version.

Site maintainers own the site repository and its lockfile. When a site consumes the npm-published `platformkit`, its maintainers pin an exact version and commit the matching lockfile. Alternatively, the production host can run `npx --yes --package=github:platform-kit/core platformkit deploy` from the site checkout; that sources `platformkit` from Core without requiring npm publication or changing the site's manifest and lockfile. In either case, the host checks out the site's selected commit and builds from that repository, not from PlatformKit's local site registry or a sibling site. Git-backed publishing returns edits to the same site repository, keeping it the source of truth.

The maintained reference documentation is in the documentation site. The OpenSpec specifications describe observable platform behavior, while the repository guidance describes how changes are proposed, implemented, and verified.

---

**Sources:** `package.json`, `packages/kit/package.json`, `packages/kit/bin/platformkit.mjs`, `packages/kit/build/sites.mjs`, `packages/kit/build/dev-workspace.mjs`, `packages/kit/build/e2e-container.mjs`, `.github/workflows/kit.yml`, `.github/workflows/publish.yml`
**Reviewed:** `2026-10-23`
