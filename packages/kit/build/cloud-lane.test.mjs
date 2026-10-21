/*
 * THE CLOUD LANE: a deployment with a backend, content in rows, and nothing that ever rebuilds.
 *
 * The shape is the one where a mistake is invisible from a developer's machine. On a checkout every
 * write is a file and every projection runs as a script afterwards, so a model with no publish-time
 * hook looks perfectly correct — and the same model in the cloud saves the row, runs nothing, and
 * the declaration never reaches the database at all. The team is saved and its members never move;
 * the bot is edited and the bot the runner sees is last month's.
 *
 * What this lane holds, and the order matters because the first is what makes the second mean
 * anything:
 *
 *   A SAVE MOVES NOTHING. A save over rows is a draft — readers never see it — so a projection that
 *   ran on save would publish an edit nobody had published. This is the half that is easy to get
 *   backwards, and a hook that fires on both would pass a naive "does it project?" check.
 *
 *   A PUBLISH MOVES EVERYTHING. And it happens with no machine anywhere: no build, no deploy, no
 *   script. That is the whole difference between this shape and the other two.
 *
 * It runs against a local stack and SKIPS WITH A NOTE when there is none — never silently, since a
 * lane that passes by not running is worse than no lane.
 *
 *   node packages/kit/build/cloud-lane.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statusOf, leave } from './test-stack.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = resolve(HERE, '..', '..', '..')
const SITE = process.cwd()
const KIT = resolve(HERE, '..')

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nTHE CLOUD LANE — content in rows, and nothing that rebuilds\n')

const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    The cloud shape is NOT covered by this run.\n'); leave(0) }
if (process.env.PLATFORMKIT_SKIP_CLOUD_LANE === '1') skip('PLATFORMKIT_SKIP_CLOUD_LANE=1')

/* the stack this project's config names, read the way build/dev.mjs reads it */
let cfg = null
try { cfg = statusOf(); if (!cfg) throw new Error('no stack') }
catch { skip('no local stack is up (npx supabase start)') }
if (!cfg || !cfg.API_URL || !cfg.SERVICE_ROLE_KEY) skip('the stack did not report an API url and a service key')

const db = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
{
  const { error } = await db.from('content').select('path', { count: 'exact', head: true })
  if (error) skip('public.content is not there — run `npm run db:reset` first (' + error.message + ')')
}

/* the models that project on a publish. cloud-parity adds to this list as each one lands; the list
   is DERIVED so it can never say a model projects when it does not */
const { registry } = await import('./models/index.mjs')
const { loadSite } = await import('./site.mjs')
const site = await loadSite(SITE)
const models = (await registry(SITE, { site })).filter((m) => typeof m.projected === 'function')
ok('there are models that project on a publish', models.length > 0, 'none — the lane would prove nothing')
console.log('  projecting on publish: ' + models.map((m) => m.key).join(', ') + '\n')

/*
 * THE ROWS STORE. The same store the admin Edge Function uses, so this exercises the real path and
 * not a rehearsal of it: `kind: 'rows'`, a client, and drafts that readers never see.
 */
const { rowsStore } = await import('./store/rows.mjs')
const store = rowsStore({ client: db })
/*
 * THE TWO STORES ARE TOLD APART BY `kind`, AND NOTHING ELSE.
 *
 * Both of them have a `drafts()` METHOD, and both used to declare a `drafts` boolean beside it which
 * the method silently shadowed. So `store.drafts` was a truthy function in a checkout and in the
 * cloud alike, and every `if (store.drafts)` meaning "is this cloud?" took the cloud branch always:
 * three models stopped running their projection on save, and the admin reported cloud mode for every
 * checkout. Nothing failed — a wrong branch that quietly does less rarely does.
 *
 * So: no boolean, and the discriminator is `kind`. This holds it.
 */
{
  const { gitStore } = await import('./store/git.mjs')
  const g = gitStore(SITE)
  ok('a checkout says kind=git', g.kind === 'git')
  ok('a rows store says kind=rows', store.kind === 'rows')
  for (const [name, s] of [['the checkout', g], ['the rows store', store]]) {
    ok(name + ' has drafts() as a method, never a flag', typeof s.drafts === 'function',
      'it is ' + typeof s.drafts + ' — a boolean here is shadowed by the method and reads as truthy')
  }
  /* and no caller may go back to asking the method whether it is truthy */
  const { readdirSync, readFileSync: rf } = await import('node:fs')
  const dir = join(KIT, 'build')
  const bad = []
  const walkJs = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walkJs(p) } else if (/\.(mjs|js)$/.test(e.name) && !e.name.endsWith('.test.mjs')) {
    /* comments stripped first: the note in store/git.mjs explains the trap by quoting it, and a
       guard that flags its own explanation is a guard people delete */
    const src = rf(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (/(?:if\s*\()[^)\n]*\bstore\.drafts\s*[)&|]/.test(src) || /\bstore\.drafts\s*\?/.test(src)) bad.push(p.replace(WORKSPACE + '/', ''))
  } } }
  walkJs(dir)
  ok('nothing tests store.drafts for truthiness', bad.length === 0, bad.join(', ') + ' — ask store.kind instead')
}
ok('the rows store carries its client', !!store.client)

