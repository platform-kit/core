/*
 * THE END-TO-END RUNNER'S OWN TEST (openspec: test-environment). The runner is what every other stack test trusts
 * for its stack, so it is checked the way it is used: real runs, real stacks, a probe in place of the suite
 * (build/fixtures/e2e-probe.mjs, through `--run`).
 *
 *   a dev stack untouched     a stand-in dev database (named and ported as `npm run dev` names them) with a row in
 *                             it, and every real dev stack that is up: the same containers, started at the same
 *                             moment, holding the same rows, on the same ports after every run as before
 *   two sites isolated        the demo and the club fixture in one run: each its own stack and ports, each holding
 *                             its own seed and not the other's, a row one writes absent from the other
 *   a schema change seen      a table added to the club's db/schemas is on its stack, with nothing run by hand
 *   a crashed run replaced    the kept stack of a run is replaced by the next, its marker row gone
 *   a live key refused        before any stack starts, naming the key
 *   a withheld service        a test that needs what the run did not give it fails the run, naming it; and Docker
 *                             withheld fails the run naming Docker
 *   an interrupted run        SIGINT mid-test, and every container of the run is gone
 *   no supabase status        held by test-coverage.test.mjs (no stack test reads `supabase status` or a fixed port)
 *
 * It starts several stacks, so it is CI's (the e2e job) and a developer's to run by hand — never inside the run it
 * tests. It leaves no stack behind.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')
const CLUB = path.join(ROOT, 'sites', 'club')
const PROBE = path.join(HERE, 'fixtures', 'e2e-probe.mjs')
const SCHEMA = path.join(CLUB, 'db', 'schemas', 'zz_e2e_probe.sql')
const ENV = path.join(CLUB, '.env')
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + String(detail).trim().split('\n').slice(-12).join('\n        ') : '')) } }

if (spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 20000 }).status !== 0) { console.log('e2e-runner: Docker is not answering — this test runs the end-to-end runner, which needs it'); process.exit(1) }
if (fs.existsSync(ENV)) { console.log(`e2e-runner: ${path.relative(ROOT, ENV)} exists — the live-key check writes that file and will not overwrite one`); process.exit(1) }

const docker = (...a) => spawnSync('docker', a, { encoding: 'utf8', timeout: 120000 })
const e2eContainers = (id) => docker('ps', '-a', '--filter', `name=_${id}`, '--format', '{{.Names}}').stdout.split('\n').filter(Boolean)
const runner = (a, env = {}) => spawnSync(process.execPath, [path.join(HERE, 'e2e.mjs'), ...a], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 1800000, maxBuffer: 1 << 26 })
const probes = (out) => [...String(out).matchAll(/PROBE (\{.*\})/g)].map((m) => JSON.parse(m[1]))
const out = (r) => (r.stdout || '') + (r.stderr || '')

/* ─── the dev side, as it is before any run ─── */
const SENTINEL = 'supabase_db_pk_runnertest_dev'
const image = docker('images', '--format', '{{.Repository}}:{{.Tag}}').stdout.split('\n').find((i) => /supabase\/postgres:\d/.test(i))
docker('rm', '-f', SENTINEL)
const devState = () => {
  const dbs = docker('ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}').stdout.split('\n').filter((n) => n && !/_e2e$/.test(n))
  return Object.fromEntries(dbs.map((n) => {
    const started = docker('inspect', n, '-f', '{{.State.StartedAt}}').stdout.trim()
    const ports = docker('port', n).stdout.trim().split('\n').sort().join(' ')
    const rows = docker('exec', n, 'psql', '-U', 'postgres', '-tAc', n === SENTINEL ? 'select count(*) from public.runner_sentinel' : 'select count(*) from auth.users').stdout.trim()
    return [n, { started, ports, rows }]
  }))
}
let sentinelUp = false
if (image) {
  docker('run', '-d', '--name', SENTINEL, '-p', '127.0.0.1:20322:5432', '-e', 'POSTGRES_PASSWORD=postgres', image)
  for (let i = 0; i < 60 && !sentinelUp; i++) {
    sentinelUp = docker('exec', SENTINEL, 'psql', '-U', 'postgres', '-c', 'select 1').status === 0
    if (!sentinelUp) await new Promise((r) => setTimeout(r, 1000))
  }
  docker('exec', SENTINEL, 'psql', '-U', 'postgres', '-c', `create schema if not exists auth; create table if not exists auth.users (id int); create table public.runner_sentinel (id int); insert into public.runner_sentinel values (1), (2), (3)`)
}
ok('a stand-in dev database is up to be left alone', sentinelUp, image ? '' : 'no supabase/postgres image is pulled')
const before = devState()

