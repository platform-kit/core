/*
 * THE MATRIX IS A CLAIM; THIS FILE DERIVES WHETHER THE CODE BACKS IT.
 *
 * build/modes.mjs says what each module does in each of the three shapes. Nothing there is a list of
 * what is broken, because a hand-written list of what is broken goes stale the day somebody fixes
 * something and forgets — which is precisely what happened to print, whose finished cloud path sat
 * on the debt list for days and was then read back off it and repeated as fact.
 *
 * So the claim is declared once and the truth is computed here, from the registries that already
 * exist and from the code itself:
 *
 *   a module claiming STATIC   owns no projected table, no Edge Function, no content that only the
 *                              admin can edit — a static site has no backend to hold any of it
 *   a module claiming CLOUD    has projected() on every projected table it owns, no artefact of its
 *                              own frozen in FIXED, no action of its own in the admin's MACHINE
 *                              list, and an admin model for every content directory it owns
 *
 * Ownership is derived, not declared twice: a model carries its `module`, content-kinds maps a
 * directory to its model, declarations maps a table to the content it comes from, and FEEDS maps a
 * model to the artefact it compiles into. So a table belongs to whichever module owns the content it
 * is projected from, and nothing has to be kept in step by hand.
 *
 * THE MIGRATION IS OVER AND THE DERIVATION STANDS ALONE. It ran BESIDE the three hand-written lists
 * for as long as it took them to agree, because switching in one step would have meant a bug in the
 * derivation showing up as a green check on something broken, with the thing you would have compared
 * against already deleted. They agreed; PROJECTION_DEBT is gone.
 *
 * FIXED and MACHINE did not go, because they were never only debt lists: FIXED says which artefacts
 * beside the functions a publish cannot change and why, MACHINE is what the admin function actually
 * refuses. They are EVIDENCE the derivation reads, not a second opinion it is checked against, and
 * the difference is the whole point — there is one answer to "what does this module do in the cloud"
 * and it is worked out, never remembered.
 *
 * What remains hand-written is the CLAIM: build/modes.mjs says what each module does in each shape,
 * and a gap carried on purpose is an exception naming its kind and the change that closes it. The
 * guard holds both directions — a claim the code does not back fails, and so does an exception whose
 * change has been archived with the gap still open, which is the direction that costs a feature
 * nobody knows they have.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODES, FEATURES, SURFACES, ALL, exceptions, modeOf, DEPLOYMENT_DEFAULTS } from './modes.mjs'
import { DECLARED, pendingOf } from './declarations.mjs'
import { KINDS, NOT_RECORDS } from './content-kinds.mjs'
import { PUBLISHED, LIVE, FIXED } from './artefacts.mjs'
import { registry, FEEDS } from './models/index.mjs'
import { loadSite, deploymentShape } from './site.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = join(HERE, '..')
const REPO = join(KIT, '..', '..')
const SITE = process.cwd()

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nDEPLOYMENT MODES\n')

/* ------------------------------------------------------------------ the models, and who owns what */
const models = await registry(SITE, { site: { root: SITE, modules: {} } })
ok('the models load', models.length > 10, String(models.length))

/*
 * A model names its module where it has one. Plenty do not — articles, books, wiki, docs and
 * achievements all carry no `module`, because the thing they belong to is named after them. So the
 * fallback is the model's own key where the matrix knows that name, and WITHOUT IT THE DERIVATION
 * GOES BLIND: articles and achievements were both real debt and both invisible, passing not because
 * the code was right but because nothing had looked. That is the failure this whole file exists to
 * prevent, reproduced inside the file itself on its first run, which is why the unowned check below
 * is a failure and not a note.
 */
const MATRIX = ALL()
const moduleOfModel = new Map(models.map((m) => [m.key, m.module || (MATRIX[m.key] ? m.key : null)]))
/* a content directory belongs to the module of the model that edits it */
const moduleOfDir = new Map()
for (const [dir, k] of Object.entries(KINDS)) if (k && k.model) moduleOfDir.set(dir, moduleOfModel.get(k.model) || null)
/* a table belongs to the module that owns the content it is projected from */
const moduleOfTable = new Map()
const dirOfTable = new Map()
const unowned = []
/* a feature may name a table outright, which is how the cross-cutting ones are owned: content_search
   is drawn from six collections and belongs to no one directory */
