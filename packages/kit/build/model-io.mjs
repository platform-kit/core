/*
 * A content model's file, read and written: content/models/<key>.md is the whole model — its name, its fields
 * (each a kind, a label, its checks), its options and how it is delivered — as frontmatter and nothing else;
 * its entries live in the folder beside it, content/models/<key>/<slug>.md. Everything custom is under
 * models/, so a key can never meet a stock collection, a fixed route or an admin view: a site may have a
 * `books` model and the stock books never notice.
 *
 *   readModel(text, name)        → { model, errors }   every fault named: the file, the field, the fault
 *   writeModel(model)            → the file's text: block YAML, keys in one order, so a rerun changes nothing
 *   readModels(store)            → every model file, by name, each with its errors (the cross-model faults too:
 *                                  a reference to a model that is not there)
 *   entryNames(store, key)       the slugs of a model's entries
 *   renameField(store, key, from, to)  the one key rewritten in every entry, the rest byte for byte
 *   renameModel(store, from, to) the file and the folder moved, every reference field in other models carried
 *
 * Every function that touches a file takes the store (build/store) — or a root, which is the checkout — and is
 * async; nothing here opens the disk itself.
 */
import { asStore } from './store/index.mjs'
import matter from 'gray-matter'
import { KINDS, KIND_KEYS, LEAF_KINDS, RULES, RULE_KEYS, rulesFor } from '../src/lib/models/rules.js'

export const DIR = 'content/models'
export const ACCESS = ['guest', 'authenticated', 'paid', 'subscribed']
export const DELIVERY = ['data', 'pages', 'json', 'section']
export const keyOk = (s) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(String(s || ''))
export const fieldKeyOk = (s) => /^[a-z][a-zA-Z0-9]*(?:[_-][a-zA-Z0-9]+)*$/.test(String(s || ''))
/* the keys an entry carries of its own — the file's name, its flag, its body — which no field may take */
export const RESERVED = ['slug', 'path', 'published', 'body', 'raw', 'id', 'metadata', 'toc', 'excerpt']

export const modelNames = async (store) => asStore(store).list(DIR)
export const entryNames = async (store, key) => asStore(store).list(DIR + '/' + key)

/* ---- reading ---- */
const str = (v, d = '') => (v === undefined || v === null ? d : String(v))
const bool = (v, d = false) => (v === undefined || v === null ? d : v === true || v === 'true')
const options = (raw) => (Array.isArray(raw) ? raw : []).map((o) => (o && typeof o === 'object' ? { value: str(o.value), label: str(o.label, str(o.value)) } : { value: str(o), label: str(o) }))

/* one field from the file, normalised: only what its kind needs is kept; faults go to `errors` */
function readField(raw, path, errors, { nested = false } = {}) {
  const f = raw && typeof raw === 'object' ? raw : {}
  const fault = (m) => errors.push(`${path}: ${m}`)
  const key = str(f.key)
  if (!fieldKeyOk(key)) fault(`a field needs a key of letters, digits, - or _, starting with a letter (got "${key}")`)
  else if (!nested && RESERVED.includes(key)) fault(`"${key}" is an entry's own key and cannot be a field`)
  const kind = str(f.kind, 'text')
  if (!KINDS[kind]) fault(`unknown kind "${kind}" — one of ${KIND_KEYS.join(', ')}`)
  else if (nested && !LEAF_KINDS.includes(kind)) fault(`a group or a list cannot hold a ${kind}: one level of structure only`)
  const out = { key, kind, label: str(f.label, key) }
  if (f.help) out.help = str(f.help)
  if (f.default !== undefined && f.default !== null && f.default !== '') out.default = f.default
  if (bool(f.required)) out.required = true
  if (bool(f.unique)) { if (KINDS[kind] && KINDS[kind].base === 'string' && kind !== 'markdown') out.unique = true; else fault('unique is for the text kinds only') }
  if (bool(f.grid)) out.grid = true
  if (f.shown && typeof f.shown === 'object') {
    const is = str(f.shown.is, 'is')
    if (!['is', 'is-not', 'empty', 'not-empty'].includes(is)) fault(`shown-when: unknown comparison "${is}"`)
    out.shown = { field: str(f.shown.field), is }
    if (is === 'is' || is === 'is-not') out.shown.value = f.shown.value
  }
  if (Array.isArray(f.rules) && f.rules.length) {
    out.rules = []
    for (const r of f.rules) {
      const rule = r && typeof r === 'object' ? str(r.rule) : str(r)
      if (!RULES[rule]) { fault(`unknown rule "${rule}" — one of ${RULE_KEYS.join(', ')}`); continue }
      if (KINDS[kind] && !rulesFor(kind).includes(rule)) { fault(`the rule ${rule} does not apply to a ${kind}`); continue }
      const shape = RULES[rule].params
      const p = r && typeof r === 'object' ? r.params : undefined
      const row = { rule }
      if (shape === 'n') { const n = Number(p); if (p === undefined || !Number.isFinite(n)) fault(`${rule} needs a number`); else row.params = n }
      else if (shape === 'range') { const a = Array.isArray(p) ? p.map(Number) : []; if (a.length !== 2 || a.some((x) => !Number.isFinite(x))) fault(`${rule} needs two numbers`); else row.params = a }
      else if (shape === 'list') { const a = Array.isArray(p) ? p.map(String) : p === undefined ? [] : [String(p)]; if (!a.length) fault(`${rule} needs values`); else row.params = a }
      else if (shape === 'none') { /* nothing to take */ }
      else { if (p === undefined || p === '') fault(`${rule} needs a value`); else row.params = String(p); if (shape === 'pattern' && row.params) { try { new RegExp(row.params) } catch { fault(`${rule}: not a valid pattern`) } } }
      out.rules.push(row)
    }
  }
  if (kind === 'select' || kind === 'multi-select') { out.options = options(f.options); if (!out.options.length) fault(`a ${kind} needs options`) }
  if (kind === 'reference') { out.model = str(f.model); if (!out.model) fault('a reference needs a model'); if (bool(f.many)) out.many = true }
  if (kind === 'group') {
    out.fields = (Array.isArray(f.fields) ? f.fields : []).map((g, i) => readField(g, `${path}.fields[${i}]`, errors, { nested: true }))
    if (!out.fields.length) fault('a group needs fields')
    dupKeys(out.fields, path, errors)
  }
  if (kind === 'list') {
    const of = str(f.of, 'text')
    if (of === 'group') { out.of = 'group'; out.fields = (Array.isArray(f.fields) ? f.fields : []).map((g, i) => readField(g, `${path}.fields[${i}]`, errors, { nested: true })); if (!out.fields.length) fault('a list of groups needs fields'); dupKeys(out.fields, path, errors) }
    else if (!LEAF_KINDS.includes(of)) fault(`a list cannot hold a ${of}`)
    else {
      out.of = of
      if (of === 'select') { out.options = options(f.options); if (!out.options.length) fault('a list of selects needs options') }
      if (of === 'reference') { out.model = str(f.model); if (!out.model) fault('a list of references needs a model') }
    }
  }
  return out
}
function dupKeys(fields, path, errors) {
  const seen = new Set()
  for (const f of fields) { if (seen.has(f.key)) errors.push(`${path}: two fields share the key "${f.key}"`); seen.add(f.key) }
}

