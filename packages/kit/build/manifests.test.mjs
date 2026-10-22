/*
 * WHAT A MODULE DECLARES ABOUT ITSELF, AND WHETHER IT IS TRUE.
 *
 * A manifest is only worth having if a wrong one is refused. Three kinds of wrong matter, and
 * each costs something different:
 *
 *   MALFORMED — a typo'd field, a missing shape, an exception with no reason. Cheap to catch and
 *   expensive to miss, because a field nobody reads is a declaration that quietly says nothing.
 *
 *   UNTRUE — a manifest claiming a route, a schema file, a function or a step that is not there.
 *   That is a module promising to take something away when it is switched off, and leaving it.
 *
 *   NOT THE ONLY COPY — a module named somewhere other than its manifest. The whole change is
 *   that four places stopped holding lists; a fifth would put it back.
 *
 *   node packages/kit/build/manifests.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import nodeFs from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
/* the kit's own src, the theme's beside it, and the site's — for the switch-reading seam below */
const KIT_SRC = fileURLToPath(new URL('../src/', import.meta.url))
const THEME_SRC = fileURLToPath(new URL('../theme/src/', import.meta.url))
import { readManifest, readManifests, unmetRequirements, FIELDS, OWNS, SHAPES, KINDS } from './modules/manifest.mjs'
import { loadSite } from './site.mjs'
import { moduleSet } from './steps.mjs'
import { activeCronJobs, cronSql } from './cron.mjs'

const CRON_SITE = await loadSite()
const CRON_MODULES = await moduleSet(CRON_SITE)
const CRON_EXPECTED = activeCronJobs(CRON_MODULES, CRON_SITE.modules || {})

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 4).join('\n    ')) } }

/* ---- ONE READING OF A SWITCH, AND NOTHING READS ONE ANOTHER WAY --------------------------- */
/*
 * `modules.stor !== false` is `undefined !== false`, which is TRUE: a mistyped module name does
 * not switch a module off, it switches it ON, silently, and ships a feature to a site that asked
 * for it to be gone. lib/modules.js exists so that reading throws instead — but it only helps
 * where it is used, and thirty-seven reads in thirteen files still went the old way.
 *
 * So the old way is refused here. The sweep this change first asked for — no quoted module id
 * outside a manifest — turned out to be unwritable: the ids are ordinary words (docs, store,
 * books, print, events, api), 1267 occurrences across 291 files, almost none of them module
 * references. A list that cries wolf is one somebody switches off. This asks the answerable
 * question instead: does anything read a switch without going through the one reading?
 */
{
  const walkSrc = (d, out = []) => {
    if (!nodeFs.existsSync(d)) return out
    for (const e of nodeFs.readdirSync(d, { withFileTypes: true })) {
      const f = nodePath.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walkSrc(f, out) }
      else if (/\.(mjs|js|ts|vue)$/.test(e.name)) out.push(f)
    }
    return out
  }
  const ONE = nodePath.join('lib', 'modules.js')
  const srcRoots = [KIT_SRC, THEME_SRC, nodePath.join(process.cwd(), 'src')]
  const all = srcRoots.flatMap((r) => walkSrc(r))
  const raw = []
  for (const f of all) {
    if (f.endsWith(ONE)) continue
    const src = nodeFs.readFileSync(f, 'utf8')
    /* ONLY A SWITCH READ OF THE SITE'S OWN modules. A function may take a modules object as an
       ARGUMENT — `sourcesOn(modules = {})` in lib/desk/shape.js does, which is what makes it a
       pure function somebody can test by passing one in. Converting that to moduleOn() made it
       ignore its own parameter and read the running site instead, and four checks of the desk
       went red. So a file whose `modules` is a local binding is not this check's business. */
    if (!/import\s*\{[^}]*\bmodules\b[^}]*\}\s*from\s*['"]#site['"]/.test(src)) continue
    if (/function\s+\w+\s*\([^)]*\bmodules\b|\(\s*modules\s*=|(const|let)\s+modules\b/.test(src)) continue
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i], tr = ln.trim()
      if (tr.startsWith('*') || tr.startsWith('//') || tr.startsWith('/*') || ln.indexOf('`modules.') >= 0) continue
      if (/modules\.[a-zA-Z]+\s*(!==|===)\s*false/.test(ln)) raw.push(nodePath.relative(process.cwd(), f) + ':' + (i + 1))
    }
  }
  t('nothing reads a module switch except lib/modules.js', () => {
    if (raw.length) throw new Error(raw.slice(0, 8).join(', ') + (raw.length > 8 ? ' …and ' + (raw.length - 8) + ' more' : '') +
      ' — use moduleOn(key), which throws on a name nobody declares instead of reading it as ON')
  })
  /* and the name is not shadowed: AdminPage.vue had its own moduleOn over a VIEW key, so two
     reads converted to the kit's bound to that instead and the admin would not load */
  const shadow = all.filter((f) => !f.endsWith(ONE) && /(const|let|function)\s+moduleOn\b/.test(nodeFs.readFileSync(f, 'utf8')))
  t('and nothing else binds the name moduleOn', () => {
    if (shadow.length) throw new Error(shadow.map((f) => nodePath.relative(process.cwd(), f)).join(', ') + ' — a local of that name shadows the one reading')
  })
}

