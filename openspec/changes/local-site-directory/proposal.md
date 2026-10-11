# Proposal

## Why

The workspace front door currently returns 404 at plain `localhost`, even though it starts several sites on named `.localhost` origins. A development-only directory gives developers an obvious starting point without changing any hosted or production routing.

## What Changes

- The root host on the workspace development front door shows a responsive card for each selected site.
- Each card uses the site's resolved homepage `og:image` and an optional `dev.projectName`; absent or blank names fall back to the site directory name. The full card links to that site's existing `<name>.localhost` origin, without a description or separate action.
- The root directory exists only in workspace development. Production apex behavior remains unchanged.
- User-facing development listeners use port 3000 by default and fail clearly on a collision; port search requires an explicit `auto` option.
- Workspace dev uses one stable Supabase project ID per site, configurable through `dev.projectId`; by default it is `pk_<site-folder-or-subdomain>_local`, so repeated runs reuse the same local stack instead of creating a new project identity each time.
- Add a project-scoped `platformkit stop` command that stops recorded PlatformKit dev process groups and the associated local Supabase projects without killing unrelated processes or deleting database volumes.
- Proposed directory copy (point: identify this local site collection and help a developer choose one):
  - Heading: “Your local sites”
  - Supporting line: “Choose a site to open.”
- The card's accessible link name identifies the project; no separate visible action label is shown.
- The directory follows the shared theme's tokens and has a compact mobile layout; its fixed words live in the theme's UI markdown.
- Update the multiple-sites development documentation and add automated coverage for development routing and metadata.

## Non-goals

- Assigning a production apex to any site, changing the `.localhost` site origins, or changing each site's SEO metadata.
- Adding an admin surface, database state, functions, email, or a new site package for the directory.
- Killing unowned processes or deleting Supabase data volumes and Docker images as part of the normal stop command.

## What James Should Look At

The key decisions are that the root host becomes a dev-only site chooser, not an alias for any one downstream site; public dev ports remain predictable unless auto-selection is requested; and process cleanup is limited to recorded PlatformKit dev runs and their site-specific Supabase projects. Review the quoted directory copy and verify project-name overrides and folder-name fallbacks, each site's artwork, and no production host changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `build-and-dev`: the workspace development front door SHALL render the selected sites' directory at its unqualified local host, use predictable public ports, reuse stable per-site Supabase project identities, and provide safe process cleanup.

## Impact

The kit's workspace and single-site dev runners, local Supabase config/project identity, stop command and tests; the theme's UI strings and styling; and the canonical development and CLI docs. Production apex routing and production database behavior remain unchanged.
