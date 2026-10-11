/*
 * A record as Contentful's entry, an asset as Contentful's asset, and the includes a page carries — plain JavaScript
 * over the index (the models' descriptions, the records, the assets), shared by the function and the build's test.
 *
 * An entry is `{ sys, fields }`: sys.id the record's path (ids.js), createdAt the record's date else its first commit,
 * updatedAt its last change, revision its count; the fields exactly its content type's — a markdown field as Rich Text
 * (Contentful's document, made by `ctx.rich`) with the markdown beside it, a picture as a Link to the asset at that
 * address (an external picture becomes an asset of its own whose file url is the url), a reference as a Link to the
 * entry, a list as an array, a group as an object; a field the record leaves empty is absent. A gated record's body
 * fields are omitted unless `ctx.gated` says the key may read them.
 */
import { entryId, assetId, hashOf } from './ids.js'
import { fieldsOf } from './types.js'

/* the id a link's value names: the target type (the field's linkContentType) and the slug */
const linkId = (def, raw) => { const t = def.type === 'Array' ? (def.items.validations || []) : (def.validations || []); const ct = (t.find((v) => v.linkContentType) || {}).linkContentType || []; return entryId(ct[0] || '', String(raw)) }

export const stripMarks = (md) => String(md || '').replace(/==([\s\S]*?)==(?:\{[a-z]+\})?/g, '$1')
const iso = (d) => { const t = d ? new Date(d) : null; return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null }
const link = (linkType, id) => ({ sys: { type: 'Link', linkType, id } })
const sysOf = (space, type, id, r, extra = {}) => ({
  space: { sys: { type: 'Link', linkType: 'Space', id: space } }, id, type,
  createdAt: iso(r.created) || iso(r.updated), updatedAt: iso(r.updated) || iso(r.created),
  environment: { sys: { id: 'master', type: 'Link', linkType: 'Environment' } }, revision: r.revision || 1, ...extra,
})

/* the asset an address names: one of the library's, or a synthetic one for a url elsewhere */
export function assetFor(address, ctx) {
  const a = String(address || '').trim()
  if (!a) return null
  const found = ctx.assetsByAddress.get(a)
  if (found) return found
  if (/^https?:\/\//i.test(a)) {
    const ext = { address: a, name: a.split('/').pop().split('?')[0] || 'file', size: null, mime: mimeOf(a), width: null, height: null, modified: null, external: true }
    ctx.assetsByAddress.set(a, ext); ctx.assets.push(ext)
    return ext
  }
  return null
}
export const mimeOf = (f) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4', txt: 'text/plain', md: 'text/markdown', json: 'application/json', css: 'text/css', js: 'application/javascript' })[String(f).split('?')[0].split('.').pop().toLowerCase()] || 'application/octet-stream'

/* the asset's url: the images door on this site, or the url itself for a picture elsewhere */
export function assetUrl(a, ctx) {
  if (a.external) return a.address
  const id = assetId(a.address), file = encodeURIComponent(a.name)
  return `${ctx.imagesBase}/${ctx.space}/${id}/${hashOf(a.address + '|' + (a.modified || ''))}/${file}`
}
export function assetOf(a, ctx) {
  const id = assetId(a.address)
  const isImage = /^image\//.test(a.mime || '') && a.mime !== 'image/svg+xml'
  const r = { created: a.modified, updated: a.modified, revision: 1 }
  return {
    sys: sysOf(ctx.space, 'Asset', id, r, { locale: ctx.locale }),
    fields: wrapAll({
      title: a.name.replace(/\.[a-z0-9]+$/i, ''), description: '',
      file: { url: assetUrl(a, ctx), details: { size: a.size ?? 0, ...(isImage && a.width ? { image: { width: a.width, height: a.height } } : {}) }, fileName: a.name, contentType: a.mime || mimeOf(a.name) },
    }, ctx),
  }
}
const wrapAll = (fields, ctx) => (ctx.allLocales ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { [ctx.locale]: v }])) : fields)

