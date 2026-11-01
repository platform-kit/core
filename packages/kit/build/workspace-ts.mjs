/*
 * THE WORKSPACE RUNS THE KIT'S TYPESCRIPT AS THE PACKAGE WILL (openspec: typescript-throughout).
 *
 * Every import names the file a site gets: `./site.mjs`, `platformkit/build/plan.mjs` — TypeScript's own convention,
 * which reads `./site.mjs` as `site.mts` while it checks. A site's node_modules holds that `.mjs`, compiled from the
 * source when the kit is packed (build/compile.mjs). The workspace holds only the source, and Node strips its types
 * but never looks for it under another extension, so this hook does: a `.mjs` (or `.js`) that is not there and has
 * a `.mts` (or `.ts`) beside it resolves to that. Nothing else changes, and where the `.mjs` exists — a site's
 * node_modules, a packed kit — the hook is never asked.
 *
 * It is loaded with `--import`, before anything is resolved: the CLI (bin/platformkit.mjs) puts it on NODE_OPTIONS, so
 * every process it starts — the tests, the dev server, the deploy, every npm script — has it. A file run with plain
 * `node` from the workspace needs `node --import platformkit/build/workspace-ts.mjs <file>`.
 */
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (e) {
      if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !/\.m?js$/.test(specifier)) throw e
      try { return nextResolve(specifier.replace(/\.(m?)js$/, '.$1ts'), context) } catch { throw e }
    }
  },
})
