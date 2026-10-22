/*
 * PLATFORMKIT GENERATE (openspec: kit-generate). Every kind, at both levels, written into a copy and then held to the
 * same checks the real thing is: the site's config loads with the piece registered and every comment kept, its
 * steps, models, test and assembled functions; PlatformKit's coverage, manifest, deployment-shape and docs checks on
 * a copy of the workspace. And it never overwrites: a taken name, an existing file, a dry run, a core run outside a
 * checkout all leave the files as they were. The production build of a generated site was proved by hand
 * (verify.md) — it takes minutes, and every check here is what that build reads.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { generate, planFor, KINDS } from './generate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE = path.resolve(HERE, '../../..')
const DEMO = path.join(WORKSPACE, 'sites', 'demo')
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + String(detail).trim().split('\n').slice(-8).join('\n        ') : '')) } }
const node = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: process.env, timeout: 300000 })
const out = (r) => (r.stdout || '') + (r.stderr || '')
const hashDir = (dir) => { const h = crypto.createHash('sha256'); const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { h.update(path.relative(dir, f)); h.update(fs.readFileSync(f)) } } }; walk(dir); return h.digest('hex') }
const comments = (t) => t.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) || []

/* ─── the site level, on a copy of the demo (inside the workspace, so its packages resolve) ─── */
const SITE = path.join(WORKSPACE, 'node_modules', '.cache', 'platformkit', 'generate-test')
const generated = /(^|\/)(node_modules|dist|\.velite|\.platformkit|\.vite)(\/|$)/
fs.rmSync(SITE, { recursive: true, force: true })
fs.cpSync(DEMO, SITE, { recursive: true, filter: (src) => { const r = path.relative(DEMO, src).split(path.sep).join('/'); return !generated.test(r) && !(r.startsWith('supabase/') && r !== 'supabase/config.toml') } })
const cfgBefore = fs.readFileSync(path.join(SITE, 'platformkit.config.js'), 'utf8')

{
  const help = node([path.join(HERE, 'generate.mjs')], SITE)
  ok('no kind: it lists the kinds and writes nothing', help.status === 0 && KINDS.every((k) => out(help).includes(k)), out(help))

  for (const [kind, name, extra] of [['module', 'gift-cards'], ['page', 'gift-cards', { module: 'gift-cards' }], ['content-type', 'recipes'], ['function', 'hello-world'], ['test', 'sanity'], ['step', 'tally']]) {
    const r = await generate({ kind, name, siteRoot: SITE, ...(extra || {}) })
    ok(`site ${kind}: written and registered`, r.ok && !/by hand/.test(r.message), r.message)
  }
  const cfg = fs.readFileSync(path.join(SITE, 'platformkit.config.js'), 'utf8')
  ok('the config keeps every comment, in order', JSON.stringify(comments(cfg)) === JSON.stringify(comments(cfgBefore)))
  ok('…and every line it had', cfgBefore.split('\n').filter((l) => l.trim()).every((l) => cfg.includes(l.replace(/\]\s*,?\s*$/, '').trim().slice(0, 60))))

  const { loadSite } = await import('./site.mjs')
  const site = await loadSite(SITE)
  ok('the config loads with the module on', site.modules['gift-cards'] === true)
  const { moduleSet } = await import('./steps.mjs')
  ok('…and the module is a module', (await moduleSet(site)).has('gift-cards'))
  ok('the page is routed under its module', (site.routes || []).some((r) => r.path === '/gift-cards' && r.module === 'gift-cards'))
  const manifest = (await import(path.join(SITE, 'src', 'gift-cards', 'module.js') + '?fresh')).default   /* fresh: generating the page loaded it before its route was added */
  ok('…and the module owns its route', (manifest.owns.routes || []).includes('/gift-cards'))
  const { parse } = await import('@vue/compiler-sfc')
  ok('the page compiles', !parse(fs.readFileSync(path.join(SITE, 'src', 'gift-cards', 'GiftCardsPage.vue'), 'utf8')).errors.length)
  const { registry } = await import('./models/index.mjs')
  ok('the content type is a model the admin edits', (await registry(SITE, { site })).some((m) => m.key === 'recipes'))
  const steps = node([path.join(HERE, 'steps.mjs'), '--check'], SITE)
  ok('every step, the new one with them, passes the step check', steps.status === 0 && /tally/.test(node([path.join(HERE, 'steps.mjs')], SITE).stdout), out(steps))
  const sanity = node([path.join(SITE, 'build', 'sanity.test.mjs')], SITE)
  ok('the generated test runs and passes', sanity.status === 0, out(sanity))
  const asm = node([path.join(HERE, 'assemble.mjs')], SITE)
  ok('the function is assembled beside the kit\'s', asm.status === 0 && fs.existsSync(path.join(SITE, 'supabase', 'functions', 'hello-world', 'index.ts')), out(asm))
}

