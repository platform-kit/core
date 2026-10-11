/* The content API (content-api): an open-source Contentful.
   (1) The index (build/content-json.mjs): every record of every model with fields, the models' entries, the assets, an
       unpublished record kept as unpublished, the content types derived from the admin's description with Contentful's
       field types; (2) the shared shapes under Node: an unresolvable link listed as Contentful lists it, the query's
       operators recomputed, Rich Text from markdown; (3) with the stack up and the functions served: the official
       `contentful.js` pointed at the site (host swapped), keys made and revoked as the admin makes them, the paywall
       under three keys, preview, GraphQL (introspection, a query, the refusals), sync with a deletion, the Images API
       decoded, ETag → 304, the rate limit; the OpenAPI document the function serves, validated and compared with the
       one the index gives. Skipped where the stack is down; CONTENT_API_TEST=0 skips it. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { contentIndex } from './content-json.mjs'
import { makeContext } from '../supabase/functions/_shared/api/context.js'
import { entryOf, includesFor } from '../supabase/functions/_shared/api/entry.js'
import { parse, apply } from '../supabase/functions/_shared/api/query.js'
import { richTextFromMarkdown } from '../supabase/functions/_shared/api/richtext.js'
import { entryId, assetId } from '../supabase/functions/_shared/api/ids.js'
import { openapiFor } from '../supabase/functions/_shared/api/openapi.js'
import { loadSite } from './site.mjs'

const note = (m) => console.log('content-api: ' + m)
if (process.env.CONTENT_API_TEST === '0') { note('skipped (CONTENT_API_TEST=0)'); process.exit(0) }
const ROOT = process.cwd()
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }
const c = await loadSite(ROOT)
if (c.modules && c.modules.api === false) { note('skipped — the api module is off'); process.exit(0) }

/* ---- (1) the index ---- */
const index = await contentIndex({ root: ROOT })
const two = await contentIndex({ root: ROOT })
const byModel = (k) => index.records.filter((r) => r.model === k)
await ok('every model with fields is a content type, every record of it in the index, an unpublished one kept as unpublished', () => {
  assert.ok(index.models.length >= 1 && index.types.length === index.models.length)
  for (const m of index.models) {
    const t = index.types.find((x) => x._model === m.key); assert.ok(t, m.key + ' typed')
    assert.ok(t.fields.every((f) => ['Symbol', 'Text', 'RichText', 'Integer', 'Number', 'Date', 'Boolean', 'Object', 'Link', 'Array'].includes(f.type)), m.key + ' field types')
    assert.ok(!t.fields.some((f) => f.id === 'published'), 'published is the status, never a field')
    if (m.body) assert.ok(t.fields.some((f) => f.id === 'body' && f.type === 'RichText') && t.fields.some((f) => f.id === 'bodyMarkdown'), m.key + ' body')
  }
  for (const r of index.records) { assert.ok(r.typeId && r.path && r.updated && r.created, r.model + '/' + r.path); assert.equal(typeof r.published, 'boolean') }
  /* what the files say */
  const off = []
  for (const m of index.models) { const d = path.join(ROOT, m.dir); if (!fs.existsSync(d) || m.single) continue; const walk = (p) => { for (const f of fs.readdirSync(p, { withFileTypes: true })) { if (f.isDirectory()) { if (m.nested) walk(path.join(p, f.name)) } else if (f.name.endsWith('.md') && /^published:\s*false/m.test(fs.readFileSync(path.join(p, f.name), 'utf8'))) off.push([m.key, path.relative(d, path.join(p, f.name)).replace(/\.md$/, '')]) } }; walk(d) }
  for (const [k, p] of off) { const r = byModel(k).find((x) => x.path === p); assert.ok(r && r.published === false, k + '/' + p + ' unpublished in the index') }
  assert.deepEqual(index.records.map((r) => r.model + '/' + r.path), two.records.map((r) => r.model + '/' + r.path), 'two builds, one index')
})
await ok('the assets are the library\'s files with their sizes; the site, the space and the locales are there', () => {
  assert.ok(index.assets.every((a) => a.address && a.name && a.mime && (a.address.startsWith('/uploads/') || a.address.startsWith('/'))))
  const pic = index.assets.find((a) => /^image\/(png|jpeg|webp)$/.test(a.mime)); if (pic) assert.ok(pic.width > 0 && pic.height > 0, 'a picture has its size')
  assert.ok(index.space && /^[a-z0-9-]+$/.test(index.space)); assert.ok(index.locales.length >= 1 && index.locales[0].default)
})
const custom = index.models.filter((m) => m.model)
if (custom.length) await ok('a site\'s own model on the API: its fields in Contentful\'s types, a select\'s choices as a validation, a reference as a Link, a picture as an Asset link, markdown as Rich Text with its twin', () => {
  const typeOf = (m, name) => index.types.find((t) => t._model === m.key).fields.filter((f) => f.id === name || f.id === name + 'Markdown')
  for (const m of custom) for (const f of m.fields) {
    const defs = typeOf(m, f.name); if (f.name === 'published') { assert.equal(defs.length, 0); continue }
    assert.ok(defs.length >= 1, m.key + '.' + f.name)
    if (f.kind === 'markdown') { assert.equal(defs[0].type, 'RichText'); assert.equal(defs[1].type, 'Text') }
    if (f.kind === 'image') { assert.equal(defs[0].type, 'Link'); assert.equal(defs[0].linkType, 'Asset') }
    if (f.kind === 'reference') { assert.ok(defs[0].type === 'Link' || defs[0].type === 'Array'); assert.ok(JSON.stringify(defs[0]).includes('linkContentType')) }
    if (f.kind === 'select') { assert.equal(defs[0].type, 'Symbol'); assert.ok(defs[0].validations[0] && defs[0].validations[0].in.length, 'the choices') }
    if (f.kind === 'tags') { assert.equal(defs[0].type, 'Array') }
    if (f.kind === 'group') assert.equal(defs[0].type, 'Object')
    if (f.kind === 'list') assert.equal(defs[0].type, 'Array')
  }
})

