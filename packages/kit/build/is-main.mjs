/*
 * WHETHER A MODULE IS THE ONE NODE WAS ASKED TO RUN — by its path without the extension, since in the workspace the
 * kit's TypeScript is run by the .mjs name a site has (build/workspace-ts.mjs): `node build/plan.mjs` runs plan.mts,
 * whose own URL then ends .mts (openspec: typescript-throughout).
 *
 * It imports nothing that reaches the filesystem: modules the content pipe copies into the Edge Functions ask it at
 * their foot, and the pipe holds no filesystem (content-kinds.test.mjs). Only when there is a command to compare with
 * is a symlinked path resolved, through Node's own module table, and anywhere that has none it is compared as given.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const bare = (p) => p.replace(/\.m?[jt]s$/, '')
const real = (p) => { try { return globalThis.process.getBuiltinModule('node:fs').realpathSync(p) } catch { return path.resolve(p) } }
export function isMain(url) {
  const argv = globalThis.process?.argv
  if (!argv || !argv[1]) return false
  const me = fileURLToPath(url)
  const asked = path.resolve(argv[1])
  return bare(me) === bare(asked) || bare(real(me)) === bare(real(asked)) || bare(real(me)) === bare(asked)
}
