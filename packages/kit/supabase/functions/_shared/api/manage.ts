/*
 * The Management API's side of the content function (content-management-api): the writing methods on entries and
 * assets, the uploads, the webhook definitions, and the Management shapes a management key reads. Nothing here writes
 * a row itself: every write goes to the content pipe — the same `adminRequest` the admin function answers with, over
 * the row store, `by` the key's maker — so the model's fields, checks and grammar hold for a write from outside as they
 * hold for a save in the admin, and a publish is the pipe's publish (live at once, pushed to the repository). Cloud
 * mode only: in git mode the content is files in a checkout, and every writing method says so.
 *
 * The deliveries (Contentful's webhooks) hang off the row store's `onEvent`: the entry or asset in the Management shape
 * under `X-Contentful-Topic`, to every active definition whose topics name the event, once per event, a failure kept on
 * the definition for the next event.
 */
import { admin, appUrl, isServiceBearer } from '../lib.ts'
import { assetUsage } from '../pipe/build/assets.mjs'
import { pipeFor as pipeOf, makerOf, type Caller } from './pipe.ts'
import { pushPending } from '../github.js'
import { contentIndexes, invalidateIndex, CLOUD, SPACE, type Index, type Rec } from '../content-index.ts'
import { makeContext } from './context.js'
import { entryOf, assetOf, strip } from './entry.js'
import { managementEntryOf, managementAssetOf, recordOf, idFor, splitId, versionOf, uploadOf, apiAssetFolder, apiAssetAddress, webhookDefinitionOf, webhookDefinitionInput, topicMatches, validationFailed, versionMismatch, unwrap } from './management.js'
import { assetId } from './ids.js'

const UPLOADS = '.uploads'
const BUCKET = 'content-assets'
const locale = () => 'en-US'
const err = (status: number, id: string, message: string, rid: string, details?: unknown) => ({ status, body: { sys: { type: 'Error', id }, message, ...(details ? { details } : {}), requestId: rid } })
const gitMode = (rid: string) => err(405, 'BadRequest', 'This site keeps its content as files in a checkout (git mode): a write goes through the admin\'s dev server. The Management API writes in cloud mode (CONTENT_STORE=cloud).', rid)

/* the pipe (api/pipe.ts) with the content webhooks' hook */
const pipeFor = (by: string) => pipeOf(by, (e: unknown) => deliverContentEvent(e as any))
const fresh = async () => { invalidateIndex(); return contentIndexes() }
const modelFor = (index: Index, typeId: string) => { const t = index.types.find((x: any) => x.sys.id === typeId); return t ? { type: t, model: index.models.find((m: any) => m.key === (t as any)._model) } : null }
const nameOf = (model: any, path: string) => (model.single ? '' : path)

