/*
 * SWITCHING ONE MODULE OFF BREAKS NO OTHER — one module at a time, every module.
 *
 * The kit has twenty-four switches and three fixture sites, which between them prove three points
 * in a space of sixteen million. What nothing proved is the property anybody actually relies on
 * when they switch something off: that turning off the community, or the store, or the sessions,
 * takes that module away and touches nothing else.
 *
 * The switches are honoured by convention — `modules[m] !== false`, written out separately in the
 * router, in `steps.mjs`, in `deploy-checks.mjs` — and a convention repeated in several places is
 * one that holds until somebody writes the twenty-fifth. The way it breaks is never loud: a step
 * belonging to a module that is ON stops running because its `module:` key was mistyped as one
 * that is off; a secret is still demanded for a feature nobody has; a module claims a step that
 * is really another module's, and switching IT off takes the other one down with it.
 *
 * So: for each module in turn, everything else left exactly as the site has it, and two questions
 * asked of the result.
 *
 *   ITS OWN THINGS GO — its steps stop running, its secrets stop being demanded.
 *   NOTHING ELSE MOVES — every other module's steps run exactly as before, and the deploy asks
 *     for exactly the same things it asked for before, less the ones that were only this
 *     module's. A single step or secret that moves for an unrelated module is the whole fault.
 *
 * No stack, no browser: `whyOff` and `checkDeploy` both take the modules they are judging, so
 * this is arithmetic over the real step list and the real check.
 *
 *   node packages/kit/build/modules-off.test.mjs
 */
import assert from 'node:assert/strict'
import { loadSite } from './site.mjs'
import { loadSteps, whyOff } from './steps.mjs'
import { checkDeploy, surfaces } from './deploy-checks.mjs'
import { FEATURES } from './modes.mjs'

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 5).join('\n    ')) } }

console.log('\nONE MODULE OFF BREAKS NO OTHER\n')

const site = await loadSite(process.cwd())
const steps = await loadSteps(site)
/* the environment is fixed for every pass, so the only thing that varies is the switch */
const ENV = { ...process.env }

const on = (modules) => {
  const s = { ...site, modules }
  return steps.filter((x) => whyOff(x, s, ENV, null) === null).map((x) => x.key)
}
/* what the CONTENT switches on — the offers, the books in print, the sessions. It does not vary
   with the switches, so it is read once: the only thing changing between passes is the module. */
const SURFACES = surfaces(process.cwd())
const UNMET = await import('./modules/manifest.mjs')
const asks = (modules) => {
  const { unmetRequirements } = UNMET
  const r = checkDeploy(ENV, SURFACES, modules, [], null, unmetRequirements(MANIFESTS, modules))
  return [...(r.missing || []).map((m) => m.key), ...(r.wrong || [])].sort()
}

/* every module the kit knows, at the value this site has it at */
/*
 * THE COUPLINGS ARE THE MANIFESTS' NOW. This file used to carry its own list with the reason
 * written out here; a coupling lived in two places and agreed by hand. It reads what the modules
 * declare, so a coupling added later needs no edit to this file.
 */
const { MODULES } = await import('./modules/kit.mjs')
const { readManifests } = await import('./modules/manifest.mjs')
const MANIFESTS = readManifests(MODULES.map((m) => ({ manifest: m, where: 'the kit' }))).modules
/* keyed by the module being switched OFF — when forms goes, it is the instrument that complains,
   so the lookup is the reverse of the declaration */
const COUPLED = {}
for (const m of MANIFESTS.values()) for (const r of m.requires) (COUPLED[r.module] = COUPLED[r.module] || []).push({ dependent: m.key, why: r.why })

const KNOWN = Object.keys(FEATURES)
const HERE = KNOWN.filter((m) => (site.modules || {})[m] !== false)
if (!HERE.length) { console.log('  ⚠ SKIPPED — this site has every module off\n'); process.exit(0) }

const baseSteps = on(site.modules || {})
const baseAsks = asks(site.modules || {})
console.log(`  with the site as it is: ${baseSteps.length} step(s) run, ${baseAsks.length} thing(s) asked for\n`)