export function readModel(text, name) {
  const errors = []
  let data
  try { data = matter(text).data || {} } catch (e) { return { model: null, errors: [`${DIR}/${name}.md: ${e.message}`] } }
  const at = `${DIR}/${name}.md`
  const key = str(data.key, name)
  if (key !== name) errors.push(`${at}: the key "${key}" must be the file's name`)
  if (!keyOk(key)) errors.push(`${at}: a key is lower-case letters, digits and hyphens`)
  const fields = (Array.isArray(data.fields) ? data.fields : []).map((f, i) => readField(f, `${at} fields[${i}]`, errors))
  dupKeys(fields, at, errors)
  const keys = fields.map((f) => f.key)
  const title = str(data.title, keys[0] || '')
  if (!fields.length) errors.push(`${at}: a model needs at least one field`)
  else if (!keys.includes(title)) errors.push(`${at}: the title field "${title}" is not one of the model's fields`)
  const slug = str(data.slug, 'title')
  if (slug !== 'title' && !keys.includes(slug)) errors.push(`${at}: the slug's field "${slug}" is not one of the model's fields`)
  const model = {
    key, name: str(data.name, key), singular: str(data.singular, str(data.name, key)), published: data.published !== false,
    title, slug, singleton: bool(data.singleton), body: data.body === true ? 'Body' : data.body ? str(data.body) : false,
    access: (Array.isArray(data.access) ? data.access : []).map(String).filter((a) => ACCESS.includes(a)),
    order: { by: str(data.order && data.order.by, title), dir: str(data.order && data.order.dir, 'asc') === 'desc' ? 'desc' : 'asc' },
    deliver: { data: true, pages: bool(data.deliver && data.deliver.pages), json: bool(data.deliver && data.deliver.json), section: bool(data.deliver && data.deliver.section) },
    fields,
  }
  if (model.order.by && !keys.includes(model.order.by)) errors.push(`${at}: the order's field "${model.order.by}" is not one of the model's fields`)
  for (const f of fields) if (f.shown && !keys.includes(f.shown.field)) errors.push(`${at} field ${f.key}: shown-when names a field the model does not have ("${f.shown.field}")`)
  return { model, errors }
}

