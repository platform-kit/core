/*
 * THE BOTS REACH THE SURFACE WITH NO MACHINE.
 *
 * The worker reads the compiled file the function carries — one copy of what a bot is, and it is
 * the file. But the SURFACE reads rows, because whether this person may summon a bot is a question
 * only the database can answer against somebody's standing. So a publish has to make those rows
 * where nothing rebuilds, and a save must not, because a save over rows is a draft.
 *
 * It is a file of its own rather than a few more checks in agents-db.test.mjs. That suite exercises
 * the agent worker, whose sweeps are timing-sensitive; bolting a projection onto the end of it made
 * a check that had passed ten runs in a row start failing about one run in four. The writes here
 * are byte-identical to what was already in the table — every column compared — so the coupling was
 * never the data, but a suite that turns flaky when something is added beside it is telling you to
 * put the thing somewhere else rather than to argue with it.
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { projectBots } from './bots-db.mjs'
import { compileBots } from './bots.mjs'
import { statusOf, leave } from './test-stack.mjs'

const SITE = process.cwd()
let pass = 0, fail = 0
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')) } }

console.log('\nBOTS, PROJECTED WITH NO MACHINE\n')
const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n'); leave(0) }

/* A failed read or write must stop before the sweep. Otherwise a transient database error can look
   like an empty projection and delete rows, or leave a half-projected declaration looking done. */
const fakeDb = ({ select, update, insert, remove } = {}) => {
  const calls = []
  const db = { calls, from(table) {
    return {
      select(columns) { calls.push(['select', table, columns]); return Promise.resolve(select || { data: [], error: null }) },
      update(row) { calls.push(['update', table, row]); return { eq: (column, value) => { calls.push(['eq', column, value]); return Promise.resolve(update || { error: null }) } } },
      insert(row) { calls.push(['insert', table, row]); return Promise.resolve(insert || { error: null }) },
      delete() { calls.push(['delete', table]); return { eq: (column, value) => { calls.push(['eq', column, value]); return Promise.resolve(remove || { error: null }) } } },
    }
  } }
  return db
}
const projectionBot = { slug: 'current', name: 'Current' }
{
  const db = fakeDb({ select: { data: null, error: { message: 'read failed' } } })
  await assert.rejects(() => projectBots({ bots: [projectionBot], db }), /could not read existing rows: read failed/)
  assert.equal(db.calls.filter(([kind]) => ['insert', 'update', 'delete'].includes(kind)).length, 0)
}
{
  const db = fakeDb({ select: { data: null, error: null } })
  await assert.rejects(() => projectBots({ bots: [], db }), /could not read existing rows: expected a row list/)
  assert.equal(db.calls.some(([kind]) => kind === 'delete'), false)
}
{
  const db = fakeDb({
    select: { data: [{ id: '1', slug: 'current' }, { id: '2', slug: 'removed' }], error: null },
    update: { error: { message: 'write failed' } },
  })
  await assert.rejects(() => projectBots({ bots: [projectionBot], db }), /current: write failed/)
  assert.equal(db.calls.some(([kind]) => kind === 'delete'), false)
}
{
  const db = fakeDb({
    select: { data: [{ id: '2', slug: 'removed' }], error: null },
    insert: { error: { message: 'insert failed' } },
  })
  await assert.rejects(() => projectBots({ bots: [projectionBot], db }), /current: insert failed/)
  assert.equal(db.calls.some(([kind]) => kind === 'delete'), false)
}
{
  const db = fakeDb({
    select: { data: [{ id: '2', slug: 'removed' }], error: null },
    remove: { error: { message: 'delete failed' } },
  })
  await assert.rejects(() => projectBots({ bots: [], db }), /could not remove removed: delete failed/)
}
console.log('  ✔ projection read/write failures stop before unsafe cleanup')
{
  const writes = []
  const store = {
    root: SITE,
    list: async (dir) => dir === 'content/bots' ? ['broken'] : [],
    read: async (file) => file === 'content/bots/broken.md'
      ? '---\nname: Broken\nsurfaces: [spaces]\nvoice:\n  provider: local\n---\nA test prompt.\n'
      : null,
    write: async (...args) => writes.push(args),
  }
  await assert.rejects(() => compileBots({ store, themeSkills: {} }), /bots: 1 fault\(s\)/)
  assert.deepEqual(writes, [])
}
console.log('  ✔ invalid bot declarations fail before generated files are written')

