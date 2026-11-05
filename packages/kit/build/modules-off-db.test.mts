/*
 * EVERY MODULE OFF, ONE AT A TIME, ON A REAL DATABASE (openspec: module-switch-removes-backend).
 *
 * modules-off.test.mjs proves the switches agree with each other in arithmetic; this proves what a switch does to the
 * backend. For each of the kit's modules in turn, the site is assembled as though that module (and everything that
 * requires it) were off — the real assembler, `--off` into a scratch tree, so its own refusals stand: a relative import
 * a served function names and the tree does not hold, which is the whole edge runtime failing to boot. Then:
 *
 *   NONE OF IT IS SERVED — none of the module's schema files and none of its functions are in the tree.
 *   THE REST APPLIES — the declaration applies to a fresh database, the rows after it, the cron block with them.
 *   NOTHING NAMES WHAT IS GONE — every function body is checked against what the database now holds: a SQL function
 *     re-created with its body checked, a PL/pgSQL one by plpgsql_check. A body naming the switched-off module's table
 *     is a function that fails the first time it is called, and nothing at apply time would have said so.
 *   EVERY JOB HAS ITS FUNCTION — each cron job left on calls a function the database has.
 *
 * And the data, for one module (courses): switched off, its functions go and its rows stay; switched on, they are all
 * there and the functions are back; `module drop` lists the tables, refuses a table with rows without consent, and
 * with consent drops them.
 *
 * The database is a scratch project of its own (the CLI's Supabase-shaped container, never a site's stack), the way
 * schema.test.mjs has one. Run by the end-to-end run (E2E_ALSO) on the demo site, which has every module on;
 * skipped elsewhere and where Docker is down.
 *
 *   node packages/kit/build/modules-off-db.test.mjs     (from a site's root)
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadSite } from './site.mjs'
import { moduleSet } from './steps.mjs'
import { activeCronJobs } from './cron.mjs'
import { ownership } from './modules/backend.mjs'
import { readDeclaration, resetShadow, computePlan, applyPlan } from './plan.mjs'
import { planDrop, applyDrop } from './module-drop.mjs'

const ROOT = process.cwd()
const ASSEMBLE = fileURLToPath(new URL('./assemble.mjs', import.meta.url))
const note = (m: any) => console.log('modules off: ' + m)
const SITE = (process.env.PLATFORMKIT_TEST_SITE || '').toLowerCase()
/* the demo site has every module on, so its run covers every switch; on another site this is not the site's question */
if (process.env.PLATFORMKIT_E2E === '1' && SITE && SITE !== 'demo') { console.log(`  — modules off: not on this site (${SITE}; the demo site, which has every module on, runs it)`); process.exit(0) }
if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) { note('skipped — Docker is not running'); process.exit(0) }

const SCR = path.join(ROOT, 'node_modules', '.cache', 'platformkit', 'modules-off-test')
const RUN = (SITE || 'local').replace(/[^a-z0-9]+/g, '-')
const { findFreePort } = await import('./dev-workspace.mjs')
const PORT = await findFreePort(44100 + ([...RUN].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 40) * 20)
const SHADOW = await findFreePort(PORT + 1)
const PROJECT = 'pk-modules-off-' + RUN
const DOCKER_AT = (process.env.SUPABASE_SERVICES_HOSTNAME || '').trim() || '127.0.0.1'
const TARGET = `postgresql://postgres:postgres@${DOCKER_AT}:${PORT}/postgres?sslmode=disable`

let pass = 0, fail = 0
const ok = (msg: any, cond: any, detail?: any) => { if (cond) { pass++; return true } else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + String(detail).split('\n').slice(0, 8).join('\n        ') : '')); return false } }
const sb = (args: any) => spawnSync('npx', ['supabase', '--workdir', SCR, ...args], { cwd: SCR, encoding: 'utf8', env: process.env })

const site = await loadSite(ROOT)
const modules = await moduleSet(site)
const own = ownership(modules)
const switches = site.modules || {}
/* a module off takes everything that requires it with it */
const closure = (key: any) => {
  const off = new Set([key])
  for (let grew = true; grew;) { grew = false; for (const m of modules.values()) if (!off.has(m.key) && m.requires.some((r) => off.has(r.module))) { off.add(m.key); grew = true } }
  return [...off]
}

/* the site assembled with these off, into a scratch tree of its own */
const VARIANT = path.join(SCR, 'variant')
const assemble = (off: any) => {
  fs.rmSync(path.join(VARIANT, 'supabase'), { recursive: true, force: true })
  return spawnSync(process.execPath, [ASSEMBLE, '--off', off.join(','), '--out', path.join(VARIANT, 'supabase')], { cwd: ROOT, encoding: 'utf8', env: process.env })
}

