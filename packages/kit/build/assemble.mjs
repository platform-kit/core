/*
 * The site's supabase/ tree, assembled from two owners — the kit's data layer (packages/kit/supabase: the
 * declared schema under schemas/, the data script, every function with its _shared, the seed's shape) and
 * the site's own (platformkit.config.js `data`: `schemas`, `rows`, `functions`, `seed` — ./db/{schemas,
 * data.sql,functions,seed.sql} by default). The database is a DECLARATION, never a history: supabase/schemas/
 * holds the kit's files as they are, then the site's under schemas/site/, and `db reset` applies them in that
 * order, then data.sql (the kit's rows and the site's, every statement idempotent), then the seed —
 * the CLI's own reset, through `[db.seed] sql_paths`, which the assembler writes into the site's config.toml.
 * A database already holding data is brought to the declaration by a plan (plan.mjs), never by a migration:
 * supabase/migrations/ is not assembled, not read, and a site that still has one is told so. The kit's
 * functions and the site's side by side, `_shared` the kit's; the seed the kit's shape followed by the
 * site's rows. Files, never cross-package imports: Deno sees one directory.
 *
 * The assembled tree is GENERATED, NEVER COMMITTED: dev, migrate, test and deploy each assemble it
 * before they use it, so a site repository holds its db/ and supabase/config.toml and ignores the rest.
 * A committed copy only records the kit it was assembled from, and drifts from the next one. `--check`
 * refuses a tree that differs from what its sources assemble to, and what no assembly fixes — a file
 * neither owner declared, a migrations folder, an unresolved import — so nothing is edited in supabase/
 * by hand; `platformkit test` assembles first, so there it catches only those. What the build writes into the tree —
 * the catalog, the compiled emails, the funnels, the strings — is the site's and is left alone.
 * A site that declares no backend (deployment.backend: false) has no data layer: the assembler does
 * nothing for it, and neither does the deploy, so no supabase/ tree is ever written or checked.
 *
 * Run: node packages/kit/build/assemble.mjs [--check]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { loadSite, deploymentShape, pipeSiteConfigSource } from './site.mjs'
import { moduleSet } from './steps.mjs'
import { assertNoManualCron, cronSql } from './cron.mjs'
import { accessOf, accessSql, communityAccessOf } from './network-access.mjs'
import { closure, PIPE_ROOTS, PIPE_SKIP } from './pipe-closure.mjs'
import {
  HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION,
  paymentProviderConfigurationOf,
  paymentProviderIdOf,
  paymentProviderRegistrySource,
  STRIPE_PAYMENT_PROVIDER_REGISTRATION,
} from './payment-provider-registry.mjs'

/* a refusal is one line, never a stack */
process.on('uncaughtException', (e) => { console.error('✖ ' + (e.message || e)); process.exit(1) })
const KIT = fileURLToPath(new URL('../supabase/', import.meta.url))
const ROOT = process.cwd()
const c = await loadSite(ROOT)
/*
 * A SITE THAT HAS SAID IT HAS NO BACKEND HAS NO DATA LAYER TO ASSEMBLE.
 *
 * `deployment: { backend: false }` is the static shape: a checkout, a build, a static host, no
 * Supabase anywhere. The deploy already knew this (`assemble: backend` in deployPlan); dev and
 * `npm test` did not, so running either in sites/docs or sites/brochure wrote a 6 MB supabase/
 * tree — a declared schema, every Edge Function, a config.toml naming ports — for a database that
 * site has declared it does not have. The decision belongs here, once, so all three agree, and
 * --check passes for such a site rather than demanding a tree it should never hold.
 */
if (deploymentShape(c).backend === false) {
  console.log('supabase/: nothing to assemble — this site declares no backend (deployment.backend: false)')
  process.exit(0)
}
const D = { schemas: 'db/schemas', rows: 'db/data.sql', functions: 'db/functions', seed: 'db/seed.sql', ...(c.data || {}) }
if (D.migrations) throw new Error('assemble: data.migrations is gone — a site declares its schema in db/schemas/*.sql (data.schemas) and its rows in db/data.sql (data.rows); a database is brought to the declaration by `platformkit migrate --plan`, never by a migration')
const OUT = path.join(ROOT, 'supabase')
const MANIFEST = path.join(OUT, '.assembled.json')
/* the build's own files in the functions tree, never assembled and never removed — and never
   committed either: build/functions-data.mjs makes every one of them, and steps.test.mjs holds
   the two lists together, so a file added here that nothing makes fails the suite */