console.log('\nWHAT A MODULE DECLARES\n')

const ok3 = { static: false, git: true, cloud: true }
const good = { key: 'widgets', what: 'the widgets', ...ok3, owns: { routes: ['/widgets'], steps: ['widgets'] } }

/* ─── malformed ─── */

t('a well-formed manifest is read', () => {
  const { manifest, faults } = readManifest(good)
  assert.deepEqual(faults, [])
  assert.equal(manifest.key, 'widgets')
  /* every "owns" kind is present, empty where unsaid, so no reader has to guard */
  for (const k of OWNS) assert.ok(Array.isArray(manifest.owns[k]), `owns.${k} is not a list`)
  assert.deepEqual(manifest.requires, [])
})
t('a module must answer for ALL THREE shapes', () => {
  for (const s of SHAPES) {
    const m = { ...good }; delete m[s]
    const { faults } = readManifest(m)
    assert.ok(faults.some((f) => f.includes(s)), `a manifest with no \`${s}\` was accepted`)
  }
})
t('an exception must name its kind and its reason', () => {
  assert.ok(readManifest({ ...good, cloud: { except: 'a thing' } }).faults.length, 'an exception with no kind was accepted')
  assert.ok(readManifest({ ...good, cloud: { kind: 'machine', except: 'a thing' } }).faults.length, 'an exception with no why was accepted')
  assert.ok(readManifest({ ...good, cloud: { kind: 'nonsense', except: 'a thing', why: 'because' } }).faults.length, 'an unknown kind was accepted')
  assert.deepEqual(readManifest({ ...good, cloud: { kind: 'machine', except: 'a thing', why: 'because' } }).faults, [])
})
/* a typo in a field name is the fault that would otherwise say nothing at all */
t('a field the shape does not have is refused, not ignored', () => {
  const { faults } = readManifest({ ...good, ownz: { routes: [] } })
  assert.ok(faults.some((f) => f.includes('ownz')), 'a misspelt field was ignored')
})
t('and so is a thing a module cannot own', () => {
  const { faults } = readManifest({ ...good, owns: { rowtes: ['/x'] } })
  assert.ok(faults.some((f) => f.includes('rowtes')))
})
t('cron ownership is declared as a named schedule and one SQL action', () => {
  const { manifest, faults } = readManifest({
    ...good,
    owns: { cron: [{ name: 'daily-work', schedule: '*/5 * * * *', command: "select public.run_work('a;b')" }] },
  })
  assert.deepEqual(faults, [])
  assert.deepEqual(manifest.owns.cron, [
    { name: 'daily-work', schedule: '*/5 * * * *', command: "select public.run_work('a;b')" },
  ])
})
t('cron declarations reject malformed schedules, actions, and duplicate names', () => {
  const invalid = [
    { name: 'daily-work', schedule: '* * * *', command: 'select public.run_work()' },
    { name: 'daily-work', schedule: '60 * * * *', command: 'select public.run_work()' },
    { name: 'daily-work', schedule: '* * * * *', command: '' },
    { name: 'daily-work', schedule: '* * * * *', command: 'select public.run_work(); delete from public.jobs' },
    { name: 'daily-work', schedule: '* * * * *', command: 'update public.jobs set due = false' },
  ]
  for (const cron of invalid) assert.ok(readManifest({ ...good, owns: { cron: [cron] } }).faults.length, `accepted ${JSON.stringify(cron)}`)
  assert.ok(readManifest({ ...good, owns: { cron: [
    { name: 'daily-work', schedule: '0 0 * * *', command: 'select public.run_work()' },
    { name: 'daily-work', schedule: '0 1 * * *', command: 'select public.run_work()' },
  ] } }).faults.some((fault) => fault.includes('declared more than once')))
  assert.ok(readManifest({ ...good, owns: { cron: [{ name: 'daily-work', schedule: '* * * * *', command: 'select public.run_work()', unexpected: true }] } })
    .faults.some((fault) => fault.includes('unexpected')))
})
t('every fault is reported, not just the first', () => {
  const { faults } = readManifest({ key: 'X!', what: '', ownz: 1 })
  assert.ok(faults.length >= 3, `only ${faults.length}: ${faults.join(' | ')}`)
})