/* ---- the scratch project ---- */
fs.rmSync(SCR, { recursive: true, force: true })
fs.mkdirSync(path.join(SCR, 'supabase'), { recursive: true })
fs.writeFileSync(path.join(SCR, 'supabase', 'config.toml'), `project_id = "${PROJECT}"\n[db]\nport = ${PORT}\nshadow_port = ${SHADOW}\nmajor_version = 17\n[db.seed]\nenabled = false\n`)
sb(['stop', '--no-backup'])
const started = sb(['db', 'start'])
if (started.status !== 0) { console.log(started.stdout, started.stderr); note('the scratch database did not start'); process.exit(1) }
const settled = async () => { for (let i = 0, good = 0; i < 120 && good < 3; i++) { try { const c = new pg.Client({ connectionString: TARGET }); await c.connect(); await c.query('select 1'); await c.end(); good++ } catch { good = 0 } await new Promise((r) => setTimeout(r, 500)) } }
await settled()
const withDb = async (fn: any) => { const c = new pg.Client({ connectionString: TARGET }); await c.connect(); try { return await fn(c) } finally { await c.end() } }

/* every function body checked against what the database holds; errors that are no module's (an extension the scratch
   has no worker for) are left out by asking the same of the whole site first */
async function bodyErrors() {
  return withDb(async (db: any) => {
    const out = []
    await db.query('create extension if not exists plpgsql_check')
    const fns = (await db.query(`select p.oid, p.proname, l.lanname, p.prorettype = 'trigger'::regtype as trig,
        (select t.tgrelid from pg_trigger t where t.tgfoid = p.oid limit 1) as rel
      from pg_proc p join pg_language l on l.oid = p.prolang
     where p.pronamespace = 'public'::regnamespace and l.lanname in ('sql', 'plpgsql')`)).rows
    for (const f of fns) {
      if (f.lanname === 'sql') {
        const def = (await db.query('select pg_get_functiondef($1) d', [f.oid])).rows[0].d
        await db.query('begin'); await db.query('set local check_function_bodies = on')
        try { await db.query(def) } catch (e: any) { out.push(`${f.proname}: ${e.message}`) }
        await db.query('rollback')
      } else if (!f.trig || f.rel) {
        const r = await db.query(`select message from plpgsql_check_function_tb($1::oid::regprocedure, ${f.trig ? '$2::oid::regclass' : '0'},
          fatal_errors => false, other_warnings => false, performance_warnings => false, extra_warnings => false) where level = 'error'`, f.trig ? [f.oid, f.rel] : [f.oid])
        for (const x of r.rows) out.push(`${f.proname}: ${x.message}`)
      }
    }
    return [...new Set(out)]
  })
}
const applyTree = async () => {
  const d = readDeclaration(VARIANT)
  await resetShadow(TARGET, d.schema)
  await withDb(async (db: any) => { await db.query('begin'); try { await db.query(d.data); await db.query('commit') } catch (e) { await db.query('rollback'); throw e } })
  return d
}