let cfg = null
try { cfg = statusOf(); if (!cfg) throw new Error('no stack') } catch { skip('no local stack') }
if (!cfg || !cfg.SERVICE_ROLE_KEY) skip('the stack reported no service key')
const db = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
{ const { error } = await db.from('bots').select('id', { head: true, count: 'exact' }); if (error) skip('the bots table is not there — npm run db:reset (' + error.message + ')') }

const { readSkills } = await import('./bots.mjs')
const { gitStore } = await import('./store/git.mjs')

const { bots } = await compileBots({ store: gitStore(SITE), write: false })
ok('the declaration compiles', bots.length > 0, String(bots.length))

/* A PROJECTION IS A WHOLE-TABLE SYNC, so it is a deletion over a declaration that reads empty.
   Nothing here runs until the files and the table agree on what exists (the rule the cloud lane
   learned the hard way, after emptying the teams table). */
const rowsBefore = ((await db.from('bots').select('slug')).data || []).map((r) => r.slug).sort()
const declared = bots.map((b) => b.slug).sort()
const safe = declared.length > 0 && rowsBefore.every((s) => declared.includes(s))
ok('the table holds nothing the files do not declare, so projecting is safe', safe,
  rowsBefore.filter((s) => !declared.includes(s)).join(', ') + ' — projecting would delete them')

if (safe) {
  const r = await projectBots({ bots, db })
  ok('the bots project with only a database, no disk and no script', r.pushed === bots.length, JSON.stringify(r))
  const rows = (await db.from('bots').select('slug')).data || []
  ok('every declared bot is a row', declared.every((s) => rows.some((x) => x.slug === s)))
  ok('and no row survives that no file declares', rows.every((x) => declared.includes(x.slug)))
  const again = await projectBots({ bots, db })
  ok('running it twice changes nothing', again.pushed === r.pushed && again.gone === 0, JSON.stringify(again))
}

/*
 * THE THEME'S DEFAULT SKILLS, WITH NO PACKAGE DIRECTORY TO READ THEM FROM.
 *
 * In a checkout readSkills walks the theme package's skills folder. An Edge Function has no such
 * folder, and before this the theme's defaults were simply missing there — a bot in the cloud quietly
 * lost every skill the theme ships. They are bundled by the assembler and handed in as data instead.
 */
{
  let bundled = {}
  try { bundled = JSON.parse(readFileSync(join(SITE, 'supabase/functions/_shared/pipe/theme-skills.json'), 'utf8')) } catch { /* reported next */ }
  ok("the theme's skills are bundled for the pipe", Object.keys(bundled).length > 0, String(Object.keys(bundled).length))
  const nothing = { list: async () => [], read: async () => null }
  const fromData = await readSkills(nothing, { themeSkills: bundled })
  ok('and resolve with no disk at all', Object.keys(fromData.skills).length === Object.keys(bundled).length, Object.keys(fromData.skills).join(', '))
  ok('with no faults', fromData.faults.length === 0, fromData.faults.join('; '))
  ok('and carry their prose', Object.values(fromData.skills).every((s) => String(s.body || '').trim().length > 0))
  /* and with neither a folder nor the data there are none, rather than a crash */
  const bare = await readSkills(nothing, {})
  ok('a site with no skills and no theme handed in has none, and does not throw', Object.keys(bare.skills).length === 0)
}

/* --- a save over rows moves nothing; a save on a checkout still pushes --- */
{
  const { AGENT_MODELS } = await import('./models/core/agents.mjs')
  const model = AGENT_MODELS.find((m) => m.key === 'bots')
  ok('the bots model answers projected()', typeof model.projected === 'function')
  let ranRows = false, ranDisk = false
  await model.after({ data: {} }, { store: { kind: 'rows', client: db }, script: async () => { ranRows = true } })
  ok('a save over rows runs no script', !ranRows, 'it asked for a machine that is not there')
  await model.after({ data: {} }, { store: gitStore(SITE), script: async () => { ranDisk = true } })
  ok('a save on a checkout still pushes', ranDisk)
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
