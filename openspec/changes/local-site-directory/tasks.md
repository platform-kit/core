# Tasks

## 1. Resolve site directory metadata

- [x] 1.1 Extract a Node-safe root-route SEO metadata resolver shared with the site's existing head logic, and expose its result only from the site's Vite development server; verify title, description, image, and fallback behavior with `node packages/kit/build/dev-directory.test.mjs`.
- [x] 1.2 Add a same-origin workspace metadata route that returns the current metadata for each selected site without fetching production pages; verify per-site routing and relative image URL resolution with `node packages/kit/build/dev-workspace.test.mjs`.

## 2. Serve and render the development directory

- [x] 2.1 Serve the directory only at the unqualified host of a workspace `platformkit dev` run, preserve every named `.localhost` proxy, and leave production apex configuration unchanged; verify with `node packages/kit/build/dev-workspace.test.mjs` and `node packages/kit/build/sites-host.test.mjs`.
- [x] 2.2 Add the responsive site cards, accessible links, theme palette styling, and markdown-authored directory words; render the directory with one and multiple sites and inspect screenshots at 1280px and 390px in light and dark appearances.
- [x] 2.3 Make public ports deterministic: default single-site and workspace front-door listeners to 3000, fail clearly rather than changing ports implicitly, and support explicit `--port:auto` and `--front-door-port:auto` options; keep workspace-internal Vite port allocation automatic. Verify exact requested ports, conflict errors, and explicit auto-selection with `node packages/kit/build/dev.test.mjs` and `node packages/kit/build/dev-workspace.test.mjs`.
- [x] 2.4 Add a `dev.projectId` site-config option for the complete stable local Supabase project ID, default it to `pk_<site-folder-or-subdomain>_local`, align committed Supabase configs with the defaults, and persist run ownership records for managed servers and Supabase projects. Verify default derivation, configured overrides, same-site reuse, and cross-site isolation with `node packages/kit/build/dev-workspace.test.mjs`.
- [x] 2.5 Add `platformkit stop` to gracefully stop registered PlatformKit dev process groups and their associated Supabase projects, with PID identity checks, stale-record handling, repeat-safe behavior, and no removal of database volumes or shared Docker images. Verify managed and unrelated process behavior with `node packages/kit/build/dev-stop.test.mjs`.
- [x] 2.6 Redesign directory cards as uniform image-and-project-name links, with `dev.projectName` and the site-folder fallback, omitting descriptions and separate open-site controls. Verify overrides and fallback with `node packages/kit/build/dev-directory.test.mjs` and inspect 1280px/390px light/dark screenshots.

## 3. Document and verify the change

- [x] 3.1 Update the multiple-sites, dev-build, and CLI reference docs to explain the development-only root directory, unchanged site subdomains, fixed public port and explicit auto options, stable configurable Supabase project IDs, and the safe stop command; verify with `node packages/kit/build/docs-check.mjs`.
- [x] 3.2 Run the changed scenarios, cross-cutting `design-rules`, `admin-editing`, and `deploy` checks, the site-owned tests, production build, docs check, and strict OpenSpec validation; verify from the site repository root and with `node packages/kit/build/docs-check.mjs` and `openspec validate --all --strict`.
- [x] 3.3 Update the multiple-sites guide and config-key reference for `dev.projectName` and the card behavior; verify source freshness and coverage with `node packages/kit/build/docs-check.mjs`.