const claimed = new Map()
for (const [name, f] of Object.entries(MATRIX)) for (const tb of f.tables || []) claimed.set(tb, name)
for (const [t, d] of Object.entries(DECLARED)) {
  if (pendingOf(t)) continue
  let owner = null, from = null
  for (const one of Array.isArray(d.from) ? d.from : [d.from]) {
    const p = String(one || '')
    /* content/articles/**\/*.md -> content/articles; content/traits.md is itself a key */
    const dir = p.replace(/\/\*\*.*$/, '').replace(/\/[^/]*$/, '')
    for (const cand of [p, dir, dir.replace(/\/[^/]*$/, '')]) {
      if (moduleOfDir.has(cand)) { owner = moduleOfDir.get(cand); from = cand; break }
    }
    if (owner) break
  }
  /* the directory is resolved whatever owns the table: AN EXPLICIT CLAIM MUST NOT SKIP THE HOOK
     CHECK. The first version let a claimed table out of it, which put achievements and the search
     index straight back into the blind spot the claim was added to fix. */
  if (from) dirOfTable.set(t, from)
  if (claimed.has(t)) { moduleOfTable.set(t, claimed.get(t)); continue }
  if (owner) moduleOfTable.set(t, owner)
  else unowned.push(t + ' (from ' + [].concat(d.from).join(', ') + ')')
}
/* A TABLE NOBODY OWNS IS A TABLE NOBODY CHECKS. It would pass every rule below by being invisible,
   which is the quietest way for this file to be useless. */
ok('every projected table belongs to a module the matrix names', unowned.length === 0,
  unowned.join('; ') + ' — give the model a `module`, or name the feature in build/modes.mjs')
const tablesOf = (mod) => [...moduleOfTable].filter(([, m]) => m === mod).map(([t]) => t)
const dirsOf = (mod) => [...moduleOfDir].filter(([, m]) => m === mod).map(([d]) => d)
const artefactsOf = (mod) => Object.entries(FEEDS).filter(([k]) => moduleOfModel.get(k) === mod).map(([, a]) => a)

/* ------------------------------------------------------ 1. the forcing function: nothing unnamed */
/*
 * THE LIST IS THE MANIFESTS, not a scrape of the configs.
 *
 * This read `modules: { … }` out of three platformkit.config.js files with a regex and demanded
 * every name it found in FEATURES. Two things were wrong with that by the time a site could add a
 * module of its own.
 *
 * It demanded a SITE's module be answered for in the KIT's matrix. sites/demo declares
 * `stockists`, which is the press's own and is answered for in the press's own manifest;
 * build/site-module.test.mjs holds that. The kit's matrix describing one site's feature is the
 * same category error the docs check had.
 *
 * And the regex over-ran. `[\s\S]*?` to the next `\n  }` swallowed whatever object came after the
 * switches, so `choice` — a key inside an instrument's round settings — was reported as a module
 * nobody had answered for. A scrape that can invent a module is not a forcing function.
 *
 * A module declares itself. The kit's are build/modules/kit.mjs, and every one of them must be in
 * FEATURES — which is now true by construction, since FEATURES is derived from exactly that list,
 * so what this really holds is that the derivation has not silently lost one.
 */
const { MODULES } = await import('./modules/kit.mjs')
const moduleNames = new Set(MODULES.map((m) => m.key))
ok('there are modules to check', moduleNames.size > 10, String(moduleNames.size))
for (const n of moduleNames) {
  ok('`' + n + '` is named in build/modes.mjs', !!FEATURES[n],
    'add it to FEATURES with its answer in each of the three shapes — a module nobody has answered for is a module that works in one shape by accident')
}
/* and every model's module too: a model behind a switch nobody declared is the same hole */
for (const m of models) if (m.module) ok('`' + m.module + '` (the module of model ' + m.key + ') is named', !!FEATURES[m.module])

/* every cell is one of the three answers, and nothing is left undefined */
for (const [name, f] of Object.entries(ALL())) {
  for (const mode of Object.keys(MODES)) {
    const c = f[mode]
    const good = c === true || c === false || (c && typeof c === 'object' && typeof c.except === 'string' && 'change' in c && typeof c.why === 'string')
    ok('`' + name + '`/' + mode + ' is answered', good, 'true, false, or { except, change, why }')
  }
}

/* ------------------------------------------------------------------- 2. a claim of STATIC is held */
const fnDir = join(KIT, 'supabase', 'functions')
const functionNames = existsSync(fnDir) ? readdirSync(fnDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name) : []
ok('the functions are there to check', functionNames.length > 10, String(functionNames.length))

for (const [name, f] of Object.entries(ALL())) {
  if (f.static !== true) continue
  const owned = tablesOf(name)
  ok('`' + name + '` claims static and owns no projected table', owned.length === 0,
    owned.join(', ') + ' — a static site has no database to project into, so either the claim is wrong or the table belongs to another module')
}

