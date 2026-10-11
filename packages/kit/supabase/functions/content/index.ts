/*
 * The content API: Contentful's Delivery, Preview, GraphQL and Sync APIs over the site's published content — every
 * collection and every model — at <domain>/api/spaces/<space>/environments/master/… and <domain>/api/content/v1/spaces/<space>/…
 * (one host rewrite, /api/*, reaches the storefront function, which hands these on; the shell forwards them where
 * there is none — /spaces on the site is the community, never this). No JWT:
 * a delivery key, or none where the site leaves Delivery public; a preview key for drafts and unpublished entries; a
 * key allowed gated content for a gated entry's body. Every write is refused until the management change.
 *
 *   /spaces/<space>                                    the space; /environments/master the environment
 *   …/entries, …/entries/<id>                          Contentful's entries with every query argument, includes, errors
 *   …/assets, …/assets/<id>                            the media library as assets
 *   …/content_types, …/content_types/<id>              what the admin knows about every model, as Contentful's types
 *   …/locales                                          the site's languages
 *   …/sync                                             initial and by token, with DeletedEntry / DeletedAsset
 *   /content/v1/spaces/<space>/environments/master     GraphQL, generated from the content types
 *   /openapi.json, /content/v1/openapi.json             the whole API described as OpenAPI 3.1, generated from the index (Scalar renders it at /api)
 * ETag and If-None-Match, Cache-Control for the host's CDN, Contentful's rate-limit headers and error envelope. What the
 * index holds is _shared/content-index.ts's business; the shapes and the query are _shared/api/*'s.
 */
import { contentIndexes, SPACE, API_ON, FORMS_ON, SESSIONS_ON, type Index } from '../_shared/content-index.ts'
import { STORE_ON, SUPPORT_ON } from '../_shared/api/flags.ts'
import { makeContext } from '../_shared/api/context.js'
import { entryOf, assetOf, includesFor, strip } from '../_shared/api/entry.js'
import { parse, apply, applyAssets, selectOn } from '../_shared/api/query.js'
import { ERR } from '../_shared/api/errors.js'
import { entryId, assetId, hashOf } from '../_shared/api/ids.js'
import { tokenOf, callerOf, rateLimit, type Caller } from '../_shared/api/keys.ts'
import { runGraphQL } from '../_shared/api/graphql.js'
import { openapiFor } from '../_shared/api/openapi.js'
import { manage, sweepUploads } from '../_shared/api/manage.ts'
import analyticsConfig from '../_shared/analytics.json' with { type: 'json' }

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-contentful-user-agent, x-contentful-content-type, x-contentful-version, x-contentful-enable-alpha-feature, if-none-match', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'ETag, X-Contentful-RateLimit-Hour-Limit, X-Contentful-RateLimit-Hour-Remaining, X-Contentful-RateLimit-Second-Limit, X-Contentful-RateLimit-Second-Remaining, X-Contentful-RateLimit-Reset, X-Contentful-Request-Id' }
type Q = Record<string, string>
const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

const site = () => (Deno.env.get('APP_URL') ?? Deno.env.get('VITE_APP_URL') ?? '').replace(/\/+$/, '')