/* the Management entry of a record, from the preview index (a draft over its live version) */
async function entryView(id: string, rid: string, gated = true) {
  const both = await contentIndexes()
  const r = both.preview.records.find((x) => x.typeId && `${x.typeId}.${x.path.replace(/\//g, '.')}` === id) ?? null
  if (!r) return null
  const live = both.live.records.find((x) => x.model === r.model && x.path === r.path) ?? null
  const ctx = makeContext(both.preview, { preview: true, gated, locale: null, imagesBase: (both.preview.site.url || appUrl()).replace(/^https?:/, '') + '/images' })
  const e = await entryOf(r, ctx)
  const rec: Rec & { draft?: boolean } = { ...r, draft: !!r.draft, publishedAt: live ? (live.publishedAt ?? live.updated) : null }
  return managementEntryOf(strip(e), rec, { space: SPACE, locale: locale() })
}
async function assetView(id: string) {
  const both = await contentIndexes()
  const a = both.preview.assets.find((x: any) => x.address && assetId(x.address) === id)
  if (a) { const ctx = makeContext(both.preview, { preview: true, gated: true, locale: null, imagesBase: (both.preview.site.url || appUrl()).replace(/^https?:/, '') + '/images' }); const d = assetOf(a as any, ctx); return managementAssetOf(SPACE, d.sys.id, { name: (a as any).name, title: d.fields.title, address: (a as any).address, url: d.fields.file.url, size: (a as any).size, mime: (a as any).mime, width: (a as any).width, height: (a as any).height, revision: 1, created: (a as any).modified, updated: (a as any).modified, publishedAt: (a as any).modified, published: true }, { space: SPACE, locale: locale() }) }
  const pending = await pendingAsset(id)
  return pending ? managementAssetOf(SPACE, id, { name: pending.fileName, title: pending.title, description: pending.description, revision: 1, created: pending.at, updated: pending.at, draft: true, pendingFile: pending.file }, { space: SPACE, locale: locale() }) : null
}
const assetIdOf = (address: string) => { const m = /^\/uploads\/api\/([A-Za-z0-9._-]{1,64})\/[^/]+$/.exec(address); return m ? m[1] : null }
/* an asset made but not yet processed: its record beside the upload */
async function pendingAsset(id: string) { const { data } = await admin.storage.from(BUCKET).download(`${UPLOADS}/assets/${id}.json`); if (!data) return null; try { return JSON.parse(await data.text()) } catch { return null } }
async function savePending(id: string, rec: unknown) { await admin.storage.from(BUCKET).upload(`${UPLOADS}/assets/${id}.json`, new Blob([JSON.stringify(rec)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' }) }
const newId = () => { const b = new Uint8Array(11); crypto.getRandomValues(b); return Array.from(b, (x) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[x % 62]).join('') }

/**
 * the management routes: null when the request is not one (the Delivery API answers it), else a { status, body }
 * — `sub` the path under the environment (or the space, for webhook_definitions), `caller` the key
 */
export async function manage(req: Request, o: { sub: string; method: string; q: Record<string, string>; caller: Caller; rid: string; spaceLevel: boolean }): Promise<{ status: number; body: unknown; headers?: Record<string, string> } | null> {
  const { sub, method, q, caller, rid } = o
  const writing = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH'
  const isMgmt = caller.kind === 'management'
  /* ---- webhook definitions (space level) ---- */
  if (/^\/webhook_definitions(\/|$)/.test(sub)) {
    if (!isMgmt) return err(403, 'AccessDenied', 'The webhook definitions are the management key\'s.', rid)
    const id = (/^\/webhook_definitions\/([^/]+)$/.exec(sub) || [])[1]
    const view = (row: any) => webhookDefinitionOf(SPACE, row)
    if (method === 'GET' && !id) { const { data } = await admin.from('content_webhooks').select('*').order('created_at'); return { status: 200, body: { sys: { type: 'Array' }, total: (data ?? []).length, skip: 0, limit: 100, items: (data ?? []).map(view) } } }
    if (method === 'GET' && id) { const { data } = await admin.from('content_webhooks').select('*').eq('id', id).maybeSingle(); return data ? { status: 200, body: view(data) } : err(404, 'NotFound', 'The resource could not be found.', rid, { type: 'WebhookDefinition', id }) }
    if (method === 'POST' || method === 'PUT') {
      let body: any; try { body = await req.json() } catch { return err(400, 'BadRequest', 'The body is not JSON.', rid) }
      const p = webhookDefinitionInput(body); if (p.error) return err(422, 'ValidationFailed', p.error, rid)
      const maker = await makerOf(caller)
      if (method === 'PUT' && id) { const { data: had } = await admin.from('content_webhooks').select('id').eq('id', id).maybeSingle(); const rec = { ...p.value, updated_at: new Date().toISOString() }; const { data, error } = had ? await admin.from('content_webhooks').update(rec).eq('id', id).select('*').single() : await admin.from('content_webhooks').insert({ id, ...rec, created_by: maker.id }).select('*').single(); if (error) return err(400, 'BadRequest', error.message, rid); return { status: had ? 200 : 201, body: view(data) } }
      const { data, error } = await admin.from('content_webhooks').insert({ ...p.value, created_by: /^[0-9a-f-]{36}$/.test(maker.id) ? maker.id : null }).select('*').single(); if (error) return err(400, 'BadRequest', error.message, rid)
      return { status: 201, body: view(data) }
    }
    if (method === 'DELETE' && id) { await admin.from('content_webhooks').delete().eq('id', id); return { status: 204, body: null } }
    return err(405, 'BadRequest', 'GET, POST, PUT or DELETE.', rid)
  }
  if (o.spaceLevel) return null
  if (!writing && !isMgmt) return null   /* a read under a lesser key: the Delivery API's */

  /* ---- writes need cloud mode and a management key ---- */
  if (writing && !isMgmt) return err(403, 'AccessDenied', 'A write needs a key of kind management (Settings → API).', rid)
  if (writing && !CLOUD) return gitMode(rid)
  if (/^\/content_types(\/|$)/.test(sub) && writing) return err(405, 'BadRequest', 'A content type is a model of the admin: it is changed in the builder, not through the API.', rid)
  if (/^\/locales(\/|$)/.test(sub) && writing) return err(405, 'BadRequest', 'The locales are the site\'s languages in platformkit.config.js.', rid)
  const maker = isMgmt ? await makerOf(caller) : { by: 'api', id: 'api' }

  /* ---- uploads ---- */
  if (sub === '/uploads' && method === 'POST') {
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (!bytes.length) return err(400, 'BadRequest', 'The body is the file\'s bytes.', rid)
    const id = newId(), at = new Date().toISOString(), expiresAt = new Date(Date.now() + 864e5).toISOString()
    const { error } = await admin.storage.from(BUCKET).upload(`${UPLOADS}/${id}`, bytes, { upsert: true, contentType: req.headers.get('content-type') || 'application/octet-stream' })
    if (error) return err(500, 'InternalServerError', error.message, rid)
    return { status: 201, body: uploadOf(SPACE, id, at, expiresAt) }
  }
  const up = /^\/uploads\/([^/]+)$/.exec(sub)
  if (up && method === 'GET') { const { data } = await admin.storage.from(BUCKET).list(UPLOADS, { search: up[1] }); const f = (data ?? []).find((x: any) => x.name === up[1]); return f ? { status: 200, body: uploadOf(SPACE, up[1], f.created_at, new Date(Date.parse(f.created_at) + 864e5).toISOString()) } : err(404, 'NotFound', 'The resource could not be found.', rid, { type: 'Upload', id: up[1] }) }
  if (up && method === 'DELETE') { await admin.storage.from(BUCKET).remove([`${UPLOADS}/${up[1]}`]); return { status: 204, body: null } }

  /* ---- assets ---- */
  const assetM = /^\/assets(?:\/([^/]+))?(?:\/files\/([^/]+)\/process|\/published)?$/.exec(sub)
  if (assetM) {
    const id = assetM[1], processing = sub.endsWith('/process'), publishing = sub.endsWith('/published')
    if (method === 'GET' && id && !processing && !publishing) { const a = await assetView(id); return a ? { status: 200, body: a } : err(404, 'NotFound', 'The resource could not be found.', rid, { type: 'Asset', id }) }
    if (method === 'GET' && !id) { const both = await contentIndexes(); const items = []; for (const a of both.preview.assets) { const v = await assetView(assetId((a as any).address)); if (v) items.push(v) } return { status: 200, body: { sys: { type: 'Array' }, total: items.length, skip: 0, limit: 1000, items } } }
    if ((method === 'POST' && !id) || (method === 'PUT' && id && !processing && !publishing)) {
      let body: any; try { body = await req.json() } catch { return err(400, 'BadRequest', 'The body is not JSON.', rid) }
      const aid = id || newId()
      const fields = body.fields || {}
      const file = unwrap(fields.file, locale()) || null
      if (!file || (!file.uploadFrom && !file.upload)) return err(422, 'ValidationFailed', 'fields.file needs uploadFrom (an Upload link) or upload (a url).', rid)
      const rec = { id: aid, title: String(unwrap(fields.title, locale()) ?? file.fileName ?? ''), description: unwrap(fields.description, locale()) ? String(unwrap(fields.description, locale())) : '', fileName: String(file.fileName || 'file'), contentType: String(file.contentType || 'application/octet-stream'), file, at: new Date().toISOString(), by: maker.by }
      await savePending(aid, rec)
      return { status: 201, body: await assetView(aid) }
    }
    if (method === 'PUT' && id && processing) {
      const p = await pendingAsset(id); if (!p) return err(404, 'NotFound', 'No such asset to process (an asset in the library is processed already).', rid, { type: 'Asset', id })
      let bytes: Uint8Array | null = null
      if (p.file.uploadFrom) { const uid = p.file.uploadFrom.sys?.id; const { data } = await admin.storage.from(BUCKET).download(`${UPLOADS}/${uid}`); if (!data) return err(422, 'ValidationFailed', 'The upload is gone (uploads last a day).', rid); bytes = new Uint8Array(await data.arrayBuffer()); await admin.storage.from(BUCKET).remove([`${UPLOADS}/${uid}`]) }
      else if (p.file.upload) { try { const r = await fetch(String(p.file.upload)); if (!r.ok) throw new Error(String(r.status)); bytes = new Uint8Array(await r.arrayBuffer()) } catch (e) { return err(422, 'ValidationFailed', 'The file could not be fetched from upload: ' + String((e as Error)?.message ?? e), rid) } }
      if (!bytes) return err(422, 'ValidationFailed', 'Nothing to process.', rid)
      const safe = String(p.fileName).replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file'
      const { store } = await pipeFor(maker.by)
      await store.putAsset(`${apiAssetFolder(id)}/${safe}`, bytes, p.contentType)
      await admin.storage.from(BUCKET).remove([`${UPLOADS}/assets/${id}.json`])
      await fresh()
      return { status: 204, body: null }
    }
    if (method === 'PUT' && id && publishing) { const a = await assetView(id); return a ? { status: 200, body: a } : err(404, 'NotFound', 'The resource could not be found.', rid, { type: 'Asset', id }) }
    if (method === 'DELETE' && id && publishing) return err(400, 'BadRequest', 'An asset in the library is always published; delete it to remove it.', rid)
    if (method === 'DELETE' && id) {
      const both = await contentIndexes()
      const a: any = both.preview.assets.find((x: any) => x.address && assetId(x.address) === id)
      if (!a) { await admin.storage.from(BUCKET).remove([`${UPLOADS}/assets/${id}.json`]); return { status: 204, body: null } }
      const { store } = await pipeFor(maker.by)
      const rel = 'content' + a.address.replace(/^\/(?!uploads)/, '/static/')
      const used = await assetUsage(store, [rel])
      if (Object.keys(used).length) return err(409, 'VersionMismatch', 'The asset is in use: ' + Object.values(used).flat().join(', '), rid, { used })
      await store.removeAsset(rel)
      await fresh()
      return { status: 204, body: null }
    }
    return err(405, 'BadRequest', 'GET, POST, PUT or DELETE.', rid)
  }

  /* ---- entries ---- */
  const entM = /^\/entries(?:\/([^/]+))?(\/published)?$/.exec(sub)
  if (!entM) return writing ? err(404, 'NotFound', 'The resource could not be found.', rid, { type: 'Route', id: sub }) : null
  const id = entM[1], published = !!entM[2]
  if (method === 'GET' && id && !published) { const e = await entryView(id, rid); return e ? { status: 200, body: e } : err(404, 'NotFound', 'The resource could not be found.', rid, { type: 'Entry', id }) }
  if (method === 'GET' && !id) {
    const both = await contentIndexes()
    const items = []; for (const r of both.preview.records) { if (!r.typeId) continue; const e = await entryView(`${r.typeId}.${r.path.replace(/\//g, '.')}`, rid); if (e) items.push(e) }
    const skip = Math.max(0, Number(q.skip) || 0), limit = Math.min(1000, Math.max(1, Number(q.limit) || 100))
    const filtered = q.content_type ? items.filter((e) => e.sys.contentType.sys.id === q.content_type) : items
    return { status: 200, body: { sys: { type: 'Array' }, total: filtered.length, skip, limit, items: filtered.slice(skip, skip + limit) } }
  }
  const { call } = await pipeFor(maker.by)
  const both = await contentIndexes()
  /* publish, unpublish, delete */
  if (id && (published || method === 'DELETE')) {
    const split = splitId(id); const found = split ? modelFor(both.preview, split.typeId) : null
    if (!split || !found || !found.model) return err(404, 'NotFound', 'The resource could not be found.', rid, { type: 'Entry', id })
    const name = nameOf(found.model, split.path)
    const current = await call('GET', 'file', { col: found.model.key, name })
    if (current.status !== 200) return err(404, 'NotFound', 'The resource could not be found.', rid, { type: 'Entry', id })
    const rec: any = current.body
    if (method === 'PUT' && published) {
      /* an entry the API made is unpublished (published: false) until now: the flag is turned before the draft goes live */
      if (rec.data && rec.data.published === false) { const w = await call('POST', 'file', {}, { col: found.model.key, name, data: { ...rec.data, published: true }, content: rec.content || '' }); if (w.status !== 200) return pipeFault(w, rid) }
      const r = await call('POST', 'publish', {}, { col: found.model.key, name })
      if (r.status === 404) { /* nothing drafted: already live */ } else if (r.status !== 200) return pipeFault(r, rid)
      await pushPending(admin, maker.by, { message: `publish ${found.model.key}/${name} (Management API)` }).catch(() => {})
      await fresh(); const e = await entryView(id, rid); return { status: 200, body: e }
    }
    if (method === 'DELETE' && published) {
      const w = await call('POST', 'file', {}, { col: found.model.key, name, data: { ...(rec.data || {}), published: false }, content: rec.content || '' })
      if (w.status !== 200) return pipeFault(w, rid)
      const r = await call('POST', 'publish', {}, { col: found.model.key, name }); if (r.status !== 200) return pipeFault(r, rid)
      await pushPending(admin, maker.by, { message: `unpublish ${found.model.key}/${name} (Management API)` }).catch(() => {})
      await fresh(); const e = await entryView(id, rid); return { status: 200, body: e }
    }
    if (method === 'DELETE') {
      const r = await call('DELETE', 'file', { col: found.model.key, name }); if (r.status !== 200) return pipeFault(r, rid)
      const p = await call('POST', 'publish', {}, { col: found.model.key, name }); if (p.status !== 200 && p.status !== 404) return pipeFault(p, rid)
      await pushPending(admin, maker.by, { message: `delete ${found.model.key}/${name} (Management API)` }).catch(() => {})
      await fresh(); return { status: 204, body: null }
    }
  }
  /* create, update */
  if (method === 'POST' || method === 'PUT') {
    let entry: any; try { entry = await req.json() } catch { return err(400, 'BadRequest', 'The body is not JSON.', rid) }
    const typeId = method === 'POST' ? (req.headers.get('x-contentful-content-type') || '') : (splitId(id || '')?.typeId || '')
    const found = typeId ? modelFor(both.preview, typeId) : null
    if (!found || !found.model) return err(method === 'POST' ? 400 : 404, method === 'POST' ? 'BadRequest' : 'NotFound', method === 'POST' ? 'X-Contentful-Content-Type names no content type of this site.' : 'The resource could not be found.', rid, { type: method === 'POST' ? 'ContentType' : 'Entry', id: typeId || id })
    const model = found.model as any, type = found.type as any
    const ctxAssets = (aid: string) => { const a: any = both.preview.assets.find((x: any) => x.address && assetId(x.address) === aid); return a ? a.address : null }   /* an asset's id is assetId(address): the API's folder name, or the hash of any other library file */
    let parsed: { data: Record<string, unknown>; body: string | null }
    try { parsed = recordOf(entry, type, model, { locale: locale(), assetAddress: ctxAssets }) } catch (e: any) {
      if (e.code === 'UnknownField') return err(422, 'ValidationFailed', 'Unknown field', rid, { errors: e.fields.map((f: string) => ({ name: 'unknown', path: ['fields', f], details: 'The content type has no such field' })) })
      if (e.code === 'UnresolvedLink') return err(422, 'ValidationFailed', 'A link cannot be resolved', rid, { errors: [{ name: 'notResolvable', path: ['fields', e.field], details: `No asset ${e.id}` }] })
      return err(422, 'ValidationFailed', String(e.message), rid, { errors: [{ name: 'invalid', path: ['fields', e.field || ''], details: String(e.message) }] })
    }
    let entryId = id
    if (method === 'POST') { entryId = idFor(type, parsed.data); if (!entryId) return err(400, 'BadRequest', 'A new entry needs a slug field or a title to make its id from (or PUT it at an id).', rid) }
    const split = splitId(entryId!)!
    const name = nameOf(model, split.path)
    const current = await call('GET', 'file', { col: model.key, name })
    const exists = current.status === 200
    if (method === 'POST' && exists) return err(409, 'VersionMismatch', 'An entry with that id exists; PUT it with its version to update.', rid)
    if (exists) {
      const view = await entryView(entryId!, rid)
      const given = req.headers.get('x-contentful-version')
      if (given != null && view && Number(given) !== view.sys.version) return { status: 409, body: versionMismatch(rid) }
    }
    const rec: any = exists ? current.body : { data: {}, content: '' }
    /* Contentful replaces the fields whole: a typed field absent from the entry is dropped; what the type does not know (published, the admin's own) is kept */
    const data: Record<string, unknown> = { ...(rec.data || {}) }
    for (const f of type.fields) if (!f.id.endsWith('Markdown') || !type.fields.some((x: any) => x.id + 'Markdown' === f.id)) { if (parsed.data[f.id] !== undefined) data[f.id] = parsed.data[f.id]; else if (entry.fields && Object.keys(entry.fields).length) delete data[f.id] }
    if (!('published' in data)) data.published = false   /* a new entry is unpublished until PUT …/published, as Contentful's is */
    const content = parsed.body != null ? parsed.body : (rec.content || '')
    const w = await call('POST', 'file', {}, { col: model.key, name, data, content, create: !exists })
    if (w.status !== 200) return pipeFault(w, rid)
    await fresh()
    const e = await entryView(entryId!, rid)
    return { status: exists ? 200 : 201, body: e }
  }
  return err(405, 'BadRequest', 'GET, POST, PUT or DELETE.', rid)
}
/* the pipe's refusal as Contentful's error */
function pipeFault(r: { status: number; body: any }, rid: string) {
  const b = r.body || {}
  if (r.status === 422) return { status: 422, body: validationFailed(b.issues || [{ path: '', message: b.error || 'validation' }], rid) }
  if (r.status === 404) return err(404, 'NotFound', String(b.error || 'not found'), rid)
  if (r.status === 409) return err(409, 'VersionMismatch', String(b.error || 'conflict'), rid)
  return err(r.status >= 400 ? r.status : 500, 'BadRequest', String(b.error || 'the write was refused'), rid)
}

/* ---- the deliveries ---- */
const TOPIC_OF = { create: 'create', save: 'save', publish: 'publish', unpublish: 'unpublish', delete: 'delete' } as Record<string, string>
export async function deliverContentEvent(e: { kind: 'Entry' | 'Asset'; topic: string; path: string; collection?: string | null; slug?: string | null; data?: unknown; body?: string | null; by?: string | null }) {
  const topic = `${e.kind}.${TOPIC_OF[e.topic] || e.topic}`
  const { data: subs } = await admin.from('content_webhooks').select('*').eq('active', true)
  const want = (subs ?? []).filter((w: any) => topicMatches(w.topics || [], topic))
  if (!want.length) return
  const both = await fresh()
  let payload: unknown
  if (e.kind === 'Entry') {
    /* the record's model: the deepest directory the path is under (content/ is the site's own, so a single model never wins over a collection) */
    const dirOf = (x: any) => String(x.dir).replace(/^\.?\//, '')
    const m = both.preview.models.filter((x: any) => e.path.startsWith(dirOf(x) + '/')).sort((x: any, y: any) => (y.single ? 0 : 1) - (x.single ? 0 : 1) || dirOf(y).length - dirOf(x).length)[0] as any
    const path = m ? e.path.slice(dirOf(m).length + 1).replace(/\.md$/, '') : e.path
    const t = m ? both.preview.types.find((x: any) => x._model === m.key) as any : null
    const id = t ? `${t.sys.id}.${path.replace(/\//g, '.')}` : e.path
    if (e.topic === 'delete') payload = { sys: { type: 'DeletedEntry', id, space: { sys: { type: 'Link', linkType: 'Space', id: SPACE } }, environment: { sys: { id: 'master', type: 'Link', linkType: 'Environment' } }, deletedAt: new Date().toISOString(), ...(t ? { contentType: { sys: { type: 'Link', linkType: 'ContentType', id: t.sys.id } } } : {}) } }
    else payload = (await entryView(id, 'webhook').catch(() => null)) ?? { sys: { type: 'Entry', id }, fields: {} }
  } else {
    const address = '/' + e.path.replace(/^content\//, '').replace(/^public\//, '')
    const aid = assetIdOf(address) || address
    if (e.topic === 'delete') payload = { sys: { type: 'DeletedAsset', id: aid, deletedAt: new Date().toISOString() } }
    else payload = (await assetView(aid).catch(() => null)) ?? { sys: { type: 'Asset', id: aid }, fields: {} }
  }
  const body = JSON.stringify(payload)
  for (const w of want as any[]) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/vnd.contentful.management.v1+json', 'X-Contentful-Topic': `ContentManagement.${topic}`, 'X-Contentful-Webhook-Name': String(w.name), ...(w.headers || {}) }
      const r = await fetch(w.url, { method: 'POST', headers, body })
      if (!r.ok) throw new Error('the subscriber answered ' + r.status)
      await admin.from('content_webhooks').update({ last_at: new Date().toISOString(), last_error: null }).eq('id', w.id)
    } catch (err2) { await admin.from('content_webhooks').update({ last_error: String((err2 as Error)?.message ?? err2).slice(0, 300) }).eq('id', w.id) }
  }
}
export const adminStoreHook = (e: any) => deliverContentEvent(e)

/* the uploads' sweep: an upload lasts a day (its Upload says so: expiresAt), and an asset made from one but never processed
   goes with it — pg_cron asks once a day (sweep_uploads → POST /sweep-uploads under the service key); the library is never
   touched, only the bucket's .uploads/ folder */
export async function sweepUploads(req: Request, o: { rid: string; olderThanMs?: number }) {
  if (!(await isServiceBearer(req))) return err(403, 'AccessDenied', 'The sweep is the cron\'s (the service key).', o.rid)
  const cutoff = Date.now() - (o.olderThanMs ?? 864e5)
  const old = (list: any[] | null) => (list ?? []).filter((f: any) => f.name && f.id && Date.parse(f.created_at || f.updated_at || 0) < cutoff)
  const { data: files } = await admin.storage.from(BUCKET).list(UPLOADS, { limit: 1000 })
  const { data: pending } = await admin.storage.from(BUCKET).list(`${UPLOADS}/assets`, { limit: 1000 })
  const gone = [...old(files).map((f: any) => `${UPLOADS}/${f.name}`), ...old(pending).map((f: any) => `${UPLOADS}/assets/${f.name}`)]
  if (gone.length) await admin.storage.from(BUCKET).remove(gone)
  /* and the Store API's carts older than thirty days (store-api) */
  const { data: carts } = await admin.from('storefront_carts').delete().lt('updated_at', new Date(Date.now() - 30 * 864e5).toISOString()).select('id')
  return { status: 200, body: { swept: gone.length, uploads: old(files).length, assets: old(pending).length, carts: (carts ?? []).length } }
}