/* ─── never overwrites ─── */
{
  const before = hashDir(SITE)
  const taken = await generate({ kind: 'module', name: 'store', siteRoot: SITE })
  ok('a taken module name: refused by name', !taken.ok && /store already exists/.test(taken.message), taken.message)
  const again = await generate({ kind: 'test', name: 'sanity', siteRoot: SITE })
  ok('an existing file: refused, naming it', !again.ok && /sanity\.test\.mjs already exists/.test(again.message), again.message)
  const dry = await generate({ kind: 'page', name: 'about-us', siteRoot: SITE, dryRun: true })
  ok('a dry run lists what it would write', dry.ok && /AboutUsPage\.vue/.test(dry.message) && /routes \+=/.test(dry.message), dry.message)
  ok('…and nothing changed', hashDir(SITE) === before)
  const bad = await generate({ kind: 'widget', name: 'x', siteRoot: SITE })
  ok('an unknown kind names the kinds', !bad.ok && /No generator called widget/.test(bad.message))
}

/* ─── a site's own template ─── */
{
  const own = path.join(SITE, 'generators', 'page', 'src', '@@dir@@')
  fs.mkdirSync(own, { recursive: true })
  fs.writeFileSync(path.join(own, '@@Name@@Page.vue.tmpl'), '<template><main>site template @@name@@</main></template>\n')
  const r = await generate({ kind: 'page', name: 'press', siteRoot: SITE })
  ok('a site template replaces the kit\'s', r.ok && fs.readFileSync(path.join(SITE, 'src', 'press', 'PressPage.vue'), 'utf8').includes('site template press'), r.message)
}
fs.rmSync(SITE, { recursive: true, force: true })

/* ─── core outside a checkout ─── */
{
  const r = await planFor({ kind: 'module', name: 'loyalty', level: 'core', siteRoot: DEMO, kitRoot: '/srv/site/node_modules/platformkit' })
  ok('core where PlatformKit came from npm: refused, pointing at the site level', /isn't a PlatformKit checkout\. Leave it off/.test(r.refused || ''), JSON.stringify(r))
}

/* ─── the core level, on a copy of the workspace (its tracked and new files; the installed packages linked) ─── */
{
  const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-generate-'))
  try {
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: WORKSPACE, encoding: 'utf8' }).split('\n').filter((f) => f && !f.startsWith('sites/external/') && fs.existsSync(path.join(WORKSPACE, f)) && fs.statSync(path.join(WORKSPACE, f)).isFile())
    for (const f of files) { const to = path.join(WS, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(WORKSPACE, f), to) }
    for (const d of ['node_modules', 'packages/kit/node_modules', 'sites/demo/node_modules']) if (fs.existsSync(path.join(WORKSPACE, d))) fs.symlinkSync(path.join(WORKSPACE, d), path.join(WS, d))
    const KIT = path.join(WS, 'packages', 'kit'), DEMO2 = path.join(WS, 'sites', 'demo')
    const gen = path.join(KIT, 'build', 'generate.mjs')
    for (const args of [['module', 'loyalty'], ['page', 'loyalty', '--module', 'loyalty'], ['content-type', 'badges'], ['function', 'loyalty-points', '--module', 'loyalty'], ['test', 'loyalty-rules'], ['step', 'loyalty-tally']]) {
      const r = node([gen, ...args, '--level', 'core'], DEMO2)
      ok(`core ${args[0]}: written and registered`, r.status === 0 && /^Wrote /.test(out(r)) && !/by hand/.test(out(r)), out(r))
    }
    ok('core: the files are where PlatformKit keeps them', ['build/modules/kit.mjs', 'theme/src/pages/LoyaltyPage.vue', 'build/models/core/badges.mjs', 'supabase/functions/loyalty-points/index.ts', 'build/loyalty-rules.test.mjs', 'build/steps/loyalty-tally.mjs'].every((p) => fs.existsSync(path.join(KIT, p))) && /key: 'loyalty'/.test(fs.readFileSync(path.join(KIT, 'build/modules/kit.mjs'), 'utf8')))
    const cov = node([path.join(KIT, 'build', 'test-coverage.test.mjs')], WS)
    ok('core: the coverage checks pass (the new function is named by its test)', cov.status === 0, out(cov))
    node([path.join(KIT, 'build', 'assemble.mjs')], DEMO2)
    for (const t of ['manifests', 'modes']) { const r = node([path.join(KIT, 'build', `${t}.test.mjs`)], DEMO2); ok(`core: the ${t} checks pass`, r.status === 0, out(r)) }
    const docs = node([path.join(KIT, 'build', 'docs-check.mjs')], WS)
    ok('core: the docs check passes (every new file named by a page, the module and the strings scope listed)', docs.status === 0, out(docs))
    const { parse } = await import('@vue/compiler-sfc')
    ok('core: App.vue still compiles with the page wired in', !parse(fs.readFileSync(path.join(KIT, 'theme', 'src', 'App.vue'), 'utf8')).errors.length)
    const rules = node([path.join(KIT, 'build', 'loyalty-rules.test.mjs')], DEMO2)
    ok('core: the generated test runs and passes', rules.status === 0, out(rules).split('\n').slice(0, 6).join('\n') + '\n' + JSON.stringify(fs.readdirSync(path.join(KIT, 'build')).filter((f) => /loyalty/.test(f))))
  } finally { fs.rmSync(WS, { recursive: true, force: true }) }
}

console.log(fail ? `generate: ${fail} failed, ${pass} passed` : `generate: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
