/*
 * The build steps, pinned: the kit's records load with unique keys and valid phases; a phase is ordered by
 * `after` with the declaration's order kept between unrelated steps; a cycle, an unknown `after`, one in another
 * phase and a duplicate key are refused; `module` and `when` switch a step off with its reason; a site's step
 * from a fixture config is merged and ordered among the kit's; the needs of the on steps are collected and a
 * missing variable, tool or package is named with its step; a failing step stops the phase naming itself; a
 * change list runs only the steps whose inputs matched. `npm test` runs it.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import * as fsMod from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadSteps, order, whyOff, isOn, needsOf, missingNeeds, runPhase, resolvable, PHASES, listing } from './steps.mjs'
import { STEPS } from './steps/index.mjs'
/* the theme resolves from a site's root: a fixture site links the node_modules that holds it, wherever the test runs from (a site's folder in the workspace has none of its own) */
const NM = (() => { const { existsSync } = fsMod; let d = path.dirname(new URL(import.meta.url).pathname); while (!existsSync(path.join(d, 'node_modules', 'platformkit')) && d !== path.dirname(d)) d = path.dirname(d); return path.join(d, 'node_modules') })()

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 3).join('\n    ')) } }
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 3).join('\n    ')) } }
const norm = (s) => ({ title: s.key, after: [], inputs: [], needs: { env: [], tools: [], packages: [] }, ...s })
const site = { root: process.cwd(), modules: {} }

/* the count is pinned on purpose: a step quietly lost, or a key used twice, is a build that
   silently stops doing something. Adding one is meant to be a line in a diff. */
