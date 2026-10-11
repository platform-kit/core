/*
 * A SITE'S OWN MODULE IS A MODULE — the extension model, proved against a site that uses it.
 *
 * Everything else about modules is checked against the kit's own twenty-four, which cannot answer
 * the question a developer asks first: can I add a feature of mine, or am I limited to switching
 * yours on and off? A model that only ever runs its author's own modules is a model that has not
 * been tried.
 *
 * So `sites/demo` registers `stockists` — a module the kit has never heard of, declared in the
 * site's own tree, with a route, a build step, an environment variable and a dependency on
 * `articles`. It is deliberately a feature nobody wants: a fixture built on something the kit
 * already knows would pass on the kit's own plumbing rather than on the extension model.
 *
 * WHAT IS ASSERTED, in both directions, because a switch that removes nothing and a switch that
 * removes too much are both broken:
 *
 *   ON    its manifest resolves beside the kit's, it has an answer for all three shapes, its step
 *         runs, and the deploy asks for its variable naming the step that reads it.
 *   OFF   its step stops, its variable stops being asked for, its route is dropped before the
 *         bundle — and NOTHING OF THE KIT'S MOVES, which is the half that catches a site's module
 *         reaching into the kit's business.
 *   AND   switching off a module it declares it needs is refused by name, with the reason the
 *         manifest gave, not a generic one.
 *
 * No stack and no browser: this is arithmetic over the real fixture, the real steps and the real
 * deploy check. The route ACTUALLY answering is the static lane's job (sites/demo builds with
 * no backend), and the page was rendered and looked at in both themes and at phone width.
 *
 *   node packages/kit/build/site-module.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL ' + name + '\n    ' + String(e.message || e).split('\n').slice(0, 4).join('\n    ')) } }

console.log('\nA SITE’S OWN MODULE\n')

/* the fixture lives beside the kit, in the workspace — found from the kit rather than from cwd,
   since this runs in whatever site's root the suite was started in */
const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../../../sites/demo')
if (!existsSync(path.join(ROOT, 'platformkit.config.js'))) {
  console.log('  ⚠ SKIPPED — sites/demo is not in this checkout\n    A SITE’S OWN MODULE is NOT covered by this run.\n')
  process.exit(0)
}

const { loadSite, deploymentShape } = await import('./site.mjs')
const { loadSteps, whyOff, moduleSet, needsOf } = await import('./steps.mjs')
const { checkDeploy, surfaces } = await import('./deploy-checks.mjs')
const { unmetRequirements, SHAPES } = await import('./modules/manifest.mjs')
const KIT_KEYS = (await import('./modules/kit.mjs')).MODULES.map((m) => m.key)

const site = await loadSite(ROOT)
const steps = await loadSteps(site)
const MODULES = await moduleSet(site)
const S = surfaces(ROOT)
/* a fixed environment, so the only thing that varies between passes is the switch */
const ENV = { VITE_APP_URL: 'https://stockistshouse.example.com' }
const SHAPE = deploymentShape(site, ENV, null)

const withStockists = (on) => ({ ...site.modules, stockists: on })
const stepsOn = (modules) => steps.filter((x) => whyOff(x, { ...site, modules }, ENV, null) === null).map((x) => x.key)
const asks = (modules) => {
  const r = checkDeploy(ENV, S, modules, needsOf(steps, { ...site, modules }, ENV, SHAPE), SHAPE, unmetRequirements(MODULES, modules), MODULES)
  return { missing: (r.missing || []).map((m) => m.key), wrong: r.wrong || [] }
}

/* ─── the fixture is what it claims to be, or everything below is vacuous ─── */

