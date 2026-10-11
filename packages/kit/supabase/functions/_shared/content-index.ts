/*
 * The content the API answers from, one shape from two sources — the doors never know which:
 *   git mode   — _shared/content/index.json, written by build/content-json.mjs (the `content-json` step): the models as
 *                the admin describes them, the content types, every record with its frontmatter, body and git times,
 *                every asset with its size, the deletions. Imported with the function, as the catalog is (the runtime
 *                compiles a function with what its imports reach); a function with no index yet boots and answers an
 *                empty site with a line saying what writes it.
 *   cloud mode — CONTENT_STORE=cloud: the models from the assembled pipe's registry (the custom models are rows too),
 *                the records from public.content with their drafts, the assets from the content-assets bucket, the
 *                deletions from the rows marked deleted; kept in memory for a minute, so a publish is on the API within
 *                a minute and a build is not needed. Under a preview key the draft stands over the live row.
 */
import { admin } from './lib.ts'
import { registry } from './pipe/build/models/index.mjs'
import { describeSchema } from './pipe/build/admin-schemas.mjs'
import { rowsStore } from './pipe/build/store/rows.mjs'
import { models as SITE_MODELS } from './pipe/site/index.js'
import * as SITE from './pipe/site.js'
import { contentTypes } from './api/types.js'
import { modelOfPath, pathWithin, isPublished, isRecordModel } from './api/records.js'
import { mimeOf } from './api/entry.js'
import { imageSize } from './api/image-size.js'

export type Rec = { model: string; typeId: string | null; path: string; data: Record<string, unknown>; body: string | null; published: boolean; created: string; updated: string; revision: number; draft?: boolean; publishedAt?: string | null; updatedBy?: string | null; createdBy?: string | null }
export type Asset = { address: string; name: string; size: number | null; mime: string; width: number | null; height: number | null; modified: string | null }
export type Index = { built: string; space: string; site: { name: string; tagline: string; description: string; url: string }; docsOnly: boolean; locales: { code: string; name: string; default: boolean; fallbackCode: string | null }[]; models: any[]; types: any[]; records: Rec[]; assets: Asset[]; deleted: { model: string; path: string; at: string }[] }

const CLOUD = (Deno.env.get('CONTENT_STORE') ?? '') === 'cloud'
const S = SITE as { modules?: Record<string, unknown>; name?: string; languages?: string[]; api?: { space?: string; public?: boolean } }
import { SPACE, PUBLIC, API_ON, FORMS_ON, SESSIONS_ON } from './api/flags.ts'
export { SPACE, PUBLIC, API_ON, FORMS_ON, SESSIONS_ON }

const EMPTY = (): Index => ({ built: new Date().toISOString(), space: SPACE, site: { name: S.name ?? '', tagline: '', description: '', url: '' }, docsOnly: false, locales: (S.languages ?? ['en']).map((c, i, a) => ({ code: c, name: c, default: i === 0, fallbackCode: i === 0 ? null : a[0] })), models: [], types: [], records: [], assets: [], deleted: [] })

/* ---- git mode: the file ---- */
let fileIndex: Index | null = null, fileTried = false
async function fromFile(): Promise<{ live: Index; preview: Index }> {
  if (!fileIndex && !fileTried) {
    fileTried = true
    try { const mod = await import('./content/index.json', { with: { type: 'json' } }); const raw = (mod.default ?? mod) as Partial<Index>; fileIndex = { ...EMPTY(), ...raw, types: raw.types ?? [], records: raw.records ?? [], assets: raw.assets ?? [], deleted: raw.deleted ?? [], models: raw.models ?? [], locales: raw.locales ?? EMPTY().locales }   /* an index of an older shape answers what it has */ }
    catch (e) { console.warn('content: no content index — node build/content-json.mjs (the content-json step) writes it: ' + (e as Error).message) }
  }
  const i = fileIndex ?? EMPTY()
  return { live: i, preview: i }   /* git mode has no drafts: preview shows the unpublished entries alone */
}