/* ─── a set ─── */

t('two manifests under one key are refused, not resolved by order', () => {
  const { faults } = readManifests([
    { manifest: good, where: 'the kit' },
    { manifest: { ...good, what: 'somebody else\'s widgets' }, where: 'the site' },
  ])
  assert.ok(faults.some((f) => /two manifests declare/.test(f)), 'the second silently won')
})
t('a module that requires one nobody declares is refused', () => {
  const { faults } = readManifests([{ manifest: { ...good, requires: ['ghosts'] }, where: 'the kit' }])
  assert.ok(faults.some((f) => f.includes('ghosts')))
})

/*
 * TWO MODULES CLAIMING ONE THING. Ownership is what a switch ACTS on: if two modules claim one
 * step, switching either off takes it away and the other quietly loses a piece of itself — the
 * exact property modules-off.test.mjs proves cannot happen. So it is refused rather than resolved,
 * and both claimants are named, because last-one-loaded would make the answer depend on the order a
 * site's config happened to register things in.
 */
for (const what of ['steps', 'routes', 'admin', 'schema', 'functions', 'cron']) {
  t(`two modules claiming one ${what.replace(/s$/, '')} are refused, and both are named`, () => {
    const owned = what === 'cron'
      ? [{ name: 'the-same-thing', schedule: '* * * * *', command: 'select public.run_work()' }]
      : ['the-same-thing']
    const { faults } = readManifests([
      { manifest: { ...good, key: 'alpha', owns: { [what]: owned } }, where: 'the kit' },
      { manifest: { ...good, key: 'beta', owns: { [what]: owned } }, where: 'the site' },
    ])
    const hit = faults.find((f) => f.includes('the-same-thing'))
    assert.ok(hit, `the collision passed: ${faults.join(' | ') || 'no faults at all'}`)
    assert.ok(hit.includes('alpha') && hit.includes('beta'), `the fault does not name both claimants: ${hit}`)
  })
}
/*
 * AND env IS NOT ONE OF THEM. This was got wrong in the commit that added the rule above: the
 * argument was that ownership is what a switch acts on and that this is "identical for each" of the
 * seven kinds. It is not identical for a secret. A route is a piece of the module and goes with it;
 * a secret is a piece of the DEPLOYMENT, and the mail relay is genuinely needed by any of seven
 * modules and Stripe's keys by any of three. Refusing a shared one would force a fiction — some
 * single module nominated as the owner of SMTP_HOST while six others quietly depend on it.
 */