/* ------------------------------------------------------------------- 3. a claim of CLOUD is held */
const modelByKey = new Map(models.map((m) => [m.key, m]))
const machineSrc = readFileSync(join(fnDir, 'admin', 'index.ts'), 'utf8')
const MACHINE = (/const MACHINE = \[([^\]]*)\]/.exec(machineSrc) || [, ''])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
ok('the admin function names its machine actions', MACHINE.length > 0, MACHINE.join(', '))

/* what the derivation believes is NOT yet cloud-capable, worked out from the code alone */
const derived = { projections: new Map(), artefacts: new Map(), machine: new Map(), uneditable: new Map() }
for (const [name, f] of Object.entries(ALL())) {
  if (f.cloud === false) continue
  /* a projected table with no publish-time hook is a declaration that never reaches the database */
  for (const t of tablesOf(name)) {
    if (pendingOf(t)) continue
    /* THE TABLE'S OWN DIRECTORY, not the module's first. A module owns several: asking whether
       `sessions` has a hook by looking at content/sessions said teams and provider_terms were
       unprojected when both have carried one since they were built. */
    const dir = dirOfTable.get(t)
    const model = dir && KINDS[dir] ? modelByKey.get(KINDS[dir].model) : null
    if (!model) continue
    if (typeof model.projected !== 'function') derived.projections.set(name, (derived.projections.get(name) || []).concat(t))
  }
  /* an artefact frozen in FIXED is a file the functions read that a publish cannot change */
  for (const a of artefactsOf(name)) if (Object.prototype.hasOwnProperty.call(FIXED, a) || Object.prototype.hasOwnProperty.call(FIXED, a + '.json')) derived.artefacts.set(name, (derived.artefacts.get(name) || []).concat(a))
  /* an action only a machine can run */
  for (const m of models) {
    if (m.module !== name) continue
    for (const a of Object.keys(m.actions || {})) if (MACHINE.includes(a)) derived.machine.set(name, (derived.machine.get(name) || []).concat(a))
  }
  /* content nobody can edit without a checkout */
  for (const d of dirsOf(name)) if (!KINDS[d] || !KINDS[d].model) derived.uneditable.set(name, (derived.uneditable.get(name) || []).concat(d))
}

/*
 * PRINT IS THE FIXTURE. Its cloud path is finished — every action branches on ctx.editions and
 * print-render does the rendering over the bucket — so the derivation MUST find it clean. If this
 * ever fails, either print regressed or the derivation is inventing debt, and both matter more than
 * whatever else is red today.
 */
ok('print derives clean in cloud (the paid debt that outlived its entry)',
  !derived.projections.has('print') && !derived.machine.has('print') && !derived.uneditable.has('print'),
  JSON.stringify({ p: derived.projections.get('print'), m: derived.machine.get('print'), u: derived.uneditable.get('print') }))

/* a module claiming cloud outright, with no exception, must derive clean */
for (const [name, f] of Object.entries(ALL())) {
  if (f.cloud !== true) continue
  const why = []
  if (derived.projections.has(name)) why.push('projects ' + derived.projections.get(name).join(', ') + ' with no projected() hook')
  if (derived.artefacts.has(name)) why.push('feeds ' + derived.artefacts.get(name).join(', ') + ', which is FIXED')
  if (derived.machine.has(name)) why.push('has the machine action(s) ' + derived.machine.get(name).join(', '))
  if (derived.uneditable.has(name)) why.push('owns ' + derived.uneditable.get(name).join(', ') + ' with no admin model')
  ok('`' + name + '` claims cloud and the code backs it', why.length === 0, why.join('; '))
}

/*
 * A STALE EXCEPTION IS THE PRINT FAILURE IN REVERSE, and the more dangerous direction: a gap that has
 * been closed while the matrix still says it is open costs a feature nobody knows they have. Print
 * spent days like that. So an exception whose derivation comes back clean fails here — the claim is
 * raised to true and the exception deleted, in the same commit as the fix.
 *
 * This only speaks for the gaps the derivation can see (a projection, a frozen artefact, a machine
 * action, uneditable content). An exception outside that — a picture that needs a browser — carries
 * its own change and is answered when that change is verified.
 */
/* what the derivation can see, by the exception's OWN kind — never a list of names, which is the
   thing that goes stale while nobody is looking */