try {
  /* the whole site first: what its own bodies already say is no switch's doing */
  const all = assemble([])
  ok('the site assembles with everything it has on', all.status === 0, all.stderr)
  await applyTree()
  const known = new Set(await bodyErrors())

  for (const m of [...modules.values()].filter((x) => x.key !== 'translation')) {
    const off = closure(m.key)
    const label = off.length > 1 ? `${m.key} off (and ${off.filter((k) => k !== m.key).join(', ')})` : `${m.key} off`
    const r = assemble(off)
    if (!ok(`${label}: the site assembles, every served function's imports in the tree`, r.status === 0, r.stderr)) continue
    const tree = path.join(VARIANT, 'supabase')
    const served = fs.readdirSync(path.join(tree, 'functions')).filter((f) => !f.startsWith('_'))
    const theirs = [...own.functions].filter(([, o]) => o.some((k) => off.includes(k))).map(([f]) => f)
    ok(`${label}: none of its functions is served`, !served.some((f) => theirs.includes(f)), served.filter((f) => theirs.includes(f)).join(', '))
    const files = fs.readdirSync(path.join(tree, 'schemas')).filter((f) => f.endsWith('.sql'))
    const schemas = [...own.schema].filter(([, o]) => o.some((k) => off.includes(k))).map(([f]) => f)
    ok(`${label}: none of its schema files is declared`, !files.some((f) => schemas.includes(f)), files.filter((f) => schemas.includes(f)).join(', '))
    const glue = fs.existsSync(path.join(tree, 'schemas', 'glue')) ? fs.readdirSync(path.join(tree, 'schemas', 'glue')) : []
    ok(`${label}: no glue joining it is declared`, !glue.some((g) => g.replace('.sql', '').split('+').some((k) => off.includes(k))), glue.join(', '))
    try { await applyTree(); pass++ } catch (e: any) { ok(`${label}: the declaration and the rows apply to a fresh database`, false, e.message); continue }
    const errs = (await bodyErrors()).filter((e: any) => !known.has(e))
    ok(`${label}: no function body names what is gone`, errs.length === 0, errs.join('\n'))
    const jobs = activeCronJobs(modules, { ...switches, ...Object.fromEntries(off.map((k) => [k, false])) })
    const missing = await withDb(async (db: any) => {
      const out = []
      for (const j of jobs) { const fn = /public\.([a-z_][a-z0-9_]*)\s*\(/i.exec(j.command)?.[1]; if (fn && !(await db.query('select 1 from pg_proc where proname = $1 and pronamespace = \'public\'::regnamespace', [fn])).rowCount) out.push(`${j.name} → ${fn}`) }
      return out
    })
    ok(`${label}: every cron job left on calls a function the database has`, missing.length === 0, missing.join(', '))
  }

  /* ---- off keeps the data; on finds it; drop removes it ---- */
  const KEY = 'courses'
  if (modules.has(KEY)) {
    const count = () => withDb(async (db: any) => (await db.query("select count(*)::int as n from public.courses where slug like 'modules-off-%'")).rows[0].n)
    const has = (fn: any) => withDb(async (db: any) => (await db.query("select to_regproc('public.' || $1) is not null as y", [fn])).rows[0].y)
    assemble([])
    await applyTree()
    await withDb((db: any) => db.query("insert into public.courses (slug, title) values ('modules-off-one', 'One'), ('modules-off-two', 'Two')"))
    assemble([KEY])
    let p = await computePlan({ root: VARIANT, target: TARGET, shadowUrl: null, env: { ...process.env, PLATFORMKIT_ALLOW_DESTRUCTIVE: '' } })
    ok('courses off: the plan keeps its tables', p.kept.includes('courses') && p.kept.includes('enrollments'), p.kept.join(', '))
    ok('courses off: and asks no consent, since it drops nothing that holds anything', p.verdict.ok, p.verdict.refused.map((h) => h.object).join(', '))
    await applyPlan(p, TARGET, () => {})
    ok('courses off: its rows are all there', (await count()) === 2)
    ok('courses off: its functions are gone', !(await has('course_state')) && !(await has('my_courses')))
    assemble([])
    p = await computePlan({ root: VARIANT, target: TARGET, shadowUrl: null, env: { ...process.env, PLATFORMKIT_ALLOW_DESTRUCTIVE: '' } })
    ok('courses back on: nothing destructive in the plan', p.verdict.ok)
    await applyPlan(p, TARGET, () => {})
    ok('courses back on: its rows are all there', (await count()) === 2)
    ok('courses back on: its functions are back', (await has('course_state')) && (await has('my_courses')))
    /* and dropped, which is its own act and asks */
    assemble([KEY])
    await applyPlan(await computePlan({ root: VARIANT, target: TARGET, shadowUrl: null }), TARGET, () => {})
    const offSite = { ...site, modules: { ...switches, [KEY]: false } }
    let refused = null
    try { await planDrop({ root: ROOT, key: KEY, target: TARGET, site: { ...site, modules: { ...switches, [KEY]: true } } }) } catch (e: any) { refused = e.message }
    ok('module drop refuses a module that is on', /is on/.test(refused || ''), refused)
    const drop = await planDrop({ root: VARIANT, key: KEY, target: TARGET, site: offSite, env: { ...process.env, PLATFORMKIT_ALLOW_DESTRUCTIVE: '' } })
    ok('module drop lists the tables, with their rows', drop.present.includes('courses') && drop.rows.courses === 2, JSON.stringify(drop.rows))
    ok('module drop refuses without consent', !drop.verdict.ok)
    let threw = false
    try { await applyDrop(drop, TARGET) } catch { threw = true }
    ok('module drop applies nothing it was refused', threw && (await count()) === 2)
    const allowed = await planDrop({ root: VARIANT, key: KEY, target: TARGET, site: offSite, env: { ...process.env, PLATFORMKIT_ALLOW_DESTRUCTIVE: drop.verdict.digest } })
    ok('module drop is allowed with consent naming it', allowed.verdict.ok)
    await applyDrop(allowed, TARGET)
    ok('module drop: the tables are gone', await withDb(async (db: any) => (await db.query("select count(*)::int as n from pg_tables where schemaname = 'public' and tablename = any($1)", [drop.present])).rows[0].n === 0))
  }
} finally {
  sb(['stop', '--no-backup'])
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
