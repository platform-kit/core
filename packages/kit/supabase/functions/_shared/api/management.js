/*
 * Contentful's Management API shapes over the site's records (content-management-api) — plain JavaScript, pinned under
 * Node (build/management.test.mjs). Where the Delivery API answers an entry's fields flat and its sys as published, the
 * Management API answers every field by locale (`{ 'en-US': value }`), a version that advances on every save and every
 * publish, the published version and time, who made and last changed it (User links), and a draft over its live
 * version. This module is both directions:
 *
 *   managementEntryOf(r, ctx)      a record (the index's shape, `draft` marking one) → the CMA entry
 *   recordOf(entry, type, model, ctx)   a CMA entry's fields → the record's data and body, ready for the pipe's write
 *   idFor(type, fields, ctx)       the entry id of a POST: the record's slug, else its title slugified, else null
 *   versionOf(r)                   the version rule: revision × 2, + 1 while a draft is over the live version
 *   uploadOf / assetOfUpload       the upload flow's shapes
 *   webhookDefinitionOf(row)       a content_webhooks row as Contentful's definition
 *   validationFailed(issues)       the pipe's 422 as Contentful's ValidationFailed
 */
import { entryId, assetId, typeIdOf } from './ids.js'
import { markdownFromRichText } from './richtext-to-markdown.js'

const iso = (d) => { const t = d ? new Date(d) : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null }
const link = (linkType, id) => ({ sys: { type: 'Link', linkType, id } })
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

/* the version rule: every save and every publish advances it, as Contentful's does; a draft over a live version is odd */
export const versionOf = (r) => (Number(r.revision) || 1) * 2 + (r.draft ? 1 : 0)
export const publishedVersionOf = (r) => (r.published && r.publishedAt ? (Number(r.revision) || 1) * 2 : undefined)

/* the CMA sys of an entry or asset */
export function managementSys(space, type, id, r, extra = {}) {
  const sys = {
    space: link('Space', space), id, type, createdAt: iso(r.created) || iso(r.updated), updatedAt: iso(r.updated) || iso(r.created),
    environment: { sys: { id: 'master', type: 'Link', linkType: 'Environment' } },
    ...(r.publishedAt ? { publishedVersion: publishedVersionOf(r), publishedAt: iso(r.publishedAt), firstPublishedAt: iso(r.firstPublishedAt || r.created || r.publishedAt), publishedCounter: Number(r.revision) || 1 } : {}),
    version: versionOf(r),
    createdBy: link('User', r.createdBy || 'site'), updatedBy: link('User', r.updatedBy || r.createdBy || 'site'),
    ...(r.publishedAt ? { publishedBy: link('User', r.updatedBy || 'site') } : {}),
    ...extra,
  }
  return sys
}

/**
 * the CMA entry: the Delivery API's fields (already made by entry.js, flat or by locale) rewrapped by locale, the sys
 * the Management API's — `delivery` is the Delivery-shaped entry of the same record (its `fields` flat), `r` the record
 */
export function managementEntryOf(delivery, r, ctx) {
  const locale = ctx.locale || 'en-US'
  const fields = {}
  for (const [k, v] of Object.entries(delivery.fields || {})) fields[k] = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length && Object.keys(v).every((x) => /^[a-z]{2}(-[A-Z]{2})?$/.test(x)) && !v.sys ? v : { [locale]: v }
  return { metadata: { tags: [] }, sys: managementSys(ctx.space, 'Entry', delivery.sys.id, r, { contentType: delivery.sys.contentType, automationTags: [] }), fields }
}

/* a field's value out of the CMA's by-locale form: the given locale, else the first */
export const unwrap = (v, locale) => (v && typeof v === 'object' && !Array.isArray(v) && !v.sys && !v.nodeType ? (v[locale] !== undefined ? v[locale] : Object.values(v)[0]) : v)

/**
 * the record a CMA entry asks for: fields by the content type's field ids back to the model's data and body — a Link to
 * an Asset as the asset's address (ctx.assetAddress(id)), a Link to an Entry as the linked record's path within its
 * collection, a RichText document as markdown (its `<field>Markdown` twin winning), Date, Number, Boolean, Array as they
 * are; a field the type does not have is refused by name
 */
