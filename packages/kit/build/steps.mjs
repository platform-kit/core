/*
 * The build steps — every piece of work the build does beyond compiling the content and the bundle, as
 * records the runner reads: the kit's fifteen (build/steps/), a theme's (`steps` in its manifest) and a
 * site's (platformkit.config.js build.steps), each { key, title, phase, after, module, when, inputs,
 * needs, run }. Four phases: `prepare` after the content is compiled (dev, build, deploy); `functions`
 * what the functions carry, before they are deployed; `site` the bundle and the pages; `after` once the
 * functions are live (deploy only). The runner orders a phase by `after`, keeps the declaration's order
 * otherwise, skips a step that is off (its module, its `when`) and can say why, runs each in turn and
 * stops at the first failure. It never skips a step on its own account: a step that can tell its work is
 * done (tts, print) says so itself. What a step needs — variables, tools on the path, packages resolvable
 * from the site — is what `platformkit steps --check`, `npm test` and deploy-checks ask for.
 *
 *   loadSteps(site)                      every record, keys unique, in declaration order (kit, theme, site)
 *   order(steps, phase)                  the phase's steps, by `after`
 *   isOn(step, site, env) / whyOff(...)  the module and the `when`
 *   needsOf(steps, site, env)            [{ step, env: [k], tools: [t], packages: [p] }] for the on steps
 *   missingNeeds(needs, env, root)       what is not there, each line naming the step
 *   runPhase(phase, { site, env, changed, only })   run them; throws on the first failure
 *   script(name, args, env, root)        a kit script spawned in the site's root (a step's `run` uses it)
 *
 *   node build/steps.mjs [--phase p] [--check]   the listing; --check exits 1 on a missing need
 *   node build/steps.mjs --run <phase>            the phase run in the site's root (platformkit build)
 *   node build/steps.mjs --only <key>             one step alone, whatever its phase (platformkit run <key>)
 */
