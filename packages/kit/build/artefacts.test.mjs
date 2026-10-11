/*
 * THE COMPILED ARTEFACTS, held to the same rule content-kinds.mjs holds content to: every one of
 * them must say how it reaches a deployment that will never build again.
 *
 * Three checks, and the third is the one that matters:
 *   1. every .json beside the functions is in PUBLISHED or FIXED — adding one answers the question
 *   2. every PUBLISHED artefact is actually wired: a compile the publish runs, a model that feeds
 *      it, and the overlay reading it
 *   3. PARITY — the artefact the build writes and the artefact an Edge Function would compile from
 *      the rows are the same thing. This is what catches a compile that quietly loses something
 *      when it cannot see a disk: the checkout's words, a collection velite made, a file a store
 *      answers with null. It needs a stack with content rows and skips with a note where there is
 *      none (a site in git mode has nothing to compare against).
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLISHED, LIVE, FIXED } from './artefacts.mjs'
import { loadSite } from './site.mjs'

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..')
/* the site's assembled tree: the kit's own directory holds no compiled artefact, they are written
   into the site's by the build (and by assemble) */
const FN = join(process.cwd(), 'supabase', 'functions', '_shared')
const ROOT = process.cwd()
const SITE = await loadSite(ROOT)
let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')) } }

console.log('\nARTEFACTS\n')

/* ---- 1. every artefact says which it is ---- */
const found = []
const walk = (dir, rel = '') => {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const at = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) { if (!['pipe'].includes(e.name) || true) walk(join(dir, e.name), at); continue }
    if (e.name.endsWith('.json')) found.push(at)
  }
}
walk(FN)
const named = (at) => {
  const base = at.replace(/\.json$/, '')
  if (PUBLISHED[base] || PUBLISHED[base.replace(/^emails\//, '')] && base.startsWith('emails/')) return true
  if (base === 'emails/compiled' && PUBLISHED.emails) return true
  if (base === 'emails/funnels' && PUBLISHED.funnels) return true
  return !!LIVE[at] || !!FIXED[at]
}
for (const at of found) {
  ok(at + ' says how it reaches a deployment that does not build', named(at),
    'add it to PUBLISHED (a publish compiles it), LIVE (the function builds it from the rows) or FIXED (with the reason) in build/artefacts.mjs')
}
if (SITE.deployment.backend) {
  ok('there are artefacts to check', found.length > 5, String(found.length))
} else {
  console.log('  (static deployment: the function artefact count is not a deployment gate)')
}

/* ---- 2. a published artefact is wired end to end ---- */
{
  const models = readFileSync(join(KIT, 'build', 'models', 'index.mjs'), 'utf8')
  const overlay = readFileSync(join(KIT, 'supabase', 'functions', '_shared', 'compiled.ts'), 'utf8')
  for (const key of Object.keys(PUBLISHED)) {
    ok(key + ' is compiled by a publish', new RegExp('^\\s*' + key + ':\\s*async', 'm').test(models),
      'build/models/index.mjs COMPILE needs an entry for ' + key)
    ok(key + ' is fed by at least one model', new RegExp("'" + key + "'").test(models.slice(models.indexOf('const FEEDS'), models.indexOf('const COMPILE'))),
      'build/models/index.mjs FEEDS needs a model whose records make ' + key)
    ok(key + ' is read through the overlay', overlay.includes("'" + key + "'"),
      '_shared/compiled.ts must list ' + key + ' so the row is read over the file')
  }
}

/* ---- 3. the compile works from content alone ----
 *
 * An Edge Function has content and nothing else: no .velite, no build output, no package directory.
 * So the same compile is run twice over this checkout — once as the build runs it, and once through
 * a BLIND store that answers nothing outside content/ — and the two must be identical.
 *
 * It needs no database and runs on every site, which is the point: the two gaps this caught were
 * the checkout's words (uiScope loading the theme off a disk) and the events (a velite collection
 * a store holding rows does not have), and both were invisible until something looked.
 */
{
  const { asStore } = await import('./store/index.mjs')
  const git = asStore(ROOT)
  const blind = { ...git, read: async (at) => (String(at).startsWith('content/') ? git.read(at) : null) }
  const themeAt = join(ROOT, 'supabase/functions/_shared/pipe/theme-strings.json')
  const theme = existsSync(themeAt) ? JSON.parse(readFileSync(themeAt, 'utf8')) : null
  const both = async (name, make) => {
    let a = null, b = null
    try { a = await make(git, null) } catch (e) { ok(name + ' compiles for the build', false, e.message); return }
    try { b = await make(blind, theme) } catch (e) { ok(name + ' compiles from content alone', false, e.message); return }
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      ok(name + ': ' + k + ' is the same from content alone', JSON.stringify(a[k]) === JSON.stringify(b[k]),
        'the build sees something in ' + k + ' that an Edge Function cannot — hand it in, or read it from content')
    }
  }
  await both('catalog', async (store, theme) => (await import('./catalog.mjs')).compileCatalog({ store, theme, root: ROOT }))
  await both('forms', async (store) => (await (await import('./forms.mjs')).compileForms(store)).forms)
  await both('funnels', async (store) => (await import('./funnels.mjs')).compileFunnels({ store, write: false, offers: (() => { try { return JSON.parse(readFileSync(join(ROOT, 'supabase/functions/_shared/catalog.json'), 'utf8')).offers } catch { return null } })() }))
}

console.log('\nartefacts: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
