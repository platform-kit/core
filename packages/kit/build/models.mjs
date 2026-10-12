/*
 * The content models, derived once for everyone: a model (content/models/<key>.md, read by model-io.mjs) is
 * turned into one zod object — for velite, so its entries build into a collection, and for the admin, so
 * its grid and drawer draw themselves — and one check runs over every entry in both places, so the drawer
 * and the build refuse the same file with the same line.
 *
 *   schemaFor(model, s, { admin })      the zod object for the model's fields (velite's `s`, or the admin's `z` with
 *                                       its .meta for describeSchema); the types alone — required, the rules, unique,
 *                                       the references and shown-when are checkEntry's, since a hidden field skips them
 *   checkEntry(model, data, ctx)        → [{ field, message }]  ctx: { siblings, refs, words }
 *   validateEntry(model, data, ctx, s)  the parse and the check together
 *   shownHolds(shown, data)             whether a field's shown-when condition holds
 *   defaultsOf(model)                   a new entry's frontmatter
 *   sortEntries(list, model)            in the model's order
 *   modelWords(root)                    the `models` strings scope, merged (theme under site)
 *   writeJson(root, outDir)             /data/models/<key>.json for every model with JSON on, from .velite
 *
 *   node build/models-check.mjs --check every model and its entries checked, listed
 *   node build/models.mjs --json [dir]  the JSON files written (the build runs it into dist)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'   /* the JSON the build writes into dist: a build output, not content */
import { join } from 'node:path'
import matter from 'gray-matter'
import { asStore } from './store/index.mjs'
import { fill } from '../src/lib/models/rules.js'
import { shownHolds, checkEntry, defaultsOf, sortEntries } from '../src/lib/models/entry.js'
export { shownHolds, checkEntry, defaultsOf, sortEntries }
import { readModels, publishedModels, entryNames, DIR } from './model-io.mjs'

const ROOT = process.cwd()
export const WIDGETS = { text: 'string', 'long-text': 'text', markdown: 'markdown', number: 'number', boolean: 'boolean', date: 'date', datetime: 'datetime', url: 'string', email: 'string', select: 'select', 'multi-select': 'multiselect', tags: 'list', reference: 'select', image: 'image', file: 'file', group: 'group', list: 'rows' }
export const collectionName = (key) => 'models_' + key.replace(/-/g, '_')

/* ---- the derivation ---- */
function leaf(f, s, admin) {
  const k = f.kind
  const opts = f.options && f.options.length ? f.options.map((o) => o.value) : null
  let t
  if (k === 'number') t = s.number()
  else if (k === 'boolean') t = s.boolean()
  else if (k === 'select') t = opts ? s.enum(opts) : s.string()
  else if (k === 'multi-select') t = s.array(opts ? s.enum(opts) : s.string())
  else if (k === 'tags') t = s.array(s.string())
  else if (k === 'reference') t = f.many ? s.array(s.string()) : s.string()
  else if (k === 'image' || k === 'file') t = s.string()   /* an address (/uploads/…, the bucket's), served as it is — media-library */
  else t = s.string()
  return t
}
function fieldSchema(f, s, admin, models) {
  let t
  if (f.kind === 'group') t = s.object(Object.fromEntries(f.fields.map((g) => [g.key, fieldSchema(g, s, admin, models)])))
  else if (f.kind === 'list') t = s.array(f.of === 'group' ? s.object(Object.fromEntries(f.fields.map((g) => [g.key, fieldSchema(g, s, admin, models)]))) : leaf({ ...f, kind: f.of }, s, admin))
  else t = leaf(f, s, admin)
  if (admin && typeof t.meta === 'function') {
    const meta = { label: f.label, help: f.help || '', kind: f.kind, grid: !!f.grid, required: !!f.required }
    const w = WIDGETS[f.kind]
    meta.widget = f.kind === 'reference' && f.many ? 'multiselect' : w
    if (f.kind === 'reference' || f.of === 'reference') meta.options = 'model:' + f.model
    if (f.kind === 'list') { meta.of = f.of; if (f.of === 'select') meta.choices = f.options; if (f.of === 'reference') meta.options = 'model:' + f.model }
    if (f.fields) meta.fields = f.fields.map((g) => ({ key: g.key, kind: g.kind, label: g.label, help: g.help || '', widget: WIDGETS[g.kind], choices: g.options || null, options: g.model ? 'model:' + g.model : null, many: !!g.many, required: !!g.required, rules: g.rules || [] }))
    if (f.shown) meta.shown = f.shown
    if (f.unique) meta.unique = true
    if (f.rules) meta.rules = f.rules
    t = t.meta(meta)
  }
  /* every field is optional to the parse — required is checkEntry's, since a hidden field is not required */
  t = f.default !== undefined ? t.optional().default(f.default) : t.optional()
  return t
}
export function schemaFor(model, s, { admin = false } = {}) {
  const shape = {}
  for (const f of model.fields) shape[f.key] = fieldSchema(f, s, admin)
  return shape
}

