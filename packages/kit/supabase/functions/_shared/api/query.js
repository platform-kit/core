/*
 * Contentful's query over the records — plain JavaScript. `parse` checks the arguments and says what is wrong the way
 * Contentful says it; `apply` filters and orders the records (their raw data: what a field holds before it is shaped),
 * so a page of them can then be shaped into entries. Every argument of the Delivery API's entries and assets collections:
 * content_type, select, include, locale, order, limit, skip, query, sys.id[in], links_to_entry, links_to_asset,
 * mimetype_group, and on any field fields.<f> with [ne] [in] [nin] [exists] [lt] [lte] [gt] [gte] [match] [all].
 */
import { entryId, assetId } from './ids.js'
import { fieldsOf } from './types.js'

const OPS = ['ne', 'in', 'nin', 'exists', 'lt', 'lte', 'gt', 'gte', 'match', 'all', 'near', 'within']
const list = (v) => String(v == null ? '' : v).split(',').map((s) => s.trim()).filter(Boolean)
const MIME_GROUPS = { image: /^image\//, audio: /^audio\//, video: /^video\//, pdfdocument: /^application\/pdf$/, plaintext: /^text\/plain$/, richtext: /^(text\/rtf|application\/rtf)/, presentation: /presentation/, spreadsheet: /(spreadsheet|excel)/, code: /(javascript|json|css|html|xml)/, archive: /(zip|tar|gzip)/, attachment: /./ }

/* the settled arguments, or an error */
export function parse(q, { kind = 'entries', types = [], locales = [] } = {}) {
  const err = (id, message, details) => ({ error: { id, message, details } })
  const num = (k, d, lo, hi) => { if (q[k] == null || q[k] === '') return d; const n = Number(q[k]); if (!Number.isInteger(n) || n < lo || n > hi) throw err('BadQuery', `The query parameter ${k} must be an integer between ${lo} and ${hi}.`); return n }
  try {
    const limit = num('limit', 100, 1, 1000), skip = num('skip', 0, 0, 1e9), include = num('include', 1, 0, 10)
    const locale = q.locale == null || q.locale === '' ? null : String(q.locale)
    if (locale && locale !== '*' && !locales.some((l) => l.code === locale)) throw err('BadQuery', `Unknown locale: ${locale}`)
    const contentType = q.content_type ? String(q.content_type) : null
    const type = contentType ? types.find((t) => t.sys.id === contentType) : null
    if (contentType && !type) throw err('InvalidQuery', 'The content type could not be found.', { errors: [{ name: 'unknownContentType', value: contentType }] })
    const select = q.select ? list(q.select) : null
    if (select && select.some((s) => s.split('.').length > 2)) throw err('BadQuery', 'The select operator only supports up to two levels of nesting (fields.title)')
    const order = q.order ? list(q.order).map((o) => ({ desc: o.startsWith('-'), key: o.replace(/^-/, '') })) : [{ desc: true, key: 'sys.createdAt' }]
    const filters = []
    for (const [k, v] of Object.entries(q)) {
      const m = /^(sys|fields|metadata)\.([A-Za-z0-9_.-]+?)(?:\[([a-z]+)\])?$/.exec(k)
      if (!m) continue
      const op = m[3] || 'eq'
      if (m[3] && !OPS.includes(m[3])) throw err('InvalidQuery', `The query operator ${m[3]} is not supported.`)
      if (op === 'near' || op === 'within') throw err('InvalidQuery', `The ${op} operator needs a Location field, and this site has none.`)
      if (m[1] === 'fields' && kind === 'entries' && !type) throw err('BadQuery', 'You need to specify a content_type to filter on fields.', { errors: [{ name: 'queryWithFieldButNoContentType', value: k }] })
      filters.push({ scope: m[1], path: m[2], op, value: String(v) })
    }
    if (kind === 'entries' && !type && order.some((o) => o.key.startsWith('fields.'))) throw err('BadQuery', 'You need to specify a content_type to order by a field.')
    const mimeGroup = q.mimetype_group ? String(q.mimetype_group) : null
    if (mimeGroup && !MIME_GROUPS[mimeGroup]) throw err('BadQuery', `Unknown mimetype_group: ${mimeGroup}`)
    return { limit, skip, include, locale, contentType, type, select, order, filters, query: q.query ? String(q.query).toLowerCase() : '', linksToEntry: q.links_to_entry ? String(q.links_to_entry) : null, linksToAsset: q.links_to_asset ? String(q.links_to_asset) : null, mimeGroup }
  } catch (e) { if (e && e.error) return e; throw e }
}

/* ---- the values a filter reads ---- */
const time = (v) => { const t = Date.parse(String(v)); return Number.isNaN(t) ? null : t }
const linkTarget = (def, raw) => { const vs = def.type === 'Array' ? (def.items.validations || []) : (def.validations || []); const ct = (vs.find((v) => v.linkContentType) || {}).linkContentType || []; return entryId(ct[0] || '', String(raw)) }
function rawOf(r, m, path, ctx) {
  const [head, ...rest] = path.split('.')
  if (head === 'body') return r.body == null ? undefined : String(r.body)
  if (head === 'bodyMarkdown') return r.body == null ? undefined : String(r.body)
  const f = m.fields.find((x) => x.name === head || x.name + 'Markdown' === head)
  const raw = r.data ? r.data[f ? f.name : head] : undefined
  if (raw == null) return undefined
  const def = f ? fieldsOf(f, ctx.models)[0] : null
  if (rest.length) {
    /* fields.book.sys.id: the link's id */
    if (def && def.type === 'Link' && rest.join('.') === 'sys.id') return def.linkType === 'Asset' ? assetId(String(raw)) : linkTarget(def, raw)
    if (def && def.type === 'Array' && def.items && def.items.linkType && rest.join('.') === 'sys.id') return (Array.isArray(raw) ? raw : [raw]).map((v) => linkTarget(def, v))
    let v = raw; for (const k of rest) v = v && typeof v === 'object' ? v[k] : undefined; return v
  }
  return raw
}
function sysOf(r, key) {
  if (key === 'id') return entryId(r.typeId, r.path)
  if (key === 'createdAt') return r.created || r.updated
  if (key === 'updatedAt') return r.updated || r.created
  if (key === 'contentType.sys.id') return r.typeId
  if (key === 'revision') return r.revision || 1
  if (key === 'type') return 'Entry'
  return undefined
}
const asStrings = (v) => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)])
function holds(actual, f, def) {
  const { op, value } = f
  if (op === 'exists') return (value === 'true') === (actual != null && actual !== '' && !(Array.isArray(actual) && !actual.length))
  if (actual == null) return op === 'ne' || op === 'nin'
  const arr = asStrings(actual)
  const isTime = def === 'date' || /^\d{4}-\d{2}-\d{2}/.test(String(Array.isArray(actual) ? actual[0] : actual)) && /^\d{4}-\d{2}-\d{2}/.test(value)
  const isNum = def === 'number' || (typeof actual === 'number' && !Number.isNaN(Number(value)))
  const cmp = (a) => (isTime ? (time(a) ?? 0) - (time(value) ?? 0) : isNum ? Number(a) - Number(value) : String(a).localeCompare(value))
  switch (op) {
    case 'eq': return typeof actual === 'boolean' ? String(actual) === value : arr.includes(value)
    case 'ne': return typeof actual === 'boolean' ? String(actual) !== value : !arr.includes(value)
    case 'in': return list(value).some((v) => arr.includes(v))
    case 'nin': return !list(value).some((v) => arr.includes(v))
    case 'all': return list(value).every((v) => arr.includes(v))
    case 'lt': return arr.some((a) => cmp(a) < 0)
    case 'lte': return arr.some((a) => cmp(a) <= 0)
    case 'gt': return arr.some((a) => cmp(a) > 0)
    case 'gte': return arr.some((a) => cmp(a) >= 0)
    case 'match': return arr.some((a) => a.toLowerCase().includes(value.toLowerCase()))
    default: return false
  }
}
const kindOfField = (m, name, ctx) => { const f = m.fields.find((x) => x.name === name); if (!f) return null; const d = fieldsOf(f, ctx.models)[0]; return !d ? null : d.type === 'Date' ? 'date' : d.type === 'Number' || d.type === 'Integer' ? 'number' : 'string' }
const text = (r) => { const parts = []; const walk = (v) => { if (typeof v === 'string') parts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }; walk(r.data); if (r.body) parts.push(String(r.body)); return parts.join(' ').toLowerCase() }