t('two modules needing one secret is allowed — a secret is the deployment\'s, not a module\'s', () => {
  const { faults } = readManifests([
    { manifest: { ...good, key: 'alpha', owns: { env: ['SMTP_HOST'] } }, where: 'the kit' },
    { manifest: { ...good, key: 'beta', owns: { env: ['SMTP_HOST'] } }, where: 'the kit' },
  ])
  assert.deepEqual(faults, [], `a shared secret was refused: ${faults.join(' | ')}`)
})
t('a thing claimed once is not a collision', () => {
  const { faults } = readManifests([
    { manifest: { ...good, key: 'alpha', owns: { steps: ['mine'] } }, where: 'the kit' },
    { manifest: { ...good, key: 'beta', owns: { steps: ['yours'] } }, where: 'the site' },
  ])
  assert.deepEqual(faults, [], faults.join(' | '))
})

/* ─── what a live module needs that is off ─── */

const SET = readManifests([
  { manifest: { key: 'forms', what: 'forms', ...ok3 }, where: 'kit' },
  { manifest: { key: 'instrument', what: 'the instrument', ...ok3, requires: ['forms'], needs: 'the instrument runs on the forms module’s runner' }, where: 'kit' },
]).modules

t('a live module whose requirement is off is reported, naming both', () => {
  const out = unmetRequirements(SET, { forms: false })
  assert.equal(out.length, 1)
  assert.equal(out[0].module, 'instrument')
  assert.equal(out[0].needs, 'forms')
  assert.ok(out[0].why, 'it did not say why')
})
t('and nothing is reported when both are on, or when the dependent is off too', () => {
  assert.deepEqual(unmetRequirements(SET, {}), [])
  assert.deepEqual(unmetRequirements(SET, { forms: false, instrument: false }), [])
})
/* the direction matters: the dependent declares, so switching off the DEPENDENT is always fine */
t('switching off the dependent alone is never a fault', () => {
  assert.deepEqual(unmetRequirements(SET, { instrument: false }), [])
})

/* ─── the kit's own 24, against what the code says ─── */

const { MODULES } = await import('./modules/kit.mjs')
const { modules: KIT, faults: kitFaults } = readManifests(MODULES.map((m) => ({ manifest: m, where: 'the kit' })))

t('every manifest the kit ships is well formed', () => {
  assert.deepEqual(kitFaults, [], kitFaults.join(' | '))
})
t('social publishing is backend-only and owns its isolated function doors', () => {
  const social = KIT.get('social-publishing')
  assert.ok(social, 'the social-publishing module is not declared')
  assert.equal(social.static, false)
  assert.equal(social.git, true)
  assert.equal(social.cloud, true)
  assert.deepEqual(social.owns.schema, ['99-social.sql'])
  assert.deepEqual(social.owns.functions, [
    'social',
    'social-oauth',
    'social-publish',
    'social-webhook',
    'social-automation',
  ])
  assert.deepEqual(social.owns.cron, [
    { name: 'social-publishing', schedule: '* * * * *', command: 'select public.run_social_publishing()' },
    { name: 'social-metrics', schedule: '*/10 * * * *', command: 'select public.run_social_metrics()' },
    { name: 'social-automation-recovery', schedule: '* * * * *', command: 'select public.run_social_automation()' },
  ])
  const schema = fileURLToPath(new URL('../supabase/schemas/99-social.sql', import.meta.url))
  assert.ok(nodeFs.existsSync(schema), 'the social-publishing schema is not declared')
  if (CRON_SITE.deployment.backend && CRON_SITE.modules['social-publishing'] !== false) {
    const data = nodeFs.readFileSync(nodePath.join(process.cwd(), 'supabase', 'data.sql'), 'utf8')
    assert.match(data, /'social'\s*,\s*'social'\s*,\s*false/)
    assert.match(data, /run_social_publishing/)
    assert.match(data, /run_social_metrics/)
    assert.match(data, /run_social_automation/)
  }
  for (const name of social.owns.functions) {
    const entry = nodePath.join(fileURLToPath(new URL('../supabase/functions/', import.meta.url)), name, 'index.ts')
    assert.ok(nodeFs.existsSync(entry), `${name} is claimed but has no Edge Function entry point`)
  }
})
t('the enabled module declarations have unique cron job names', () => {
  assert.equal(new Set(CRON_EXPECTED.map((job) => job.name)).size, CRON_EXPECTED.length, 'the enabled declarations contain duplicate names')
})
if (CRON_SITE.deployment.backend) {
  t('the assembled cron block is derived from the enabled module declarations', () => {
    const data = nodeFs.readFileSync(nodePath.join(process.cwd(), 'supabase', 'data.sql'), 'utf8').trimEnd()
    const block = cronSql(CRON_MODULES, CRON_SITE.modules || {}).trim()
    assert.ok(data.endsWith(block), 'the assembled data.sql cron block differs from the enabled manifests')
  })
} else {
  console.log('  (static deployment: assembled database cron checks are not applicable)')
}