for (const m of HERE) {
  const modules = { ...(site.modules || {}), [m]: false }
  const nowSteps = on(modules)
  const nowAsks = asks(modules)

  /*
   * "Only its own steps stop" used to be asked here and could not fail. `whyOff` stops a step
   * exactly when its own module is off, and only one module is off per pass — so the stopped
   * set IS the set carrying that module, by construction. It read each step's `module` and then
   * asked whether the steps that stopped carried it: the attribution judging itself.
   * Mis-attributing the emails step to the spaces module passed it cleanly.
   *
   * What is checkable is that a step names a module somebody can set, and `loadSteps` refuses
   * one that does not — see build/manifests.test.mjs for the manifests' side of it.
   */
  t(`${m} off: no step starts that was not running`, () => {
    const started = nowSteps.filter((k) => !baseSteps.includes(k))
    assert.deepEqual(started, [], `switching off ${m} started ${started.join(', ')}`)
  })

  /* and the deploy asks for less, never for something new */
  t(`${m} off: the deploy asks for nothing it did not ask for before`, () => {
    let extra = nowAsks.filter((k) => !baseAsks.includes(k))
    /* a module something else declares it needs: the deploy SHOULD complain, naming the
       dependent, and that complaint is not "something moved for an unrelated module" */
    for (const c of COUPLED[m] || []) extra = extra.filter((k) => !String(k).includes(c.dependent))
    assert.deepEqual(extra, [], `switching off ${m} made the deploy demand ${extra.join(', ')}`)
  })
}

/*
 * The check that used to be here — every step gated on a module the kit knows — has moved into
 * `loadSteps` itself, which now REFUSES such a step rather than letting a run report it. It cannot
 * be asked here any more: the load throws before this file has a step list to look at. The
 * manifests' side of the same rule (a step naming a module that does not claim it) is pinned in
 * `build/manifests.test.mjs`.
 */

/*
 * AND THE OTHER DIRECTION, which is the one that rots quietly: a module switched off must
 * actually take something away. A switch that removes nothing is a switch somebody will trust and
 * a feature that is still running, still asking for its secrets, still shipping its code.
 */
const inert = []
for (const m of HERE) {
  const modules = { ...(site.modules || {}), [m]: false }
  /* only a module whose step is actually RUNNING can be expected to stop one. tts owns a step
     that is already off because TTS is not 1, and a switch cannot take away what is not there —
     counting that as inert was the test being imprecise, not the switch being broken. */
  const running = steps.filter((s) => s.module === m && baseSteps.includes(s.key))
  if (!running.length) continue
  if (on(modules).length === baseSteps.length) inert.push(m)
}
t('a module whose step is running stops it when switched off', () => {
  assert.deepEqual(inert, [], `${inert.join(', ')} have a step running but switching them off changed nothing — the switch is trusted and the feature is not off`)
})