const DERIVED_KINDS = { projection: (n) => derived.projections.has(n), artefact: (n) => derived.artefacts.has(n), editing: (n) => derived.uneditable.has(n) }
const KINDS_ALLOWED = new Set([...Object.keys(DERIVED_KINDS), 'machine', 'browser'])
for (const [name, f] of Object.entries(MATRIX)) {
  for (const mode of Object.keys(MODES)) {
    const c = f[mode]
    if (!c || typeof c !== 'object') continue
    ok('`' + name + '`/' + mode + " says what kind of gap it is", KINDS_ALLOWED.has(c.kind), String(c.kind) + ' — one of ' + [...KINDS_ALLOWED].join(', '))
    const seen = DERIVED_KINDS[c.kind]
    if (!seen || mode !== 'cloud') continue
    ok('`' + name + "`'s cloud exception is still owed", seen(name),
      'the derivation finds nothing wrong — the gap is closed, so raise the claim to true and delete the exception in the same commit as the fix')
  }
}

/* ------------------------------------------------- 4. an exception names a change that is still live */
const changesDir = join(REPO, 'openspec', 'changes')
const live = existsSync(changesDir) ? readdirSync(changesDir).filter((n) => n !== 'archive') : []
for (const e of exceptions()) {
  if (e.change === null) { ok('`' + e.name + '`/' + e.mode + " carries no change, so it says why not", !!e.why); continue }
  ok('`' + e.name + '`/' + e.mode + ' names a live change', live.includes(e.change),
    e.change + ' is not a live change — either it was archived without closing the gap, or the name is wrong')
}

/*
 * ------------------------------------- 5. EVERY SITE IN THE REPOSITORY IS HELD TO ITS OWN DECLARATION
 *
 * This is the reason the shape is declared rather than inferred from an absent key. Nothing in
 * sites/docs said it was a static site: you would have worked it out from every module happening to
 * be off, which is exactly the fragile inference being removed. Switch its store on and the suite
 * stays green — it breaks at a deploy that may not happen for weeks, if anybody ever runs one.
 * Declared, the same edit fails on the machine that writes it.
 */
for (const dir of ['sites/brochure', 'sites/demo', 'sites/docs']) {
  const p = join(REPO, dir, 'platformkit.config.js')
  if (!existsSync(p)) continue
  const site = await loadSite(join(REPO, dir))
  const shape = deploymentShape(site, {})
  const wrong = []
  /* every module the matrix knows, at its EFFECTIVE value — absent from a config means on */
  for (const name of Object.keys(MATRIX)) {
    if ((site.modules || {})[name] === false) continue
    if (!FEATURES[name]) continue   /* a cross-cutting surface is not a switch a site sets */
    if (MATRIX[name][shape.mode] === false) wrong.push(name + ' — ' + (MATRIX[name].needs || 'it does not work in ' + shape.mode))
  }
  ok('`' + dir + '` is a ' + shape.mode + ' site and every module it switches on works there', wrong.length === 0, wrong.join('; '))
}

/* ------------------------------------------------------------- 6. the shape a deployment resolves to */
ok('no backend is static', modeOf({ backend: false, content: 'files', repo: true }) === 'static')
ok('a backend with the repository in the cycle is git', modeOf({ backend: true, content: 'files', repo: true }) === 'git')
ok('rows with the repository still in the cycle is git', modeOf({ backend: true, content: 'rows', repo: true }) === 'git')
ok('rows with the repository out of the cycle is cloud', modeOf({ backend: true, content: 'rows', repo: false }) === 'cloud')
ok('the defaults are what a site already was', DEPLOYMENT_DEFAULTS.backend === true && DEPLOYMENT_DEFAULTS.content === 'files' && DEPLOYMENT_DEFAULTS.repo === true)

/*
 * ------------------------------------------- 7. WHAT A DEPLOY WOULD RUN, IN EACH SHAPE
 *
 * Asserted without running one. deploy.mjs reads this same deployPlan, so the script and this check
 * cannot drift — which is the only reason a check on a deploy is worth anything.
 */
{
  const src = readFileSync(join(KIT, 'build', 'deploy.mjs'), 'utf8')
  const m = /export const deployPlan = \(shape\) => \{[\s\S]*?\n\}/.exec(src)
  ok('the deploy declares its plan', !!m, 'deployPlan is gone from build/deploy.mjs')
  if (m) {
    const deployPlan = eval('(' + m[0].replace('export const deployPlan = ', '') + ')')
    const STATIC = deployPlan({ backend: false, content: 'files', repo: false, mode: 'static' })
    const GIT = deployPlan({ backend: true, content: 'files', repo: true, mode: 'git' })
    const CLOUD = deployPlan({ backend: true, content: 'rows', repo: false, mode: 'cloud' })
    /* A STATIC DEPLOY TOUCHES NO DATABASE AND NO FUNCTION. It builds, and that is the deploy. */
    for (const k of ['targetGuards', 'assemble', 'link', 'migrate', 'contentExport', 'functionsDeploy', 'secrets', 'after'])
      ok('a static deploy does not ' + k, STATIC[k] === false)
    ok('a static deploy builds', STATIC.build === true)
    ok('a static deploy runs no functions phase', !STATIC.phases.includes('functions'))
    /* and the two backed shapes are what they were */
    for (const k of ['targetGuards', 'assemble', 'link', 'migrate', 'functionsDeploy', 'secrets', 'after', 'build'])
      ok('a git deploy still does ' + k, GIT[k] === true)
    ok('a git deploy exports no rows', GIT.contentExport === false)
    ok('a cloud deploy writes the rows out first', CLOUD.contentExport === true)
  }
}

