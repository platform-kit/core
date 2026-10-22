---
title: Several sites on one host
description: Run local and separately owned sites through one development workspace and deploy them from independent repositories.
order: 12
sources:
  [
    packages/kit/build/dev-directory.mjs,
    packages/kit/build/dev-directory.css,
    packages/kit/build/dev-directory.test.mjs,
    packages/kit/src/lib/seo-head.js,
    packages/kit/src/lib/seo.js,
    packages/kit/vite/index.mjs,
    packages/kit/theme/src/content/ui/site-directory.md,
    packages/kit/theme/src/pages/SharePage.vue,
    packages/kit/build/sites.mjs,
    packages/kit/build/hosts.mjs,
    packages/kit/build/dev.mjs,
    packages/kit/build/dev-workspace.mjs,
    packages/kit/build/dev-runtime.mjs,
    packages/kit/build/dev-ports.mjs,
    packages/kit/build/dev-stop.mjs,
    packages/kit/build/dev-owner.mjs,
    packages/kit/build/rewrites.mjs,
    packages/kit/build/sites-host.test.mjs,
    packages/kit/build/site-repositories.test.mjs,
    packages/kit/build/deploy-pins.mjs,
    packages/kit/build/deploy-pins.test.mjs,
    packages/kit/build/deploy.mjs,
    .github/workflows/kit.yml,
    packages/kit/build/dev-workspace.test.mjs,
    packages/kit/build/dev.test.mjs,
    packages/kit/build/dev-stop.test.mjs,
    packages/kit/build/rewrites.test.mjs,
    packages/kit/bin/platformkit.mjs,
    packages/kit/build/runtime-paths.mjs,
    packages/kit/build/source-install.mjs,
    packages/kit/build/source-cli.test.mjs,
    deploy/nginx,
    package.json,
  ]
reviewed: 2026-10-22
---

The workspace root contains PlatformKit's packages and generic fixtures. A separately owned site stays in its own Git repository; it is fetched to `sites/external/<name>` and is not part of the root npm workspaces. The root registry is `platformkit.sites.json`. `platformkit sites` lists both kinds of sites. Use `platformkit sites --json` for their full paths and pin information. A registered repository that has not been fetched is listed with the command needed to fetch it. Site names are DNS labels. `PLATFORMKIT_DEFAULT_SITE` selects the site used by root commands (default `sites/docs`) and accepts either a site name or a path. `PLATFORMKIT_SITES` explicitly selects one or more sites for multi-site development, taking precedence over the default; `PLATFORMKIT_ROOT_SITE` optionally names a configured site at the workspace root.

## Fetch a site for local development

Register and fetch the exact commit you want to use:

```sh
platformkit sites fetch <name> [--url <git-url>] --ref <40-character-commit>
```

The URL may be HTTPS, SSH, or a local Git URL. Instead of `--url`, set `PLATFORMKIT_SITE_<NAME>_GIT_URL`, with the site name uppercased and hyphens changed to underscores. The full commit SHA is required; a moving branch or tag is not a reproducible pin. Fetching checks out that commit and records the remote and pin in `platformkit.sites.json`. The registry is local state, and fetched checkouts under `sites/external/` are gitignored while generic fixtures remain tracked. Fetching does not run the site's package lifecycle scripts. Install its dependencies explicitly from the checkout:

```sh
cd sites/external/<name>
npm ci
```

If the site repository changes, update only after choosing the new full commit SHA:

```sh
platformkit sites update <name> --ref <new-40-character-commit>
```

An update refuses a checkout with tracked edits or untracked files and does not reset, clean, or remove them. Commit or otherwise preserve that work, then retry. The current checkout must still be at its registered commit; if it was manually switched to another commit, restore the pin before updating. `platformkit sites` reports the registered revision and whether a managed checkout has local changes. From the workspace root, `platformkit dev` uses `PLATFORMKIT_DEFAULT_SITE` (default `sites/docs`); set it to the fetched site's name to run that checkout. Set `PLATFORMKIT_SITES` explicitly when you want several sites behind the shared front door. A registered but unfetched selected site prevents startup and prints the fetch command.

For a private GitHub HTTPS remote, provide `PLATFORMKIT_GITHUB_TOKEN` (or `GITHUB_TOKEN` / `GH_TOKEN`). The token is passed to Git as temporary process configuration; it is not added to the remote URL or saved in `platformkit.sites.json`. SSH remotes use the machine's SSH agent, and other HTTPS hosts use the configured Git credential helper.

Generic fixtures under `sites/` continue to work without a remote. A fetched site is discovered by its declared local name, receives its own development server and—when enabled—its isolated Supabase project, and remains outside the tracked `sites/*` npm workspace glob. This keeps the workspace lockfile independent of which repositories happen to be fetched on a developer's machine.

`platformkit dev` routes the selected sites through one local front door, using each site name under `PLATFORMKIT_DOMAIN` (for example, `docs.localhost:3000`) while Vite serves the app. Docker must be running for this shared front door; a startup error from it means the named local URLs are not ready, even if a site's Vite server has started. The front-door container only needs the selected site names and their allocated Vite ports; a fetched site does not need to be copied into the container image.

If a run ends without its normal cleanup, the next `platformkit dev` takes over only resources recorded for this checkout. It waits for earlier site servers and their function servers to finish stopping, and its one line names each resource it clears: a site by its port, the front door by its port, or a stale run record if no live resource remains. A second attached run is refused, and any listener the kit cannot verify is left untouched.

The same goes for testing. `npm run test:e2e` gives every registered site with a backend a test stack of its own — built fresh from that site's files, on ports and project names that never meet the development ones — and runs its end-to-end checks there, several sites side by side (`--only <site>` for some). A site's checks reach only its own stack.

## Build and deploy a site independently

A production build starts from the site's own repository and commit. Install the site's other dependencies there, then run its documented build and test commands. A site may use exact PlatformKit package versions from its lockfile or invoke the Core CLI from GitHub with `npx --yes --package=github:platform-kit/core platformkit deploy`. The source route installs the kit and theme from the Core repository into the site's `node_modules`, without changing its manifest or lockfile. The receipt compares each installed package with the exact file list npm packs from that Core checkout, so development-only files do not create a false mismatch; deploy verifies the receipt against the public Core repository before deployment steps begin. The CLI then runs the deploy script from those installed packages, so it uses their dependencies rather than assuming the transient `npx` package has the whole workspace installed. No Core source is copied into the site repository. Changing a local site pin does not publish packages or deploy anything.

For a multi-site host, build each selected site from its own repository, then configure the host with `PLATFORMKIT_DOMAIN`, `PLATFORMKIT_SITES`, and `PLATFORMKIT_SITES_MODE=files`. Backend URLs are supplied per site using `SUPABASE_URL_<SITE>`; replace hyphens in the site name with underscores and uppercase it. A selected site that requires a backend but has no URL is refused before nginx starts. Each server block serves that site's build and generated rewrites. `PLATFORMKIT_APEX` optionally names the site that also answers on the bare domain. TLS certificates are mounted at `/etc/nginx/certs/fullchain.pem` and `/etc/nginx/certs/privkey.pem`; the host, not the image, obtains them.

A single-site host can continue to build and deploy directly from that site's repository with the site's own deployment settings. The selected payment provider and its server secrets are resolved from that site's config and environment; one site's provider selection is not shared with another. Package publication is a PlatformKit release action; it is not triggered by a site fetch, pin update, or site deployment. After the kit CI passes, a `kit-v<version>` tag publishes both `platformkit` and `platformkit/theme` to npm and GitHub Packages; a site updates both exact pins and its lockfile in a separate change.
