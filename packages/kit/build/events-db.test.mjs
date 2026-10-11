/*
 * THE EVENTS REACH THE DATABASE WITH NO MACHINE.
 *
 * Two halves, and the first is what makes the second mean anything:
 *
 *   A SAVE MOVES NOTHING over rows. A save is a draft — readers have not been shown it — so a
 *   projection that ran on save would publish an edit nobody published. A hook that fired on both
 *   would pass a naive "does it project?" check and be wrong.
 *
 *   A PUBLISH MOVES EVERYTHING, and the writes happen in the Edge Function rather than waiting for
 *   a deploy that, with git out of the cycle and no deploy hook, never comes.
 *
 * It runs against a local stack and skips with a note when there is none.
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

const SITE = process.cwd()
let pass = 0, fail = 0
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')) } }

console.log('\nEVENTS, PROJECTED WITH NO MACHINE\n')
const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n'); process.exit(0) }

let cfg = null
try { cfg = JSON.parse(execSync('npx supabase status -o json', { cwd: SITE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch { skip('no local stack') }
if (!cfg || !cfg.SERVICE_ROLE_KEY) skip('the stack reported no service key')
const db = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
{ const { error } = await db.from('calendar_events').select('id', { head: true, count: 'exact' }); if (error) skip('calendar_events is not there — npm run db:reset (' + error.message + ')') }

/* the module the Edge Function can run: no filesystem at import, so the pipe may carry it */
const { projectEvents } = await import('./events-db.mjs')
const { compileEvents } = await import('./events.mjs')
const { gitStore } = await import('./store/git.mjs')

const store = gitStore(SITE)
const { events, rows } = await compileEvents({ store, write: false })
/* a site that declares no events has nothing to project, and says so rather than failing the run */
if (Array.isArray(rows) && rows.length === 0) skip('this site declares no events — the projection is NOT covered by this run')
ok('the declaration compiles', Array.isArray(rows) && rows.length > 0, String(rows && rows.length))

/* --- a publish moves the rows, and does it from the declaration alone --- */
const before = (await db.from('calendar_events').select('slug')).data || []
const r = await projectEvents({ events, rows, db })
const after = (await db.from('calendar_events').select('slug')).data || []
ok('the projection ran with only a database, no disk and no script', !!r && typeof r.pushed === 'number', JSON.stringify(r))
const want = new Set(rows.filter((x) => x.published).map((x) => x.slug))
ok('every published event is a row', [...want].every((s) => after.some((x) => x.slug === s)),
  [...want].filter((s) => !after.some((x) => x.slug === s)).join(', '))
ok('and no row survives that no file declares', after.every((x) => want.has(x.slug)),
  after.filter((x) => !want.has(x.slug)).map((x) => x.slug).join(', '))
ok('the occurrences were expanded', (r.occurrences || 0) > 0, String(r.occurrences))
/* it is idempotent: running it twice is the same database, which is what a publish depends on */
const again = await projectEvents({ events, rows, db })
ok('running it twice changes nothing', again.pushed === r.pushed && again.gone === 0, JSON.stringify(again))
ok('the rows did not multiply', ((await db.from('calendar_events').select('slug')).data || []).length === after.length)
ok('nothing that was there is lost', before.every((b) => !want.has(b.slug) || after.some((a) => a.slug === b.slug)))

/* --- and what may be commented on travels with it --- */
{
  const { data } = await db.from('comment_subjects').select('subject').eq('kind', 'event')
  ok('every published event may be commented on', [...want].every((s) => (data || []).some((x) => x.subject === s)),
    [...want].filter((s) => !(data || []).some((x) => x.subject === s)).join(', '))
}

/* --- A SAVE OVER ROWS MOVES NOTHING --- */
{
  const { AGENT_MODELS } = await import('./models/core/agents.mjs')
  const model = AGENT_MODELS.find((m) => m.key === 'events')
  ok('the events model is there', !!model)
  ok('it answers projected()', typeof model.projected === 'function')
  let ranScript = false
  const drafting = { kind: 'rows', drafts: true, client: db }
  await model.after({ data: {} }, { store: drafting, script: async () => { ranScript = true } })
  ok('a save over rows runs no script', !ranScript, 'it asked for a machine that is not there')
  /* and on a checkout it does run one, or an editor on a machine would be worse off than before */
  let onDisk = false
  await model.after({ data: {} }, { store: gitStore(SITE), script: async () => { onDisk = true } })
  ok('a save on a checkout still runs the push', onDisk)
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