/* ------------------------- 8. NO STEP THAT NEEDS A BACKEND RUNS IN A SHAPE THAT HAS NONE */
{
  const { loadSteps, isOn, stepNeedsBackend } = await import('./steps.mjs')
  const site = await loadSite(join(REPO, 'sites', 'docs'))
  const shape = deploymentShape(site, {})
  const steps = await loadSteps(site)
  const on = steps.filter((s) => isOn(s, site, {}, shape))
  ok('the docs site is static', shape.mode === 'static')
  ok('steps load for it', steps.length > 10, String(steps.length))
  ok('not one step needing a backend runs there', on.filter(stepNeedsBackend).length === 0,
    on.filter(stepNeedsBackend).map((s) => s.key).join(', '))
  /* and the inference is not vacuous: the backed site DOES have such steps */
  const root = await loadSite(SITE)
  const rootSteps = await loadSteps(root)
  ok('a backed site has steps that need one (so the rule is not vacuous)',
    rootSteps.filter(stepNeedsBackend).length > 3, String(rootSteps.filter(stepNeedsBackend).length))
}

/*
 * ------------------------------------------------ 6. WHAT THE DERIVATION FOUND
 *
 * No longer a reconciliation: there is nothing left to reconcile it against. This prints what the
 * rules worked out, so a person reading the run can see the shape of it rather than only whether it
 * passed — and so a projection appearing here that nobody expected is noticed.
 */
const derivedTables = new Set([...derived.projections.values()].flat())
console.log('\n  WHAT THE DERIVATION FOUND\n')
console.log('    projections without a hook : ' + ([...derivedTables].sort().join(', ') || 'none'))
console.log('    artefacts                  : ' + Object.keys(FIXED).length + ' frozen, ' + Object.keys(PUBLISHED).length + ' published, ' + Object.keys(LIVE).length + ' live')
console.log('    machine-only actions       : ' + MACHINE.join(', '))

/*
 * ------------------------------------------------ 7. AN EXCEPTION OUTLIVING THE CHANGE THAT CLOSES IT
 *
 * A gap carried on purpose names the change that closes it. When that change is ARCHIVED the gap is
 * meant to be closed — so an exception still standing against an archived change is either a claim
 * nobody updated or a change archived with its work unfinished, and both are worth stopping for.
 *
 * This is the direction that costs a feature nobody knows they have, which is the expensive one:
 * print's cloud path was finished, its debt entry stayed, and the entry was later read back off the
 * list and repeated as fact. A stale claim in the other direction merely fails a check.
 *
 * The kinds the guard can derive (projection, artefact, editing) are already held above — this
 * catches `machine` and `browser`, which nothing in the code can answer for.
 */
{
  const archived = existsSync(join(REPO, 'openspec/changes/archive'))
    ? readdirSync(join(REPO, 'openspec/changes/archive'))
    : []
  /* an archive folder carries its date: 2026-09-19-cloud-content closes "cloud-content" */
  const closes = (name) => archived.filter((d) => d.replace(/^\d{4}-\d{2}-\d{2}-/, '') === name)
  for (const e of exceptions()) {
    if (!e.change) continue
    const found = closes(e.change)
    ok(`the gap ${e.name}/${e.mode} declares is still open, or its change is still live (${e.change})`,
      found.length === 0,
      found.length
        ? `${e.change} is archived as ${found[0]}, so this gap was meant to be closed: raise the claim in build/modes.mjs and delete the exception, or say which change closes it now — "${e.except}"`
        : '')
  }
}

const ex = exceptions()
if (ex.length) {
  console.log('\n  CARRIED ON PURPOSE — every gap the matrix declares\n')
  for (const e of ex) console.log('    ' + (e.name + '/' + e.mode).padEnd(26) + e.except + (e.change ? '   → ' + e.change : '   → no change yet'))
}
console.log('')

console.log(`  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
