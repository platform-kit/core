# Design

## Context

See [proposal.md](./proposal.md) for motivation. The current command can run a site at an arbitrary `--site` path, but workspace discovery is based on directories inside the checkout and the root npm workspace includes site packages. The kit and theme have package manifests, but a standalone site needs released versions to install. The existing multi-site runner, local fixtures, and deployment tooling must continue to work.

## Goals / Non-Goals

**Goals:**

- Keep PlatformKit source and site-owned source in separately versioned Git repositories.
- Fetch a reproducible site checkout for local multi-site development without storing site files in the PlatformKit Git history.
- Make a site's own repository the complete build and deploy context.
- Keep the kit's current guides, configuration, and specifications product-neutral, and exclude downstream-specific historical records from the sanitized public Core snapshot while retaining any needed originals only in private legacy refs.

**Non-Goals:**

- Automatically publish packages or deploy a site merely because its pin changes.
- Rewrite old changelogs or archived change proposals to remove references that were accurate when written; those originals remain private and are not included in the public snapshot.
- Replace generic demo and documentation fixtures that exist to exercise PlatformKit itself.

## Decisions

### Site checkouts are explicitly pinned and managed locally

Add `platformkit sites fetch <name> --url <git-url> --ref <commit>` and `platformkit sites update <name>`. The first command accepts an HTTPS or SSH Git remote and a full commit SHA; the local managed-site registry records those values for later updates. Keep that registry and fetched checkouts under a gitignored PlatformKit workspace directory, separate from npm's tracked workspaces. This lets a developer use a site without committing its identity or URL into PlatformKit.

Fetch checks out exactly the supplied commit and reports the resolved commit. Update fetches the recorded remote and moves only to an explicitly supplied new pin. It refuses to update a dirty checkout and never resets, cleans, or otherwise discards local files. Fetching does not run package lifecycle scripts; installing dependencies remains an explicit `npm ci` in the site checkout.

**Alternatives considered:** A committed list of downstream repositories would make team setup convenient but would put site identities and URLs in PlatformKit. A moving branch as the pin would be easier to keep current but makes local builds non-reproducible and updates implicit. Git submodules would record a commit but make basic workspace use depend on submodule initialization and would not provide a managed update flow.

### Local discovery consumes managed checkouts, not npm workspace membership

Keep the kit and theme as PlatformKit's npm workspaces. Fetched sites live outside the tracked workspace globs and are discovered from the local registry for `platformkit sites` and `platformkit dev`. The multi-site front door can then start a fetched site by its declared name while continuing to support generic in-repository fixtures. Site-specific modules resolve from the site's own installed dependencies.

**Alternatives considered:** Adding cloned sites to `workspaces` would make the lockfile and install graph depend on whichever sites happen to be fetched. Copying a site's source into the PlatformKit repository would recreate the ownership and history coupling this change removes.

### Repository URLs and credentials are environment-bound

`platformkit sites fetch` may take its URL from `PLATFORMKIT_SITE_<NAME>_GIT_URL` when `--url` is omitted; the name is uppercased and hyphens become underscores. Private GitHub HTTPS fetches and updates use `PLATFORMKIT_GITHUB_TOKEN`, then `GITHUB_TOKEN` or `GH_TOKEN`. The token is passed to Git as temporary process configuration and is never embedded in a URL, written to the registry, or printed. SSH remotes continue to use the machine's SSH agent, and other HTTPS hosts use the configured Git credential helper.

**Alternatives considered:** Embedding credentials in remote URLs would persist secrets in local state and could expose them through process output. Requiring every operator to alter global Git configuration would make an isolated managed checkout harder to authenticate consistently.

### The existing deploy flow runs through the Core source CLI

From the checked-out site repository, run `npx --yes --package=github:platform-kit/core platformkit deploy`. The existing CLI installs the kit and theme from that Core source into the site's `node_modules` without changing the site's manifest or lockfile, then the existing deploy script checks that installation before running production-facing steps. A source-install receipt binds the installed package contents to the canonical Core repository; the deploy preflight refuses a missing or mismatched receipt. The site's own dependencies remain governed by the site's existing install and lockfile.

This changes neither the site's deployment host nor its configuration: the host runs the existing command from the checked-out site root. No provider-specific deployment files or second deploy path are introduced.

**Alternatives considered:** Requiring published package versions makes publication a prerequisite even when the Core repository is public and the CLI can install directly from its source. Fetching a site inside the Core deployment would obscure which site commit is deployed and couple deployment to the local site registry.

### Repository ownership follows the content

Site code, content, build and test configuration, purpose/features/operating documents, and site-specific specs move together into the site repository. PlatformKit's current docs, config, and specs describe only generic capabilities; generic fixtures remain available to test the kit. Downstream-specific changelogs, archived change records, generated verification workspaces, and site-specific deployment templates are excluded from the sanitized public snapshot. Their originals may remain in private legacy refs, which are never pushed or mirrored to the public Core remote.

**Alternatives considered:** Keeping site documents in the kit but removing the product name would still make the kit own product purpose and operation. Rewriting the archive would destroy the historical record and is outside this change.

## Risks / Trade-offs

- **The first split needs repository and registry access** → Provision both remotes and package-registry credentials before cutover; create and validate separate current snapshots before changing the live deploy source. The site repository does not need the source repository's commit history; keep the original repository intact as the rollback record.
- **The Core source installation could differ from its recorded source** → Hash the installed kit and theme, record their provenance, and verify the receipt before the existing deploy script performs production-facing work.
- **A local checkout can differ from its pin** → Report its dirty and pinned state in `platformkit sites`; refuse update when dirty and require an explicit operator action to preserve, commit, or discard changes.
- **The local fetch registry is machine-specific** → Keep its format simple and exportable so another developer can reproduce the same site checkout from the remote and pin; do not treat it as the production source of truth.
- **An environment token may be over-scoped** → Prefer a repository-scoped token, keep it in the host's secret environment, and never write it to the registry or remote.
- **Documentation or specs may remain product-specific after extraction** → Scan all maintained PlatformKit-owned documents and configuration without archive/changelog exemptions, and verify that the public snapshot contains no inherited history or excluded site artifacts.

## Migration Plan

1. Create and validate the two repository destinations from separate current snapshots. The site repository starts with its current files and does not need the source repository's Git history; leave the original repository intact during the transition.
2. Verify `npx --yes --package=github:platform-kit/core platformkit deploy` from the site repository installs the kit and theme from Core source, leaves the site's manifest and lockfile unchanged, and passes the existing deploy preflight.
3. Move site-owned docs, content, code, and specs to the site repository. Remove site-owned packages and shortcuts from PlatformKit's root workspace; keep generic fixtures and update CI to test them.
4. Add the local fetch/update registry and commands, and connect fetched sites to workspace discovery and development.
5. Run the existing deploy command from the site's checked-out repository; verify source provenance before any production-facing step. Do not add host-specific deployment configuration.
6. Roll back by restoring the prior deployment source. Do not delete either repository or the original source repository during the transition.
7. Before making Core public, create a sanitized root snapshot from the finalized current tree; verify its complete tracked content and confirm no parent history or prohibited site-specific paths/references are present. Keep legacy/site refs private and never push them with `--all` or `--mirror`.

## Open Questions

- The actual site Git remote URLs must be supplied when the repositories are provisioned; the workflow intentionally does not hard-code a site identity.