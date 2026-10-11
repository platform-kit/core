/*
 * describeSchema: a zod object walked into the field metadata the admin UI renders — the one place a model's
 * fields (build/models: the core records' zod, a custom model's derived one) become a form and a grid. UI hints
 * ride on each field as zod .meta({ label, widget, grid, help }), so there is no second list to keep in sync.
 * The core collections' records live in build/models/core/collections.mjs; collectionsFor() is the built-in
 * ones plus every published custom model, for the scripts and tests that want the set without the server.
 */
import { COLLECTIONS } from './models/core/collections.mjs'
import { customModels } from './models/custom.mjs'

/* ---- introspection: a zod object → the field metadata the admin UI renders ---- */
function unwrap(field) {
  let f = field, required = true
  const metas = []
  for (let i = 0; i < 8 && f; i++) {
    if (typeof f.meta === 'function') { const m = f.meta(); if (m) metas.push(m) }
    const t = f.def && f.def.type
    if (t === 'optional' || t === 'nullable' || t === 'default') { required = false; f = f.def.innerType; continue }
    break
  }
  return { base: f, required, meta: Object.assign({}, ...metas) }
}
function baseType(base) {
  const t = base && base.def && base.def.type
  if (t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'enum') return 'enum'
  if (t === 'array') {
    const et = base.def.element && base.def.element.def && base.def.element.def.type
    if (et === 'enum') return 'multienum'
    return et === 'string' ? 'list' : 'raw'
  }
  if (t === 'any' || t === 'unknown') return 'raw'
  return 'string'
}
/* the string values of a z.enum, across zod builds */
function enumValues(base) {
  if (Array.isArray(base.options)) return base.options
  const e = base.def && base.def.entries
  return e ? Object.values(e) : []
}
const titleCase = (s) => s.replace(/(^|_)(\w)/g, (_, a, c) => (a ? ' ' : '') + c.toUpperCase())

export function describeSchema(schema) {
  const shape = schema.shape
  return Object.keys(shape).map((name) => {
    const { base, required, meta } = unwrap(shape[name])
    const type = baseType(base)
    /* a z.enum drives a single-choice dropdown, an array of z.enum a fixed multi-
       select: the enum values become the options either way */
    const choices = meta.choices ? meta.choices : type === 'enum' ? enumValues(base).map((v) => ({ value: v, label: titleCase(v) }))
      : type === 'multienum' ? enumValues(base.def.element).map((v) => ({ value: v, label: titleCase(v) }))
      : null
    return {
      name, type, required,
      widget: meta.widget || (type === 'enum' ? 'select' : type === 'multienum' ? 'multiselect' : type),
      options: meta.options || null,          /* a canonical-list key for a multiselect */
      choices,                                /* fixed {value,label} list for a select */
      grid: !!meta.grid,
      half: !!meta.half,                      /* two to a row in the drawer */
      readonly: !!meta.readonly,              /* shown, never edited (an offer's key) */
      label: meta.label || titleCase(name),
      help: meta.help || '',
      shown: meta.shown || null,             /* shown only while another field says so: { field, is: is | is-not | empty | not-empty, value } */
      /* a content model's field carries more: its kind, a group's or list's sub-fields, the rows' kind, shown-when, unique, its rules */
      ...(meta.kind ? { kind: meta.kind, fields: meta.fields || null, of: meta.of || null, shown: meta.shown || null, unique: !!meta.unique, rules: meta.rules || [], choices: choices || meta.choices || null } : {}),
    }
  })
}


export async function collectionsFor(store = process.cwd()) {
  const out = {}
  for (const [k, m] of Object.entries(COLLECTIONS)) out[k] = { ...m, schema: m.fields, label: m.name }
  for (const m of await customModels(store)) out[m.key] = { ...m, schema: m.fields, label: m.name }
  return out
}
export const assetsFor = async (colKey, store = process.cwd()) => ((await collectionsFor(store))[colKey] || {}).assets || null
export { COLLECTIONS }