/* ---- (2) the shapes ---- */
const ctx = makeContext(index, { preview: false, gated: false, locale: null, imagesBase: '//x.test/api/media' })
await ok('an entry: sys with a stable id, its fields exactly its type\'s, a markdown body as Rich Text with the markdown beside it, a picture as an Asset link into includes', async () => {
  const withBody = index.records.find((r) => r.published && r.body && index.models.find((m) => m.key === r.model).body)
  const e = await entryOf(withBody, ctx)
  assert.equal(e.sys.id, entryId(withBody.typeId, withBody.path)); assert.equal(e.sys.type, 'Entry'); assert.equal(e.sys.contentType.sys.id, withBody.typeId); assert.ok(e.sys.createdAt && e.sys.updatedAt && e.sys.revision >= 1)
  assert.equal(e.fields.body.nodeType, 'document'); assert.equal(typeof e.fields.bodyMarkdown, 'string')
  const type = index.types.find((t) => t._model === withBody.model); for (const k of Object.keys(e.fields)) assert.ok(type.fields.some((f) => f.id === k), k + ' is a field of ' + type.sys.id)
  const pictured = index.records.find((r) => r.published && Object.entries(r.data).some(([k, v]) => typeof v === 'string' && v.startsWith('/') && ctx.assetsByAddress.has(v)))
  if (pictured) { const pe = await entryOf(pictured, ctx); const link = Object.values(pe.fields).find((v) => v && v.sys && v.sys.linkType === 'Asset'); assert.ok(link, 'an Asset link'); const { includes } = await includesFor([pe], 1, ctx); assert.ok(includes.Asset && includes.Asset.some((a) => a.sys.id === link.sys.id), 'the asset included'); assert.ok(includes.Asset[0].fields.file.url.startsWith('//x.test/api/media/' + index.space + '/'), 'the images door') }
})
await ok('a link that cannot be resolved is listed under errors as notResolvable; a resolvable one lands in includes', async () => {
  const isRef = (f) => f.kind === 'reference' || (f.widget === 'select' && f.options && index.models.some((x) => x.key === f.options || 'models/' + String(f.options).replace(/^model:/, '') === x.key))
  const ref = index.models.find((m) => m.fields.some(isRef) && byModel(m.key).some((r) => r.published && r.data[m.fields.find(isRef).name]))
  if (!ref) { note('no record with a reference on this site — the link checks run on the demo'); return }
  const f = ref.fields.find(isRef)
  const target = index.models.find((x) => x.key === f.of || x.key === f.options || 'models/' + String(f.options).replace(/^model:/, '') === x.key || 'models/' + f.of === x.key)
  const real = byModel(ref.key).find((r) => r.published && r.data[f.name])
  const fake = { ...real, path: 'probe-unresolvable', data: { ...real.data, [f.name]: 'nobody-here' } }
  const [e1, e2] = [await entryOf(real, ctx), await entryOf(fake, ctx)]
  const targetType = index.types.find((t) => t._model === (target && target.key)); const a = await includesFor([e1], 1, ctx); assert.ok(a.includes.Entry && a.includes.Entry.some((x) => x.sys.id === entryId(targetType.sys.id, String(real.data[f.name]))), 'the ' + (target ? target.key : '') + ' entry included')
  const b = await includesFor([e2], 1, ctx); assert.deepEqual(b.errors, [{ sys: { id: 'notResolvable', type: 'error' }, details: { type: 'Link', linkType: 'Entry', id: entryId(targetType.sys.id, 'nobody-here') } }])
})
await ok('every operator, recomputed from the records', () => {
  const t = index.types.find((x) => byModel(x._model).filter((r) => r.published).length >= 2 && index.models.find((m) => m.key === x._model).fields.some((f) => f.name === 'title'))
  const rows = byModel(t._model).filter((r) => r.published), m = index.models.find((x) => x.key === t._model)
  const q = (extra) => { const a = parse({ content_type: t.sys.id, ...extra }, { types: ctx.types, locales: index.locales }); assert.ok(!('error' in a), JSON.stringify(a.error)); return apply(ctx.records, a, ctx) }
  const word = rows[0].data.title.split(/\s+/).find((w) => w.length > 3) || rows[0].data.title
  assert.deepEqual(q({ 'fields.title[match]': word }).map((r) => r.path).sort(), rows.filter((r) => String(r.data.title).toLowerCase().includes(word.toLowerCase())).map((r) => r.path).sort())
  assert.deepEqual(q({ 'fields.title': rows[0].data.title }).map((r) => r.path), [rows[0].path])
  assert.deepEqual(q({ 'fields.title[ne]': rows[0].data.title }).length, rows.length - 1)
  assert.deepEqual(q({ 'sys.id[in]': rows.slice(0, 2).map((r) => entryId(t.sys.id, r.path)).join(',') }).length, 2)
  const tagged = m.fields.find((f) => f.name === 'tags') && rows.filter((r) => Array.isArray(r.data.tags) && r.data.tags.length)
  if (tagged && tagged.length) { const tag = tagged[0].data.tags[0]; assert.deepEqual(q({ 'fields.tags[in]': tag }).map((r) => r.path).sort(), rows.filter((r) => (r.data.tags || []).includes(tag)).map((r) => r.path).sort()); assert.deepEqual(q({ 'fields.tags[all]': tagged[0].data.tags.join(',') }).map((r) => r.path).sort(), rows.filter((r) => tagged[0].data.tags.every((x) => (r.data.tags || []).includes(x))).map((r) => r.path).sort()); assert.deepEqual(q({ 'fields.tags[exists]': 'false' }).length, rows.filter((r) => !(r.data.tags || []).length).length) }
  const dated = m.fields.find((f) => f.name === 'date') && rows.filter((r) => r.data.date)
  if (dated && dated.length > 1) { const sorted = [...dated].sort((a, b) => new Date(a.data.date) - new Date(b.data.date)); assert.deepEqual(q({ 'fields.date[gte]': new Date(sorted[1].data.date).toISOString() }).length, dated.filter((r) => new Date(r.data.date) >= new Date(sorted[1].data.date)).length); assert.deepEqual(q({ order: 'fields.date' }).filter((r) => r.data.date).map((r) => r.path), sorted.map((r) => r.path)) }
  assert.deepEqual(q({ order: '-sys.createdAt', limit: '2' }).length, rows.length, 'order alone never cuts (the page does)')
  const bad = parse({ content_type: t.sys.id, 'fields.title[near]': '1,2' }, { types: ctx.types, locales: index.locales }); assert.equal(bad.error.id, 'InvalidQuery')
  const noType = parse({ 'fields.title': 'x' }, { types: ctx.types, locales: index.locales }); assert.equal(noType.error.id, 'BadQuery')
  const unknown = parse({ content_type: 'nope' }, { types: ctx.types, locales: index.locales }); assert.equal(unknown.error.id, 'InvalidQuery'); assert.equal(unknown.error.details.errors[0].name, 'unknownContentType')
  const over = parse({ limit: '5000' }, { types: ctx.types, locales: index.locales }); assert.equal(over.error.id, 'BadQuery')
})
await ok('Rich Text from markdown: Contentful\'s node types and marks, a library picture an embedded asset', () => {
  const pic = index.assets.find((a) => /^image\//.test(a.mime))
  const doc = richTextFromMarkdown(`# Head\n\nA **bold** *soft* \`code\` [link](https://x.y).\n\n- one\n- two\n\n1. first\n\n> quote\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![pic](${pic ? pic.address : '/nope.png'})\n`, ctx)
  const types = doc.content.map((n) => n.nodeType)
  assert.deepEqual(types, ['heading-1', 'paragraph', 'unordered-list', 'ordered-list', 'blockquote', 'hr', 'table', pic ? 'embedded-asset-block' : 'paragraph'])
  const para = doc.content[1].content; assert.deepEqual(para[1].marks, [{ type: 'bold' }]); assert.deepEqual(para[3].marks, [{ type: 'italic' }]); assert.deepEqual(para[5].marks, [{ type: 'code' }]); assert.equal(para[7].nodeType, 'hyperlink'); assert.equal(para[7].data.uri, 'https://x.y')
  if (pic) assert.equal(doc.content[7].data.target.sys.id, assetId(pic.address))
  assert.ok(JSON.stringify(doc).includes('"data":{}'), 'every node carries data')
})

/* ONE ID, ONE TYPE. A site's own model is namespaced (`models/events` → `modelEvent`) precisely so it can
   never land on a stock collection's id; without this the collision is silent — the later type simply wins in the
   schema map, and a query, a link validation and an entry's id each mean whichever one got there first. */
await ok('every content type has an id of its own', () => {
  const seen = new Map()
  for (const t of index.types) seen.set(t.sys.id, [...(seen.get(t.sys.id) || []), t._model || t.name])
  const clashes = [...seen].filter(([, ms]) => ms.length > 1)
  assert.deepEqual(clashes, [], 'two models under one content type id: ' + JSON.stringify(clashes))
})

await ok('the OpenAPI document: valid 3.1, one schema per content type, content_type\'s choices the type ids, every door under its tag, the two APIs as tag groups', async () => {
  const { validate } = await import('@scalar/openapi-parser')
  const formsOn = c.modules.forms !== false && fs.existsSync(path.join(ROOT, 'supabase/functions/_shared/forms.json'))
  const forms = formsOn ? JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/forms.json'), 'utf8')) : null
  const sessOn = c.modules.sessions !== false && fs.existsSync(path.join(ROOT, 'supabase/functions/_shared/catalog.json'))
  const sessions = sessOn ? (JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/catalog.json'), 'utf8')).sessions || []) : null
  const storeOn = c.modules.store !== false, supportOn = c.modules.support !== false
  const doc = openapiFor(index, { base: 'https://x.test', functions: 'http://stack.test', sources: ['other-site'], forms, sessions, store: storeOn, support: supportOn })
  const v = await validate(doc); assert.ok(v.valid, 'validate: ' + JSON.stringify((v.errors || []).slice(0, 3)))
  assert.equal(doc.openapi, '3.1.0'); assert.ok(doc.info.title && doc.info.description.includes(index.space))
  for (const t of index.types) { const s = doc.components.schemas[t.sys.id.replace(/^./, (c) => c.toUpperCase())]; assert.ok(s, 'a schema for ' + t.sys.id); assert.deepEqual(Object.keys(s.properties.fields.properties), t.fields.map((f) => f.id), 'the fields of ' + t.sys.id) }
  const entries = doc.paths[`/api/content/spaces/${index.space}/environments/master/entries`].get
  assert.deepEqual(entries.parameters.find((p) => p.name === 'content_type').schema.enum, index.types.map((t) => t.sys.id))
  const tags = (tag) => Object.values(doc.paths).flatMap((p) => Object.values(p)).filter((op) => op.tags.includes(tag)).length
  assert.deepEqual([tags('Content Delivery'), tags('Content Management'), tags('Content Sync'), tags('Content GraphQL'), tags('Content Images'), tags('Analytics Events'), tags('Analytics Capture')], [8, 19, 1, 2, 1, 1, 4], 'every door has its operations under its tag')
  /* the Management API's operations sit on the Delivery routes, under their own tag and key */
  const entryRoute = doc.paths[`/api/content/spaces/${index.space}/environments/master/entries/{id}`]; assert.ok(entryRoute.get && entryRoute.put && entryRoute.delete, 'read, write and delete on one route'); assert.deepEqual(entryRoute.put.security, [{ managementKey: [] }]); assert.ok(doc.components.securitySchemes.managementKey)
  assert.ok(doc.paths[`/api/content/spaces/${index.space}/environments/master/entries/{id}/published`].put && doc.paths[`/api/content/spaces/${index.space}/uploads`].post && doc.paths[`/api/content/spaces/${index.space}/webhook_definitions`].post, 'publish, uploads, webhook definitions')
  assert.ok(doc.components.schemas.ManagementEntry && doc.components.schemas.WebhookDefinition && doc.components.schemas.Upload)
  const names = doc.tags.map((t) => t.name); assert.deepEqual(names, ['Content Delivery', 'Content Management', 'Content Sync', 'Content GraphQL', 'Content Images', ...(forms ? ['Forms', 'Responses', 'Webhooks', 'Insights'] : []), ...(sessions ? ['Event Types', 'Slots', 'Bookings', 'Schedules', 'Scheduling Webhooks'] : []), ...(storeOn ? ['Storefront'] : []), ...(supportOn ? ['Client', 'Conversations', 'Contacts', 'Support Webhooks'] : []), 'Analytics Events', 'Analytics Capture'])
  const groups = doc['x-tagGroups']; assert.deepEqual(groups.map((g) => g.name), ['Content API', ...(forms ? ['Forms API'] : []), ...(sessions ? ['Scheduling API'] : []), ...(storeOn ? ['Store API'] : []), ...(supportOn ? ['Support API'] : []), 'Analytics API']);
  if (supportOn) { assert.deepEqual([tags('Client'), tags('Conversations'), tags('Contacts'), tags('Support Webhooks')], [11, 6, 6, 4], 'the Support API\'s operations'); assert.ok(doc.components.securitySchemes.supportKey && doc.components.schemas.SupportConversation) }
  if (storeOn) { assert.equal(tags('Storefront'), 3, 'the Store API\'s operations'); assert.ok(doc.paths['/api/store/api/{version}/graphql.json'].post && doc.components.securitySchemes.storefrontKey && doc.components.schemas.StorefrontRequest) }
  if (sessions) { assert.deepEqual([tags('Event Types'), tags('Slots'), tags('Bookings'), tags('Schedules'), tags('Scheduling Webhooks')], [2, 1, 6, 2, 5], 'the Scheduling API\'s operations'); assert.ok(doc.components.schemas.EventType && doc.components.schemas.Booking && doc.components.schemas.Schedule); assert.deepEqual(doc.components.schemas.EventType.properties.slug.enum, sessions.map((s) => s.slug)) } else assert.ok(!Object.keys(doc.paths).some((p) => p.startsWith('/api/scheduling/v2/')), 'no Scheduling API with sessions off')
  if (forms) { assert.deepEqual([tags('Forms'), tags('Responses'), tags('Webhooks'), tags('Insights')], [8, 3, 4, 1], 'the Forms API\'s operations (the reads and the writes)'); assert.ok(doc.paths['/api/forms/forms'].post && doc.paths['/api/forms/forms/{form_id}'].patch, 'the form writes'); assert.ok(doc.components.schemas.Form && doc.components.schemas.Response && doc.components.schemas.Webhook); assert.deepEqual(doc.paths['/api/forms/forms/{form_id}'].get.parameters[0].schema.enum, Object.entries(forms).filter(([, f]) => f.kit?.published !== false && f.settings?.page === 'form-slides').map(([k]) => k)) } else assert.ok(!Object.keys(doc.paths).some((p) => p.startsWith('/api/forms/')), 'no Forms API with forms off')
  assert.deepEqual(groups.flatMap((g) => g.tags).sort(), names.slice().sort(), 'every tag is in a group')
  for (const op of Object.values(doc.paths).flatMap((p) => Object.values(p))) assert.ok(op.tags.every((t) => names.includes(t)) && /^[A-Z]/.test(op.summary) && !/posthog|contentful|typeform|cal\.com/i.test(op.summary) && !/posthog|contentful|typeform|cal\.com/i.test(op.tags.join()), 'an operation names a declared tag and says what it does, no product name in a name: ' + op.operationId)
  assert.deepEqual(doc.servers.map((x) => x.url), ['https://x.test', 'http://stack.test/functions/v1/content'])
  assert.ok(doc.paths['/api/events/e/'].post.description.includes('other-site'), 'the sources are named')
})

/* ---- (3) the served doors ---- */
const url = supabaseUrl(), anon = process.env.VITE_SUPABASE_ANON_KEY || ''
let served = false
try { served = !!(url && anon && localStack()) && (await fetch(url + '/functions/v1/content/spaces/' + index.space, { signal: AbortSignal.timeout(4000) })).ok } catch { /* down */ }
if (!served) { note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''} (the index and the shapes — the local stack is not up or the content function is not served)`); process.exit(fail ? 1 : 0) }
execFileSync(process.execPath, [new URL('./content-json.mjs', import.meta.url).pathname], { stdio: 'ignore' })   /* the served function answers this checkout's content */
/* the functions server reloads on the index's write: wait for it to answer again before asking anything */
for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 500)); try { const r = await fetch(url + '/functions/v1/content/spaces/' + index.space, { signal: AbortSignal.timeout(4000) }); if (r.ok && (await r.json()).sys) { await new Promise((x) => setTimeout(x, 1000)); break } } catch { /* reloading */ } }
await new Promise((r) => setTimeout(r, 1500))
const { createClient } = await import('@supabase/supabase-js')
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const API = url + '/functions/v1/content'
const CF = (await import('contentful')).createClient
const host = url.replace(/^https?:\/\//, '')
const clientFor = (token) => CF({ space: index.space, accessToken: token, host, basePath: '/functions/v1/content', insecure: url.startsWith('http:'), retryOnError: false })
/* the keys, made as the admin's page makes them: the random key kept by the site that uses it, its sha256 in api_keys */
const sha256 = async (s) => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('') }
const made = []
const makeKey = async (kind, gated = false) => { const key = `pk_${kind}_probe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; const { data: admin } = await service.from('profiles').select('id').eq('email', 'admin@example.com').maybeSingle(); const { error } = await service.from('api_keys').insert({ name: 'content-api test', kind, gated, prefix: key.slice(0, 12), hash: await sha256(key), created_by: admin ? admin.id : null }); if (error) throw new Error(error.message); made.push(key); return key }
const get = async (p, headers = {}) => { const r = await fetch(API + p, { headers }); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) } }
try {
  const delivery = await makeKey('delivery'), previewKey = await makeKey('preview'), gatedKey = await makeKey('delivery', true)
  const client = clientFor(delivery)
  const typeWithMany = index.types.find((t) => byModel(t._model).filter((r) => r.published).length >= 3 && index.models.find((m) => m.key === t._model).fields.some((f) => f.name === 'title'))
  const T = typeWithMany.sys.id, TN = byModel(typeWithMany._model).filter((r) => r.published).length
  await ok('contentful.js, the host swapped: a page of entries with includes resolved by the client, a filter, a search, one entry, one asset, the types, the locales', async () => {
    const page = await client.getEntries({ content_type: T, include: 2, order: '-sys.createdAt', limit: 2, skip: 1 })
    assert.equal(page.total, TN); assert.equal(page.items.length, Math.min(2, TN - 1)); assert.equal(page.skip, 1)
    const withPic = (await client.getEntries({ content_type: T, include: 1, limit: 100 })).items.find((i) => Object.values(i.fields).some((v) => v && v.fields && v.fields.file))
    if (withPic) { const pic = Object.values(withPic.fields).find((v) => v && v.fields && v.fields.file); assert.ok(pic.fields.file.url.includes('/api/media/' + index.space + '/'), 'the client resolved the asset link'); const asset = await client.getAsset(pic.sys.id); assert.equal(asset.fields.file.fileName, pic.fields.file.fileName); assert.ok(asset.fields.file.details.size >= 0) }
    const one = await client.getEntry(page.items[0].sys.id); assert.equal(one.sys.id, page.items[0].sys.id); assert.equal(one.sys.contentType.sys.id, T)
    const searched = await client.getEntries({ query: page.items[0].fields.title.split(/\s+/)[0] }); assert.ok(searched.total >= 1)
    const types = await client.getContentTypes(); assert.deepEqual(types.items.map((t) => t.sys.id).sort(), index.types.map((t) => t.sys.id).sort())
    const t1 = await client.getContentType(T); assert.ok(t1.fields.length && t1.displayField)
    const loc = await client.getLocales(); assert.deepEqual(loc.items.map((l) => l.code), index.locales.map((l) => l.code))
    const space = await client.getSpace(); assert.equal(space.sys.id, index.space)
  })
  await ok('Contentful\'s shapes, field for field: a collection, an entry\'s sys, an asset\'s file, the error envelope', async () => {
    const r = (await get(`/spaces/${index.space}/environments/master/entries?content_type=${T}&limit=1&include=1`, { Authorization: 'Bearer ' + delivery })).body
    assert.deepEqual(Object.keys(r).filter((k) => k !== 'includes' && k !== 'errors').sort(), ['items', 'limit', 'skip', 'sys', 'total']); assert.deepEqual(r.sys, { type: 'Array' })
    const e = r.items[0]; assert.deepEqual(Object.keys(e.sys).sort(), ['contentType', 'createdAt', 'environment', 'id', 'locale', 'revision', 'space', 'type', 'updatedAt'])
    assert.deepEqual(e.sys.space, { sys: { type: 'Link', linkType: 'Space', id: index.space } }); assert.deepEqual(e.sys.environment, { sys: { id: 'master', type: 'Link', linkType: 'Environment' } })
    assert.ok(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(e.sys.createdAt))
    if (r.includes && r.includes.Asset) { const a = r.includes.Asset[0]; assert.deepEqual(Object.keys(a.fields).sort(), ['description', 'file', 'title']); assert.deepEqual(Object.keys(a.fields.file).sort(), ['contentType', 'details', 'fileName', 'url']); assert.ok('size' in a.fields.file.details) }
    const bad = await get(`/spaces/${index.space}/environments/master/entries?content_type=nope`, { Authorization: 'Bearer ' + delivery })
    assert.equal(bad.status, 400); assert.deepEqual(Object.keys(bad.body).sort(), ['details', 'message', 'requestId', 'sys']); assert.deepEqual(bad.body.sys, { type: 'Error', id: 'InvalidQuery' }); assert.equal(bad.body.details.errors[0].name, 'unknownContentType')
    const nf = await get(`/spaces/other-space/environments/master/entries`, { Authorization: 'Bearer ' + delivery }); assert.equal(nf.status, 404); assert.equal(nf.body.sys.id, 'NotFound'); assert.deepEqual(nf.body.details, { type: 'Space', id: 'other-space' })
    const env = await get(`/spaces/${index.space}/environments/staging/entries`, { Authorization: 'Bearer ' + delivery }); assert.equal(env.status, 404)
    const w = await fetch(API + `/spaces/${index.space}/environments/master/entries`, { method: 'POST', headers: { Authorization: 'Bearer ' + delivery, 'content-type': 'application/json' }, body: '{}' }); assert.equal(w.status, 403, 'a delivery key is refused a write (the Management API wants a management key)')
  })
  await ok('the operators against the served door agree with the recomputation', async () => {
    const rows = byModel(typeWithMany._model).filter((r) => r.published)
    const m = index.models.find((x) => x.key === typeWithMany._model)
    const tagged = m.fields.some((f) => f.name === 'tags') && rows.find((r) => Array.isArray(r.data.tags) && r.data.tags.length)
    if (tagged) { const tag = tagged.data.tags[0]; const r = await client.getEntries({ content_type: T, 'fields.tags[in]': tag, limit: 100 }); assert.deepEqual(r.items.map((i) => i.sys.id).sort(), rows.filter((x) => (x.data.tags || []).includes(tag)).map((x) => entryId(T, x.path)).sort()) }
    const r2 = await client.getEntries({ content_type: T, 'fields.title[match]': rows[0].data.title.slice(0, 4), limit: 100 }); assert.ok(r2.items.some((i) => i.sys.id === entryId(T, rows[0].path)))
    const r3 = await client.getEntries({ content_type: T, 'fields.title[exists]': false }); assert.equal(r3.total, 0)
    const r4 = await client.getEntries({ content_type: T, select: 'sys.id,fields.title', limit: 1 }); assert.deepEqual(Object.keys(r4.items[0].fields), ['title'])
    const linked = index.models.find((x) => x.fields.some((f) => f.kind === 'reference' || (f.widget === 'select' && f.options)))
    if (linked) { const f = linked.fields.find((x) => x.kind === 'reference' || (x.widget === 'select' && x.options)); const r = byModel(linked.key).find((x) => x.published && x.data[f.name]); const lt1 = index.types.find((x) => x._model === linked.key); const ltf = lt1.fields.find((x) => x.id === f.name); const targetT = ((ltf.validations.find((v) => v.linkContentType) || {}).linkContentType || [])[0]; if (r && targetT) { const lt = await client.getEntries({ links_to_entry: entryId(targetT, String(r.data[f.name])), limit: 100 }); assert.ok(lt.items.some((i) => i.sys.id === entryId(lt1.sys.id, r.path)), 'links_to_entry') } }
  })
  await ok('the paywall: a gated entry lists with its plain fields for a delivery key and the public, its body for a key allowed gated content', async () => {
    const gated = index.records.find((r) => r.published && Array.isArray(r.data.canAccess) && r.data.canAccess.length && !r.data.canAccess.includes('guest') && r.body)
    if (!gated) { note('no gated record on this site — the paywall is checked on the demo'); return }
    const p = `/spaces/${index.space}/environments/master/entries/${entryId(gated.typeId, gated.path)}`
    const pub = await get(p), del = await get(p, { Authorization: 'Bearer ' + delivery }), open = await get(p, { Authorization: 'Bearer ' + gatedKey })
    for (const r of [pub, del]) { assert.equal(r.status, 200); assert.ok(r.body.fields.title); assert.ok(!('body' in r.body.fields) && !('bodyMarkdown' in r.body.fields), 'no body for ' + (r === pub ? 'the public' : 'a delivery key')) }
    assert.ok(open.body.fields.body && open.body.fields.body.nodeType === 'document' && open.body.fields.bodyMarkdown.length > 50, 'the whole body for the gated key')
  })
  await ok('preview: an unpublished entry exists to a preview key and not to a delivery key or the public; a foreign token reads as the public on a public site; a revoked key is refused', async () => {
    const off = index.records.find((r) => !r.published)
    if (off) { const p = `/spaces/${index.space}/environments/master/entries/${entryId(off.typeId, off.path)}`; assert.equal((await get(p, { Authorization: 'Bearer ' + delivery })).status, 404); assert.equal((await get(p)).status, 404); const pv = await get(p, { Authorization: 'Bearer ' + previewKey }); assert.equal(pv.status, 200); assert.equal(pv.body.sys.id, entryId(off.typeId, off.path)) }
    else note('no unpublished record on this site — preview is checked on the demo')
    const foreign = await get(`/spaces/${index.space}/environments/master/entries?limit=1`, { Authorization: 'Bearer some-other-token' }); assert.equal(foreign.status, 200)
    const doomed = await makeKey('delivery'); assert.equal((await get(`/spaces/${index.space}/environments/master/entries?limit=1`, { Authorization: 'Bearer ' + doomed })).status, 200)
    await service.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('hash', await sha256(doomed))
    assert.equal((await get(`/spaces/${index.space}/environments/master/entries?limit=1`, { Authorization: 'Bearer ' + doomed })).status, 401, 'the revoked key is refused from that moment')
    const { data: row } = await service.from('api_keys').select('last_used_at').eq('hash', await sha256(delivery)).maybeSingle(); assert.ok(row && row.last_used_at, 'last use stamped')
  })
  await ok('ETag and 304; the rate limit\'s headers, and 429 past it', async () => {
    const p = `/spaces/${index.space}/environments/master/entries?content_type=${T}&limit=2`
    const first = await fetch(API + p, { headers: { Authorization: 'Bearer ' + delivery } }); const etag = first.headers.get('etag'); assert.ok(etag && first.headers.get('cache-control'))
    const again = await fetch(API + p, { headers: { Authorization: 'Bearer ' + delivery, 'If-None-Match': etag } }); assert.equal(again.status, 304)
    assert.equal(first.headers.get('x-contentful-ratelimit-second-limit'), '78'); assert.ok(first.headers.get('x-contentful-ratelimit-hour-remaining'))
    /*
     * THE LIMIT IS TESTED WHERE IT IS DECIDED, not by trying to out-run the clock.
     *
     * This used to fire 120 requests at once and demand a 429. That assumes the machine can
     * deliver 79 of them inside one second — and on a busy one (the suite, with another lane
     * just finished) the runtime spreads them over several seconds, so each second sees forty
     * and NOTHING should be refused. The test was asserting the speed of the hardware. It
     * passed alone, failed in the suite, and told us nothing either way.
     *
     * So the RULE is asked of the counter directly, which is deterministic and instant, and the
     * WIRING is asked of the door: that it carries the headers and that they count down. Between
     * them they cover what a 429 covered, without a race.
     */
    const who = 'test-' + Math.random().toString(36).slice(2)
    /* A FIXED INSTANT. Asking the counter in a loop was still asking the clock — eighty round
       trips take longer than the second they are meant to measure, the window slides, and
       nothing is refused, which is correct behaviour and tells us nothing. api_rate_take takes
       the instant (defaulting to now(), which is what everything real passes), so the RULE can
       be asked at one moment and the answer is the arithmetic rather than the hardware. */
    const at = new Date('2030-01-01T00:00:00.400Z').toISOString()
    let over = null
    for (let i = 1; i <= 80 && over === null; i++) {
      const { data } = await service.rpc('api_rate_take', { p_who: who, p_now: at })
      const row = Array.isArray(data) ? data[0] : data
      if (Number(row.sec) > 78) over = i
    }
    assert.equal(over, 79, 'the counter passes 78 in one second and refuses the 79th')

    /* and the SLIDE itself, which is the part a calendar bucket gets wrong: 60 taken in the
       second before, asked again 400ms into the next, must still see most of them — not zero */
    const slid = 'test-' + Math.random().toString(36).slice(2)
    const before = new Date('2030-01-01T00:00:00.500Z').toISOString()
    for (let i = 0; i < 60; i++) await service.rpc('api_rate_take', { p_who: slid, p_now: before })
    const { data: after } = await service.rpc('api_rate_take', { p_who: slid, p_now: new Date('2030-01-01T00:00:01.400Z').toISOString() })
    const n = Number((Array.isArray(after) ? after[0] : after).sec)
    assert.ok(n >= 36 && n <= 38, `a burst carries across the boundary: 60 at .5s, 1 at 1.4s → ${n} (60 × 0.6 + 1)`)

    /* and the door: the headers are there, and the allowance goes down as it is spent */
    const one = await fetch(API + `/spaces/${index.space}/environments/master/locales`, { headers: { Authorization: 'Bearer ' + delivery } })
    const two = await fetch(API + `/spaces/${index.space}/environments/master/locales`, { headers: { Authorization: 'Bearer ' + delivery } })
    const left = (r) => Number(r.headers.get('x-contentful-ratelimit-hour-remaining'))
    assert.ok(left(one) > 0 && left(two) > 0, 'the door reports what is left')
    assert.ok(left(two) < left(one), `spending the allowance lowers it: ${left(one)} then ${left(two)}`)
  })
  await ok('GraphQL at Contentful\'s path: introspection, a query with a filter and an order, preview refused under a delivery key, a query over the ceiling refused', async () => {
    const gql = async (query, token = delivery) => { const r = await fetch(API + `/content/v1/spaces/${index.space}/environments/master`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ query }) }); return { status: r.status, body: await r.json() } }
    const Tn = T[0].toUpperCase() + T.slice(1)
    const intro = await gql('{ __schema { queryType { name } types { name } } }'); assert.equal(intro.status, 200); const names = intro.body.data.__schema.types.map((t) => t.name); for (const n of [Tn, Tn + 'Collection', Tn + 'Filter', Tn + 'Order', 'Asset', 'Sys', 'Entry']) assert.ok(names.includes(n), n)
    const q = await gql(`{ ${T}Collection(limit: 2, order: sys_publishedAt_DESC) { total items { sys { id publishedAt } title } } }`); assert.equal(q.status, 200, JSON.stringify(q.body)); assert.equal(q.body.data[T + 'Collection'].total, TN); assert.equal(q.body.data[T + 'Collection'].items.length, Math.min(2, TN))
    const one = q.body.data[T + 'Collection'].items[0]; const single = await gql(`{ ${T}(id: "${one.sys.id}") { title sys { id } } }`); assert.equal(single.body.data[T].sys.id, one.sys.id)
    const where = await gql(`{ ${T}Collection(where: { title: "${one.title.replace(/"/g, '\\"')}" }) { total } }`); assert.equal(where.body.data[T + 'Collection'].total, byModel(typeWithMany._model).filter((r) => r.published && r.data.title === one.title).length)
    const pv = await gql(`{ ${T}Collection(preview: true) { total } }`); assert.equal(pv.status, 403); assert.equal(pv.body.errors[0].extensions.contentful.code, 'ACCESS_DENIED')
    const pv2 = await gql(`{ ${T}Collection(preview: true) { total } }`, previewKey); assert.equal(pv2.status, 200); assert.equal(pv2.body.data[T + 'Collection'].total, byModel(typeWithMany._model).length)
    const big = await gql(`{ ${T}Collection(limit: 1000) { items { linkedFrom { entryCollection(limit: 1000) { total } } } } }`); assert.equal(big.status, 400); assert.equal(big.body.errors[0].extensions.contentful.code, 'TOO_COMPLEX_QUERY')
    const bad = await gql('{ nothing }'); assert.equal(bad.status, 400); assert.equal(bad.body.errors[0].extensions.contentful.code, 'INVALID_QUERY')
    const viaGet = await fetch(API + `/content/v1/spaces/${index.space}/environments/master?query=` + encodeURIComponent(`{ ${T}Collection { total } }`), { headers: { Authorization: 'Bearer ' + delivery } }); assert.equal((await viaGet.json()).data[T + 'Collection'].total, TN)
    const pic = index.assets.find((a) => /^image\//.test(a.mime)); if (pic) { const a = await gql(`{ asset(id: "${assetId(pic.address)}") { url(transform: { width: 200, format: WEBP }) width height } }`); assert.ok(a.body.data.asset.url.includes('w=200') && a.body.data.asset.url.includes('fm=webp')); assert.equal(a.body.data.asset.width, pic.width) }
  })
  await ok('sync: initial pages every entry and asset with a nextSyncUrl; a token from before a deletion returns a DeletedEntry; a fresh token returns nothing', async () => {
    const s = await client.sync({ initial: true }); assert.equal(s.entries.length, index.records.filter((r) => r.published).length); assert.ok(s.nextSyncToken)
    /*
     * EVERY LIBRARY ASSET IS THERE, and anything beyond it is EXTERNAL. A url elsewhere that an
     * entry points at (a video's poster on somebody else's host) becomes a synthetic asset as that
     * entry is rendered — `assetFor` in api/entry.js — so the count is the library's plus however
     * many of those the entries in this sync happened to name. Asserting the bare count made this
     * a check on the order entries fall into pages: adding one record anywhere moved an external
     * url from after the asset pass to before it, and the number changed with nothing broken.
     */
    const ids = new Set(s.assets.map((a) => a.sys.id))
    assert.ok(index.assets.every((a) => ids.has(assetId(a.address))), 'every asset of the library is in the sync')
    const extra = s.assets.filter((a) => !index.assets.some((x) => assetId(x.address) === a.sys.id))
    /* sync answers a locale map per field where the delivery shapes do not: take either */
    const fileUrl = (a) => { const f = a.fields && a.fields.file; return String((f && (f.url ?? (f[Object.keys(f)[0]] || {}).url)) || '') }
    assert.ok(extra.every((x) => /^https?:\/\//i.test(fileUrl(x))), 'anything beyond the library is a url somewhere else: ' + extra.map((x) => fileUrl(x) || JSON.stringify(x.fields).slice(0, 120)).join(', '))
    const again = await client.sync({ nextSyncToken: s.nextSyncToken }); assert.equal(again.entries.length + again.assets.length + again.deletedEntries.length, 0)
    /* the functions serve the rows in cloud mode (npm run dev wrote CONTENT_STORE=cloud into .env.dev): the repository's deletions are the file index's alone */
    const cloud = fs.existsSync(path.join(ROOT, '.env.dev')) && /^CONTENT_STORE=cloud/m.test(fs.readFileSync(path.join(ROOT, '.env.dev'), 'utf8'))
    if (cloud) note('the functions run in cloud mode — the repository\'s deletions are not theirs; DeletedEntry is checked in git mode')
    else if (index.deleted.length) { const old = btoa(JSON.stringify({ t: new Date(new Date(index.deleted[0].at).getTime() - 1000).toISOString(), type: 'all', ct: null })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); const r = (await get(`/spaces/${index.space}/environments/master/sync?sync_token=${old}`, { Authorization: 'Bearer ' + delivery })).body; assert.ok(r.items.some((i) => i.sys.type === 'DeletedEntry' && i.sys.id === entryId(index.types.find((t) => t._model === index.deleted[0].model).sys.id, index.deleted[0].path)), 'the deletion synced') }
    else note('no deletion in this site\'s history — DeletedEntry is checked on the demo')
  })
  await ok('the served document is the index\'s: /openapi.json validates and names the same paths and schemas, the site as its server', async () => {
    const { validate } = await import('@scalar/openapi-parser')
    const r = await get('/openapi.json'); assert.equal(r.status, 200); assert.ok((r.headers.get('content-type') || '').includes('application/json'))
    const v = await validate(r.body); assert.ok(v.valid, 'validate: ' + JSON.stringify((v.errors || []).slice(0, 3)))
    const formsOn = c.modules.forms !== false && fs.existsSync(path.join(ROOT, 'supabase/functions/_shared/forms.json'))
    const sessOn = c.modules.sessions !== false && fs.existsSync(path.join(ROOT, 'supabase/functions/_shared/catalog.json'))
    const mine = openapiFor(index, { forms: formsOn ? JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/forms.json'), 'utf8')) : null, sessions: sessOn ? (JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/catalog.json'), 'utf8')).sessions || []) : null, store: c.modules.store !== false, support: c.modules.support !== false }); assert.deepEqual(Object.keys(r.body.paths).sort(), Object.keys(mine.paths).sort()); assert.deepEqual(Object.keys(r.body.components.schemas).sort(), Object.keys(mine.components.schemas).sort())
    assert.ok(r.body.servers.length >= 1 && r.body.servers.some((x) => x.url.endsWith('/functions/v1/content')), 'the function names its own address')
    const also = await get('/content/v1/openapi.json'); assert.equal(also.status, 200); assert.equal(also.body.info.title, r.body.info.title)
  })
  await ok('the Images API: a 400 × 300 WebP cut from the top, avif answered as webp, a padded jpg on a colour, a circle, out of range refused, the cache and the ETag', async () => {
    const pic = index.assets.find((a) => /^image\/(png|jpeg|webp)$/.test(a.mime) && a.width > 300)
    if (!pic) { note('no picture in the library — the Images API is checked on the demo'); return }
    const a = await client.getAsset(assetId(pic.address)); const u = url + '/functions/v1/images' + a.fields.file.url.replace(/^\/\/[^/]+\/api\/media/, '')
    const sharp = (await import('sharp')).default
    const dims = async (qs) => { const r = await fetch(u + qs); if (r.status !== 200) return { status: r.status }; const buf = Buffer.from(await r.arrayBuffer()); const m = await sharp(buf).metadata(); return { status: 200, format: m.format, width: m.width, height: m.height, type: r.headers.get('content-type'), etag: r.headers.get('etag'), cache: r.headers.get('cache-control') } }
    const fill = await dims('?w=400&h=300&fit=fill&f=top&fm=webp&q=70'); assert.deepEqual([fill.status, fill.format, fill.width, fill.height], [200, 'webp', 400, 300]); assert.ok(fill.cache.includes('immutable'))
    const avif = await dims('?w=200&fm=avif'); assert.equal(avif.format, 'webp'); assert.equal(avif.width, 200)
    const pad = await dims('?w=300&h=300&fit=pad&bg=rgb:ff0000&fm=jpg'); assert.deepEqual([pad.format, pad.width, pad.height], ['jpeg', 300, 300])
    const circle = await dims('?w=120&r=max&fm=png'); assert.equal(circle.format, 'png'); assert.equal(circle.width, 120)
    const scaled = await dims('?w=100&h=40&fit=scale'); assert.deepEqual([scaled.width, scaled.height], [100, 40])
    const bad = await fetch(u + '?w=0'); assert.equal(bad.status, 400); assert.equal((await bad.json()).sys.id, 'BadQuery')
    const bad2 = await fetch(u + '?fit=zoom'); assert.equal(bad2.status, 400)
    const t0 = Date.now(); const cached = await fetch(u + '?w=400&h=300&fit=fill&f=top&fm=webp&q=70'); assert.equal(cached.status, 200); assert.ok(Date.now() - t0 < 1500, 'served from the cache')
    const notMod = await fetch(u + '?w=400&h=300&fit=fill&f=top&fm=webp&q=70', { headers: { 'If-None-Match': cached.headers.get('etag') } }); assert.equal(notMod.status, 304)
  })
  /* ---- (4) the Management API: contentful-management pointed at the site ---- */
  const cloudMode = fs.existsSync(path.join(ROOT, '.env.dev')) && /^CONTENT_STORE=cloud/m.test(fs.readFileSync(path.join(ROOT, '.env.dev'), 'utf8'))
  const mgmt = await makeKey('management')
  const cm = await import('contentful-management'); const CM = cm.createClient || cm.default.createClient
  const cma = CM({ accessToken: mgmt, host, hostUpload: host, basePath: '/functions/v1/content', insecure: url.startsWith('http:'), retryOnError: false })
  const send = async (method, p, body, headers = {}) => { const r = await fetch(API + p, { method, headers: { Authorization: 'Bearer ' + mgmt, 'Content-Type': 'application/vnd.contentful.management.v1+json', ...headers }, body: body == null ? undefined : (typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)) }); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) } }
  const ENV = `/spaces/${index.space}/environments/master`
  await ok('a management key reads an entry in Contentful\'s management shape (version, publishedVersion, updatedBy); a delivery key and no key are refused a write', async () => {
    const any = index.records.find((r) => r.typeId && r.published)
    const r = await send('GET', `${ENV}/entries/${entryId(any.typeId, any.path)}`); assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.ok(r.body.sys.version >= 2 && r.body.sys.publishedVersion && r.body.sys.updatedBy && r.body.sys.createdBy, 'the management sys')
    assert.ok(Object.values(r.body.fields).every((v) => v && typeof v === 'object' && 'en-US' in v), 'fields by locale')
    const asDelivery = await fetch(API + `${ENV}/entries/${entryId(any.typeId, any.path)}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + delivery, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(asDelivery.status, 403)
    const noKey = await fetch(API + `${ENV}/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(noKey.status, 403)
    const types = await send('PUT', `${ENV}/content_types/x`, { name: 'x' }); assert.equal(types.status, 405, 'a content type is the builder\'s')
    const defs = await send('GET', `/spaces/${index.space}/webhook_definitions`); assert.equal(defs.status, 200); assert.equal(defs.body.sys.type, 'Array')
  })
  if (!cloudMode) await ok('in git mode every write is 405 with the reason; a read still answers', async () => {
    const any = index.records.find((r) => r.typeId && r.published)
    const r = await send('PUT', `${ENV}/entries/${entryId(any.typeId, any.path)}`, { fields: {} }); assert.equal(r.status, 405); assert.match(r.body.message, /git mode/)
    const p = await send('PUT', `${ENV}/entries/${entryId(any.typeId, any.path)}/published`); assert.equal(p.status, 405)
    const a = await send('POST', `${ENV}/assets`, { fields: {} }); assert.equal(a.status, 405)
    const u = await send('POST', `/spaces/${index.space}/uploads`, new Uint8Array([1, 2, 3]), { 'Content-Type': 'application/octet-stream' }); assert.equal(u.status, 405)
    note('git mode — the life of an entry and an asset through the Management API is checked on the demo in cloud mode')
  })
  else {
    const typeMany = index.types.find((t) => t.sys.id === T)
    const TYPE = index.types.find((t) => t.sys.id === 'teacher') || typeMany
    const model = index.models.find((m) => m.key === TYPE._model)
    const titleField = TYPE.displayField || 'title'
    const probe = 'probe-' + Date.now().toString(36)
    const ID = `${TYPE.sys.id}.${probe}`
    let entry = null, asset = null, cleanup = []
    const env = await (await cma.getSpace(index.space)).getEnvironment('master')
    const site = await (async () => { try { const raw = fs.readFileSync(path.join(ROOT, '.env.dev'), 'utf8'); const m = /^APP_URL=(.+)$/m.exec(raw); return m ? m[1].trim() : null } catch { return null } })()
    try {
      await ok('the life of an entry: created unpublished (preview sees it, delivery does not), updated with its version, a stale version refused (409), published and read by delivery and on the site\'s page, unpublished, deleted', async () => {
        const fields = { [titleField]: { 'en-US': 'Probe ' + probe }, ...(TYPE.fields.some((f) => f.id === 'line') ? { line: { 'en-US': 'Made through the Management API.' } } : {}), ...(model.body ? { bodyMarkdown: { 'en-US': 'A **line** of body.\n\nAnd a second paragraph.' } } : {}) }
        entry = await env.createEntryWithId(TYPE.sys.id, ID, { fields })
        cleanup.push(async () => { try { await send('DELETE', `${ENV}/entries/${ID}`) } catch { /* gone */ } })
        assert.equal(entry.sys.id, ID); assert.equal(entry.sys.version % 2, 1, 'a fresh draft: the version odd (drafted)'); assert.ok(!entry.sys.publishedVersion, 'not published')
        assert.equal((await get(`${ENV}/entries/${ID}`, { Authorization: 'Bearer ' + delivery })).status, 404, 'delivery does not see a draft')
        const pv = await get(`${ENV}/entries/${ID}`, { Authorization: 'Bearer ' + previewKey }); assert.equal(pv.status, 200); assert.equal(pv.body.fields[titleField], 'Probe ' + probe)
        if (model.body) assert.equal(pv.body.fields.bodyMarkdown.trim(), 'A **line** of body.\n\nAnd a second paragraph.')
        /* a stale version */
        const stale = await send('PUT', `${ENV}/entries/${ID}`, { fields: { ...fields, [titleField]: { 'en-US': 'Stale' } } }, { 'X-Contentful-Version': String(entry.sys.version + 10) }); assert.equal(stale.status, 409); assert.equal(stale.body.sys.id, 'VersionMismatch')
        /* the update, with the version */
        entry.fields[titleField] = { 'en-US': 'Probe ' + probe + ' (edited)' }
        entry = await entry.update(); assert.equal(entry.fields[titleField]['en-US'], 'Probe ' + probe + ' (edited)'); assert.ok(entry.sys.version % 2 === 1, 'still a draft')
        /* publish */
        entry = await entry.publish(); assert.ok(entry.sys.publishedVersion && entry.sys.publishedAt, 'published'); assert.equal(entry.sys.version % 2, 0, 'no draft after a publish')
        const live = await get(`${ENV}/entries/${ID}`, { Authorization: 'Bearer ' + delivery }); assert.equal(live.status, 200); assert.equal(live.body.fields[titleField], 'Probe ' + probe + ' (edited)')
        const found = await clientFor(delivery).getEntries({ content_type: TYPE.sys.id, [`fields.${titleField}`]: 'Probe ' + probe + ' (edited)' }); assert.equal(found.total, 1, 'the query finds it')
        /* the site's page, live from the rows */
        if (site && model.model) {
          let browser = null
          try { const { chromium } = await import('playwright'); const shell = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'); browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync(shell) ? shell : undefined) }) } catch { note('no browser — the site\'s page of the entry is not looked at') }
          if (browser) { try { const pg = await browser.newPage(); await pg.goto(`${site}/c/${model.model.key}/${probe}`, { waitUntil: 'networkidle', timeout: 30000 }); await pg.waitForFunction((t) => document.body.innerText.includes(t), 'Probe ' + probe + ' (edited)', { timeout: 15000 }); note('the entry\'s page on the site shows it') } finally { await browser.close() } }
        }
        /* unpublish: delivery loses it, preview keeps it */
        entry = await entry.unpublish(); assert.ok(!entry.sys.publishedVersion, 'unpublished')
        assert.equal((await get(`${ENV}/entries/${ID}`, { Authorization: 'Bearer ' + delivery })).status, 404)
        assert.equal((await get(`${ENV}/entries/${ID}`, { Authorization: 'Bearer ' + previewKey })).status, 200)
        /* delete */
        await entry.delete(); entry = null
        assert.equal((await send('GET', `${ENV}/entries/${ID}`)).status, 404)
        assert.equal((await get(`${ENV}/entries/${ID}`, { Authorization: 'Bearer ' + previewKey })).status, 404)
      })
      await ok('an entry read and put back as it came — a library picture\'s link, the Rich Text body — is a draft with the same fields, who made it the key\'s maker; the draft dropped leaves the live version', async () => {
        const rec = index.records.find((r) => r.typeId === TYPE.sys.id && r.published && Object.values(r.data || {}).some((v) => typeof v === 'string' && v.startsWith('/uploads/'))) || index.records.find((r) => r.typeId === TYPE.sys.id && r.published)
        const id = entryId(rec.typeId, rec.path)
        const e = await env.getEntry(id); const fields = JSON.parse(JSON.stringify(e.fields))
        e.fields[titleField] = { 'en-US': fields[titleField]['en-US'] + ' (API)' }
        const back = await e.update(); assert.equal(back.fields[titleField]['en-US'], fields[titleField]['en-US'] + ' (API)'); assert.equal(back.sys.version % 2, 1, 'a draft')
        for (const k of Object.keys(fields)) if (k !== titleField && k !== 'body') {
          if (Array.isArray(fields[k]?.['en-US']) && fields[k]['en-US'].length === 0) {
            assert.equal(back.fields[k], undefined, k + ' empty array omitted by the record writer')
          } else assert.deepEqual(back.fields[k], fields[k], k + ' as it came')
        }
        assert.equal(String(back.sys.updatedBy.sys.id), 'Admin Person', 'the key\'s maker')
        const { data: d } = await service.from('content_drafts').select('by').eq('path', rec.model.replace(/^models\//, 'content/models/').replace(/^(?!content\/)/, 'content/') + '/' + rec.path + '.md').maybeSingle()
        if (d) assert.equal(d.by, 'Admin Person')
        await service.from('content_drafts').delete().like('path', '%/' + rec.path + '.md')
        const live = await get(`${ENV}/entries/${id}`, { Authorization: 'Bearer ' + delivery }); assert.equal(live.body.fields[titleField], fields[titleField]['en-US'], 'the live version untouched')
      })
      await ok('a field the type does not have is 422 with the field named; a create at an id that exists is 409', async () => {
        const r = await send('PUT', `${ENV}/entries/${TYPE.sys.id}.probe-bad-${probe}`, { fields: { [titleField]: { 'en-US': 'x' }, nosuchfield: { 'en-US': 1 } } }); assert.equal(r.status, 422); assert.equal(r.body.sys.id, 'ValidationFailed'); assert.deepEqual(r.body.details.errors[0].path, ['fields', 'nosuchfield'])
        const any = index.records.find((r) => r.typeId === TYPE.sys.id && r.published)
        if (any) { const dup = await send('POST', `${ENV}/entries`, { fields: { [titleField]: { 'en-US': any.data[titleField] || any.data.title || any.path } } }, { 'X-Contentful-Content-Type': TYPE.sys.id }); assert.equal(dup.status, 409, JSON.stringify(dup.body)) }
      })
      await ok('the life of an asset: an upload, an asset made from it, processed into the library, published, linked from an entry (its delete refused while in use), deleted', async () => {
        const sharp = (await import('sharp')).default
        const png = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#4a6' } }).png().toBuffer()
        const upload = await env.createUpload({ file: png }); assert.equal(upload.sys.type, 'Upload'); assert.ok(upload.sys.id)
        const AID = 'probe-' + probe
        asset = await env.createAssetWithId(AID, { fields: { title: { 'en-US': 'Probe picture' }, file: { 'en-US': { contentType: 'image/png', fileName: 'probe.png', uploadFrom: { sys: { type: 'Link', linkType: 'Upload', id: upload.sys.id } } } } } })
        cleanup.push(async () => { try { await send('DELETE', `${ENV}/assets/${AID}`) } catch { /* gone */ } })
        assert.equal(asset.sys.id, AID); assert.ok(!asset.fields.file['en-US'].url, 'not processed yet')
        asset = await asset.processForAllLocales({ processingCheckWait: 500, processingCheckRetries: 20 })
        const f = asset.fields.file['en-US']; assert.ok(f.url && /probe\.png$/.test(f.url), 'processed: a url in the library'); assert.equal(f.details.image.width, 24)
        asset = await asset.publish(); assert.ok(asset.sys.publishedVersion, 'published')
        const viaDelivery = await clientFor(delivery).getAsset(AID); assert.equal(viaDelivery.fields.file.fileName, 'probe.png'); assert.equal(viaDelivery.fields.file.details.image.width, 24); assert.ok(viaDelivery.fields.file.url.includes('/api/media/' + index.space + '/'), 'the url uses the site media door')
        const gone = await send('GET', `/spaces/${index.space}/uploads/${upload.sys.id}`); assert.equal(gone.status, 404, 'the upload is consumed')
        /* an entry linking it */
        const picField = TYPE.fields.find((x) => x.type === 'Link' && x.linkType === 'Asset')
        if (picField) {
          const EID = `${TYPE.sys.id}.probe-link-${probe}`
          const e = await env.createEntryWithId(TYPE.sys.id, EID, { fields: { [titleField]: { 'en-US': 'Probe link ' + probe }, [picField.id]: { 'en-US': { sys: { type: 'Link', linkType: 'Asset', id: AID } } } } })
          cleanup.push(async () => { try { await send('DELETE', `${ENV}/entries/${EID}`) } catch { /* gone */ } })
          assert.equal(e.fields[picField.id]['en-US'].sys.id, AID, 'the link reads back')
          const used = await send('DELETE', `${ENV}/assets/${AID}`); assert.equal(used.status, 409, 'in use: ' + JSON.stringify(used.body))
          const missing = await send('PUT', `${ENV}/entries/${TYPE.sys.id}.probe-nolink-${probe}`, { fields: { [titleField]: { 'en-US': 'x' }, [picField.id]: { 'en-US': { sys: { type: 'Link', linkType: 'Asset', id: 'no-such-asset' } } } } }); assert.equal(missing.status, 422); assert.equal(missing.body.details.errors[0].name, 'notResolvable')
          await e.delete()
        }
        await asset.delete(); asset = null
        assert.equal((await send('GET', `${ENV}/assets/${AID}`)).status, 404)
      })
      await ok('the sweep: an upload never processed, and an asset made from it, are gone after the sweep (run by hand, the service key); a lesser bearer is refused', async () => {
        const upload = await env.createUpload({ file: Buffer.from('never processed') })
        const AID = 'probe-sweep-' + probe
        await env.createAssetWithId(AID, { fields: { title: { 'en-US': 'Never processed' }, file: { 'en-US': { contentType: 'text/plain', fileName: 'never.txt', uploadFrom: { sys: { type: 'Link', linkType: 'Upload', id: upload.sys.id } } } } } })
        assert.equal((await send('GET', `/spaces/${index.space}/uploads/${upload.sys.id}`)).status, 200)
        const refused = await fetch(API + '/sweep-uploads?older_than_ms=1', { method: 'POST', headers: { Authorization: 'Bearer ' + mgmt } }); assert.equal(refused.status, 403)
        const swept = await fetch(API + '/sweep-uploads?older_than_ms=1', { method: 'POST', headers: { Authorization: 'Bearer ' + serviceKey() } }); assert.equal(swept.status, 200)
        const r = await swept.json(); assert.ok(r.uploads >= 1 && r.assets >= 1, 'swept: ' + JSON.stringify(r))
        assert.equal((await send('GET', `/spaces/${index.space}/uploads/${upload.sys.id}`)).status, 404, 'the upload is gone')
        assert.equal((await send('GET', `${ENV}/assets/${AID}`)).status, 404, 'the unprocessed asset is gone')
        assert.equal((await send('GET', `${ENV}/assets`)).status, 200, 'the library stands')
      })
      await ok('a webhook definition is made, listed, updated and removed; a publish delivers to it with Contentful\'s headers', async () => {
        const http = await import('node:http')
        const hits = []
        const server = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => { b += c }); rq.on('end', () => { hits.push({ headers: rq.headers, body: b ? JSON.parse(b) : null }); rs.writeHead(200); rs.end('ok') }) })
        await new Promise((r) => server.listen(0, '0.0.0.0', r))
        const receiver = `http://host.docker.internal:${server.address().port}/hook`
        try {
          const def = await send('POST', `/spaces/${index.space}/webhook_definitions`, { name: 'probe hook', url: receiver, topics: ['Entry.publish', 'Entry.unpublish'], headers: [{ key: 'X-Probe', value: 'yes' }] }); assert.equal(def.status, 201, JSON.stringify(def.body)); assert.equal(def.body.sys.type, 'WebhookDefinition')
          const listed = await send('GET', `/spaces/${index.space}/webhook_definitions`); assert.ok(listed.body.items.some((x) => x.sys.id === def.body.sys.id))
          const upd = await send('PUT', `/spaces/${index.space}/webhook_definitions/${def.body.sys.id}`, { name: 'probe hook 2', url: receiver, topics: ['Entry.publish'], headers: [{ key: 'X-Probe', value: 'yes' }] }); assert.equal(upd.status, 200); assert.equal(upd.body.name, 'probe hook 2')
          const EID = `${TYPE.sys.id}.probe-hook-${probe}`
          const e = await env.createEntryWithId(TYPE.sys.id, EID, { fields: { [titleField]: { 'en-US': 'Probe hook ' + probe } } })
          cleanup.push(async () => { try { await send('DELETE', `${ENV}/entries/${EID}`) } catch { /* gone */ } })
          await e.publish()
          for (let i = 0; i < 30 && !hits.length; i++) await new Promise((r) => setTimeout(r, 300))
          assert.ok(hits.length >= 1, 'the publish was delivered')
          const h = hits.find((x) => x.headers['x-contentful-topic'] === 'ContentManagement.Entry.publish') || hits[0]
          assert.equal(h.headers['x-contentful-topic'], 'ContentManagement.Entry.publish'); assert.equal(h.headers['x-contentful-webhook-name'], 'probe hook 2'); assert.equal(h.headers['x-probe'], 'yes')
          assert.equal(h.body.sys.id, EID); assert.equal(h.body.sys.type, 'Entry')
          const row = await send('GET', `/spaces/${index.space}/webhook_definitions/${def.body.sys.id}`); assert.ok(row.body.sys.lastAt || row.status === 200)
          await (await env.getEntry(EID)).delete()
          /* a person's publish and unpublish in the admin (the admin function's own row store) reach the same subscriber */
          const rec = index.records.find((r) => r.typeId && r.published && !r.model.startsWith('models/') && index.models.find((m) => m.key === r.model && !m.single))
          if (site && rec) {
            let browser = null
            try { const { chromium } = await import('playwright'); const shell = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'); browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync(shell) ? shell : undefined) }) } catch { note('no browser — the admin\'s publish is not driven') }
            if (browser) {
              try {
                const up2 = await send('PUT', `/spaces/${index.space}/webhook_definitions/${def.body.sys.id}`, { name: 'probe hook 2', url: receiver, topics: ['Entry.publish', 'Entry.unpublish'], headers: [{ key: 'X-Probe', value: 'yes' }] }); assert.equal(up2.status, 200)
                hits.length = 0
                const pg = await browser.newPage(); pg.on('dialog', (d) => d.accept())
                await pg.goto(`${site}/admin/${rec.model}/${rec.path}`, { waitUntil: 'networkidle', timeout: 30000 })
                await pg.click('.ad-gate .ad-save'); await pg.fill('.au-card input[type=email]', 'admin@example.com'); await pg.fill('.au-card input[type=password]', 'password123'); await pg.click('.au-card .au-submit')
                await pg.waitForSelector('.ad-gate', { state: 'detached', timeout: 20000 }); await pg.reload({ waitUntil: 'networkidle' })   /* the admin loads its view as it mounts */
                await pg.waitForSelector('.ad-drawer .ad-publish', { timeout: 30000 })
                await pg.click('.ad-drawer .ad-publish')
                for (let i = 0; i < 40 && !hits.some((h) => h.headers['x-contentful-topic'] === 'ContentManagement.Entry.publish'); i++) await new Promise((r) => setTimeout(r, 300))
                const pub = hits.find((h) => h.headers['x-contentful-topic'] === 'ContentManagement.Entry.publish'); assert.ok(pub, 'the admin\'s publish was delivered'); assert.equal(pub.body.sys.id, entryId(rec.typeId, rec.path)); assert.equal(pub.headers['x-probe'], 'yes')
                /* off, and published again: unpublish then publish, each delivered under its topic */
                const reopen = async () => { await pg.goto(`${site}/admin/${rec.model}/${rec.path}`, { waitUntil: 'networkidle', timeout: 30000 }); await pg.waitForSelector('.ad-drawer .ad-publish', { timeout: 30000 }) }   /* a publish closes the drawer */
                const toggle = () => pg.locator('.ad-drawer .ad-f', { hasText: 'Published' }).locator('.p-toggleswitch').first()
                await reopen(); await toggle().click(); await pg.click('.ad-drawer .ad-publish')
                for (let i = 0; i < 40 && !hits.some((h) => h.headers['x-contentful-topic'] === 'ContentManagement.Entry.unpublish'); i++) await new Promise((r) => setTimeout(r, 300))
                assert.ok(hits.some((h) => h.headers['x-contentful-topic'] === 'ContentManagement.Entry.unpublish'), 'the admin\'s unpublish was delivered')
                hits.length = 0
                await reopen(); await toggle().click(); await pg.click('.ad-drawer .ad-publish')
                for (let i = 0; i < 40 && !hits.some((h) => h.headers['x-contentful-topic'] === 'ContentManagement.Entry.publish'); i++) await new Promise((r) => setTimeout(r, 300))
                assert.ok(hits.some((h) => h.headers['x-contentful-topic'] === 'ContentManagement.Entry.publish'), 'published again')
                assert.equal((await get(`${ENV}/entries/${entryId(rec.typeId, rec.path)}`, { Authorization: 'Bearer ' + delivery })).status, 200, 'the record is live again')
              } finally { await browser.close() }
            }
          }
          const del = await send('DELETE', `/spaces/${index.space}/webhook_definitions/${def.body.sys.id}`); assert.equal(del.status, 204)
          assert.equal((await send('GET', `/spaces/${index.space}/webhook_definitions/${def.body.sys.id}`)).status, 404)
        } finally { server.close(); const left = await send('GET', `/spaces/${index.space}/webhook_definitions`); for (const d of ((left.body || {}).items || []).filter((x) => /^probe hook/.test(x.name))) await send('DELETE', `/spaces/${index.space}/webhook_definitions/${d.sys.id}`) }
      })
    } finally { for (const f of cleanup.reverse()) await f() }
  }
} finally {
  const hashes = []; for (const k of made) hashes.push(await sha256(k))
  if (hashes.length) await service.from('api_keys').delete().in('hash', hashes)
}
note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''}`)
process.exit(fail ? 1 : 0)