t('the fixture registers a module the kit does not ship', () => {
  assert.ok(!KIT_KEYS.includes('stockists'), 'the kit ships a module called stockists — the fixture is no longer testing the extension model')
  assert.ok(MODULES.has('stockists'), 'the site’s own module did not resolve at all')
})
t('it resolves beside the kit’s, not instead of them', () => {
  for (const k of KIT_KEYS) assert.ok(MODULES.has(k), `${k} was lost when the site’s module was added`)
  assert.equal(MODULES.size, KIT_KEYS.length + 1)
})
t('it answers for all three shapes, like any module', () => {
  const m = MODULES.get('stockists')
  for (const s of SHAPES) assert.notEqual(m[s], undefined, `no answer for ${s}`)
})
t('and it says in one line what it is', () => {
  assert.ok((MODULES.get('stockists').what || '').length > 8)
})

/* ─── ON ─── */

t('on: its step runs', () => {
  assert.ok(stepsOn(withStockists(true)).includes('stockists'), 'the site’s own step did not run with its module on')
})
t('on: the deploy asks for its variable, naming what reads it', () => {
  const r = asks(withStockists(true))
  assert.ok(r.missing.includes('STOCKISTS_DISTRIBUTOR'), `it asked for ${r.missing.join(', ') || 'nothing'}`)
})

/* ─── OFF ─── */

t('off: its step stops', () => {
  assert.ok(!stepsOn(withStockists(false)).includes('stockists'))
})
t('off: its variable stops being asked for', () => {
  assert.ok(!asks(withStockists(false)).missing.includes('STOCKISTS_DISTRIBUTOR'))
})
t('off: its route is dropped before the bundle, not guarded at runtime', () => {
  /* the same rule the plugin applies: a route whose module is off is not emitted at all, so the
     component is never shipped — checked here against the config the plugin reads */
  const kept = (site.routes || []).filter((r) => !r.module || withStockists(false)[r.module] !== false)
  assert.deepEqual(kept.map((r) => r.path), [], 'the stockists’s route survived its module being switched off')
  const keptOn = (site.routes || []).filter((r) => !r.module || withStockists(true)[r.module] !== false)
  assert.deepEqual(keptOn.map((r) => r.path), ['/stockists'], 'and with it on the route should be there')
})

/*
 * OFF: AND NOTHING OF THE KIT'S MOVES. This is the half that catches a site's module reaching into
 * the kit's business — a step it should not have claimed, a variable it should not have caused.
 */
t('off: not one of the kit’s steps changes', () => {
  const before = stepsOn(withStockists(true)).filter((k) => k !== 'stockists')
  const after = stepsOn(withStockists(false))
  assert.deepEqual(after, before, 'switching the site’s own module off moved one of the kit’s steps')
})
t('off: the deploy asks for exactly what it did, less the stockists’s own', () => {
  const before = asks(withStockists(true))
  const after = asks(withStockists(false))
  assert.deepEqual(after.missing, before.missing.filter((k) => k !== 'STOCKISTS_DISTRIBUTOR'))
  assert.deepEqual(after.wrong, before.wrong)
})

/* ─── what it declares it needs ─── */

t('a module it needs, switched off, is refused BY NAME and with its own reason', () => {
  const mods = { ...site.modules, books: false }
  const r = checkDeploy(ENV, S, mods, [], SHAPE, unmetRequirements(MODULES, mods), MODULES)
  const said = (r.wrong || []).find((w) => /stockists/.test(w) && /books/.test(w))
  assert.ok(said, `it was not refused: ${(r.wrong || []).join(' | ') || 'nothing was wrong'}`)
  assert.ok(/nothing for a shop to stock/.test(said), `the refusal did not carry the manifest’s own reason: ${said}`)
})
t('and with both on, nothing is said about the pair', () => {
  const r = checkDeploy(ENV, S, withStockists(true), [], SHAPE, unmetRequirements(MODULES, withStockists(true)), MODULES)
  assert.deepEqual((r.wrong || []).filter((w) => /stockists/.test(w)), [])
})

console.log(bad ? `\nsite module: ${n - bad} passed, ${bad} failed\n` : `\nsite module: ${n} passed, 0 failed\n`)
process.exit(bad ? 1 : 0)