/*
 * A SAVE IS A DRAFT AND A PUBLISH IS THE ACT — proven on the one thing every model shares: the hook
 * itself. Calling projected() with a rows store must reach the database; calling a model's `after`
 * with a drafting store must not run a script.
 */
for (const m of models) {
  const ctx = { store, script: async () => { throw new Error('a script ran over rows, where there is no machine to run one') } }
  let threw = null
  try { await m.after?.({ data: {} }, ctx) } catch (e) { threw = e.message }
  ok('`' + m.key + '` runs no script on a save over rows', threw === null, threw)
}

/*
 * ==========================================================================================
 * A PROJECTION OVER AN UNSEEDED STORE IS A DELETION. READ THIS BEFORE EXTENDING THE LANE.
 *
 * A projection is a whole-table sync: it writes what the declaration holds and removes every
 * file-owned row the declaration does NOT hold. Over a rows store whose public.content has never
 * been seeded, the declaration reads as empty — and "empty declaration" and "delete everything the
 * files own" are the same instruction.
 *
 * The first draft of this lane did exactly that to the local teams table, which is the second time
 * that table has been emptied by a test in this project. It is not a subtle failure and it is not
 * rare: any database a developer has not deliberately put into cloud mode looks like this.
 *
 * So the lane compares the two before it projects anything, and skips the model loudly rather than
 * running a sync it cannot make safe. A lane that destroys the developer's data to prove a point is
 * worse than no lane.
 * ==========================================================================================
 */
const { gitStore } = await import('./store/git.mjs')
const git = gitStore(SITE)
const safeToProject = async (m) => {
  if (!m.dir) return { ok: false, why: 'the model names no directory, so the two cannot be compared' }
  const ext = m.ext || 'md'
  const inFiles = (await git.list(m.dir, { ext }).catch(() => [])).length
  const inRows = (await store.list(m.dir, { ext }).catch(() => [])).length
  if (inRows < inFiles) return { ok: false, why: `the rows hold ${inRows} of the ${inFiles} record(s) the checkout has — this database is not in cloud mode, and projecting would delete what the files own` }
  return { ok: true, why: `${inRows} record(s) in rows` }
}

/* the hook reaches the database — which is what a publish calls, and the whole point of the shape */
for (const m of models) {
  const safe = await safeToProject(m)
  if (!safe.ok) { console.log('  ⚠ ' + m.key + ' not projected — ' + safe.why); continue }
  let err = null
  try { await m.projected({ store }) } catch (e) { err = e.message }
  ok('`' + m.key + '` projects with no machine, only a database (' + safe.why + ')', err === null, err)
}

/*
 * WHAT THE FUNCTIONS READ COMES FROM THE ROWS, NOT THE SHIPPED FILE. A deployment that never builds
 * again has the file the last build left it, so every compiled artefact must reach the functions as
 * a row of public.compiled instead (_shared/compiled.ts reads the row over the file).
 */
{
  const { PUBLISHED } = await import('./artefacts.mjs')
  const { data, error } = await db.from('compiled').select('path')
  ok('public.compiled is readable', !error, error && error.message)
  const have = new Set((data || []).map((r) => r.path))
  console.log('  compiled rows present: ' + ([...have].join(', ') || 'none yet (a publish writes them)'))
  for (const k of Object.keys(PUBLISHED)) {
    /* not an assertion that the row exists — a database nobody has published to has none — but that
       the artefact is one a publish COULD write, which is the contract the overlay depends on */
    ok('`' + k + '` is an artefact a publish can write', typeof PUBLISHED[k] === 'string' && PUBLISHED[k].length > 0)
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
