---
title: CLI commands
description: PlatformKit commands for developing, testing, building and deploying sites.
order: 80
sources:
  [
    packages/kit/bin/platformkit.mjs,
    packages/kit/build/sites.mjs,
    packages/kit/build/dev.mjs,
    packages/kit/build/dev-workspace.mjs,
    packages/kit/build/dev-runtime.mjs,
    packages/kit/build/dev-ports.mjs,
    packages/kit/build/dev-stop.mjs,
    packages/kit/build/dev-owner.mjs,
    packages/kit/build/runtime-paths.mjs,
    packages/kit/build/source-install.mjs,
    packages/kit/build/deploy-pins.mjs,
    packages/kit/build/deploy.mjs,
    packages/kit/build/test.mjs,
    packages/kit/build/site-repositories.test.mjs,
    packages/kit/build/source-cli.test.mjs,
    packages/kit/build/dev-workspace.test.mjs,
    package.json,
    packages/kit/package.json,
  ]
reviewed: 2026-10-22
---

Run `platformkit` from a site directory for site commands, or pass `--site <path>` to select a site explicitly. At the workspace root, site commands and root npm shortcuts use `PLATFORMKIT_DEFAULT_SITE`, which defaults to `sites/docs`; it may be a site name or a path to a tracked or separately linked site. `--site` takes precedence. Workspace `dev` uses that default unless `PLATFORMKIT_SITES` explicitly selects multiple sites; `sites` and `stop` operate on the workspace. The root registry is `platformkit.sites.json`; fetched repositories live in `sites/external/<name>`, outside the tracked fixture sites and npm workspaces.

From a checked-out site repository, install the site's dependencies, then use the Core GitHub source to build or deploy without waiting for a Core npm release:

```sh
npm ci
npx --yes --package=github:platform-kit/core platformkit build
DEPLOY=1 npx --yes --package=github:platform-kit/core platformkit deploy
```

Run these commands from the site's root. The GitHub source installs `platformkit` into the site's `node_modules` without changing its manifest or lockfile. The receipt compares the installed packages with the exact files npm packs from that source, excluding development-only checkout files; deploy preflight verifies the receipt before deployment steps begin. The site continues to own and install its other dependencies. This avoids publishing the Core packages to npm, but still uses npm to install dependencies and fetch the GitHub-hosted CLI.