const KIT_STEPS = 40   /* + teams, teams-push: a team's declaration compiled, then projected; + courses-push */
t('the kit declares every step it should, keys unique, phases valid, run a function', () => {
  assert.equal(STEPS.length, KIT_STEPS)
  assert.equal(new Set(STEPS.map((s) => s.key)).size, KIT_STEPS)
  for (const s of STEPS) { assert.ok(PHASES.includes(s.phase), s.key); assert.equal(typeof s.run, 'function', s.key); assert.ok(s.title, s.key) }
  assert.ok(STEPS.find((s) => s.key === 'tts').needs.packages.includes('onnxruntime-node'))
})
t('every phase of the kit orders, and the order respects every after', () => {
  const all = STEPS.map(norm)
  for (const phase of PHASES) {
    const o = order(all, phase)
    for (const s of o) for (const a of s.after) assert.ok(o.findIndex((x) => x.key === a) < o.indexOf(s), `${s.key} after ${a}`)
  }
  assert.deepEqual(order(all, 'site').map((s) => s.key), ['rewrites', 'form-embed', 'support-sdk', 'comments-sdk', 'analytics-sdk', 'models-json', 'prerender'])
  assert.deepEqual(order(all, 'after').map((s) => s.key), ['auth-config', 'push-catalog', 'webhooks-push', 'spaces-push', 'teams-push', 'courses-push', 'events-push', 'comments-push', 'achievements-push', 'bots-push', 'search-push', 'funnels-run', 'tts'])
})
t('the declaration order is kept between unrelated steps; an edge moves a step only as far as it must', () => {
  const list = [{ key: 'a', phase: 'site' }, { key: 'b', phase: 'site', after: ['c'] }, { key: 'c', phase: 'site' }, { key: 'd', phase: 'site' }].map(norm)
  assert.deepEqual(order(list, 'site').map((s) => s.key), ['a', 'c', 'b', 'd'])
})
t('a cycle, an unknown after, one in another phase, are refused naming the steps', () => {
  assert.throws(() => order([{ key: 'a', phase: 'site', after: ['b'] }, { key: 'b', phase: 'site', after: ['a'] }].map(norm), 'site'), /cycle — a → b → a|cycle/)
  assert.throws(() => order([{ key: 'a', phase: 'site', after: ['zz'] }].map(norm), 'site'), /step a: after names "zz"/)
  assert.throws(() => order([{ key: 'a', phase: 'site', after: ['b'] }, { key: 'b', phase: 'after' }].map(norm), 'site'), /another phase/)
})
t('module and when switch a step off, with the reason', () => {
  const s = norm({ key: 'x', phase: 'site', module: 'tts', when: (env) => env.TTS === '1', whenText: 'TTS is not 1' })
  assert.equal(whyOff(s, { modules: { tts: false } }, { TTS: '1' }), 'the tts module is off')
  assert.equal(whyOff(s, { modules: {} }, {}), 'TTS is not 1')
  assert.equal(whyOff(s, { modules: {} }, { TTS: '1' }), null)
  assert.ok(isOn(norm({ key: 'y', phase: 'site' }), { modules: {} }, {}))
})
t('catalog push follows the selected payment provider and its declared capability', () => {
  const step = STEPS.find((item) => item.key === 'push-catalog')
  assert.equal(step.when({ STRIPE_SECRET_KEY: 'sk_live_x' }, {}), true)
  assert.equal(step.when({}, {}), false)
  assert.equal(step.when({}, {
    payments: { provider: 'site-mock' },
    _paymentProviderRegistrations: [{ id: 'site-mock', capabilities: ['checkout.one-time'] }],
  }), false)
  assert.equal(step.when({}, {
    payments: { provider: 'site-catalog' },
    _paymentProviderRegistrations: [{ id: 'site-catalog', capabilities: ['catalog.sync'] }],
  }), true)
})
ta('print generation is opt-in and its off step is not run or asked for build-only needs', async () => {
  const step = norm(STEPS.find((s) => s.key === 'print'))
  assert.equal(whyOff(step, site, {}), 'PRINT_BUILD is not 1')
  assert.equal(whyOff(step, site, { PRINT_BUILD: '0' }), 'PRINT_BUILD is not 1')
  assert.equal(whyOff(step, site, { PRINT_BUILD: '1' }), null)
  assert.deepEqual(needsOf([step], site, {}), [])
  assert.deepEqual(needsOf([step], site, { PRINT_BUILD: '1' }).map((x) => x.step.key), ['print'])
  const { lines } = await listing(site, {}, { root: process.cwd() })
  assert.ok(lines.some((line) => line.includes('print') && line.includes('off — PRINT_BUILD is not 1')))
  assert.deepEqual(await runPhase('functions', { site, env: {}, only: ['print'], log: () => {} }), [])
})
t('the needs of the on steps, and what is missing named with its step', () => {
  const steps = [norm({ key: 'a', phase: 'after', needs: { env: ['ZZ_UNSET_VAR'], tools: ['no-such-tool-zz'], packages: ['no-such-package-zz', 'gray-matter'] } }), norm({ key: 'b', phase: 'after', module: 'tts', needs: { env: ['ALSO_UNSET'] } })]
  const needs = needsOf(steps, { modules: { tts: false } }, {})
  assert.deepEqual(needs.map((x) => x.step.key), ['a'])
  const miss = missingNeeds(needs, {}, process.cwd())
  assert.deepEqual(miss.map((m) => m.kind + ':' + m.name), ['env:ZZ_UNSET_VAR', 'tool:no-such-tool-zz', 'package:no-such-package-zz'])
  assert.ok(miss.every((m) => m.step.key === 'a'))
  assert.deepEqual(missingNeeds(needs, { ZZ_UNSET_VAR: 'x' }, process.cwd(), ['env']), [])
  assert.ok(resolvable('gray-matter', process.cwd()) && !resolvable('no-such-package-zz', process.cwd()))
})
await ta('a site step from a config is merged and ordered among the kit\'s; a duplicate key is refused', async () => {
  const d = mkdtempSync(path.join(tmpdir(), 'steps-'))
  mkdirSync(path.join(d, 'build'), { recursive: true })
  writeFileSync(path.join(d, 'build', 'mine.mjs'), `export default { key: 'mine', title: 'Mine', phase: 'site', after: ['form-embed'], run: () => {} }\n`)
  writeFileSync(path.join(d, 'build', 'dup.mjs'), `export default { key: 'prerender', title: 'Dup', phase: 'site', run: () => {} }\n`)
  const cfg = { root: d, modules: {}, theme: 'platformkit/theme', build: { steps: ['./build/mine.mjs'] } }
  writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { 'platformkit/theme': '*' } }))
  /* the theme resolves from the site's root: link the workspace's node_modules */
  const { symlinkSync } = await import('node:fs'); symlinkSync(NM, path.join(d, 'node_modules'))
  const steps = await loadSteps(cfg)
  assert.equal(steps.length, KIT_STEPS + 1)
  const o = order(steps, 'site').map((s) => s.key)
  assert.ok(o.indexOf('form-embed') < o.indexOf('mine') && o.includes('prerender'))
  assert.equal(steps.find((s) => s.key === 'mine').from, 'the site (./build/mine.mjs)')
  const providerFixture = {
    ...cfg,
    payments: { provider: 'site-mock' },
    build: { modules: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/site-payment-provider/module.mjs')] },
  }
  await loadSteps(providerFixture)
  assert.ok(providerFixture._paymentProviderRegistrations.some((provider) => provider.id === 'site-mock'))
  await assert.rejects(() => loadSteps({ ...cfg, build: { steps: ['./build/dup.mjs'] } }), /step prerender is already declared by the kit/)
  rmSync(d, { recursive: true, force: true })
})
await ta('a failing step stops the phase naming itself; a change list runs the matching steps only', async () => {
  const log = []
  const mk = (key, fn, inputs = []) => norm({ key, phase: 'site', inputs, run: fn })
  const ran = []
  const steps = [mk('one', () => ran.push('one')), mk('two', () => { throw new Error('boom') }), mk('three', () => ran.push('three'))]
  /* runPhase loads the kit's steps itself; the fixture goes through the same order/run path via a stub site with these as its own */
  const { runPhase: rp } = await import('./steps.mjs')
  const d = mkdtempSync(path.join(tmpdir(), 'steps-'))
  mkdirSync(path.join(d, 'build'), { recursive: true })
  writeFileSync(path.join(d, 'build', 's.mjs'), `globalThis.__ran = []\nexport default [\n { key: 'one', title: 'One', phase: 'site', after: ['prerender'], inputs: ['content/a/**'], run: () => globalThis.__ran.push('one') },\n { key: 'two', title: 'Two', phase: 'site', after: ['one'], run: () => { throw new Error('boom') } },\n { key: 'three', title: 'Three', phase: 'site', after: ['two'], run: () => globalThis.__ran.push('three') },\n { key: 'local-projection', title: 'Local projection', phase: 'after', localProjection: true, inputs: ['content/a/**'], run: () => globalThis.__ran.push('local') },\n { key: 'remote-projection', title: 'Remote projection', phase: 'after', inputs: ['content/a/**'], run: () => globalThis.__ran.push('remote') },\n]\n`)
  for (const k of ['one', 'two', 'three', 'local-projection', 'remote-projection']) writeFileSync(path.join(d, 'build', k + '.mjs'), `import all from './s.mjs'\nexport default all.find((s) => s.key === '${k}')\n`)
  writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'fixture' }))
  const { symlinkSync } = await import('node:fs'); symlinkSync(NM, path.join(d, 'node_modules'))
  const cfg = { root: d, modules: { forms: false, models: false }, theme: 'platformkit/theme', build: { steps: ['./build/one.mjs', './build/two.mjs', './build/three.mjs', './build/local-projection.mjs', './build/remote-projection.mjs'] } }
  /* prerender (the kit's) would run first in this phase: keep it out by a change list that matches only the fixture's `one` */
  const got = await rp('site', { site: cfg, changed: ['content/a/x.md'], log: (m) => log.push(m) })
  assert.deepEqual(got, ['one'])
  assert.deepEqual(globalThis.__ran, ['one'])
  assert.equal((await loadSteps(cfg)).length, KIT_STEPS + 5)
  const projected = await rp('after', {
    site: cfg,
    only: ['local-projection', 'remote-projection'],
    changed: ['content/a/nested/file.md'],
    localProjectionOnly: true,
    log: (m) => log.push(m),
  })
  assert.deepEqual(projected, ['local-projection'])
  assert.deepEqual(globalThis.__ran, ['one', 'local'])
  /* every step: prerender runs the real script — so only the three, by `only` */
  await assert.rejects(() => rp('site', { site: cfg, only: ['one', 'two', 'three'], log: (m) => log.push(m) }), /step two \(Two\) failed: boom/)
  assert.deepEqual(globalThis.__ran, ['one', 'local', 'one'])
  rmSync(d, { recursive: true, force: true })
})