/* ---- writing ---- */
function fieldOut(f) {
  const o = { key: f.key, kind: f.kind, label: f.label }
  if (f.help) o.help = f.help
  if (f.default !== undefined) o.default = f.default
  if (f.required) o.required = true
  if (f.unique) o.unique = true
  if (f.grid) o.grid = true
  if (f.shown) { o.shown = { field: f.shown.field, is: f.shown.is }; if ('value' in f.shown) o.shown.value = f.shown.value }
  if (f.rules && f.rules.length) o.rules = f.rules.map((r) => (RULES[r.rule] && RULES[r.rule].params === 'none' ? { rule: r.rule } : { rule: r.rule, params: r.params }))
  if (f.options) o.options = f.options.map((x) => ({ value: x.value, label: x.label }))
  if (f.model) o.model = f.model
  if (f.many) o.many = true
  if (f.of) o.of = f.of
  if (f.fields) o.fields = f.fields.map(fieldOut)
  return o
}
export function writeModel(m) {
  const data = { key: m.key, name: m.name }
  if (m.singular && m.singular !== m.name) data.singular = m.singular
  if (m.published === false) data.published = false
  data.title = m.title
  if (m.slug && m.slug !== 'title') data.slug = m.slug
  if (m.singleton) data.singleton = true
  if (m.body) data.body = m.body === 'Body' ? true : m.body
  if (m.access && m.access.length) data.access = m.access
  if (m.order && (m.order.by !== m.title || m.order.dir === 'desc')) data.order = { by: m.order.by, dir: m.order.dir }
  const d = m.deliver || {}
  if (d.pages || d.json || d.section) { data.deliver = {}; for (const k of ['pages', 'json', 'section']) if (d[k]) data.deliver[k] = true }
  data.fields = (m.fields || []).map(fieldOut)
  return matter.stringify('', data, { lineWidth: -1 })
}

/* ---- the set ---- */
export async function readModels(store) {
  const st = asStore(store)
  const out = []
  for (const name of await modelNames(st)) {
    const { model, errors } = readModel(await st.read(DIR + '/' + name + '.md'), name)
    out.push({ name, model, errors })
  }
  const keys = new Set(out.filter((x) => x.model).map((x) => x.model.key))
  for (const x of out) {
    if (!x.model) continue
    const walk = (fields, at) => { for (const f of fields || []) { if ((f.kind === 'reference' || f.of === 'reference') && f.model && !keys.has(f.model)) x.errors.push(`${DIR}/${x.name}.md field ${at}${f.key}: a reference to a model that is not there ("${f.model}")`); if (f.fields) walk(f.fields, at + f.key + '.') } }
    walk(x.model.fields, '')
  }
  return out.sort((a, b) => ((a.model && a.model.name) || a.name).localeCompare((b.model && b.model.name) || b.name))
}
export const publishedModels = async (store) => (await readModels(store)).filter((x) => x.model && x.model.published && !x.errors.length).map((x) => x.model)

export async function saveModel(store, m) {
  const text = writeModel(m)
  const { errors } = readModel(text, m.key)
  if (errors.length) return { ok: false, errors }
  await asStore(store).write(DIR + '/' + m.key + '.md', text, { collection: 'models', slug: m.key, data: m, body: '' })
  return { ok: true, errors: [] }
}

/* ---- carrying the entries along ---- */
/* the line `from:` at the top level of an entry's frontmatter becomes `to:`; nothing else in the file moves */
export async function renameField(store, key, from, to) {
  const st = asStore(store)
  let n = 0
  for (const slug of await entryNames(st, key)) {
    const p = DIR + '/' + key + '/' + slug + '.md'
    const text = await st.read(p)
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    if (!m) continue
    const re = new RegExp(`^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*:)`, 'm')
    if (!re.test(m[1])) continue
    const fm = m[1].replace(re, `${to}$1`)
    await st.write(p, text.slice(0, m.index + 4) + fm + text.slice(m.index + 4 + m[1].length), { collection: 'models', slug: key + '/' + slug })
    n++
  }
  return n
}
/* the model's file and folder renamed; every other model's reference fields that name it, renamed in their files */
export async function renameModel(store, from, to) {
  const st = asStore(store)
  if (!keyOk(to)) throw new Error('a key is lower-case letters, digits and hyphens')
  if (await st.exists(DIR + '/' + to + '.md') || (await st.list(DIR + '/' + to)).length) throw new Error(`a model "${to}" is already there`)
  const { model, errors } = readModel(await st.read(DIR + '/' + from + '.md'), from)
  if (!model || errors.length) throw new Error(errors.join('; '))
  model.key = to
  await st.write(DIR + '/' + to + '.md', writeModel(model), { collection: 'models', slug: to, data: model })
  await st.remove(DIR + '/' + from + '.md')
  for (const slug of await st.list(DIR + '/' + from)) await st.rename(DIR + '/' + from + '/' + slug + '.md', DIR + '/' + to + '/' + slug + '.md')
  for (const f of await st.list(DIR + '/' + from, { ext: '' })) if (!f.endsWith('.md')) await st.rename(DIR + '/' + from + '/' + f, DIR + '/' + to + '/' + f)   /* the entries' uploads beside them */
  let carried = 0
  for (const x of await readModels(st)) {
    if (!x.model || x.name === to) continue
    let touched = false
    const walk = (fields) => { for (const f of fields || []) { if (f.model === from) { f.model = to; touched = true } if (f.fields) walk(f.fields) } }
    walk(x.model.fields)
    if (touched) { await st.write(DIR + '/' + x.name + '.md', writeModel(x.model), { collection: 'models', slug: x.name, data: x.model }); carried++ }
  }
  return carried
}
