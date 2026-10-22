# Verification

Applied on 2026-10-21 at James's request. Not archived: read it, then `/opsx:archive`.

| Scenario | Result | Evidence |
| --- | --- | --- |
| from npm | **passed, from the packed package** | `node build/one-package.test.mjs`, 9 checks: `npm pack` carries `bin/platformkit.mjs`, `theme/src/main.js` and `theme/src/theme.js`, and the command runs `--help` from the unpacked copy. `npx platformkit dev` itself waits on the first release to npm. |
| from GitHub | **passed** | `npx --yes github:platform-kit/core#main --help` from an empty folder listed the commands (about a minute). It runs the pushed `main`, so the renamed package reaches it with the next push. |
| one name | **passed** | `one-package.test.mjs`: no tracked file outside history names the retired packages. |

Also checked: `deploy-pins.test.mjs`, `source-cli.test.mjs` and `workspace-root.test.mjs` pass against the one package; the brochure site builds; DharmaLab's app builds (`vite build`, 32 s) with its dependency changed to `github:platform-kit/core#main`, in its own checkout, uncommitted. `docs-check.mjs` passes on all 88 pages.

The release workflow no longer publishes to GitHub Packages, which accepts scoped names only; GitHub serves the package as `github:platform-kit/core#<tag>`.
