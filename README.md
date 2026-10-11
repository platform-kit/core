# PlatformKit

PlatformKit is a reusable publishing platform: a core package for content, builds, and backend services, paired with a theme for reader and editor interfaces. Independently owned sites add their own content, configuration, and registrations.

## Workspace

- `packages/kit` — platform services, build tools, the CLI, and backend declarations.
- `packages/movable-types` — reusable reader and admin interfaces, page sections, styles, and default language.
- `sites/docs`, `sites/demo`, and `sites/brochure` — generic fixtures used to document and verify the platform.

Separately owned sites are fetched into a local managed checkout and are not part of this repository's npm workspaces.

## Development

Install the workspace with `npm install`. From its root, `npm run dev` selects `PLATFORMKIT_DEFAULT_SITE`, which defaults to `sites/docs`. Use a site name or path, `--site <path>` for an explicit site, or `PLATFORMKIT_SITES` to select several sites.

Use `platformkit sites` to list registered checkouts, and `platformkit sites fetch` / `platformkit sites update` to manage a separately owned site's pinned checkout. The root registry is `platformkit.sites.json`; external checkouts are isolated under `sites/external/`, while the generic fixture sites remain tracked. A site can use Core directly from GitHub with `npx --yes --package=github:platform-kit/core platformkit` without published PlatformKit packages.

Root commands such as `npm run build`, `npm test`, and `npm run deploy` operate on the selected site. The site's repository and lockfile are the build and deployment context for independent production releases.

## Documentation

The canonical PlatformKit guides and reference are in [sites/docs/content/docs](./sites/docs/content/docs). Current capability requirements are in [openspec/specs](./openspec/specs); repository workflow guidance is in [AGENTS.md](./AGENTS.md).