export function recordOf(entry, type, model, ctx = {}) {
  const locale = ctx.locale || 'en-US'
  const fields = entry.fields || {}
  const byId = Object.fromEntries((type.fields || []).map((f) => [f.id, f]))
  const data = {}
  let body = null
  const unknown = Object.keys(fields).filter((k) => !byId[k] && k !== 'body' && k !== 'bodyMarkdown')
  if (unknown.length) throw Object.assign(new Error('unknown field'), { code: 'UnknownField', fields: unknown })
  const done = new Set()
  for (const f of type.fields || []) {
    if (done.has(f.id)) continue
    const raw = fields[f.id]
    if (f.type === 'RichText') {
      const twin = fields[f.id + 'Markdown']
      const md = twin !== undefined ? String(unwrap(twin, locale) ?? '') : raw !== undefined ? markdownFromRichText(unwrap(raw, locale), ctx) : undefined
      done.add(f.id); done.add(f.id + 'Markdown')
      if (md !== undefined) data[f.id] = md
      continue
    }
    if (f.type === 'Text' && f.id.endsWith('Markdown') && byId[f.id.slice(0, -8)] && byId[f.id.slice(0, -8)].type === 'RichText') continue   /* the twin, read with its RichText */
    if (raw === undefined) continue
    const v = unwrap(raw, locale)
    if (v === null) { data[f.id] = null; continue }
    if (f.type === 'Link' && f.linkType === 'Asset') { const a = ctx.assetAddress ? ctx.assetAddress(v && v.sys ? v.sys.id : String(v)) : null; if (!a) throw Object.assign(new Error('unresolvable asset'), { code: 'UnresolvedLink', field: f.id, id: v && v.sys ? v.sys.id : String(v) }); data[f.id] = a; continue }
    if (f.type === 'Link' && f.linkType === 'Entry') { data[f.id] = pathOfLink(v); continue }
    if (f.type === 'Array' && f.items && f.items.linkType === 'Entry') { data[f.id] = (Array.isArray(v) ? v : [v]).map(pathOfLink); continue }
    if (f.type === 'Array') { data[f.id] = Array.isArray(v) ? v : [v]; continue }
    if (f.type === 'Boolean') { data[f.id] = !!v; continue }
    if (f.type === 'Integer' || f.type === 'Number') { const n = Number(v); if (!Number.isFinite(n)) throw Object.assign(new Error('not a number'), { code: 'ValidationFailed', field: f.id }); data[f.id] = n; continue }
    data[f.id] = v
  }
  if (model && model.body) {
    const twin = fields.bodyMarkdown, doc = fields.body
    if (twin !== undefined) body = String(unwrap(twin, locale) ?? '')
    else if (doc !== undefined) body = markdownFromRichText(unwrap(doc, locale), ctx)
  }
  return { data, body }
}
/* an Entry link's id → the linked record's path within its collection (`article.read-it-aloud` → `read-it-aloud`) */
export const pathOfLink = (v) => { const id = v && v.sys ? String(v.sys.id) : String(v || ''); const i = id.indexOf('.'); return (i >= 0 ? id.slice(i + 1) : id).replace(/\./g, '/') }

/* the id a POST gets: `<type>.<slug>` from the record's slug, else its title slugified, else null (a 400) */
export function idFor(type, data) {
  const title = data ? data[type.displayField || 'title'] ?? data.title : null
  const slug = data && typeof data.slug === 'string' && data.slug.trim() ? slugify(data.slug) : typeof title === 'string' && title.trim() ? slugify(title) : ''
  return slug ? entryId(type.sys.id, slug) : null
}
/* an entry id → { typeId, path } */
export function splitId(id) { const s = String(id || ''); const i = s.indexOf('.'); if (i < 0) return null; return { typeId: s.slice(0, i), path: s.slice(i + 1).replace(/\./g, '/') } }

