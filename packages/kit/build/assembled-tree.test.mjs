/* The assembled supabase/ tree is generated, never committed: `platformkit test` assembles it, then
   checks it. Run on a copy of sites/demo's sources (its config, db/, content and supabase/config.toml —
   no generated tree), the step must pass with nothing on disk, pass over a copy assembled from an older
   kit, and refuse a file neither owner declared — by name, pointing at the assembler, and never asking
   for a commit. The copy sits under the workspace's node_modules/.cache so the kit's packages resolve.
   Pinned by npm test. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = path.resolve(HERE, '../../..')
const DEMO = path.join(WORKSPACE, 'sites', 'demo')
const WORK = path.join(WORKSPACE, 'node_modules', '.cache', 'platformkit', 'assembled-tree-test')

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + detail.trim().split('\n').slice(-6).join('\n        ') : '')) } }

/* the test step lists both commands, unconditionally */
const runner = fs.readFileSync(path.join(HERE, 'test.mjs'), 'utf8')
ok('test.mjs assembles before it checks, whatever is on disk',
  /\n\s*\['assemble\.mjs'\],\s*\n\s*\['assemble\.mjs', '--check'\],/.test(runner) && !/\.assembled\.json'\)\) \? \['assemble\.mjs'/.test(runner))

/* the site's sources, and nothing generated */
const generated = /(^|\/)(node_modules|dist|\.velite|\.platformkit|\.vite|\.content-collections)(\/|$)/
fs.rmSync(WORK, { recursive: true, force: true })
fs.cpSync(DEMO, WORK, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(DEMO, src).split(path.sep).join('/')
    if (generated.test(rel)) return false
    return !(rel.startsWith('supabase/') && rel !== 'supabase/config.toml')
  },
})
ok('the copy holds no assembled tree', !fs.existsSync(path.join(WORK, 'supabase', 'functions')) && fs.existsSync(path.join(WORK, 'supabase', 'config.toml')))

const step = () => ['assemble.mjs', 'assemble.mjs --check'].map((cmd) => {
  const [script, ...args] = cmd.split(' ')
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { cwd: WORK, encoding: 'utf8', env: process.env })
  return { cmd, status: r.status, out: (r.stdout || '') + (r.stderr || '') }
})

/* 1. a fresh checkout: nothing generated yet */
for (const r of step()) ok(`no tree: ${r.cmd} passes`, r.status === 0, r.out)
ok('no tree: the functions were assembled', fs.existsSync(path.join(WORK, 'supabase', 'functions', '_shared')))

/* 2. a stale copy: one assembled file differs from its source */
const lib = path.join(WORK, 'supabase', 'functions', '_shared', 'lib.ts')
fs.appendFileSync(lib, '\n// assembled from an older kit\n')
for (const r of step()) ok(`stale copy: ${r.cmd} passes`, r.status === 0, r.out)
ok('stale copy: the file is current again', !fs.readFileSync(lib, 'utf8').includes('assembled from an older kit'))

/* 3. a file neither owner declared */
const stray = path.join(WORK, 'supabase', 'functions', 'stray-test', 'index.ts')
fs.mkdirSync(path.dirname(stray), { recursive: true }); fs.writeFileSync(stray, 'export {}\n')
const [, checked] = step()
ok('stray file: the check refuses', checked.status !== 0, checked.out)
ok('stray file: it is named', checked.out.includes('stray functions/stray-test/index.ts'), checked.out)
ok('stray file: the remedy is the assembler', checked.out.includes('assemble.mjs'), checked.out)
ok('stray file: no commit is asked for', !/then commit/i.test(checked.out), checked.out)
fs.rmSync(path.dirname(stray), { recursive: true })

/* 4. a migration: nothing reads one, and an assembly does not remove a site's own */
const migration = path.join(WORK, 'supabase', 'migrations', '20260101000000_site.sql')
fs.mkdirSync(path.dirname(migration), { recursive: true }); fs.writeFileSync(migration, 'select 1;\n')
const [, migrated] = step()
ok('migration: the check refuses', migrated.status !== 0, migrated.out)
ok('migration: the directory is named', migrated.out.includes('supabase/migrations/'), migrated.out)

fs.rmSync(WORK, { recursive: true, force: true })
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (the assembled tree is generated)`)
process.exit(fail ? 1 : 0)