/* the records a query admits, in its order — every record given is already the door's (published, or a preview's) */
export function apply(records, a, ctx) {
  let out = records
  if (a.type) out = out.filter((r) => r.typeId === a.type.sys.id)
  for (const f of a.filters) {
    if (f.scope === 'sys') { out = out.filter((r) => holds(sysOf(r, f.path), f, f.path.endsWith('At') ? 'date' : null)); continue }
    if (f.scope === 'metadata') { out = out.filter(() => f.op === 'exists' ? f.value === 'false' : false); continue }
    out = out.filter((r) => { const m = ctx.modelsByKey.get(r.model); return holds(rawOf(r, m, f.path, ctx), f, kindOfField(m, f.path.split('.')[0], ctx)) })
  }
  if (a.query) out = out.filter((r) => text(r).includes(a.query))
  if (a.linksToEntry) out = out.filter((r) => linksOf(r, ctx).some(([k, id]) => k === 'Entry' && id === a.linksToEntry))
  if (a.linksToAsset) out = out.filter((r) => linksOf(r, ctx).some(([k, id]) => k === 'Asset' && id === a.linksToAsset))
  const keyFn = (o) => (r) => { if (o.key.startsWith('sys.')) return sysOf(r, o.key.slice(4)); const m = ctx.modelsByKey.get(r.model); return o.key.startsWith('fields.') ? rawOf(r, m, o.key.slice(7), ctx) : undefined }
  out = [...out].sort((x, y) => {
    for (const o of a.order) {
      const kx = keyFn(o)(x), ky = keyFn(o)(y)
      const isTime = /At$/.test(o.key) || (typeof kx === 'string' && /^\d{4}-\d{2}-\d{2}/.test(kx))
      const a1 = isTime ? (time(kx) ?? -Infinity) : kx == null ? -Infinity : typeof kx === 'number' ? kx : String(kx).toLowerCase()
      const b1 = isTime ? (time(ky) ?? -Infinity) : ky == null ? -Infinity : typeof ky === 'number' ? ky : String(ky).toLowerCase()
      if (a1 < b1) return o.desc ? 1 : -1
      if (a1 > b1) return o.desc ? -1 : 1
    }
    return 0
  })
  return out
}
/* the links a record's raw data holds, as [linkType, id] — the entry and asset fields of its model */
export function linksOf(r, ctx) {
  const m = ctx.modelsByKey.get(r.model); const out = []
  for (const f of m.fields) {
    const raw = r.data ? r.data[f.name] : undefined; if (raw == null || raw === '') continue
    const d = fieldsOf(f, ctx.models)[0]; if (!d) continue
    if (d.type === 'Link' && d.linkType === 'Asset') { const a = ctx.assetsByAddress.get(String(raw)); if (a) out.push(['Asset', assetId(a.address)]) }
    else if (d.type === 'Link' && d.linkType === 'Entry') out.push(['Entry', linkTarget(d, raw)])
    else if (d.type === 'Array' && d.items && d.items.linkType === 'Entry') for (const v of (Array.isArray(raw) ? raw : [raw])) out.push(['Entry', linkTarget(d, v)])
  }
  return out
}
/* the assets a query admits */
export function applyAssets(assets, a) {
  let out = assets
  if (a.mimeGroup) out = out.filter((x) => MIME_GROUPS[a.mimeGroup].test(x.mime || ''))
  for (const f of a.filters) {
    if (f.scope === 'sys' && f.path === 'id') out = out.filter((x) => holds(assetId(x.address), f))
    else if (f.scope === 'fields' && (f.path === 'title' || f.path === 'file.fileName')) out = out.filter((x) => holds(f.path === 'title' ? x.name.replace(/\.[a-z0-9]+$/i, '') : x.name, f))
    else if (f.scope === 'fields' && f.path === 'file.contentType') out = out.filter((x) => holds(x.mime, f))
  }
  if (a.query) out = out.filter((x) => x.name.toLowerCase().includes(a.query))
  const dir = a.order[0] && a.order[0].desc ? -1 : 1, key = a.order[0] ? a.order[0].key : 'sys.createdAt'
  out = [...out].sort((x, y) => { const kx = key === 'fields.title' ? x.name : (x.modified || ''), ky = key === 'fields.title' ? y.name : (y.modified || ''); return kx < ky ? -dir : kx > ky ? dir : 0 })
  return out
}
/* `select`: the paths kept on an entry (sys always whole, as Contentful keeps it) */
export function selectOn(item, select) {
  if (!select) return item
  const out = { sys: item.sys }
  for (const s of select) {
    const [head, sub] = s.split('.')
    if (head === 'sys') continue
    if (head === 'fields' && !sub) { out.fields = item.fields; continue }
    if (head === 'fields' && item.fields && sub in item.fields) { out.fields = out.fields || {}; out.fields[sub] = item.fields[sub] }
    if (head === 'metadata') out.metadata = item.metadata || { tags: [] }
  }
  if (!out.fields) out.fields = {}
  return out
}