/* the compiled forms, for the Forms API's part of the document — none where the forms module is off (no file) */
/* the session types, for the Scheduling API's part — none where the sessions module is off */
async function sessionsFor() { if (!SESSIONS_ON) return null; try { const { of } = await import('../_shared/compiled.ts'); return (of('catalog') as any).sessions ?? [] } catch { return null } }
async function formsFor() { if (!FORMS_ON) return null; try { const mod = await import('../_shared/forms.json', { with: { type: 'json' } }); return (mod as any).default ?? mod } catch { return null } }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const q: Q = {}; url.searchParams.forEach((v, k) => { q[k] = v })
  /* the path under the function: the runtime mounts it at /content (the site's host at
     /functions/v1/content). The site's own room — /api/content — is stripped by the host's rule, so
     what arrives here is Contentful's own path and nothing in this file knows about the prefix. */
  const path = url.pathname.replace(/^(?:.*?\/functions\/v1)?\/content(?=\/|$)/, '').replace(/\/+$/, '') || '/'
  const rid = Math.random().toString(36).slice(2, 12)
  let extra: Record<string, string> = {}
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => {
    const text = JSON.stringify(body)
    const etag = '"' + hashOf(text) + '"'
    const h = { ...CORS, ...extra, 'Content-Type': 'application/vnd.contentful.delivery.v1+json', 'X-Contentful-Request-Id': rid, ETag: etag, ...(status === 200 && req.method === 'GET' ? { 'Cache-Control': CACHE } : {}), ...headers }
    if (status === 200 && req.method === 'GET' && req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: h })
    return new Response(text, { status, headers: h })
  }
  const fail = (e: { status: number; body: unknown }) => reply(e.body, e.status)
  if (!API_ON) return fail(ERR.notFound('The content API is not on for this site.'))
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(req.method)) return fail(ERR.method())

  /* the uploads' daily sweep, asked by pg_cron under the service key (sweep_uploads in 85-api.sql) */
  if (path === '/sweep-uploads' && req.method === 'POST') { const r = await sweepUploads(req, { rid, olderThanMs: Number(q.older_than_ms) > 0 ? Number(q.older_than_ms) : undefined }); return reply(r.body, r.status) }

  /* who is asking, and how often */
  const token = tokenOf(req, q)
  const caller = await callerOf(token)
  if (caller === 'public-denied' || caller === null) return fail(ERR.token())
  const who = caller.id ?? (req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'anon').split(',')[0].trim()
  const rl = await rateLimit(who); extra = rl.headers
  if (rl.over) return fail(ERR.rate(rl.reset))

  /* the API described: OpenAPI 3.1 from the index, for Scalar at /api and any client that reads it */
  if (path === '/openapi.json' || path === '/content/v1/openapi.json') { const idx = (await contentIndexes()).live; return reply(openapiFor(idx, { base: idx.site.url || site(), functions: (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''), sources: ((analyticsConfig as { sources?: { name: string }[] }).sources ?? []).map((x) => x.name), forms: await formsFor(), sessions: await sessionsFor(), store: STORE_ON, support: SUPPORT_ON }), 200, { 'Content-Type': 'application/json' }) }

  /* the space and the environment in the path */
  const gql = /^\/content\/v1\/spaces\/([^/]+)(?:\/environments\/([^/]+))?$/.exec(path)
  const rest = /^\/spaces\/([^/]+)(?:\/environments\/([^/]+))?(\/.*)?$/.exec(path)
  const m = gql ?? rest
  if (!m) return fail(ERR.notFound('The resource could not be found.', { type: 'Route', id: path }))
  if (m[1] !== SPACE) return fail(ERR.notFound('The resource could not be found.', { type: 'Space', id: m[1] }))
  const env = m[2] ?? 'master'
  if (env !== 'master') return fail(ERR.notFound('The resource could not be found.', { type: 'Environment', id: env }))
  const preview = caller.kind === 'preview' || caller.kind === 'management'
  const both = await contentIndexes()
  const index: Index = preview ? both.preview : both.live
  const imagesBase = (index.site.url || site()).replace(/^https?:/, '') + '/api/media'

  /* ---- GraphQL ---- */
  if (gql) {
    let query = '', variables: Record<string, unknown> = {}, operationName: string | undefined
    if (req.method === 'POST') { try { const b = await req.json(); query = String(b.query ?? ''); variables = b.variables ?? {}; operationName = b.operationName } catch { return reply({ errors: [{ message: 'The body is not JSON.' }] }, 400) } }
    else { query = q.query ?? ''; try { variables = q.variables ? JSON.parse(q.variables) : {} } catch { variables = {} }; operationName = q.operationName }
    if (!query) return reply({ errors: [{ message: 'A query is required.' }] }, 400)
    const out = await runGraphQL({ query, variables, operationName, index, live: both.live, previewIndex: both.preview, caller, imagesBase })
    return reply(out.body, out.status, { 'Content-Type': 'application/json' })
  }
  const sub = m[3] ?? ''
  /* the Management API: the writing methods, the uploads, the webhook definitions, and a management key's own shapes on a read */
  const managed = await manage(req, { sub, method: req.method, q, caller, rid, spaceLevel: !m[2] && /^\/webhook_definitions/.test(sub) ? true : false })
  if (managed) return managed.status === 204 ? new Response(null, { status: 204, headers: { ...CORS, ...extra, 'X-Contentful-Request-Id': rid } }) : reply(managed.body, managed.status, { 'Content-Type': 'application/vnd.contentful.management.v1+json', 'Cache-Control': 'no-store' })
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail({ status: 405, body: { sys: { type: 'Error', id: 'BadRequest' }, message: 'The Delivery API is read-only; a write is the Management API\'s, under a management key.', requestId: rid } })
  const ctxOf = (locale: string | null) => makeContext(index, { preview, gated: caller.gated, locale, imagesBase })
  if (m[2] && (sub === '' || sub === '/')) return reply({ sys: { type: 'Environment', id: 'master', version: 1, space: { sys: { type: 'Link', linkType: 'Space', id: SPACE } }, status: { sys: { type: 'Link', linkType: 'Status', id: 'ready' } } }, name: 'master' })   /* the environment first: its sub is the space's too */
  if (sub === '' || sub === '/') return reply({ sys: { type: 'Space', id: SPACE, version: 1 }, name: index.site.name, locales: index.locales.map((l) => ({ code: l.code, default: l.default, name: l.name, fallbackCode: l.fallbackCode })) })

  /* ---- locales, content types ---- */
  if (sub === '/locales') return reply(page(index.locales.map((l) => ({ sys: { type: 'Locale', id: l.code, version: 1 }, code: l.code, name: l.name, default: l.default, fallbackCode: l.fallbackCode, optional: !l.default })), q))
  const ctx = ctxOf(q.locale ?? null)
  if (sub === '/content_types') return reply(page(ctx.types, q))
  let one = /^\/content_types\/([^/]+)$/.exec(sub)
  if (one) { const t = ctx.types.find((x: any) => x.sys.id === one![1]); return t ? reply(t) : fail(ERR.notFound('The resource could not be found.', { type: 'ContentType', id: one[1] })) }

  /* ---- entries ---- */
  const a = parse(q, { kind: sub.startsWith('/assets') ? 'assets' : 'entries', types: ctx.types, locales: index.locales })
  if ('error' in a) { const e = a.error as { id: string; message: string; details?: unknown }; return fail({ status: e.id === 'UnknownContentType' ? 400 : 400, body: { sys: { type: 'Error', id: e.id }, message: e.message, ...(e.details ? { details: e.details } : {}), requestId: rid } }) }
  one = /^\/entries\/([^/]+)$/.exec(sub)
  if (one) {
    const r = ctx.recordsById.get(one[1])
    if (!r) return fail(ERR.notFound('The resource could not be found.', { type: 'Entry', id: one[1] }))
    const e = await entryOf(r, ctx)
    return reply(selectOn(strip(e), a.select))
  }
  if (sub === '/entries') {
    const rows = apply(ctx.records, a, ctx)
    const pageRows = rows.slice(a.skip, a.skip + a.limit)
    const items = []; for (const r of pageRows) items.push(await entryOf(r, ctx))
    const { includes, errors } = a.include > 0 ? await includesFor(items, a.include, ctx) : { includes: {}, errors: [] }
    const out: Record<string, unknown> = { sys: { type: 'Array' }, total: rows.length, skip: a.skip, limit: a.limit, items: items.map((e) => selectOn(strip(e), a.select)) }
    if (Object.keys(includes).length) out.includes = includes
    if (errors.length) out.errors = errors
    return reply(out)
  }
  /* ---- assets ---- */
  one = /^\/assets\/([^/]+)$/.exec(sub)
  if (one) { const x = ctx.assetsById.get(one[1]); return x ? reply(selectOn(assetOf(x, ctx), a.select)) : fail(ERR.notFound('The resource could not be found.', { type: 'Asset', id: one[1] })) }
  if (sub === '/assets') {
    const rows = applyAssets(ctx.assets, a)
    return reply({ sys: { type: 'Array' }, total: rows.length, skip: a.skip, limit: a.limit, items: rows.slice(a.skip, a.skip + a.limit).map((x) => selectOn(assetOf(x, ctx), a.select)) })
  }
  /* ---- sync ---- */
  if (sub === '/sync') return reply(await sync(q, index, ctxOf('*'), url))
  return fail(ERR.notFound('The resource could not be found.', { type: 'Route', id: sub }))
})