export const BUILT_PATHS = [
  'functions/_shared/catalog.json', 'functions/_shared/content/index.json',
  'functions/_shared/analytics.json', 'functions/_shared/cloud.json', 'functions/_shared/webhooks.json',
  'functions/_shared/bots.json', 'functions/_shared/commands.json',
  'functions/_shared/spaces.json', 'functions/_shared/teams.json', 'functions/_shared/forms.json',
  'functions/_shared/emails/compiled.json', 'functions/_shared/emails/funnels.json',
  'functions/_shared/emails/strings.json', 'functions/cal-webhook/strings.json',
]
export const BUILT = /^functions\/(_shared\/catalog\.json|_shared\/content\/index\.json|_shared\/analytics\.json|_shared\/cloud\.json|_shared\/webhooks\.json|_shared\/(bots|commands)\.json|_shared\/(spaces|teams)\.json|_shared\/forms\.json|_shared\/emails\/(compiled|funnels|strings)\.json|cal-webhook\/strings\.json)$/
/* what db reset applies, in order: the declaration (the kit's files, then the site's), the rows, the seed */
export const SEED_PATHS = ['./schemas/*.sql', './schemas/site/*.sql', './data.sql', './seed.sql']

const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []
const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 12)
const rel = (base, f) => path.relative(base, f).split(path.sep).join('/')

/* what the tree should hold: published path → { from, content } */
const plan = new Map()
const put = (to, from) => { if (plan.has(to)) throw new Error(`assemble: ${to} comes from both ${plan.get(to).from} and ${from}`); plan.set(to, { from, content: fs.readFileSync(from) }) }
/* the declaration: the kit's schema files by name, the site's under site/ */
const kitSchemas = walk(path.join(KIT, 'schemas')).filter((f) => f.endsWith('.sql')).sort()
const siteSchemas = walk(path.resolve(ROOT, D.schemas)).filter((f) => f.endsWith('.sql')).sort()
for (const f of kitSchemas) put('schemas/' + path.basename(f), f)
for (const f of siteSchemas) put('schemas/site/' + path.basename(f), f)
/* the rows: the kit's data script, the site's after it */
const kitRows = fs.readFileSync(path.join(KIT, 'data.sql'), 'utf8')
const siteRowsFile = path.resolve(ROOT, D.rows)
const siteRows = fs.existsSync(siteRowsFile) ? fs.readFileSync(siteRowsFile, 'utf8') : ''
assertNoManualCron(kitRows, 'packages/kit/supabase/data.sql')
assertNoManualCron(siteRows, D.rows)
const modules = await moduleSet(c)
const rows = kitRows.trimEnd() + (siteRows.trim() ? '\n\n-- the site\'s rows (' + D.rows + ')\n' + siteRows.trimEnd() : '')
/* who takes part in the network, from the config (network.access): a fault refuses the assembly */
const access = accessOf(c, ROOT)
if (access.faults.length) throw new Error(access.faults.join('\n'))
/* who enters each place of the community (community.access, places[].access): the same */
const places = communityAccessOf(c, ROOT)
if (places.faults.length) throw new Error(places.faults.join('\n'))
plan.set('data.sql', {
  /* the cron block is last: it is derived from the manifests, and manifests.test holds data.sql to end with it */
  from: 'the kit\'s data.sql + ' + D.rows + ' + network.access + community.access + enabled module cron declarations',
  content: Buffer.from(rows + accessSql(c.modules && c.modules.network === false ? null : access.rules, places.rules) + cronSql(modules, c.modules || {}) + '\n'),
})
/* functions: the kit's whole tree, then the site's (a site function of the kit's name is refused) */
for (const f of walk(path.join(KIT, 'functions'))) put('functions/' + rel(path.join(KIT, 'functions'), f), f)
const siteFn = path.resolve(ROOT, D.functions)
for (const f of walk(siteFn)) { const r = rel(siteFn, f); if (path.basename(r) === '.gitkeep') continue; put('functions/' + r, f) }
plan.set('functions/_shared/payment-provider.d.ts', {
  from: 'the published server-side payment provider contract',
  content: Buffer.from(fs.readFileSync(path.join(KIT, '..', 'src', 'payment-provider.d.ts'))),
})
{
  const selectedProvider = paymentProviderIdOf(c)
  const registrations = [
    STRIPE_PAYMENT_PROVIDER_REGISTRATION,
    ...(selectedProvider === 'hyperswitch' ? [HYPERSWITCH_PAYMENT_PROVIDER_REGISTRATION] : []),
    ...[...modules.values()]
    .filter((module) => c.modules?.[module.key] !== false)
    .flatMap((module) => module.paymentProviders),
  ]
  for (const registration of registrations) {
    const adapterPath = `functions/_shared/${registration.adapter}`
    if (!plan.has(adapterPath)) throw new Error(`assemble: payment provider "${registration.id}" adapter is missing from ${D.functions}/_shared/${registration.adapter}`)
  }
  plan.set('functions/_shared/payment-provider-registry.ts', {
    from: 'the enabled site module payment-provider registrations',
    content: Buffer.from(paymentProviderRegistrySource(
      registrations,
      selectedProvider,
      paymentProviderConfigurationOf(c),
      { typescript: true },
    )),
  })
}
/* The content pipe, for the admin and agent functions: shared modules are copied under one
   `_shared/pipe/` tree with their relative imports intact. A function's deno.json import map is
   scoped to its own directory and does not resolve bare imports from this shared tree, so those
   imports are rewritten to the explicit npm:/jsr: targets declared by the consuming functions. */