import { spawnSync, execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import picomatch from 'picomatch'
import { loadSite } from './site.mjs'
import { loadTheme } from './theme.mjs'

export const PHASES = ['prepare', 'functions', 'site', 'after']
const KIT = (f) => fileURLToPath(new URL('./' + f, import.meta.url))

/* ---- the records ---- */
function check(s, from) {
  const at = `${from}: step ${s && s.key ? s.key : '(no key)'}`
  if (!s || typeof s !== 'object' || !s.key) throw new Error(`${from}: a step needs a key`)
  if (!PHASES.includes(s.phase)) throw new Error(`${at}: phase must be one of ${PHASES.join(', ')} (got "${s.phase}")`)
  if (typeof s.run !== 'function') throw new Error(`${at}: run must be a function`)
  if (s.localProjection !== undefined && typeof s.localProjection !== 'boolean') throw new Error(`${at}: localProjection must be boolean`)
  if (s.localProjection && s.phase !== 'after') throw new Error(`${at}: localProjection steps must use the after phase`)
  return { title: s.key, after: [], inputs: [], needs: {}, ...s, needs: { env: [], tools: [], packages: [], ...(s.needs || {}) }, from }
}
/*
 * THE MODULES THIS DEPLOYMENT HAS, read from the manifests. A step gated on `module: 'emials'`
 * is gated on a switch nobody can set: it runs always, while whoever wrote it believes it is off
 * for sites that switched the feature off. So the set is resolved and a step naming a module
 * outside it is refused at load, rather than quietly running for ever.
 */
export async function moduleSet(site) {
  const { MODULES } = await import('./modules/kit.mjs')
  const { readManifests } = await import('./modules/manifest.mjs')
  const theme = await loadTheme(site)
  const extra = []
  /* a site may register its own, named in platformkit.config.js */
  for (const m of (site && site.build && site.build.modules) || []) {
    const mod = await import(pathToFileURL(path.resolve(site.root, m)).href)
    for (const one of [].concat(mod.default || mod.MODULES || [])) extra.push({ manifest: one, where: `the site (${m})` })
  }
  if (theme.modules != null && !Array.isArray(theme.modules)) throw new Error(`theme ${theme.package}: modules must be a list of manifest file paths`)
  for (const m of theme.modules || []) {
    if (typeof m !== 'string' || !m.trim()) throw new Error(`theme ${theme.package}: each module entry must be a manifest file path`)
    const mod = await import(pathToFileURL(path.resolve(theme.src, m)).href)
    for (const one of [].concat(mod.default || mod.MODULES || [])) extra.push({ manifest: one, where: `the theme (${m})` })
  }
  const { modules, faults } = readManifests([...MODULES.map((m) => ({ manifest: m, where: 'the kit' })), ...extra])
  if (faults.length) throw new Error('the module manifests are wrong:\n  ' + faults.join('\n  '))
  return modules
}

export async function loadSteps(site) {
  const c = site || await loadSite()
  const out = [], seen = new Map()
  const add = (s, from) => { const r = check(s, from); if (seen.has(r.key)) throw new Error(`${from}: step ${r.key} is already declared by ${seen.get(r.key)}`); seen.set(r.key, from); out.push(r) }
  const { STEPS } = await import('./steps/index.mjs')
  for (const s of STEPS) add(s, 'the kit')
  const theme = await loadTheme(c)
  for (const m of theme.steps || []) add((await import(pathToFileURL(path.resolve(theme.src, m)).href)).default, `the theme (${m})`)
  for (const m of (c.build && c.build.steps) || []) add((await import(pathToFileURL(path.resolve(c.root, m)).href)).default, `the site (${m})`)
  /* a step gated on a module no manifest declares would run always — refused here, where the
     person who wrote it is looking, rather than discovered by its feature never switching off */
  const known = await moduleSet(c)
  const strange = out.filter((s) => s.module && !known.has(s.module))
  if (strange.length) throw new Error('a build step is gated on a module no manifest declares:\n  ' + strange.map((s) => `${s.key} → ${s.module} (${s.from})`).join('\n  '))
  return out
}

/* ---- on or off ---- */

/*
 * DOES THIS STEP NEED A BACKEND? A static site has none, so a step that writes to a database, pushes
 * secrets or fills the functions tree has nowhere to put its work and must not run — and a step
 * added later must not silently break that shape, which is why this is inferred rather than listed.
 *
 * The inference is a step's own declared needs: anything asking for a Supabase key is asking for a
 * backend. A step where that reads wrong says so outright with `backend: true | false` — a guard
 * that guesses and cannot be corrected is a guard people route around.
 */
const BACKEND_ENV = /^SUPABASE_|^PLATFORMKIT_SHADOW_DB_URL$/
export const stepNeedsBackend = (s) =>
  typeof s.backend === 'boolean' ? s.backend : (s.needs && s.needs.env || []).some((k) => BACKEND_ENV.test(k))

export function whyOff(s, site, env = process.env, shape = null) {
  if (s.module && site.modules && site.modules[s.module] === false) return `the ${s.module} module is off`
  if (shape && shape.backend === false && stepNeedsBackend(s)) return 'this site has no backend'
  if (typeof s.when === 'function') { const w = s.when(env, site); if (!w) return s.whenText || 'its condition does not hold'; }
  return null
}
export const isOn = (s, site, env, shape = null) => whyOff(s, site, env, shape) === null

/* ---- the order: the declaration's, then every `after` respected (a stable topological sort) ---- */
export function order(steps, phase) {
  const list = steps.filter((s) => s.phase === phase)
  const keys = new Set(steps.map((s) => s.key))
  for (const s of list) for (const a of s.after) { if (!keys.has(a)) throw new Error(`step ${s.key}: after names "${a}", which no step declares`); if (!list.some((x) => x.key === a)) throw new Error(`step ${s.key}: after names "${a}", which is in another phase`) }
  const out = [], done = new Set(), visiting = new Set()
  const visit = (s, trail) => {
    if (done.has(s.key)) return
    if (visiting.has(s.key)) throw new Error(`steps: a cycle — ${[...trail, s.key].join(' → ')}`)
    visiting.add(s.key)
    for (const a of s.after) visit(list.find((x) => x.key === a), [...trail, s.key])
    visiting.delete(s.key); done.add(s.key); out.push(s)
  }
  for (const s of list) visit(s, [])
  return out
}

/* ---- the needs ---- */
export function needsOf(steps, site, env = process.env, shape = null) {
  /* THE SHAPE, or the deploy asks for what a step that will never run would have needed. A static
     site was told to provide SUPABASE_SERVICE_ROLE_KEY six times over, once for each projection
     step that is off in that shape — the gate was on runPhase and not here, and the two have to
     agree or the checks refuse a deploy that would have worked. */
  return steps.filter((s) => isOn(s, site, env, shape)).map((s) => ({ step: s, env: s.needs.env, tools: s.needs.tools, packages: s.needs.packages }))
}
const onPath = (tool) => { try { execSync((process.platform === 'win32' ? 'where ' : 'command -v ') + tool, { stdio: 'ignore', shell: true }); return true } catch { return false } }
export const resolvable = (pkg, root) => { const from = path.resolve(root, 'package.json'); try { createRequire(from).resolve(pkg + '/package.json'); return true } catch { try { createRequire(from).resolve(pkg); return true } catch { return false } } }
/* what is not there: [{ step, kind: env | tool | package, name }] — a variable unset, a tool off the path, a package no import from the site's root would find */
export function missingNeeds(needs, env = process.env, root = process.cwd(), kinds = ['env', 'tool', 'package']) {
  const out = []
  for (const n of needs) {
    if (kinds.includes('env')) for (const k of n.env) if (!String(env[k] ?? '').trim()) out.push({ step: n.step, kind: 'env', name: k })
    if (kinds.includes('tool')) for (const t of n.tools) if (!onPath(t)) out.push({ step: n.step, kind: 'tool', name: t })
    if (kinds.includes('package')) for (const p of n.packages) if (!resolvable(p, root)) out.push({ step: n.step, kind: 'package', name: p })
  }
  return out
}

/* ---- running ---- */
export function script(name, args = [], env = process.env, root = process.cwd()) {
  const r = spawnSync(process.execPath, [KIT(name), ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.status !== 0) throw new Error(`${name} exited ${r.status}`)
  return true
}
export async function runPhase(phase, { site, env = process.env, changed = null, only = null, dev = false, shape = null, localProjectionOnly = false, log = console.log } = {}) {
  const c = site || await loadSite()
  const steps = await loadSteps(c)
  const ran = []
  for (const s of order(steps, phase)) {
    if (!isOn(s, c, env, shape)) continue
    if (only && !only.includes(s.key)) continue
    if (localProjectionOnly && s.localProjection !== true) continue
    /* a change list (the dev watcher): only a step whose inputs matched a changed file runs; one with no inputs waits for a full run */
    if (changed && !(s.inputs.length && changed.some((f) => picomatch(s.inputs, { dot: true })(f)))) continue
    log(`› ${s.title}`)
    try { await s.run({ site: c, env, changed, dev, log, script: (n, a) => script(n, a, env, c.root) }) }
    catch (e) { throw new Error(`step ${s.key} (${s.title}) failed: ${e && e.message ? e.message : e}`, { cause: e }) }
    ran.push(s.key)
  }
  return ran
}

/* ---- the listing ---- */
export async function listing(site, env = process.env, { root } = {}) {
  const c = site || await loadSite()
  const steps = await loadSteps(c)
  const lines = []
  for (const phase of PHASES) for (const s of order(steps, phase)) {
    const off = whyOff(s, c, env)
    const need = [...s.needs.env, ...s.needs.tools.map((t) => t + ' (tool)'), ...s.needs.packages.map((p) => p + ' (package)')]
    lines.push(`  ${phase.padEnd(9)} ${s.key.padEnd(20)} ${off ? 'off — ' + off : 'on'}${s.after.length ? `  after ${s.after.join(', ')}` : ''}${need.length ? `  needs ${need.join(', ')}` : ''}${s.from === 'the kit' ? '' : `  (${s.from})`}`)
  }
  /* the listing checks what the site can know here — its tools and packages; the variables are the deploy's environment, and deploy-checks asks for those */
  const missing = missingNeeds(needsOf(steps, c, env), env, root || c.root, ['tool', 'package'])
  return { lines, missing }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const args = process.argv.slice(2)
  const c = await loadSite()
  if (args.includes('--run')) {
    const phase = args[args.indexOf('--run') + 1]
    if (!PHASES.includes(phase)) { console.error(`✖ steps: --run takes a phase (${PHASES.join(', ')})`); process.exit(2) }
    try { await runPhase(phase, { site: c }) } catch (e) { console.error('✖ ' + e.message); process.exit(1) }
    process.exit(0)
  }
  if (args.includes('--only')) {
    const key = args[args.indexOf('--only') + 1]
    const steps = await loadSteps(c)
    const s = steps.find((x) => x.key === key)
    if (!s) { console.error(`✖ steps: no step "${key}" — ${steps.map((x) => x.key).join(', ')}`); process.exit(2) }
    const off = whyOff(s, c)
    if (off) { console.error(`✖ steps: ${s.title} is off — ${off}`); process.exit(1) }
    try { await runPhase(s.phase, { site: c, only: [key] }) } catch (e) { console.error('✖ ' + e.message); process.exit(1) }
    process.exit(0)
  }
  const { lines, missing } = await listing(c)
  const phase = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : null
  console.log(lines.filter((l) => !phase || l.trim().startsWith(phase)).join('\n'))
  if (missing.length) {
    console.error('✖ steps: ' + missing.map((m) => `${m.step.title}: ${m.kind === 'env' ? m.name + ' is unset' : m.kind === 'tool' ? m.name + ' is not on the path' : m.name + ' is not installed (npm install ' + m.name + ' in the site)'}`).join('\n  '))
    if (args.includes('--check')) process.exit(1)
  } else console.log(`✔ steps: ${lines.length} step(s); every tool and package the on steps need is here`)
}
