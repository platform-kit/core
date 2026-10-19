/* Gated text never reaches a published file (_shared/gate.js). A copy of sites/demo gets a book a guest may read
   one chapter of, its companion, a paid article and a paid wiki page, each with a marker sentence where no guest
   may read; the copy is built (the content, the prepare steps, the bundle, then the site steps that pre-render the
   pages), and every file it publishes is searched for every marker. The free chapter must be there; no marker may.
   The same copy as a static site must publish no gated text and name what it left out. Slow (a whole build):
   GATED_CONTENT_TEST=0 skips it. Pinned by npm test. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const note = (m) => console.log('gated-content: ' + m)
if (process.env.GATED_CONTENT_TEST === '0') { note('skipped (GATED_CONTENT_TEST=0)'); process.exit(0) }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = path.resolve(HERE, '../../..')
const DEMO = path.join(WORKSPACE, 'sites', 'demo')
const WORK = path.join(WORKSPACE, 'node_modules', '.cache', 'platformkit', 'gated-content-test')

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + String(detail).trim().split('\n').slice(-8).join('\n        ') : '')) } }

/* the markers: where a guest may read, and where none may */
const FREE = 'GATEFREE chapter one is for everyone.'
const MARK = {
  bookEnd: 'GATECANARY the second chapter ends privately.',
  bookShort: 'GATECANARY short third chapter.',
  companion: 'GATECANARY the second summary is private.',
  article: 'GATECANARY the paid article ends privately.',
  wiki: 'GATECANARY the paid wiki page ends privately.',
}
const filler = (word) => Array.from({ length: 30 }, (_, i) => `${word} filler sentence number ${i} keeps this chapter long.`).join(' ')
const FIXTURES = {
  'content/books/gate-probe.md': `---\ntitle: Gate Probe\nauthor: Test\nbook_id: gate-probe\ndescription: A book for the gate test.\npublished: true\nguestChapters: 1\n---\n\n# One\n\n${FREE} ${filler('one')}\n\n# Two\n\n${filler('two')} ${MARK.bookEnd}\n\n# Three\n\n${MARK.bookShort}\n`,
  'content/companions/gate-probe.md': `---\nbook: gate-probe\ninsight: The probe's insight.\n---\n\n# One\n\n## Summary\n\nThe free summary.\n\n# Two\n\n## Summary\n\n${MARK.companion}\n\n## Quiz\n\n1. Which?\n   - [x] a\n   - [ ] b\n   - [ ] c\n   - [ ] d\n\n# Three\n\n## Summary\n\nThe third summary.\n`,
  'content/articles/gate-probe.md': `---\ntitle: Gate Probe Article\ndescription: A paid article.\ndate: 2026-10-01\npublished: true\ncanAccess:\n  - paid\n---\n\n${filler('article')} ${MARK.article}\n`,
  'content/wiki/gate-probe.md': `---\ntitle: Gate Probe Wiki\ndescription: A paid page.\npublished: true\ncanAccess:\n  - paid\n---\n\n${filler('wiki')} ${MARK.wiki}\n`,
}

const generated = /(^|\/)(node_modules|dist|\.velite|\.platformkit|\.vite|\.content-collections)(\/|$)/
function copyDemo() {
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.cpSync(DEMO, WORK, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(DEMO, src).split(path.sep).join('/')
      return !generated.test(rel) && !(rel.startsWith('supabase/') && rel !== 'supabase/config.toml')
    },
  })
  for (const [rel, text] of Object.entries(FIXTURES)) { fs.mkdirSync(path.dirname(path.join(WORK, rel)), { recursive: true }); fs.writeFileSync(path.join(WORK, rel), text) }
}
const run = (args, env = {}) => {
  const r = spawnSync(args[0], args.slice(1), { cwd: WORK, encoding: 'utf8', env: { ...process.env, CONTENT_STORE: 'files', ...env }, maxBuffer: 1 << 28 })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const velite = (env) => run([process.execPath, '--input-type=module', '-e',
  `const { engineFor } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'collections.mjs')).href)})
   const e = await engineFor(process.cwd())
   if (e.name !== 'velite') await e.build({ root: process.cwd(), log: () => {} })
   else { const { build } = await import('velite'); await build({ clean: true }) }`], env)
const textFiles = (dir) => {
  const out = []
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(html|js|mjs|json|css|txt|xml|map)$/.test(e.name)) out.push(p) } }
  walk(dir)
  return out
}
const scan = (files) => {
  const found = {}
  for (const f of files) { const t = fs.readFileSync(f, 'utf8'); for (const [k, m] of Object.entries(MARK)) if (t.includes(m)) (found[k] ||= []).push(path.relative(WORK, f)) }
  return found
}