/*
 * THE MATRIX IS THE MANIFESTS NOW, so this is no longer two sources agreeing.
 *
 * It was: while modes.mjs held a literal of twenty-four entries, the two had to agree exactly, and
 * that agreement was the evidence the manifests had been written from the code rather than from a
 * reading of the matrix. modes.mjs derives from here, so that check would now be true by
 * construction — the same trap as the "only its own steps stop" check in modes-off, which read
 * each step's module and then asked whether the stopped steps carried it.
 *
 * WHAT IS STILL CHECKABLE is the PROJECTION. `FEATURES` is a mapper over the manifests, and a
 * mapper can drop a field: forget `needs` and every refusal loses the sentence that says why a
 * module cannot be static, forget a shape and the module is held to nothing in it. So the manifest
 * is the source and FEATURES is asked whether it carried the whole claim across — which fails on a
 * mapper bug and cannot pass by construction, because the two are no longer written by hand.
 */
{
  const { FEATURES } = await import('./modes.mjs')
  t('the matrix carries every module the manifests declare, and no other', () => {
    assert.deepEqual(Object.keys(FEATURES).sort(), [...KIT.keys()].sort())
  })
  for (const [key, m] of KIT) {
    t(`${key}: its whole claim reaches the matrix`, () => {
      const f = FEATURES[key]
      assert.ok(f, `the manifest for ${key} did not reach the matrix at all`)
      for (const s of SHAPES) assert.deepEqual(f[s], m[s], `${key}.${s} was dropped or changed on the way`)
      assert.equal(f.what, m.what, `${key}: what it is was dropped`)
      assert.equal(f.needs || null, m.needs || null, `${key}: the reason it cannot be static was dropped`)
    })
  }
}

/*
 * ITS CLAIMS ARE REAL. A manifest naming a step that is not there, or one that belongs to another
 * module, is a module promising to take something away when it is switched off and leaving it.
 * Neither side is trusted alone: the step carries `module:` and the manifest carries the key, and
 * they are compared.
 */
{
  const { loadSteps } = await import('./steps.mjs')
  const { loadSite } = await import('./site.mjs')
  const steps = await loadSteps(await loadSite(process.cwd()))
  const byKey = new Map(steps.map((s) => [s.key, s]))

  t('every step a manifest claims exists, and agrees that it belongs to that module', () => {
    const wrong = []
    for (const m of CRON_MODULES.values()) {
      for (const k of m.owns.steps) {
        const s = byKey.get(k)
        if (!s) wrong.push(`${m.key} claims step ${k}, which is not a step`)
        else if (s.module !== m.key) wrong.push(`${m.key} claims step ${k}, which says it belongs to ${s.module || 'no module'}`)
      }
    }
    assert.deepEqual(wrong, [], wrong.join(' | '))
  })

  t('and every step that names a module is claimed by that module', () => {
    const orphans = steps.filter((s) => s.module).filter((s) => !(CRON_MODULES.get(s.module) || { owns: { steps: [] } }).owns.steps.includes(s.key))
      .map((s) => `${s.key} says ${s.module}, which does not claim it`)
    assert.deepEqual(orphans, [], orphans.join(' | '))
  })
}

/* ─── one timeout for every browser this repository opens ─── */

