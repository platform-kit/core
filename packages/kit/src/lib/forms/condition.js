/*
 * A display or jump condition as rows — a field, a comparison, a value — and back as the nunjucks
 * expression the document keeps. The builder edits rows and never shows the expression; a condition
 * written by hand that these rows cannot say is shown as it is and kept unless cleared. Pure.
 *
 *   rowsOf("topic == 'Other' and age > 18")  → [{ field: 'topic', op: 'is', value: 'Other' }, { field: 'age', op: 'gt', value: '18' }]
 *   exprOf(rows)                              → "topic == 'Other' and age > 18"
 */
export const OPS = ['is', 'isnot', 'contains', 'gt', 'lt', 'set', 'unset']
const NAME = "[a-zA-Z_$][a-zA-Z0-9_$]*"
const VAL = `'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"|(-?\\d+(?:\\.\\d+)?)`
const ROW = [
  [new RegExp(`^(${NAME})\\s*==\\s*(?:${VAL})$`), 'is'],
  [new RegExp(`^(${NAME})\\s*!=\\s*(?:${VAL})$`), 'isnot'],
  [new RegExp(`^(?:${VAL})\\s+in\\s+(${NAME})$`), 'contains'],
  [new RegExp(`^(${NAME})\\s*>\\s*(?:${VAL})$`), 'gt'],
  [new RegExp(`^(${NAME})\\s*<\\s*(?:${VAL})$`), 'lt'],
  [new RegExp(`^not\\s+(${NAME})$`), 'unset'],
  [new RegExp(`^(${NAME})$`), 'set'],
]
const unq = (m, from) => { for (let i = from; i < from + 3; i++) if (m[i] !== undefined) return m[i].replace(/\\(['"])/g, '$1') ; return '' }

/* the rows a condition says, or null when it is not one these rows can say */
export function rowsOf(cond) {
  const c = String(cond || '').trim().replace(/^\((.*)\)$/s, '$1').trim()
  if (!c) return []
  const parts = c.split(/\s+and\s+/)
  const rows = []
  for (const p of parts) {
    const part = p.trim().replace(/^\((.*)\)$/s, '$1').trim()
    let ok = false
    for (const [re, op] of ROW) {
      const m = re.exec(part)
      if (!m) continue
      if (op === 'contains') rows.push({ field: m[4], op, value: unq(m, 1) })
      else if (op === 'set' || op === 'unset') rows.push({ field: m[1], op, value: '' })
      else rows.push({ field: m[1], op, value: unq(m, 2) })
      ok = true; break
    }
    if (!ok) return null
  }
  return rows
}
const lit = (v) => (/^-?\d+(\.\d+)?$/.test(String(v).trim()) ? String(v).trim() : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
/* the expression the rows say */
export function exprOf(rows) {
  return (rows || []).filter((r) => r && r.field).map((r) => {
    switch (r.op) {
      case 'isnot': return `${r.field} != ${lit(r.value)}`
      case 'contains': return `${lit(r.value)} in ${r.field}`
      case 'gt': return `${r.field} > ${lit(r.value)}`
      case 'lt': return `${r.field} < ${lit(r.value)}`
      case 'set': return r.field
      case 'unset': return `not ${r.field}`
      default: return `${r.field} == ${lit(r.value)}`
    }
  }).join(' and ')
}
/* the fields a condition reads */
export function fieldsOf(cond) { const rows = rowsOf(cond); if (rows) return [...new Set(rows.map((r) => r.field))]; const bare = String(cond || '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ' '); return [...new Set([...bare.matchAll(new RegExp(`\\b(${NAME})\\b`, 'g'))].map((m) => m[1]).filter((n) => !['and', 'or', 'not', 'in', 'true', 'false', 'none', 'is', 'defined', 'undefined'].includes(n)))] }

/* a condition in words, for a summary: "Topic is An order and Age is more than 18" — the fields by their questions, the
   comparisons by the words given (the admin's `condition` group); a condition rows cannot say is shown as it is */
export function describe(cond, fields, words) {
  const rows = rowsOf(cond)
  if (rows === null) return String(cond || '')
  const w = words || {}
  const q = (n) => { const f = (fields || []).find((x) => x.name === n); const t = f && (f.question || (f.params && f.params.question)); return t && t !== '...' ? t : n }
  return rows.map((r) => [q(r.field), w[r.op] || r.op, r.op === 'set' || r.op === 'unset' ? '' : r.value].filter(Boolean).join(' ')).join(' ' + (w.and || 'and') + ' ')
}