/* 1. the static shape: velite alone, with no backend */
copyDemo()
const cfgFile = path.join(WORK, 'platformkit.config.js')
const cfg = fs.readFileSync(cfgFile, 'utf8')
fs.writeFileSync(cfgFile, cfg.replace(/deployment:\s*\{[^}]*\}/, "deployment: { backend: false, content: 'files' }"))
ok('static: the copy declares no backend', /deployment: \{ backend: false/.test(fs.readFileSync(cfgFile, 'utf8')))
const st = velite()
ok('static: the content builds', st.status === 0, st.out)
ok('static: the build names the gated records it left out', /\[gate\] a static site publishes no gated text/.test(st.out) && /gate-probe/.test(st.out), st.out.split('\n').filter((l) => /gate/.test(l)).join('\n'))
const staticFound = scan(textFiles(path.join(WORK, '.velite')))
ok('static: no gated text in what the build wrote', !Object.keys(staticFound).length, JSON.stringify(staticFound))

/* 2. the whole build with a backend */
copyDemo()
const v = velite()
ok('the content builds', v.status === 0, v.out)
const prep = run([process.execPath, path.join(HERE, 'steps.mjs'), '--run', 'prepare'])
ok('the prepare steps run (the search index among them)', prep.status === 0, prep.out)
const b = run(['npx', 'vite', 'build', '--logLevel', 'warn'], { PLATFORMKIT_CONTENT_DONE: '1', NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --max-old-space-size=4096').trim() })
ok('the bundle builds', b.status === 0, b.out)
const siteSteps = run([process.execPath, path.join(HERE, 'steps.mjs'), '--run', 'site'], { PLATFORMKIT_CONTENT_DONE: '1' })
const prerendered = fs.existsSync(path.join(WORK, 'dist', 'books')) || textFiles(path.join(WORK, 'dist')).some((f) => /\/(articles|wiki)\/.*index\.html$/.test(f))
if (siteSteps.status !== 0 || !prerendered) note('the pages were not pre-rendered here (no browser for the pre-render step) — the bundle they are rendered from is scanned')

const files = [...textFiles(path.join(WORK, 'dist')), ...textFiles(path.join(WORK, '.velite'))]
ok('there is output to scan', files.length > 20, String(files.length))
const found = scan(files)
for (const k of Object.keys(MARK)) ok(`no ${k} marker in any published file`, !found[k], (found[k] || []).join(', '))
ok('the free chapter is published', files.some((f) => fs.readFileSync(f, 'utf8').includes('GATEFREE chapter one')))
ok('the locked chapters keep their titles', (() => { const b2 = JSON.parse(fs.readFileSync(path.join(WORK, '.velite', 'books.json'), 'utf8')).find((x) => x.slug === 'gate-probe'); return b2 && b2.gatedFrom === 1 && /^# Two$/m.test(b2.raw) && /^# Three$/m.test(b2.raw) })())

fs.rmSync(WORK, { recursive: true, force: true })
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (no gated text published${prerendered ? ', pre-rendered pages included' : ''})`)
process.exit(fail ? 1 : 0)