/*
 * Playwright's default is 30 seconds and applies to any call given no explicit budget, so a file
 * that writes 60 on the waits it thought about still runs the rest at 30 — and under load, which
 * is when a suite is slowest, those are the ones that fail. A context made anywhere but
 * `build/browser.mjs` inherits that 30 back, so it is refused here rather than discovered by an
 * afternoon spent reading the wrong surface.
 */
{
  const { readdirSync, readFileSync: rf, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const HERE = new URL('.', import.meta.url).pathname
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (/node_modules|\.cache/.test(p)) continue
      if (e.isDirectory()) walk(p, out)
      else if (/\.mjs$/.test(e.name)) out.push(p)
    }
    return out
  }
  void statSync
  const offenders = walk(HERE)
    .filter((p) => !/\/browser\.mjs$/.test(p) && !/\/manifests\.test\.mjs$/.test(p))
    .filter((p) => /\.newContext\s*\(/.test(rf(p, 'utf8')))
    .map((p) => p.replace(HERE, ''))
  t('every browser context is made through build/browser.mjs, which sets the floor', () => {
    assert.deepEqual(offenders, [], `these make their own and inherit Playwright\u2019s 30s: ${offenders.join(', ')}`)
  })
}


/*
 * EVERY VARIABLE THE DEPLOY CAN DEMAND IS DECLARED BY SOMEBODY.
 *
 * The manifests now say which variables a module can ask for, and deploy-checks reads them — but
 * reading them is not the same as being held to them. Nothing yet stops somebody adding a
 * a fresh `need(…)` to the deploy and never declaring what it asks for, and then the manifests are a
 * decoration: they would describe most of the environment and quietly miss a piece.
 *
 * So the check goes the other way round. The deploy's source is scanned for every variable it can
 * DEMAND — a refusal, not a note and not a warning about a value being wrong — and each must be
 * either a module's (declared in a manifest) or explicitly the deployment's own (DEPLOYMENT_ENV,
 * the handful that belong to no module: there is no module called "having a database").
 *
 * A printer's keys are reached through PRINTER_KEYS rather than written at the call, so they are
 * taken from that map as well as from the source.
 */
{
  const src = readFileSync(new URL('./deploy-checks.mjs', import.meta.url), 'utf8')
  const { DEPLOYMENT_ENV, declaredEnv, PRINTER_KEYS } = await import('./deploy-checks.mjs')

  /* what it can demand: a need(…) call, and the paired lists that feed the same call */
  const demanded = new Set()
  for (const m of src.matchAll(/need\(\s*'([A-Z][A-Z_0-9]*)'/g)) demanded.add(m[1])
  for (const m of src.matchAll(/\[\s*'([A-Z][A-Z_0-9]*)'\s*,\s*['"`]/g)) demanded.add(m[1])
  for (const ks of Object.values(PRINTER_KEYS)) for (const k of ks) demanded.add(k)

  t('the deploy demands something', () => {
    assert.ok(demanded.size > 10, `only found ${demanded.size} — the scan has stopped matching and this check is now vacuous`)
  })

  const declared = new Set([...declaredEnv(), ...DEPLOYMENT_ENV])
  t('every variable the deploy can demand is declared by a module or is the deployment\'s own', () => {
    const orphans = [...demanded].filter((k) => !declared.has(k)).sort()
    assert.deepEqual(orphans, [], `nobody declares ${orphans.join(', ')} — add it to the owning module's \`owns.env\`, or to DEPLOYMENT_ENV if it belongs to no module`)
  })

  /* and the other direction: a module declaring a variable the deploy never asks for is a
     declaration nothing honours, which is how a manifest starts drifting from the deploy */
  t('every variable a module declares is one the deploy can demand', () => {
    const idle = declaredEnv().filter((k) => !demanded.has(k)).sort()
    assert.deepEqual(idle, [], `${idle.join(', ')} is declared by a module and the deploy never asks for it — either the deploy lost the check, or the declaration is stale`)
  })
}

console.log(bad ? `\nmanifests: ${n - bad} passed, ${bad} failed\n` : `\nmanifests: ${n} passed, 0 failed\n`)
process.exit(bad ? 1 : 0)