const page = (items: unknown[], q: Q) => { const skip = Math.max(0, parseInt(q.skip ?? '0', 10) || 0), limit = Math.min(1000, Math.max(1, parseInt(q.limit ?? '100', 10) || 100)); return { sys: { type: 'Array' }, total: items.length, skip, limit, items: items.slice(skip, skip + limit) } }

/* the sync API: a token is the time the caller last saw and its page; every locale on every item, as Contentful syncs */
const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const dec = (s: string) => { try { return JSON.parse(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))) } catch { return null } }
async function sync(q: Q, index: Index, ctx: any, url: URL) {
  const base = `${url.origin}${url.pathname}`
  const SIZE = 100
  let since: string | null = null, pageNo = 1, type = q.type ?? 'all', ct = q.content_type ?? null
  if (q.sync_token) { const t = dec(q.sync_token); if (!t) return { sys: { type: 'Error', id: 'BadQuery' }, message: 'The sync token is not one of ours.' }; since = t.t ?? null; pageNo = t.page ?? 1; type = t.type ?? 'all'; ct = t.ct ?? null }
  else if (q.initial !== 'true') return { sys: { type: 'Error', id: 'BadQuery' }, message: 'A sync starts with initial=true or continues with a sync_token.' }
  const after = (t: string | null | undefined) => !since || (t && t > since)
  const wantEntries = type === 'all' || type === 'Entry', wantAssets = type === 'all' || type === 'Asset', wantDeleted = type === 'all' || type === 'Deletion' || type === 'DeletedEntry' || type === 'DeletedAsset'
  const items: unknown[] = []
  if (wantEntries) for (const r of ctx.records.filter((r: any) => (!ct || r.typeId === ct) && after(r.updated))) items.push(strip(await entryOf(r, ctx)))
  if (wantAssets && !ct) for (const x of ctx.assets.filter((x: any) => after(x.modified))) items.push(assetOf(x, ctx))
  const typeOfModel = (k: string) => { const t = index.types.find((x: any) => x._model === k); return t ? t.sys.id : k }
  if (wantDeleted && since) for (const d of index.deleted.filter((d) => d.at > since!)) items.push({ sys: { type: 'DeletedEntry', id: entryId(typeOfModel(d.model), d.path), space: { sys: { type: 'Link', linkType: 'Space', id: index.space } }, environment: { sys: { id: 'master', type: 'Link', linkType: 'Environment' } }, createdAt: d.at, updatedAt: d.at, deletedAt: d.at, revision: 1 } })
  const start = (pageNo - 1) * SIZE, slice = items.slice(start, start + SIZE)
  const out: Record<string, unknown> = { sys: { type: 'Array' }, items: slice }
  if (start + SIZE < items.length) out.nextPageUrl = base + '?sync_token=' + enc({ t: since, page: pageNo + 1, type, ct })
  else out.nextSyncUrl = base + '?sync_token=' + enc({ t: new Date().toISOString(), type, ct })
  return out
}
export { assetId }
