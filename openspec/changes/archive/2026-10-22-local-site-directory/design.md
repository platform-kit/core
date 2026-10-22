# Design

## Context

See [proposal.md](./proposal.md) for motivation. The workspace front door currently routes named hosts to each selected site's Vite port; its unqualified host is generated as a 404. Site pages resolve their title, description, and `og:image` from the root route's content and site defaults. The production host generator also uses the same host configuration code, so the development directory must be explicitly scoped to the workspace dev run.

## Goals / Non-Goals

**Goals:**

- Make the workspace front door's root host a useful directory without changing named site origins.
- Keep cards titled by the local project name rather than the SEO title, while using each running site's resolved root-route Open Graph image.
- Keep the fixed directory words editable through the theme's UI markdown and the layout compatible with the shared palette.

**Non-Goals:**

- Change site metadata, public SEO output, or production apex routing.
- Add persistence, authentication, database state, or a new independently deployable site.

## Decisions

1. **Use a dev-only root response, not an apex site assignment.** `dev-workspace` already owns the selected site list and front-door lifetime. It will opt that run into the directory explicitly; normal `PLATFORMKIT_APEX` behavior remains unchanged. The directory answers only the unqualified root host, while each named host continues proxying to its Vite server.
   - *Alternative considered:* Assign one downstream site as the development apex. Rejected because it hides the other local sites and confuses the directory with a site alias.

2. **Resolve metadata from each running site's root route.** Provide a development-only metadata response from the site dev server using the same SEO resolution contract as the app. The workspace front door uses the returned `og:image`; relative image URLs resolve against that site's named local origin. The card title comes from optional `dev.projectName`, falling back to the directory name when unset or blank. SEO titles and descriptions are not card copy.
   - *Alternative considered:* Parse `content/site.md` alone. Rejected because the root page can override its title, description, and image, and a docs-only site can resolve its root differently.
   - Metadata failures must be visible on the affected card rather than silently rendering an empty image or description.

3. **Serve a small directory document separate from site bundles.** The development front door serves the directory and its same-origin metadata response at the unqualified host; this keeps the page independent of any site's module switches and prevents it from entering a site's production bundle. Selected-site ordering follows the workspace's existing deterministic discovery order.
   - *Alternative considered:* Add a directory route to a downstream site's app. Rejected because the root belongs to the workspace, not to one site, and the directory must work when that site is not selected.

4. **Keep the surface deliberately small and accessible.** Use a responsive grid of uniformly sized cards with the 1200×675 image ratio, a clamped project name, and a full-card link with keyboard focus. Do not show SEO descriptions or a separate open-site action. Keep the directory palette responsive to light and dark appearances; user-facing page and accessible image copy remains in the theme UI markdown scope.

5. **Make public development ports predictable.** A direct single-site dev server and the workspace front door bind port 3000 by default and fail clearly if it is occupied. Port searching is an explicit opt-in: `--port:auto` for a single-site server and `--front-door-port:auto` for the workspace front door. Explicit numeric port options bind that exact port. Workspace-internal per-site Vite ports remain automatically allocated because they are not public entry points and must coexist behind the one front door.
   - *Alternative considered:* Continue probing upward from the usual Vite port. Rejected because startup silently changes the address and can move a developer to a different port on each run.

6. **Give each site a configurable, stable Supabase identity.** Read the complete override from `dev.projectId` in the site's `platformkit.config.js`; when omitted, derive `pk_<site-folder-or-subdomain>_local` (for example, `pk_example_local`). Reuse it across runs; never append a run token. Direct and workspace development honor the same resolved project ID. Keep each site's committed `supabase/config.toml` project ID aligned with the default identity.
   - *Alternative considered:* Generate a unique project ID for every run. Rejected because it creates a new Compose project identity each time and accumulates redundant per-project containers and database volumes.

7. **Stop only resources the workspace can identify as its own.** Record run, site root, process-group/PID identity, ports, and Supabase project IDs under the workspace's ignored runtime state. `platformkit stop` reads those records, validates process identity before signaling, gracefully stops managed process groups, then stops only the associated Supabase projects; stale records are reported and cleaned without signaling a reused PID. Normal stop preserves database volumes and shared Docker images.
   - *Alternative considered:* Search the process table by words such as `vite` or `supabase` and kill matches. Rejected because it could terminate unrelated projects or user-owned processes.

## Risks / Trade-offs

- [A site's resolved `og:image` may be hosted at its public origin] → Use the exact image URL returned by that site's head; resolve only relative URLs to its local origin, and show a visible card-level error if the image cannot load.
- [A site may be slow or fail to supply metadata] → Keep the directory available and report the affected site's metadata failure on its card; do not fail the whole workspace or silently substitute another site's content.
- [The host configuration is shared with production] → Gate the directory on the workspace-dev opt-in and pin the no-apex production behavior with the host configuration test.
- [Port 3000 may already be used by another process] → Fail without changing the public URL and print the collision; the developer can choose an explicit port or opt into automatic selection.
- [A process record may outlive a crashed dev runner] → Validate PID identity and process ownership before signaling; report stale records and never signal on PID alone.
- [Repeated runs previously used different Supabase project IDs] → Pin one stable project ID per site from its configured value or default derivation and test it across restarts; any one-time cleanup of legacy resources is explicit and does not delete data by default.

## Migration Plan

No data migration is needed. The directory is created only for the lifetime of a workspace dev run and cleaned up with its existing runtime files. Rollback is removing the dev-only route and opt-in; production host configuration and deployed output remain unchanged.