/*
 * AND THE THIRD DIRECTION: a DECLARATION that asks for a module which is off.
 *
 * Most switches take a feature away and that is the end of it. Encryption cannot work that way. A
 * channel's file says `encrypted: true`; with the module off there is no schema to keep a key in
 * and no client to seal with, so the room would be served as plain text — looking sealed in the
 * repository and holding readable messages in the database. Nobody would be told. That is worse
 * than either a sealed room or an open one, so the compile refuses it and names both the module
 * and the file.
 */
{
  const fs = await import('node:fs'), os = await import('node:os'), pathm = await import('node:path')
  const { compileSpaces } = await import('./spaces.mjs')
  const { gitStore } = await import('./store/index.mjs')
  const root = fs.mkdtempSync(pathm.join(os.tmpdir(), 'enc-off-'))
  const put = (rel, body) => { fs.mkdirSync(pathm.dirname(pathm.join(root, rel)), { recursive: true }); fs.writeFileSync(pathm.join(root, rel), body) }
  put('content/spaces/guild.md', '---\nname: The Guild\nkind: community\n---\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\nencrypted: true\n---\n')
  put('content/spaces/guild/open.md', '---\nname: Open\n---\n')
  /* the compile writes its complaint to console.error and sets a non-zero exit code; both are
     caught here so one refusal does not end this run */
  const quiet = async (fn) => {
    const e = console.error, l = console.log; let said = ''
    console.error = (m) => { said += m }; console.log = () => {}
    try { const r = await fn(); return { r, said } } finally { console.error = e; console.log = l; process.exitCode = 0 }
  }
  const compile = (modules) => quiet(() => compileSpaces({ store: gitStore(root), write: false, catalog: {}, forms: [], modules }))

  const off = await compile({ 'space-encryption': false })
  t('encrypted: true with the module off is refused', () => {
    assert.equal(off.r, null, 'the compile returned a declaration instead of refusing it')
  })
  t('…and the refusal names the module', () => {
    assert.ok(off.said.includes('space-encryption'), `said: ${off.said}`)
  })
  t('…and the channel\'s own file', () => {
    assert.ok(off.said.includes('content/spaces/guild/lounge.md'), `said: ${off.said}`)
  })
  t('…and does not blame the channel that asked for nothing', () => {
    assert.ok(!off.said.includes('open.md'), `said: ${off.said}`)
  })

  const on = await compile({ 'space-encryption': true })
  t('the same declaration compiles with the module on', () => {
    assert.ok(on.r && on.r.length === 1, `said: ${on.said}`)
    const ch = Object.fromEntries(on.r[0].channels.map((c) => [c.slug, c.encrypted]))
    assert.equal(ch.lounge, true, 'the sealed room did not come out sealed')
    assert.equal(ch.open, false, 'a room that asked for nothing came out sealed')
  })
  /* a space may seal every room under it, and that too is refused with the module off */
  put('content/spaces/guild.md', '---\nname: The Guild\nkind: community\nencrypted: true\n---\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\n---\n')
  const space = await compile({ 'space-encryption': false })
  t('a SPACE that seals its rooms is refused the same way', () => {
    assert.equal(space.r, null)
    assert.ok(space.said.includes('space-encryption'), `said: ${space.said}`)
  })
  /* and nobody told — an Edge Function has no config to read — is not a fault */
  const unknown = await compile(null)
  t('a compile that was told nothing about the modules refuses nothing', () => {
    assert.ok(unknown.r && unknown.r.length === 1, `said: ${unknown.said}`)
  })
  /* A FEED IS THE NETWORK'S READING: with the network off a room that asks to be read as one is
     refused the same way, naming the module and the room's own file */
  put('content/spaces/guild.md', '---\nname: The Guild\nkind: community\n---\n')
  put('content/spaces/guild/lounge.md', '---\nname: Lounge\nmode: feed\n---\n')
  const feedOff = await compile({ network: false })
  t('mode: feed with the network off is refused, naming the module and the room', () => {
    assert.equal(feedOff.r, null)
    assert.ok(feedOff.said.includes('network') && feedOff.said.includes('content/spaces/guild/lounge.md'), `said: ${feedOff.said}`)
  })
  const feedOn = await compile({ network: true })
  t('…and is read as a feed with it on', () => {
    assert.ok(feedOn.r && feedOn.r[0].channels.find((c) => c.slug === 'lounge').mode === 'feed', `said: ${feedOn.said}`)
  })
  fs.rmSync(root, { recursive: true, force: true })
}

if (Object.keys(COUPLED).length) {
  console.log('\n  COUPLED ON PURPOSE — a site owner must be told before switching these off:')
  for (const [m, cs] of Object.entries(COUPLED)) for (const c of cs) console.log(`    ${c.dependent} needs ${m}: ${c.why}`)
}
console.log(bad ? `\nmodules off: ${n - bad} passed, ${bad} failed (${HERE.length} modules)\n` : `\nmodules off: ${n} passed, 0 failed (${HERE.length} modules)\n`)
process.exit(bad ? 1 : 0)