/* ---- cloud mode: the rows and the bucket ---- */
let rowsAt = 0, rowsIndex: { live: Index; preview: Index } | null = null
async function fromRows(): Promise<{ live: Index; preview: Index }> {
  if (rowsIndex && Date.now() - rowsAt < 60_000) return rowsIndex
  const store = rowsStore({ client: admin, by: '', url: '', key: '' })
  const site = { root: '', modules: S.modules ?? {}, admin: {} }
  let models: any[] = []
  try {
    const reg = await registry('', { site, siteModels: SITE_MODELS, store })
    models = reg.filter((m: any) => m.fields && m.dir).map((m: any) => ({ key: m.key, name: m.name, dir: String(m.dir).replace(/^\.?\//, ''), single: !!m.single, nested: !!m.nested, body: !!m.body, bodyLabel: m.bodyLabel || null, fields: describeSchema(m.fields), model: m.model ? { key: m.model.key, name: m.model.name, singular: m.model.singular } : null })).filter(isRecordModel)
  } catch (e) { console.warn('content: the registry —', (e as Error).message) }
  const { data: rows, error } = await admin.from('content').select('path, published, data, body, text, updated_at, updated_by, published_at, deleted_at, content_drafts(text, data, body, at, by, deleted)')
  if (error) { console.warn('content: content rows —', error.message); return rowsIndex ?? { live: EMPTY(), preview: EMPTY() } }
  const now = new Date().toISOString()
  const live: Rec[] = [], preview: Rec[] = [], deleted: Index['deleted'] = []
  for (const r of rows ?? []) {
    const m = modelOfPath(models, r.path); if (!m) continue
    const d = Array.isArray(r.content_drafts) ? r.content_drafts[0] : r.content_drafts
    const path = pathWithin(m, r.path)
    if (r.deleted_at) { deleted.push({ model: m.key, path, at: r.deleted_at }); continue }
    const base = (data: Record<string, unknown>, body: string | null, updated: string) => ({ model: m.key, typeId: null as string | null, path, data: data ?? {}, body: body && String(body).trim() ? String(body) : null, published: isPublished(data), created: data?.date ? new Date(String(data.date)).toISOString() : (r.published_at || r.updated_at || now), updated, revision: Math.max(1, Math.floor((Date.parse(updated) - 1577836800000) / 1000)), publishedAt: r.published_at || null, updatedBy: r.updated_by || null, createdBy: r.updated_by || null })
    if (r.text != null) live.push(base((r.data ?? {}) as Record<string, unknown>, r.body, r.published_at || r.updated_at || now))
    if (d && !d.deleted && d.text != null) preview.push({ ...base((d.data ?? {}) as Record<string, unknown>, d.body, d.at || r.updated_at || now), draft: true, updatedBy: d.by || r.updated_by || null })
    else if (r.text != null) preview.push(base((r.data ?? {}) as Record<string, unknown>, r.body, r.published_at || r.updated_at || now))
  }
  /* the assets: the bucket's two roots, walked; a picture's size from its header */
  const assets: Asset[] = []
  const walk = async (dir: string) => { let list: any[] = []; try { list = await store.assets.list(dir) } catch { return }; for (const e of list) { if (e.type === 'dir') { await walk(e.path); continue } if (e.name.startsWith('.') || /^public\/(static|print)\//.test(e.path)) continue; const address = e.path.startsWith('content/uploads/') ? '/uploads/' + e.path.slice('content/uploads/'.length) : '/' + e.path.slice('public/'.length); const mime = e.mime || mimeOf(e.name); let width: number | null = null, height: number | null = null; if (/^image\/(png|jpeg|webp|gif)$/.test(mime) && e.url) { try { const head = await fetch(e.url, { headers: { Range: 'bytes=0-65535' } }); const sz = imageSize(new Uint8Array(await head.arrayBuffer())); if (sz) { width = sz.width; height = sz.height } } catch { /* no size */ } } assets.push({ address, name: e.name, size: e.size ?? null, mime, width, height, modified: e.modified ? new Date(e.modified).toISOString() : null }) } }
  await walk('content/uploads'); await walk('public')
  const siteRec = live.find((x) => x.model === 'site')
  const sd = (siteRec?.data ?? {}) as Record<string, unknown>
  const types = contentTypes(models, { space: SPACE, now })
  for (const list of [live, preview]) for (const x of list) { const t = types.find((y: any) => y._model === x.model); x.typeId = t ? t.sys.id : null }
  const mk = (records: Rec[]): Index => ({ ...EMPTY(), built: now, site: { name: String(sd.name ?? S.name ?? ''), tagline: String(sd.tagline ?? ''), description: String(sd.description ?? ''), url: String(sd.url ?? '').replace(/\/+$/, '') }, models, types, records, assets, deleted })
  rowsIndex = { live: mk(live), preview: mk(preview) }
  rowsAt = Date.now()
  return rowsIndex
}

export const contentIndexes = (): Promise<{ live: Index; preview: Index }> => (CLOUD ? fromRows() : fromFile())
/* a write through the Management API: the next read rebuilds the rows' index rather than serving the minute's */
export const invalidateIndex = () => { rowsAt = 0 }
export { CLOUD }
