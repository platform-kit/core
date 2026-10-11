/*
 * An entry against its model — the checks the parse does not do, pure, shared by the build (velite's prepare,
 * models.mjs --check) and the admin's drawer (per field, as the field is left): required, the rules
 * (rules.js), unique against the other entries, a reference that exists, and shown-when — a field hidden by
 * its condition skips every one of them, which is why none of this is zod. Every failure is worded from the
 * models scope (ctx.words: the scope's groups), so the drawer and the build say the same line.
 *
 *   shownHolds(shown, data)      whether a field's condition holds on this entry
 *   checkEntry(model, data, ctx) → [{ field, message }]  ctx: { siblings, refs, words }
 *   defaultsOf(model)            a new entry's frontmatter
 *   sortEntries(list, model)     in the model's order
 */
import { KINDS, checkRules, fill } from './rules.js'

const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)
export function shownHolds(shown, data) {
  if (!shown) return true
  if (Array.isArray(shown)) return shown.every((c) => shownHolds(c, data))   /* several conditions: every one must hold */
  const v = data ? data[shown.field] : undefined
  if (shown.is === 'empty') return empty(v)
  if (shown.is === 'not-empty') return !empty(v)
  /* ONE OF SEVERAL. A field shown for three of four choices was otherwise written as three
     conditions nobody could read, or as `is-not` against the one exception — which also shows it
     when the field is empty, and empty usually means the question has not been answered yet. */
  if (shown.is === 'in' || shown.is === 'not-in') {
    const list = (Array.isArray(shown.value) ? shown.value : [shown.value]).map(String)
    const has = Array.isArray(v) ? v.map(String).some((x) => list.includes(x)) : list.includes(String(v === undefined || v === null ? '' : v))
    return shown.is === 'not-in' ? !has : has
  }
  const same = Array.isArray(v) ? v.map(String).includes(String(shown.value)) : String(v === undefined || v === null ? '' : v) === String(shown.value === undefined ? '' : shown.value)
  return shown.is === 'is-not' ? !same : same
}
const word = (words, key, ctx) => fill((words && words.rules && words.rules[key] && words.rules[key].message) || `{field}: ${key}`, ctx)

/* the checks the parse does not do: required, the rules, unique, a reference that exists — each skipped while
   the field is hidden. ctx.siblings: the other entries' frontmatter (for unique); ctx.refs: { model: Set(slugs) } */
export function checkEntry(model, data, ctx = {}) {
  const words = ctx.words || {}
  const out = []
  const check = (fields, obj, prefix) => {
    for (const f of fields) {
      if (!prefix && !shownHolds(f.shown, obj)) continue
      const v = obj ? obj[f.key] : undefined
      const c = { field: f.label }
      const at = prefix + f.key
      if (f.required && empty(v)) { out.push({ field: at, message: word(words, 'required', c) }); continue }
      if (empty(v)) continue
      if (f.kind === 'group') { check(f.fields, v, at + '.'); continue }
      if (f.kind === 'list') {
        if (f.of === 'group') (Array.isArray(v) ? v : []).forEach((row, i) => check(f.fields, row, `${at}[${i}].`))
        else for (const msg of checkRules(v, f.rules, words.rules, c)) out.push({ field: at, message: msg })
        if (f.of === 'reference' && ctx.refs) for (const slug of Array.isArray(v) ? v : []) if (ctx.refs[f.model] && !ctx.refs[f.model].has(String(slug))) out.push({ field: at, message: word(words, 'reference', { ...c, value: slug }) })
        continue
      }
      for (const msg of checkRules(v, f.rules, words.rules, c)) out.push({ field: at, message: msg })
      if (f.kind === 'reference' && ctx.refs && ctx.refs[f.model]) for (const slug of Array.isArray(v) ? v : [v]) if (!ctx.refs[f.model].has(String(slug))) out.push({ field: at, message: word(words, 'reference', { ...c, value: slug }) })
      if (f.unique && !prefix && ctx.siblings) for (const sib of ctx.siblings) if (sib && String(sib[f.key]) === String(v)) { out.push({ field: at, message: word(words, 'unique', c) }); break }
    }
  }
  check(model.fields, data, '')
  return out
}
export function defaultsOf(model) {
  const out = { published: true }
  for (const f of model.fields) if (f.default !== undefined) out[f.key] = f.default
  return out
}
export function sortEntries(list, model) {
  const by = model.order && model.order.by, dir = model.order && model.order.dir === 'desc' ? -1 : 1
  if (!by) return list
  const f = model.fields.find((x) => x.key === by)
  const num = f && KINDS[f.kind] && KINDS[f.kind].base === 'number'
  return [...list].sort((a, b) => { const x = a[by], y = b[by]; if (x === y) return 0; if (x === undefined || x === null) return 1; if (y === undefined || y === null) return -1; return (num ? x - y : String(x).localeCompare(String(y))) * dir })
}