| Command                                                 | What it does                                                                                                                                                                                                                                                                                                                                                 | Script                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `dev`                                                   | At the workspace root, starts selected sites behind one front door; inside a site, starts that site. A restart takes over from an abandoned run of this checkout and names the resources it stops. `--port:auto` and `--front-door-port:auto` explicitly enable port search. `--single`, `--no-functions`, `--no-start` and `--no-stack` are also available. | `build/dev.mjs`, `build/dev-workspace.mjs`  |
| `stop`                                                  | Stops PlatformKit-managed development processes and their local Supabase stacks after verifying recorded process identity.                                                                                                                                                                                                                                   | `build/dev-stop.mjs`, `build/dev-owner.mjs` |
| `sites [--json]`                                        | Lists local and registered sites, their checkout state, and available paths.                                                                                                                                                                                                                                                                                 | `build/sites.mjs`                           |
| `sites fetch <name> [--url <git-url>] [--ref <commit>]` | Fetches a site at a full 40-character commit SHA into `sites/external/<name>`. The URL may come from `PLATFORMKIT_SITE_<NAME>_GIT_URL`; a registered remote and pin may be reused. Credentials are read from the environment and are never stored in the registry. It does not install dependencies or run package scripts.                                  | `build/sites.mjs`                           |
| `sites update <name> --ref <commit>`                    | Updates a registered checkout to an explicitly selected full commit SHA. Refuses checkouts with local changes.                                                                                                                                                                                                                                               | `build/sites.mjs`                           |
| `site-run <script> [args...]`                           | Runs an npm script from the selected site package; useful for site-specific commands without hardcoding a site in workspace scripts.                                                                                                                                                                                                                         | `bin/platformkit.mjs`                       |
| `build [--outDir dist]`                                 | Runs the content build, preparation steps, bundle, prerender and site build steps.                                                                                                                                                                                                                                                                           | `build/steps.mjs`, `build/prerender.mjs`    |
| `steps [--phase p] [--check]`                           | Lists build steps, their state and required tools; `--check` fails when an enabled step is missing a need.                                                                                                                                                                                                                                                   | `build/steps.mjs`                           |
| `run <key>`                                             | Runs one build step and reports why if it is disabled.                                                                                                                                                                                                                                                                                                       | `build/steps.mjs --only`                    |
| `deploy`                                                | Verifies the installed PlatformKit source or package pins, then runs provider-aware preflight for the selected site's required configuration and payment-provider secrets before its existing deployment steps.                                                                                                                                              | `build/deploy.mjs`, `build/deploy-pins.mjs` |
| `test`                                                  | Runs module-appropriate kit checks, the site's declared tests and its OpenSpec validation. With `--e2e`, every stack-backed check on stacks built for the run from each site's files (`--only <sites>`, `--jobs <n>`, `--keep`, `--run <script>` in place of the suite); see Testing.                                                                        | `build/test.mjs`                            |
| `migrate [--plan] [--linked] [--json]`                  | Assembles the database declaration and plans or applies it locally; `--linked` targets `SUPABASE_DB_URL`.                                                                                                                                                                                                                                                    | `build/plan.mjs`                            |
| `migrate reset`                                         | Resets and seeds the local Supabase database from its declared schema and data.                                                                                                                                                                                                                                                                              | `supabase db reset`                         |
| `dev-account`                                           | Creates the configured local development account.                                                                                                                                                                                                                                                                                                            | `build/dev-account.mjs`                     |
| `functions [deploy]`                                    | Assembles and serves functions locally, or deploys them when `deploy` is supplied.                                                                                                                                                                                                                                                                           | Supabase CLI                                |
| `assemble [--check]`                                    | Assembles the site's Supabase tree from PlatformKit declarations and site-owned sources; `--check` detects drift.                                                                                                                                                                                                                                            | `build/assemble.mjs`                        |
| `print -- [options]`                                    | Renders or sets print editions when that module is enabled.                                                                                                                                                                                                                                                                                                  | `build/print.mjs`                           |
| `tts -- [options]`                                      | Generates spoken book audio when that module is enabled.                                                                                                                                                                                                                                                                                                     | `build/tts.mjs`                             |
| `tts-setup`                                             | Prepares the spoken-book engine and browser weights.                                                                                                                                                                                                                                                                                                         | `build/tts/setup.mjs`                       |
| `enrich -- [options]`                                   | Generates book introductions and companions when enrichment is enabled.                                                                                                                                                                                                                                                                                      | `build/enrich.mjs`                          |
| `share-images`                                          | Photographs the site's share cards and favicon.                                                                                                                                                                                                                                                                                                              | `build/share-images.mjs`                    |
| `probe --url <url> --routes <paths>`                    | Runs the phone probe against a served site.                                                                                                                                                                                                                                                                                                                  | `build/phone-probe.mjs`                     |
| `spec`                                                  | Validates the site's OpenSpec requirements.                                                                                                                                                                                                                                                                                                                  | OpenSpec CLI                                |

## Other scripts

Run a script from the site root with `node packages/kit/build/<script>` when using a PlatformKit workspace, or `node node_modules/platformkit/build/<script>` from a standalone installation. Optional module tools are required only when the corresponding module is enabled. `platformkit test` reports missing requirements before the relevant build step.

## Installing a separately fetched site

After fetching a site, install its own dependencies from its checkout:

```sh
cd sites/external/<name>
npm ci # or npm install when the site does not commit a lockfile
```

The site's package manifest and lockfile are the build contract. Local fetch/update commands only change the managed checkout and its pin; they do not publish packages, run tests, or deploy the site.