/* ---- the data the functions import is made, not committed ---------------------------------- */
{
  const { BUILT, BUILT_PATHS } = await import('./assemble.mjs')
  const fsx = await import('node:fs')
  const cp = await import('node:child_process')

  /* the two lists are one list: the regex assemble matches on, written out so it can be walked */
  t('every path assemble is told to keep is one it recognises', () => {
    const unmatched = BUILT_PATHS.filter((x) => !BUILT.test(x))
    if (unmatched.length) throw new Error(unmatched.join(', '))
  })

  /* every one exists — on a fresh clone this is the real test, since npm test makes them first
     and nothing else would have */
  t('and build/functions-data.mjs made every one of them', () => {
    const absent = BUILT_PATHS.filter((x) => !fsx.existsSync('supabase/' + x))
    if (absent.length) throw new Error(absent.join(', ') + ' — add the step that writes it to DATA_STEPS in build/functions-data.mjs')
  })

  /* and none of them is in git: a generated file in history is a second source of truth, and two
     of these drifted from the content before they were taken out of it */
  t('and none of them is committed', () => {
    const tracked = BUILT_PATHS.filter((x) => cp.spawnSync('git', ['ls-files', '--error-unmatch', 'supabase/' + x], { stdio: 'ignore' }).status === 0)
    if (tracked.length) throw new Error(tracked.join(', ') + ' — add it to .gitignore and git rm --cached it')
  })
}

  await ta('the funnels step waits for its generated function artefact', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'platformkit-funnels-step-'))
    try {
      mkdirSync(path.join(root, 'content/funnels'), { recursive: true })
      mkdirSync(path.join(root, 'content/blasts'), { recursive: true })
      const stepUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'steps/funnels.mjs')).href
      const script = `
        import { existsSync, readFileSync } from 'node:fs'
        import step from ${JSON.stringify(stepUrl)}
        await step.run()
        const file = 'supabase/functions/_shared/emails/funnels.json'
        if (!existsSync(file)) throw new Error('funnels step returned before writing its required function artefact')
        JSON.parse(readFileSync(file, 'utf8'))
      `
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { cwd: root, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr || result.stdout)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  console.log(`${bad ? '✖' : '✔'} steps: ${n - bad}/${n} checks`)
  if (bad) process.exit(1)
