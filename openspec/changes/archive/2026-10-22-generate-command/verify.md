# Verification

Run on 2026-10-22.

| Scenario | Result | Evidence |
| --- | --- | --- |
| A new module | Passed | `generate.test.mjs`: `module gift-cards` in a copy of the demo writes the manifest, adds `modules['gift-cards']: true` and `build.modules`, and the site loads with the module on. |
| Every kind passes the checks as written | Passed | `generate.test.mjs`: all six kinds in the demo copy; the config loads with each registered, the page compiles, `steps --check` passes with the new step, the model is in the admin registry, the function is assembled, the generated test passes. A full `platformkit build` of a copy with all six generated succeeded, and `/gift-cards` was prerendered into `dist/`. |
| The config keeps its comments | Passed | `generate.test.mjs`: every comment in the demo config, in order, and every line it had, after six generations. |
| No level given | Passed | `generate.test.mjs`: every site-level run wrote only into the site copy. |
| Every kind at the core level | Passed | `generate.test.mjs`: all six kinds with `--level core` into a copy of the workspace; the files are in place, and the coverage (9/9), manifests, deployment-shape and docs checks pass there, `App.vue` compiles with the page wired in, and the generated test passes. |
| The core level in a site installed from npm | Passed | `generate.test.mjs`: with PlatformKit under `node_modules`, `--level core` is refused with the pointer to the site level. |
| A name that is taken | Passed | `generate.test.mjs`: `module store` is refused by name and nothing changes. |
| A dry run | Passed | `generate.test.mjs`: the listing names the files and the route, and a hash of the site copy is unchanged. |
| A site's own page template | Passed | `generate.test.mjs`: a page template in the site's `generators/page/` is used in place of the kit's. |
| Generate is a command | Passed | `platformkit generate` with no kind lists the kinds and exits 0; `platformkit generate page about-us --dry-run` in the demo listed its files and changed nothing. |

Found and fixed on the way: run from a path through a symlink (`/var` is `/private/var` on macOS), the "run directly" guard in `generate.mjs` and `check.mjs` never matched, so the command exited 0 having done nothing. Both now compare real paths, and the test asserts each run says what it wrote.