/* THE PIPE IS ONE DEFINITION, and it is build/pipe-closure.mjs — the roots, the skip list and the
   walk. It was two for a while: this file kept its own copy, and a module added to the skip list
   there went on being copied into the function from here. Never re-declare either list. */
const KIT_PKG = path.resolve(KIT, '..')
const pipeImportMaps = [...plan]
  .filter(([name]) => /^functions\/[^/]+\/deno\.json$/.test(name))
  .flatMap(([file, { content }]) => {
    const imports = JSON.parse(content.toString()).imports || {}
    return Object.entries(imports).map(([key, target]) => ({ file, key, target }))
  })
const sharedSpecifier = (specifier, importer, { lenient = false, only = null } = {}) => {
  if (/^(?:\.{1,2}\/|\/|npm:|jsr:|node:|https?:|data:)/.test(specifier)) return specifier
  const matches = pipeImportMaps.filter(({ file }) => !only || file === only).filter(({ key }) => specifier === key || specifier.startsWith(key.endsWith('/') ? key : key + '/'))
  if (!matches.length && lenient) return specifier
  if (!matches.length) throw new Error(`assemble: shared Edge module ${importer} imports "${specifier}" but no function deno.json maps it`)
  const longest = Math.max(...matches.map(({ key }) => key.length))
  const resolved = new Set(matches.filter(({ key }) => key.length === longest).map(({ file, key, target }) => {
    if (typeof target !== 'string') throw new Error(`assemble: invalid Deno import map target for "${key}" in ${file}`)
    const suffix = specifier.slice(key.length)
    if (/^(?:npm|jsr|node):/.test(target)) return target + suffix
    if (target.startsWith('./') || target.startsWith('../')) {
      const mapped = path.posix.normalize(path.posix.join(path.posix.dirname(file), target, suffix))
      let relative = path.posix.relative(path.posix.dirname(importer), mapped)
      if (!relative.startsWith('.')) relative = './' + relative
      return relative
    }
    return target + suffix
  }))
  if (resolved.size !== 1) throw new Error(`assemble: functions declare conflicting Deno import maps for shared import "${specifier}" in ${importer}`)
  return [...resolved][0]
}
const sharedStaticImportPattern = /^(\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?)(['"])([^'"]+)\2/gm
const sharedDynamicImportPattern = /(\bimport\s*\(\s*)(['"])([^'"]+)\2/g
for (const [r, abs] of closure(KIT_PKG, PIPE_ROOTS, PIPE_SKIP)) {
  const target = 'functions/_shared/pipe/' + r
  plan.set(target, { from: abs, content: fs.readFileSync(abs) })
}

/* THE PRINT FUNCTION'S OWN. print-render sets a book where there is no machine, and the three
   things it needs are already written and already pure: the typesetter (which never touched a
   filesystem, and is the reason that function is small), the run planner, and the wasm driver
   behind the compiler seam. They are copied flat, under their own names, because nothing else in
   the functions imports them and a print/ folder says what they are for. */
const PRINT_MODULES = {
  'typeset.js': 'build/print/typeset.mjs',
  'plan-pieces.js': 'build/print/plan-pieces.mjs',
  'wasm-compiler.js': 'build/print/typeset/wasm-compiler.js',
  /* NOT compiler.js: the seam names both drivers as literal specifiers, one of them the native
     binary's, and nothing in the functions asks it which driver to use — the function always wants
     wasm and says so. Its one pure part is readback.js. */
  'readback.js': 'build/print/typeset/readback.js',
  'picture.js': 'build/print/picture.js',
  'cover-source.js': 'build/print/cover-source.mjs',
  'provider.js': 'build/print/provider.mjs',
  'edition.js': 'build/print/edition.mjs',
  'index-io.js': 'build/print/index-io.mjs',
  'epub.js': 'build/print/epub.mjs',
}
for (const [name, r] of Object.entries(PRINT_MODULES)) {
  const abs = path.join(KIT_PKG, r)
  if (!fs.existsSync(abs)) continue
  /* the typesetter reaches one module of the kit's src; the copy reaches the copy beside it */
  /* they are copied flat under .js names, so an import of one by another is brought to its copy */
  const text = fs.readFileSync(abs, 'utf8').replace(/from '\.\.\/\.\.\/src\/lib\/speech\.js'/g, "from './speech.js'")
    .replace(/from '\.\/([a-z-]+)\.mjs'/g, "from './$1.js'")
  plan.set('functions/_shared/print/' + name, { from: abs, content: Buffer.from(text) })
}
{
  const speech = path.join(KIT_PKG, 'src/lib/speech.js')
  if (fs.existsSync(speech)) put('functions/_shared/print/speech.js', speech)
}
/* AND THE TEMPLATES, compiled in rather than fetched: book.typ and cover.typ are a few tens of
   kilobytes, they change when the code changes, and a function holding a template that did not
   match its own code would set a book nobody could explain. The TYPE is the other way — large,
   almost never changed — and is fetched from the bucket once per worker. */
{
  const dir = path.join(KIT_PKG, 'build/print')
  const t = {}
  if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir).sort()) if (n.endsWith('.typ')) t[n] = fs.readFileSync(path.join(dir, n), 'utf8')
  if (Object.keys(t).length) plan.set('functions/_shared/print/templates.json', { from: dir, content: Buffer.from(JSON.stringify(t, null, 2) + '\n') })
}
/* THE AGENT LOOP'S OWN DECISION, where the worker can reach it. It is pure — no imports at all —
   and it is tested under Node from src/lib, so the copy here is the same file rather than a second
   version of the same reasoning, which is the thing that always drifts. */
put('functions/_shared/agents/loop.js', path.resolve(KIT_PKG, 'src/lib/agents/loop.js'))
/* and what a line SAYS, for the same reason: the worker builds the transcript a bot is given, and
   there must not be a second opinion about what a platform line or a voice note reads as. */
put('functions/_shared/agents/model.js', path.resolve(KIT_PKG, 'src/lib/spaces/model.js'))
put('functions/_shared/chat/markup.js', path.resolve(KIT_PKG, 'src/lib/chat/markup.js'))
/* model.js re-exports a few of the chat's own helpers, so that file comes too — both are pure */
put('functions/_shared/chat/model.js', path.resolve(KIT_PKG, 'src/lib/chat/model.js'))
/* and the recurrence rules, for the same reason: the worker asks what a schedule owes it, and
   there must not be a second copy of what "every third Friday" means. */
plan.set('functions/_shared/recurrence.js', { from: 'src/lib/recurrence.js', content: fs.readFileSync(path.resolve(KIT_PKG, 'src/lib/recurrence.js')) })
/* the share card's fit rule: SharePage sizes the card with it in the bundle and the share-image
   function sizes the same card with it here, so a long title is stepped down the same way in both */
plan.set('functions/_shared/share-card.js', { from: 'src/lib/share-card.js', content: fs.readFileSync(path.resolve(KIT_PKG, 'src/lib/share-card.js')) })
plan.set('functions/_shared/pipe/site.js', { from: 'platformkit.config.js', content: Buffer.from(pipeSiteConfigSource(c)) })
if (c.admin && c.admin.models) {
  const siteBase = ROOT, entry = rel(ROOT, path.resolve(ROOT, c.admin.models))
  for (const [r, abs] of closure(siteBase, [entry], /^(node_modules|packages)\//)) {
    const depth = r.split('/').length - 1
    const up = '../'.repeat(depth + 1)   /* from pipe/site/<r> back to pipe/ */
    const text = fs.readFileSync(abs, 'utf8').replace(/from '@platform-kit\/kit\/(build|src)\//g, `from '${up}$1/`).replace(/import\('@platform-kit\/kit\/(build|src)\//g, `import('${up}$1/`)
    plan.set('functions/_shared/pipe/site/' + r, { from: abs, content: Buffer.from(text) })
  }
  plan.set('functions/_shared/pipe/site/index.js', { from: c.admin.models, content: Buffer.from(`export { models } from './${entry}'\n`) })
} else plan.set('functions/_shared/pipe/site/index.js', { from: 'platformkit.config.js', content: Buffer.from('export const models = []\n') })
/* AND THE REST OF THE SHARED TREE, for the same reason: `_shared/api/richtext.js` and `_shared/emails/markdown.js`
   import `marked` bare (Node reads them too, through node_modules), and no function's deno.json reaches them, so every
   function that imported either failed to boot — content, storefront-api, agent-run, admin, providers. Outside the
   pipe a bare import no function maps is left as written: only Node and the browser read such a module. */
for (const [target, entry] of plan) {
  if (!target.startsWith('functions/_shared/') || !/\.(?:[cm]?js|ts)$/.test(target)) continue
  const lenient = !target.startsWith('functions/_shared/pipe/')
  const rewrite = (_, prefix, quote, specifier) => `${prefix}${quote}${sharedSpecifier(specifier, target, { lenient })}${quote}`
  const content = entry.content.toString('utf8')
    .replace(sharedStaticImportPattern, rewrite)
    .replace(sharedDynamicImportPattern, rewrite)
  plan.set(target, { ...entry, content: Buffer.from(content) })
}
/* AND EVERY FUNCTION'S OWN FILES, through its own deno.json: the local runtime applies no function's import map at all
   (images failed on its own `@cf-wasm/photon/others`, which its deno.json maps), and a written-out npm: target needs
   none — so what boots does not depend on how a runtime reads deno.json, here or deployed. */
for (const [target, entry] of plan) {
  const fn = /^functions\/([^/_][^/]*)\/.+\.(?:[cm]?js|ts)$/.exec(target)?.[1]
  if (!fn || !plan.has(`functions/${fn}/deno.json`)) continue
  const rewrite = (_, prefix, quote, specifier) => `${prefix}${quote}${sharedSpecifier(specifier, target, { lenient: true, only: `functions/${fn}/deno.json` })}${quote}`
  const content = entry.content.toString('utf8')
    .replace(sharedStaticImportPattern, rewrite)
    .replace(sharedDynamicImportPattern, rewrite)
  plan.set(target, { ...entry, content: Buffer.from(content) })
}
/* the theme's default strings, by scope, for the pipe's words in the function (the theme's manifest is not there to read) */
{
  const { loadTheme } = await import('./theme.mjs'); const { readScopes } = await import('./strings-io.mjs')
  const theme = await loadTheme(c)
  const scopes = readScopes(theme.strings)
  const out = {}; for (const [k, v] of Object.entries(scopes)) out[k] = { groups: v.groups }
  plan.set('functions/_shared/pipe/theme-strings.json', { from: theme.strings, content: Buffer.from(JSON.stringify(out) + '\n') })
}
/* the theme's default SKILLS, for the pipe: a bot in an Edge Function has no package directory to
   read them from, and a site's skill of the same name replaces one whole. Same arrangement as the
   theme's strings above, and for the same reason. */
{
  const { loadTheme } = await import('./theme.mjs')
  const theme = await loadTheme(c)
  const out = {}
  try { for (const f of fs.readdirSync(theme.skills).filter((x) => x.endsWith('.md'))) out[f.slice(0, -3)] = fs.readFileSync(path.join(theme.skills, f), 'utf8') } catch { /* a theme with none */ }
  plan.set('functions/_shared/pipe/theme-skills.json', { from: theme.skills, content: Buffer.from(JSON.stringify(out) + '\n') })
}

/* the theme's BRAND for the pipe: the three faces its looks set (--fd, --f, --m) and the site's
   mark as flat SVG. Both are code rather than content — they cannot change on a publish — and the
   Edge Function has no stylesheet and no Vue to read them from, so they are bundled here the way
   the theme's strings and skills are. The share-image function sets the card in them. */
{
  const { fontsOf, markOf } = await import('./fonts.mjs')
  const { accentOf } = await import('./fonts.mjs')
  const out = { fonts: await fontsOf(c.root), mark: await markOf(c.root, { size: 26, stroke: '__STROKE__' }), accent: await accentOf(c.root) }
  plan.set('functions/_shared/pipe/theme-brand.json', { from: 'src/looks + components/SiteMark.vue', content: Buffer.from(JSON.stringify(out) + '\n') })
}

/*
 * THE ENRICHMENT'S BRIEFS, for the pipe. The six stage prompts are the SITE's — its voice, never
 * the kit's — and `enrichment.briefs` names them by a path under the site. On a machine the script
 * resolves that path; a function resolves nothing by path and has no site directory to resolve it
 * against, so they are compiled to text here, exactly as the theme's strings and the bots' skills
 * are and for exactly the same reason.
 *
 * They are code, not content: a publish cannot change them, and a stage prompt that changed without
 * a deploy would quietly make every cached result stale. So this is the right place, and the cache
 * keys that include the prompt version stay honest.
 */
{
  const out = {}
  const named = c.enrichment && c.enrichment.briefs
  if (named) {
    try {
      const m = await import(pathToFileURL(path.resolve(c.root, named)).href)
      for (const k of ['UNDERSTAND', 'INTRODUCE', 'EXTRACT', 'WRITE', 'AUDIT', 'BOOK_LINES']) if (typeof m[k] === 'string') out[k] = m[k]
    } catch (e) { console.warn('  ! the enrichment briefs (' + named + ') could not be read — a cloud run would have no voice to write in: ' + e.message) }
  }
  /*
   * WRITTEN EVEN WHEN IT IS EMPTY. agent-run imports this file by a literal specifier, and the edge
   * runtime resolves every literal specifier it sees — so a site that names no briefs (the demo, any
   * site with no books) would get a functions tree that does not boot, not one function that fails.
   * An empty object is the honest answer and the job refuses on it with a line saying why.
   */
  plan.set('functions/_shared/pipe/enrichment-briefs.json', { from: named || 'platformkit.config.js (enrichment.briefs names none)', content: Buffer.from(JSON.stringify(out, null, 1) + '\n') })
}

/* THE KIT'S OWN EMAIL DESIGNS, for the pipe: a site's `content/emails/<kind>.json` overrides one
   whole, and where it has none the kit's is what the build compiles. In an Edge Function there is no
   package directory to fall back to, so they are bundled here — the same arrangement the theme's
   strings have, and for the same reason. */
{
  const dir = path.join(KIT, '..', 'content', 'emails')
  const out = {}
  try { for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { /* a kit with none */ }
  plan.set('functions/_shared/pipe/kit-designs.json', { from: 'packages/kit/content/emails', content: Buffer.from(JSON.stringify(out) + '\n') })
}

/* the seed: the kit's shape, the site's rows */
const kitSeed = fs.readFileSync(path.join(KIT, 'seed.sql'), 'utf8')
const siteSeedFile = path.resolve(ROOT, D.seed)
const siteSeed = fs.existsSync(siteSeedFile) ? fs.readFileSync(siteSeedFile, 'utf8') : ''
plan.set('seed.sql', { from: 'the kit\'s seed.sql + ' + D.seed, content: Buffer.from(kitSeed.trimEnd() + '\n\n' + siteSeed.trimEnd() + '\n') })

/* a config.toml for a site that has none: the kit's template with the site's id, name and port base (data.ports, 54320 by default);
   once written it is the site's own and never touched again but for the seed's paths (emails.mjs writes its block into it) */
const cfg = path.join(OUT, 'config.toml')
const check = process.argv.includes('--check')
if (!fs.existsSync(cfg) && !check) {
  const base = Number(D.ports || 54320)
  const id = (c.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const toml = fs.readFileSync(path.join(KIT, 'config.toml.template'), 'utf8').replace(/\{\{project_id\}\}/g, id).replace(/\{\{name\}\}/g, c.name || 'Site').replace(/\{\{p\+(\d+)\}\}/g, (m, n) => String(base + Number(n)))
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(cfg, toml); console.log(`supabase/config.toml written for ${id} on ports ${base}…`)
}
/* [db.seed] sql_paths names what a reset applies: the one line of the site's config the assembler owns */
const seedLine = `sql_paths = [${SEED_PATHS.map((p) => JSON.stringify(p)).join(', ')}]`
const withSeed = (toml) => {
  const m = /\[db\.seed\]([\s\S]*?)(?=\n\[|$)/.exec(toml)
  if (!m) throw new Error('assemble: supabase/config.toml has no [db.seed] section — add one (enabled = true, sql_paths) so db reset applies the declaration')
  const block = m[1].replace(/^\s*enabled\s*=.*$/m, 'enabled = true').replace(/^\s*sql_paths\s*=.*$/m, seedLine)
  const fixed = /^\s*sql_paths\s*=/m.test(block) ? block : block.replace(/\s*$/, '\n' + seedLine + '\n')
  return toml.slice(0, m.index) + '[db.seed]' + fixed + toml.slice(m.index + m[0].length)
}

const current = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { assembled: [], sha: {} }
/*
 * EVERY RELATIVE IMPORT IN THE ASSEMBLED TREE MUST RESOLVE — and this is checked over the plan, not
 * the disk, so a tree that would not boot is never written.
 *
 * The edge runtime reads every literal specifier it can see, in a guarded branch or a driver map it
 * will never take, and a specifier naming a file that is not there is not that function failing:
 * it is the WHOLE RUNTIME refusing to boot, which arrives as every call to every function answering
 * `name resolution failed`. That reads exactly like a stack that is not up, and it has now cost two
 * afternoons — once because a module was skipped that a literal dynamic import still named, and once
 * because a function imported a pure helper out of the Typst seam, whose driver map names a 44 MB
 * native binary that is rightly not copied.
 *
 * The assembler is where this belongs: it is what decides which files the tree holds.
 */
const SPEC_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
function unresolved(plan) {
  const bad = []
  for (const [k, v] of plan) {
    if (!/^functions\/.*\.(m?js|ts)$/.test(k)) continue
    let text; try { text = v.content.toString('utf8') } catch { continue }
    for (const m of text.matchAll(SPEC_RE)) {
      const spec = m[1] || m[2]
      if (!spec || !spec.startsWith('.')) continue
      const to = path.posix.normalize(path.posix.join(path.posix.dirname(k), spec.split('?')[0]))
      if (plan.has(to) || BUILT.test(to)) continue
      /* a directory import, and an extensionless one, are what Deno does not do anyway */
      bad.push(`${k} → ${spec}`)
    }
  }
  return bad
}

/*
 * THE FUNCTIONS THE GATEWAY MUST LET THROUGH WITHOUT A SUPABASE JWT — a webhook, a Matrix or atproto client, a page's
 * own form — are named by the kit's template (`verify_jwt = false`). A site's config.toml is its own and is written
 * once, so a function added to the kit after it was written was never let through: the gateway answered 401 to every
 * Matrix client and to every payment provider's webhook, before the function ever ran. Each one the tree serves is
 * kept in the site's file here, as [db.seed] is; a section the site wrote itself is left as it is.
 */
const PUBLIC_FUNCTIONS = [...fs.readFileSync(path.join(KIT, 'config.toml.template'), 'utf8').matchAll(/^\[functions\.([a-z0-9-]+)\]\s*\nverify_jwt = false/gm)].map((m) => m[1])
function withPublicFunctions(toml) {
  const missing = PUBLIC_FUNCTIONS.filter((fn) => plan.has(`functions/${fn}/index.ts`) && !new RegExp(`^\\[functions\\.${fn}\\]`, 'm').test(toml))
  return { toml: missing.length ? toml.trimEnd() + '\n' + missing.map((fn) => `\n[functions.${fn}]\nverify_jwt = false\n`).join('') : toml, missing }
}

const manifest = { assembled: [...plan.keys()].sort(), sha: Object.fromEntries([...plan].map(([k, v]) => [k, sha(v.content)])) }
const migrations = walk(path.join(OUT, 'migrations')).filter((f) => f.endsWith('.sql'))

if (check) {
  const bad = []
  for (const [k, v] of plan) { const f = path.join(OUT, k); if (!fs.existsSync(f)) bad.push(`missing ${k}`); else if (sha(fs.readFileSync(f)) !== sha(v.content)) bad.push(`differs ${k} (from ${rel(ROOT, v.from) || v.from})`) }
  for (const k of ['schemas', 'functions']) for (const f of walk(path.join(OUT, k))) { const r = rel(OUT, f); if (!plan.has(r) && !BUILT.test(r) && path.basename(r) !== '.gitkeep') bad.push(`stray ${r} — not from the kit or the site's db/`) }
  for (const u of unresolved(plan)) bad.push(`unresolved ${u} — the edge runtime resolves every literal specifier it sees, so this is the whole runtime refusing to boot, not one function failing`)
  if (migrations.length) bad.push(`supabase/migrations/ holds ${migrations.length} file(s) — nothing reads a migration now: the declaration is supabase/schemas/, and git keeps the history; delete the folder`)
  if (fs.existsSync(cfg) && withSeed(fs.readFileSync(cfg, 'utf8')) !== fs.readFileSync(cfg, 'utf8')) bad.push('config.toml: [db.seed] does not name the declaration, the rows and the seed')
  if (fs.existsSync(cfg)) for (const fn of withPublicFunctions(fs.readFileSync(cfg, 'utf8')).missing) bad.push(`config.toml: [functions.${fn}] verify_jwt = false is missing — the gateway refuses its callers before it runs`)
  for (const d of fs.existsSync(path.join(OUT, 'functions')) ? fs.readdirSync(path.join(OUT, 'functions')) : []) { const dir = path.join(OUT, 'functions', d); if (fs.statSync(dir).isDirectory() && !walk(dir).length) bad.push(`stray functions/${d}/ — an empty directory a removed function left`) }
  if (bad.length) { console.error('✖ supabase/ is not what its sources assemble to — run node packages/kit/build/assemble.mjs; the tree is generated, never edited or committed:\n  ' + bad.join('\n  ')); process.exit(1) }
  console.log(`✔ supabase/ assembled: ${kitSchemas.length} kit + ${siteSchemas.length} site schema file(s), the rows, ${new Set([...plan.keys()].filter((k) => k.startsWith('functions/')).map((k) => k.split('/')[1])).size} function dir(s), the seed`)
  process.exit(0)
}
{
  const u = unresolved(plan)
  if (u.length) { console.error('✖ this tree would not boot — a relative import names a file the plan does not hold:\n  ' + u.join('\n  ')); process.exit(1) }
}
/* write: every planned file, then remove what a previous assembly wrote and this one did not (the migrations it once copied among them) */
let wrote = 0
for (const [k, v] of plan) { const f = path.join(OUT, k); fs.mkdirSync(path.dirname(f), { recursive: true }); if (!fs.existsSync(f) || !fs.readFileSync(f).equals(v.content)) { fs.writeFileSync(f, v.content); wrote++ } }
for (const k of current.assembled || []) if (!plan.has(k) && !BUILT.test(k)) { const f = path.join(OUT, k); if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('  removed ' + k) } }
/* and the directories a removed function leaves empty: the runtime serves a directory as a function, and the run's
   coverage gate counted one (wp-json) that had not existed for a month */
for (const d of fs.existsSync(path.join(OUT, 'functions')) ? fs.readdirSync(path.join(OUT, 'functions')) : []) { const dir = path.join(OUT, 'functions', d); if (fs.statSync(dir).isDirectory() && !walk(dir).length) { fs.rmSync(dir, { recursive: true }); console.log('  removed functions/' + d + '/ (empty)') } }
const migDir = path.join(OUT, 'migrations')
if (fs.existsSync(migDir) && !walk(migDir).length) fs.rmSync(migDir, { recursive: true })
if (walk(migDir).length) console.warn(`  ! supabase/migrations/ still holds ${walk(migDir).length} file(s) nothing reads — delete the folder (git keeps the history); --check refuses it`)
{ const t = fs.readFileSync(cfg, 'utf8'); const u = withSeed(t); if (u !== t) { fs.writeFileSync(cfg, u); console.log('  config.toml: [db.seed] names the declaration, the rows and the seed') } }
{ const { toml, missing } = withPublicFunctions(fs.readFileSync(cfg, 'utf8')); if (missing.length) { fs.writeFileSync(cfg, toml); console.log(`  config.toml: the gateway lets ${missing.join(', ')} through without a Supabase JWT, as the kit's template does`) } }
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(`supabase/ ← the kit's data layer + ${D.schemas}, ${D.rows}, ${D.functions}, ${D.seed}: ${plan.size} file(s), ${wrote} written`)