/* ---- uploads and assets ---- */
export const uploadOf = (space, id, at, expiresAt) => ({ sys: { type: 'Upload', id, space: link('Space', space), createdAt: at, expiresAt, createdBy: link('User', 'site') } })
/* the library folder an API-made asset lands in: content/uploads/api/<id>/<fileName>, so the address encodes the id */
export const apiAssetFolder = (id) => `content/uploads/api/${id}`
export const apiAssetAddress = (id, fileName) => `/uploads/api/${id}/${fileName}`
/* the CMA asset: fields by locale, the file with its url once processed, `upload` or `uploadFrom` before */
export function managementAssetOf(space, id, a, ctx = {}) {
  const locale = ctx.locale || 'en-US'
  const file = a.address ? { url: a.url, details: { size: a.size ?? 0, ...(a.width ? { image: { width: a.width, height: a.height } } : {}) }, fileName: a.name, contentType: a.mime } : (a.pendingFile || undefined)
  return { metadata: { tags: [] }, sys: managementSys(space, 'Asset', id, a, {}), fields: { title: { [locale]: a.title || a.name || '' }, ...(a.description ? { description: { [locale]: a.description } } : {}), ...(file ? { file: { [locale]: file } } : {}) } }
}

/* ---- webhooks ---- */
export const TOPICS = ['Entry.create', 'Entry.save', 'Entry.auto_save', 'Entry.publish', 'Entry.unpublish', 'Entry.archive', 'Entry.unarchive', 'Entry.delete', 'Asset.create', 'Asset.save', 'Asset.auto_save', 'Asset.publish', 'Asset.unpublish', 'Asset.archive', 'Asset.unarchive', 'Asset.delete', 'ContentType.create', 'ContentType.save', 'ContentType.publish', 'ContentType.unpublish', 'ContentType.delete', '*.*', 'Entry.*', 'Asset.*', 'ContentType.*', '*.create', '*.save', '*.publish', '*.unpublish', '*.delete']
export const topicMatches = (want, topic) => want.some((w) => { const [t, e] = String(w).split('.'); const [tt, te] = topic.split('.'); return (t === '*' || t === tt) && (e === '*' || e === te) })
export function webhookDefinitionOf(space, row) {
  return { sys: { type: 'WebhookDefinition', id: row.id, space: link('Space', space), version: 1, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: link('User', row.created_by || 'site'), updatedBy: link('User', row.created_by || 'site') }, name: row.name, url: row.url, topics: row.topics || [], filters: [], headers: Object.entries(row.headers || {}).map(([key, value]) => (/secret|token|key|auth/i.test(key) ? { key, secret: true } : { key, value })), active: !!row.active, transformation: {}, ...(row.last_at ? { lastDeliveredAt: row.last_at } : {}), ...(row.last_error ? { lastError: row.last_error } : {}) }
}
export function webhookDefinitionInput(body) {
  const out = {}
  if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name is required' }
  if (typeof body.url !== 'string' || !/^https?:\/\/\S+$/.test(body.url)) return { error: 'url is required and must be http(s)' }
  const topics = Array.isArray(body.topics) ? body.topics.map(String) : []
  if (!topics.length || topics.some((t) => !TOPICS.includes(t))) return { error: 'topics is a list of ' + TOPICS.join(', ') }
  out.name = body.name.trim().slice(0, 120); out.url = body.url; out.topics = topics; out.active = body.active !== false
  out.headers = {}
  for (const h of Array.isArray(body.headers) ? body.headers : []) if (h && typeof h.key === 'string' && typeof h.value === 'string') out.headers[h.key.slice(0, 80)] = h.value.slice(0, 500)
  return { value: out }
}

/* ---- errors ---- */
export function validationFailed(issues, requestId) {
  return { sys: { type: 'Error', id: 'ValidationFailed' }, message: 'Validation error', details: { errors: (issues || []).map((i) => ({ name: i.name || 'invalid', path: String(i.path || '').split('.').filter(Boolean), details: i.message || String(i) })) }, requestId }
}
export const versionMismatch = (requestId) => ({ sys: { type: 'Error', id: 'VersionMismatch' }, message: 'The version of the entry does not match the version given (X-Contentful-Version).', requestId })
export { entryId, assetId, typeIdOf }