try {
  /* ─── a live key: refused before any stack ─── */
  fs.writeFileSync(ENV, `STRIPE_SECRET_KEY=${'sk_' + 'live_'}${'0'.repeat(24)}\n`)
  {
    const r = runner(['--only', 'club'])
    ok('a live key refuses the run', r.status !== 0 && /live payment key \(STRIPE_SECRET_KEY\)/.test(out(r)), out(r))
    ok('…before any stack of the site started', !e2eContainers('pk_club_e2e').length, e2eContainers('pk_club_e2e').join(', '))
  }
  fs.rmSync(ENV, { force: true })

  /* ─── Docker withheld ─── */
  {
    const r = runner(['--only', 'club'], { DOCKER_HOST: 'unix:///nonexistent/docker.sock' })
    ok('Docker withheld fails the run, naming Docker', r.status !== 0 && /Docker is not answering/.test(out(r)), out(r))
  }

  /* ─── two sites side by side, a schema change, a row left behind ─── */
  fs.mkdirSync(path.dirname(SCHEMA), { recursive: true })
  fs.writeFileSync(SCHEMA, `-- written by build/e2e-runner.test.mjs and removed by it\ncreate table if not exists public.e2e_probe (id bigint generated always as identity primary key, note text, probe_column text);\n`)
  let first = []
  {
    const r = runner(['--only', 'demo,club', '--keep', '--run', PROBE], { PROBE_WRITE: '1' })
    first = probes(out(r))
    const demo = first.find((p) => p.site === 'demo'), club = first.find((p) => p.site === 'club')
    ok('a run over two sites probes both', r.status === 0 && demo && club, out(r))
    if (demo && club) {
      ok('…each on its own API port, in the test range', demo.api !== club.api && [demo, club].every((p) => Number(new URL(p.api).port) >= 40000), `${demo.api} ${club.api}`)
      ok('…its own database', demo.db !== club.db, `${demo.db} ${club.db}`)
      ok('…its own mail catcher', demo.mail && club.mail && demo.mail !== club.mail, `${demo.mail} ${club.mail}`)
      ok('…as the end-to-end run', demo.e2e === '1' && club.e2e === '1')
      ok('…each with its own seed: the demo\'s buyer\'s purchase, and none in the club, which sells nothing', demo.purchases > 0 && club.purchases === 0, `demo ${demo.purchases}, club ${club.purchases}`)
      ok('a table added to the club\'s schema is on its stack, with nothing run by hand', club.tables.includes('e2e_probe') && club.columns.includes('probe_column'), club.columns.join(', '))
      ok('…and not on the demo\'s', !demo.tables.includes('e2e_probe'))
      ok('the club\'s row is in the club\'s database', club.marker === 1, club.marker)
    }
    ok('--keep leaves the stacks up', e2eContainers('pk_club_e2e').length > 0 && e2eContainers('pk_demo_e2e').length > 0)
  }

  /* ─── the next run replaces what the last one left, then removes its own ─── */
  {
    const r = runner(['--only', 'club', '--run', PROBE])
    const club = probes(out(r)).find((p) => p.site === 'club')
    ok('a run after a kept one probes the club', r.status === 0 && !!club, out(r))
    if (club) ok('…on a stack built anew: the last run\'s row is gone', club.marker === 0, club.marker)
    ok('a run that ends removes its stack', !e2eContainers('pk_club_e2e').length, e2eContainers('pk_club_e2e').join(', '))
  }

  /* ─── a service the run did not give ─── */
  {
    const r = runner(['--only', 'club', '--run', PROBE], { PROBE_WITHHOLD: 'PLATFORMKIT_TEST_MAIL_URL' })
    ok('a test needing what the run did not give fails the run, naming the test and the service', r.status !== 0 && /e2e-probe: could not run in the end-to-end run — no mail catcher/.test(out(r)), out(r))
    ok('…and the run still removes its stack', !e2eContainers('pk_club_e2e').length)
  }

  /* ─── interrupted mid-test ─── */
  {
    const p = spawn(process.execPath, [path.join(HERE, 'e2e.mjs'), '--only', 'club', '--run', PROBE], { cwd: ROOT, env: { ...process.env, PROBE_SLEEP: '900' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    p.stdout.on('data', (d) => { text += d }); p.stderr.on('data', (d) => { text += d })
    const log = path.join(ROOT, 'node_modules', '.cache', 'platformkit', 'e2e', 'club.log')
    const testing = () => /up — API/.test(text) && fs.existsSync(log) && /PROBE /.test(fs.readFileSync(log, 'utf8'))
    for (let i = 0; i < 900 && !testing() && p.exitCode === null; i++) await new Promise((r) => setTimeout(r, 1000))
    ok('a run reaches its tests to be interrupted', testing(), text)
    p.kill('SIGINT')
    const code = await new Promise((r) => (p.exitCode !== null ? r(p.exitCode) : p.on('exit', (c) => r(c))))
    ok('an interrupted run stops', code === 130, `exit ${code}\n${text}`)
    ok('…and removes every container it started', !e2eContainers('pk_club_e2e').length, e2eContainers('pk_club_e2e').join(', '))
  }

  /* ─── the dev side, as it was ─── */
  const after = devState()
  ok('every dev stack is as it was: the same containers, started at the same time, on the same ports, with the same rows', JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }, null, 1))

  /* ─── no stack test reads `supabase status` or a fixed port: test-coverage holds it ─── */
  {
    const r = spawnSync(process.execPath, [path.join(HERE, 'test-coverage.test.mjs')], { encoding: 'utf8' })
    ok('no stack test reads `supabase status` or a fixed port (test-coverage.test.mjs)', r.status === 0 && !/FAIL {2}no stack test reads/.test(r.stdout), r.stdout)
  }
} finally {
  fs.rmSync(ENV, { force: true })
  fs.rmSync(SCHEMA, { force: true })
  docker('rm', '-f', SENTINEL)
  /* the demo's kept stack from the two-site run, and anything an interrupted check left */
  for (const id of ['pk_demo_e2e', 'pk_club_e2e']) spawnSync('npx', ['supabase', 'stop', '--project-id', id, '--no-backup'], { cwd: ROOT, stdio: 'ignore', timeout: 300000 })
}

console.log(fail ? `e2e-runner: ${fail} failed, ${pass} passed` : `e2e-runner: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
