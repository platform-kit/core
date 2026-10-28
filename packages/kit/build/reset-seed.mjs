/*
 * WHAT A RESET LEAVES A DATABASE HOLDING, after `supabase db reset` has applied the declaration, the
 * data and the seed: the projections the build's `after` phase writes (spaces, teams, events, comments,
 * providers, achievements, courses, bots, the search rows), the print bucket's type, and the developer's own
 * account. One list, read by `platformkit migrate reset` and by the end-to-end runner
 * (build/e2e.mjs), so a stack made for tests holds exactly what a reset dev stack does. A projection
 * added to the `after` phase is added here.
 */
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const SEED_STEPS = [
  ['spaces.mjs'], ['spaces-push.mjs', '--seed'], ['teams.mjs'], ['teams-push.mjs'], ['events.mjs'], ['events-push.mjs'],
  ['comments-push.mjs'], ['providers-push.mjs'], ['achievements-push.mjs'], ['courses-push.mjs'], ['bots.mjs'], ['bots-push.mjs'], ['search-push.mjs'],
  ['print/templates.mjs', '--fonts'], ['dev-account.mjs'],
]

/* every step in the site's folder, with the stack's env; the first that fails stops the rest and is named */
export function runSeedSteps({ cwd, env = process.env, stdio = 'inherit', skip = [] } = {}) {
  for (const [script, ...args] of SEED_STEPS) {
    if (skip.includes(script)) continue
    const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { cwd, env, stdio, encoding: 'utf8' })
    if (r.status !== 0) return { ok: false, step: script, output: ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-12).join('\n') }
  }
  return { ok: true }
}
