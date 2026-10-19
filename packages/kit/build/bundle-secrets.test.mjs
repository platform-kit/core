/* No server secret reaches a published file. Every secret-named variable in the root .env.example (a SECRET, KEY,
   TOKEN, PASS, PRIVATE, SERVICE_ROLE or WEBHOOK in its name, outside the public VITE_ prefix and the build's own
   named flags) is given a distinctive value; a copy of sites/demo is built with them — the content, the prepare
   steps and the bundle, never a step that calls a provider — and every file it would publish is searched for each
   value. A variable added later under a public prefix, or a secret written into content or config the bundle
   carries, fails here. Slow (a whole build): BUNDLE_SECRETS_TEST=0 skips it. Pinned by npm test. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const note = (m) => console.log('bundle-secrets: ' + m)
if (process.env.BUNDLE_SECRETS_TEST === '0') { note('skipped (BUNDLE_SECRETS_TEST=0)'); process.exit(0) }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = path.resolve(HERE, '../../..')
const DEMO = path.join(WORKSPACE, 'sites', 'demo')
const WORK = path.join(WORKSPACE, 'node_modules', '.cache', 'platformkit', 'bundle-secrets-test')

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + String(detail).trim().split('\n').slice(-8).join('\n        ') : '')) } }

/* the secret-named variables the kit documents, and a value for each nobody could mistake */
const PUBLIC = /^VITE_|^(IN_BROWSER_TTS|LOCKDOWN_MODE|CONTENT_STORE)$/
const SECRET = /SECRET|KEY|TOKEN|PASS|PRIVATE|SERVICE_ROLE|WEBHOOK/
const names = [...new Set((fs.readFileSync(path.join(WORKSPACE, '.env.example'), 'utf8').match(/^[A-Z][A-Z0-9_]*(?==)/gm) || []))]
  .filter((n) => SECRET.test(n) && !PUBLIC.test(n))
const sentinel = (n) => `zzsecret_${n.toLowerCase()}_q7v`
ok('there are secrets to plant', names.length > 20, String(names.length))

const generated = /(^|\/)(node_modules|dist|\.velite|\.platformkit|\.vite|\.content-collections)(\/|$)/
fs.rmSync(WORK, { recursive: true, force: true })
fs.cpSync(DEMO, WORK, { recursive: true, filter: (src) => {
  const rel = path.relative(DEMO, src).split(path.sep).join('/')
  return !generated.test(rel) && !(rel.startsWith('supabase/') && rel !== 'supabase/config.toml') && !/^\.env/.test(rel)
} })
/* the secrets as a deploy would have them: in the site's .env, and in the environment of every step */
const planted = Object.fromEntries(names.map((n) => [n, sentinel(n)]))
fs.writeFileSync(path.join(WORK, '.env'), Object.entries(planted).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
const run = (args, env = {}) => {
  const r = spawnSync(args[0], args.slice(1), { cwd: WORK, encoding: 'utf8', env: { ...process.env, ...planted, CONTENT_STORE: 'files', ...env }, maxBuffer: 1 << 28 })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const v = run([process.execPath, '--input-type=module', '-e',
  `const { engineFor } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'collections.mjs')).href)})
   const e = await engineFor(process.cwd())
   if (e.name !== 'velite') await e.build({ root: process.cwd(), log: () => {} })
   else { const { build } = await import('velite'); await build({ clean: true }) }`])
ok('the content builds', v.status === 0, v.out)
const prep = run([process.execPath, path.join(HERE, 'steps.mjs'), '--run', 'prepare'])
ok('the prepare steps run', prep.status === 0, prep.out)
const b = run(['npx', 'vite', 'build', '--logLevel', 'warn'], { PLATFORMKIT_CONTENT_DONE: '1', NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --max-old-space-size=4096').trim() })
ok('the bundle builds', b.status === 0, b.out)

/* every file a host would serve, and the compiled content the bundle is made from */
const files = []
const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(html|js|mjs|json|css|txt|xml|map|webmanifest|svg)$/.test(e.name)) files.push(p) } }
walk(path.join(WORK, 'dist')); walk(path.join(WORK, '.velite')); walk(path.join(WORK, 'public'))
ok('there is output to search', files.length > 20, String(files.length))
const leaks = {}
for (const f of files) { const t = fs.readFileSync(f, 'utf8'); for (const [n, s] of Object.entries(planted)) if (t.includes(s)) (leaks[n] ||= []).push(path.relative(WORK, f)) }
ok('no server secret in any published file', !Object.keys(leaks).length, Object.entries(leaks).map(([n, fs_]) => `${n}: ${fs_.slice(0, 3).join(', ')}`).join('\n'))

fs.rmSync(WORK, { recursive: true, force: true })
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (${names.length} secrets planted, none published)`)
process.exit(fail ? 1 : 0)