/* one described field's value(s) as Contentful gives them: [ [fieldId, value], … ] */
async function valuesOf(f, raw, r, ctx) {
  const defs = fieldsOf(f, ctx.models)
  if (!defs.length || raw == null || raw === '') return []
  const d = defs[0]
  if (d.type === 'RichText' && f.kind === 'markdown') { const md = stripMarks(raw); return [[d.id, await ctx.rich(md, r.model + ':' + r.path + ':' + f.name + ':' + (r.updated || ''))], [d.id + 'Markdown', md]] }
  if (d.type === 'Link' && d.linkType === 'Asset') { const a = assetFor(raw, ctx); return a ? [[d.id, link('Asset', assetId(a.address))]] : [] }
  if (d.type === 'Link' && d.linkType === 'Entry') return [[d.id, link('Entry', linkId(d, raw))]]
  if (d.type === 'Array' && d.items && d.items.linkType === 'Entry') return [[d.id, (Array.isArray(raw) ? raw : [raw]).map((v) => link('Entry', linkId(d, v)))]]
  if (d.type === 'Array') return [[d.id, Array.isArray(raw) ? raw : [raw]]]
  if (d.type === 'Date') return [[d.id, iso(raw) || String(raw)]]
  if (d.type === 'Boolean') return [[d.id, !!raw]]
  if (d.type === 'Number' || d.type === 'Integer') { const n = Number(raw); return Number.isFinite(n) ? [[d.id, n]] : [] }
  if (d.type === 'Object') return [[d.id, raw]]
  return [[d.id, typeof raw === 'string' ? raw : JSON.stringify(raw)]]
}

/* the record as an entry; `open` says whether a gated record's body may be served to this caller */
export async function entryOf(r, ctx) {
  const m = ctx.modelsByKey.get(r.model)
  const type = ctx.typesByModel.get(r.model)
  const fields = {}
  for (const f of m.fields) for (const [k, v] of await valuesOf(f, r.data ? r.data[f.name] : undefined, r, ctx)) fields[k] = v
  const gated = Array.isArray(r.data && r.data.canAccess) && r.data.canAccess.length > 0 && !r.data.canAccess.includes('guest')
  if (m.body && r.body != null && String(r.body).trim() && (!gated || ctx.gated)) {
    const md = stripMarks(r.body)
    fields.body = await ctx.rich(md, r.model + ':' + r.path + ':body:' + (r.updated || ''))
    fields.bodyMarkdown = md
  }
  if (gated && !ctx.gated) for (const f of m.fields) if (f.kind === 'markdown') { delete fields[f.name]; delete fields[f.name + 'Markdown'] }
  return { sys: sysOf(ctx.space, 'Entry', entryId(r.typeId, r.path), r, { contentType: link('ContentType', type.sys.id), locale: ctx.locale }), fields: wrapAll(fields, ctx), _model: r.model, _path: r.path }
}

/* the links an entry (or asset) holds, as [linkType, id] */
export function linksIn(value, out = []) {
  if (!value || typeof value !== 'object') return out
  if (value.sys && value.sys.type === 'Link' && value.sys.linkType && value.sys.id) { out.push([value.sys.linkType, value.sys.id]); return out }
  for (const v of Object.values(value)) linksIn(v, out)
  return out
}

/* `includes` for a page of entries: the linked entries and assets to the depth asked, the page's own left out, what
   cannot be resolved (an unpublished target, a missing file) listed under errors as Contentful lists it */
export async function includesFor(items, depth, ctx) {
  const own = new Set(items.map((e) => e.sys.id))
  const entries = new Map(), assets = new Map(), errors = [], seen = new Set()
  let frontier = items
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = []
    for (const e of frontier) for (const [kind, id] of linksIn(e.fields)) {
      const key = kind + ':' + id
      if (seen.has(key)) continue; seen.add(key)
      if (kind === 'Entry') {
        if (own.has(id)) continue
        const r = ctx.recordsById.get(id)
        if (!r || !r.published && !ctx.preview) { errors.push({ sys: { id: 'notResolvable', type: 'error' }, details: { type: 'Link', linkType: 'Entry', id } }); continue }
        const ent = await entryOf(r, ctx); entries.set(id, ent); next.push(ent)
      } else if (kind === 'Asset') {
        const a = ctx.assetsById.get(id)
        if (!a) { errors.push({ sys: { id: 'notResolvable', type: 'error' }, details: { type: 'Link', linkType: 'Asset', id } }); continue }
        assets.set(id, assetOf(a, ctx))
      }
    }
    frontier = next
  }
  const includes = {}
  if (entries.size) includes.Entry = [...entries.values()].map(strip)
  if (assets.size) includes.Asset = [...assets.values()]
  return { includes, errors }
}
export const strip = (e) => { const { _model, _path, ...rest } = e; return rest }
