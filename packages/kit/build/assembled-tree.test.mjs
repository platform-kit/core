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

/* 5. EVERY SHARED MODULE A FUNCTION CAN BOOT: a function's deno.json reaches only its own folder, so a bare import a map
   could resolve, left in _shared, is a function that fails to boot (content, storefront-api, agent-run, admin and
   providers all did, over 'marked') — the assembler writes it as the target the maps name */
{
  const fns = path.join(WORK, 'supabase', 'functions')
  const keys = new Set(fs.readdirSync(fns).flatMap((d) => { const f = path.join(fns, d, 'deno.json'); return fs.existsSync(f) ? Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).imports || {}) : [] }))
  const left = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(?:[cm]?js|ts)$/.test(e.name)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)\b[^\n]*?from\s+['"]([^'"]+)['"]/g)) if ([...keys].some((k) => m[1] === k || m[1].startsWith(k.endsWith('/') ? k : k + '/'))) left.push(path.relative(fns, f) + ': ' + m[1]) } }
  walk(path.join(fns, '_shared'))
  ok('no shared module keeps a bare import a function\'s map could resolve', !left.length, left.slice(0, 8).join('\n'))
  /* nor a function's own files a bare import its own map names: the local runtime applies no deno.json at all */
  const own = []
  for (const d of fs.readdirSync(fns)) {
    const f = path.join(fns, d, 'deno.json'); if (d.startsWith('_') || !fs.existsSync(f)) continue
    const mine = Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).imports || {})
    for (const e of fs.readdirSync(path.join(fns, d))) if (/\.(?:[cm]?js|ts)$/.test(e)) for (const m of fs.readFileSync(path.join(fns, d, e), 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)\b[^\n]*?from\s+['"]([^'"]+)['"]/g)) if (mine.some((k) => m[1] === k || m[1].startsWith(k.endsWith('/') ? k : k + '/'))) own.push(d + '/' + e + ': ' + m[1])
  }
  ok('no function keeps a bare import its own map names', !own.length, own.slice(0, 8).join('\n'))
}
fs.rmSync(path.dirname(migration), { recursive: true, force: true })
const assembleOnly = (...args) => { const r = spawnSync(process.execPath, [path.join(HERE, 'assemble.mjs'), ...args], { cwd: WORK, encoding: 'utf8', env: process.env }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') } }

/* 6. A FUNCTION THE GATEWAY MUST LET THROUGH, in a site's config.toml written before the function existed: the check
   refuses it by name, and the assembly writes it in (matrix-api, social-oauth and payment-provider-webhook were all
   answered 401 by the gateway, before they ran, on every site whose file predated them) */
{
  const cfgFile = path.join(WORK, 'supabase', 'config.toml')
  fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace(/\n\[functions\.matrix-api\]\nverify_jwt = false\n/, '\n'))
  const refused = assembleOnly('--check'); assembleOnly()
  ok('a public function missing from config.toml: the check refuses it, by name', refused.status !== 0 && /\[functions\.matrix-api\] verify_jwt = false is missing/.test(refused.out), refused.out)
  ok('…and the assembly wrote it back', /\[functions\.matrix-api\]\nverify_jwt = false/.test(fs.readFileSync(cfgFile, 'utf8')))
}

/* 7. the directory a removed function leaves: the runtime serves it as a function, so the check refuses it and the
   assembly removes it */
{
  const gone = path.join(WORK, 'supabase', 'functions', 'a-removed-function')
  fs.mkdirSync(gone, { recursive: true })
  const refused = assembleOnly('--check'); assembleOnly()
  ok('an empty function directory: the check refuses it', refused.status !== 0 && /stray functions\/a-removed-function\//.test(refused.out), refused.out)
  ok('…and the assembly removed it', !fs.existsSync(gone))
}

fs.rmSync(WORK, { recursive: true, force: true })
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (the assembled tree is generated)`)
process.exit(fail ? 1 : 0)
