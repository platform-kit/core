# Tasks

## 1. Root site management

- [x] 1.1 Move the registry to the Core root and fetched checkouts to `sites/external/`; ignore only external checkouts, preserve tracked fixtures, and test Git URL/pin protections. **Verify:** `node packages/kit/build/site-repositories.test.mjs`.
- [x] 1.2 Resolve `PLATFORMKIT_DEFAULT_SITE` by site path or name, default to `sites/docs`, and keep explicit `--site` precedence. **Verify:** `node packages/kit/build/site-repositories.test.mjs` and the CLI's `--site` selection test.

## 2. GitHub-source CLI

- [x] 2.1 Expose the existing CLI as a root `platformkit` binary and verify npm can execute a Git-source package without a published package. **Verify:** `node packages/kit/build/source-cli.test.mjs`.
- [x] 2.2 Add a site setup path that installs the kit and theme from that same source with no saved manifest or lockfile changes. **Verify:** `node packages/kit/build/source-cli.test.mjs` with unpublished package names unavailable.
- [x] 2.3 Update the separate site repository's scripts to use the Core Git-source CLI without adding Core code to the site repository. **Verify:** inspect the site manifest diff and run its focused CLI-resolution check if available.

## 3. Runtime paths and documentation

- [x] 3.1 Move development records, ports, asset cache, and database shadows to `node_modules/.cache/platformkit`; update cleanup, host tooling, nginx mounts, and focused tests. **Verify:** `node packages/kit/build/dev-workspace.test.mjs`, `node packages/kit/build/assets.test.mjs`, `node packages/kit/build/runtime-paths.test.mjs`, and `node packages/kit/build/schema.test.mjs`.
- [x] 3.2 Relocate the existing `.platformkit` data only after confirming no active process or container uses its files. **Verify:** the old path is absent, preserved data is at the new cache path, and no development state creates `.platformkit`.
- [x] 3.3 Update the CLI, environment-variable, file-map, and workspace documentation and this change's specs with the verified paths and invocation. **Verify:** the focused docs check and `openspec validate clean-core-source-cli --strict`.