/* ---- the check: the pure part is src/lib/models/entry.js (the drawer runs it too); the parse and the check together ---- */
export function validateEntry(model, data, ctx, s) {
  const r = s.object(schemaFor(model, s)).safeParse(data)
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => { const key = String(i.path[0]); const f = model.fields.find((x) => x.key === key); return { field: i.path.join('.'), message: fill((ctx && ctx.words && ctx.words.rules && ctx.words.rules.type && ctx.words.rules.type.message) || '{field}: {value}', { field: (f && f.label) || key, value: i.message }) } }) }
  const errors = checkEntry(model, r.data, ctx)
  return { ok: !errors.length, errors, data: r.data }
}

/* ---- the words ---- */
export async function modelWords(root = ROOT, opts = {}) {
  const { uiScope } = await import('./strings-io.mjs')
  try { return (await uiScope('models', root, opts)) || {} } catch { return {} }   /* a root with no site config (a fixture): the keys alone */
}

/* ---- every entry of every model, read from the files (the build's and the check's) ---- */
export async function readEntries(store, key) {
  const st = asStore(store)
  const out = []
  for (const slug of await entryNames(st, key)) { const { data, content } = matter(await st.read(DIR + '/' + key + '/' + slug + '.md')); out.push({ slug, data, content }) }
  return out
}
export async function checkAll(root = ROOT, opts = {}) {
  const s = opts.s
  if (!s) throw new Error('checkAll requires the schema library from its Node-only caller')
  const words = opts.words || await modelWords(root)
  const faults = []
  const models = await readModels(root)
  for (const x of models) for (const e of x.errors) faults.push(e)
  const live = models.filter((x) => x.model && !x.errors.length).map((x) => x.model)
  const refs = {}
  for (const m of live) refs[m.key] = new Set(await entryNames(root, m.key))
  const report = []
  for (const m of live) {
    const entries = await readEntries(root, m.key)
    for (const e of entries) {
      const r = validateEntry(m, e.data, { siblings: entries.filter((o) => o !== e).map((o) => o.data), refs, words }, s)
      for (const err of r.errors) faults.push(`${DIR}/${m.key}/${e.slug}.md: ${err.message}`)
    }
    report.push({ key: m.key, name: m.name, published: m.published, fields: m.fields.length, entries: entries.length, deliver: Object.keys(m.deliver).filter((k) => m.deliver[k]) })
  }
  return { faults, report }
}

/* ---- the JSON: the published entries of a model with JSON on, from .velite, the body as markdown — one object
   the build writes to dist/data/models/<key>.json and the dev server answers at the same address ---- */
export function jsonFor(root, m) {
  if (!m || !m.deliver.json) return null
  const p = join(root, '.velite', collectionName(m.key) + '.json')
  if (!existsSync(p)) return null
  const entries = JSON.parse(readFileSync(p, 'utf8'))
  const list = (Array.isArray(entries) ? entries : [entries]).map((e) => { const { body, raw, path, ...rest } = e; return raw !== undefined ? { ...rest, body: raw } : rest })
  return { model: { key: m.key, name: m.name, fields: m.fields.map((f) => ({ key: f.key, kind: f.kind, label: f.label })) }, entries: list }
}
export async function writeJson(root = ROOT, outDir = join(root, 'dist')) {
  const written = []
  for (const m of await publishedModels(root)) {
    const out = jsonFor(root, m)
    if (!out) continue
    mkdirSync(join(outDir, 'data', 'models'), { recursive: true })
    writeFileSync(join(outDir, 'data', 'models', m.key + '.json'), JSON.stringify(out, null, 2) + '\n')
    written.push(m.key)
  }
  return written
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const args = process.argv.slice(2)
  if (args.includes('--json')) {
    const i = args.indexOf('--json'); const dir = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : join(ROOT, 'dist')
    const w = await writeJson(ROOT, dir)
    console.log(`✔ models: ${w.length} JSON file(s)${w.length ? ' — ' + w.join(', ') : ''} → ${dir}/data/models`)
  } else {
    console.error('Run node build/models-check.mjs [--check] to validate models.')
    process.exitCode = 1
  }
}
