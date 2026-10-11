/* The Management API's shapes (content-management-api), under Node: a record to Contentful's Management entry (fields
   by locale, the version rule, the published version and time, the User links) and a Management entry back to the
   record the pipe writes (every field type, a Link to an asset as its address, a Link to an entry as its path, a Rich
   Text document as markdown with its Markdown twin winning, an unknown field refused); Rich Text → markdown as the
   reverse of the reader's converter — markdown → document → markdown equal on the every-node fixture; the id rule of
   a POST; an API-made asset's id from its address; a webhook definition's shape and its topics. */
import assert from 'node:assert/strict'
import { managementEntryOf, recordOf, idFor, splitId, versionOf, managementAssetOf, apiAssetAddress, webhookDefinitionOf, webhookDefinitionInput, topicMatches, validationFailed, unwrap, slugify } from '../supabase/functions/_shared/api/management.js'
import { markdownFromRichText } from '../supabase/functions/_shared/api/richtext-to-markdown.js'
import { richTextFromMarkdown } from '../supabase/functions/_shared/api/richtext.js'
import { assetId, entryId } from '../supabase/functions/_shared/api/ids.js'

let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }
const note = (m) => console.log('management: ' + m)

const TYPE = { sys: { id: 'article' }, fields: [
  { id: 'title', type: 'Symbol' }, { id: 'date', type: 'Date' }, { id: 'published', type: 'Boolean' }, { id: 'rating', type: 'Number' }, { id: 'count', type: 'Integer' },
  { id: 'tags', type: 'Array', items: { type: 'Symbol' } }, { id: 'cover', type: 'Link', linkType: 'Asset' }, { id: 'book', type: 'Link', linkType: 'Entry', validations: [{ linkContentType: ['book'] }] },
  { id: 'related', type: 'Array', items: { type: 'Link', linkType: 'Entry', validations: [{ linkContentType: ['article'] }] } },
  { id: 'summary', type: 'RichText' }, { id: 'summaryMarkdown', type: 'Text' }, { id: 'meta', type: 'Object' },
] }
const MODEL = { key: 'articles', body: true }
const ctx = { space: 'demo', locale: 'en-US', assetAddress: (id) => (id === 'pic1' ? '/uploads/pic.png' : id === 'apiA' ? '/uploads/api/apiA/photo.png' : null) }

await ok('a Management entry: fields by locale, the version rule, the published version and times, the User links', () => {
  const delivery = { sys: { id: 'article.hello', contentType: { sys: { type: 'Link', linkType: 'ContentType', id: 'article' } } }, fields: { title: 'Hello', tags: ['a', 'b'], cover: { sys: { type: 'Link', linkType: 'Asset', id: 'pic1' } } } }
  const r = { revision: 3, created: '2026-09-01T00:00:00Z', updated: '2026-09-10T00:00:00Z', publishedAt: '2026-09-10T00:00:00Z', published: true, draft: false, createdBy: 'u1', updatedBy: 'u2' }
  const e = managementEntryOf(delivery, r, ctx)
  assert.deepEqual(e.fields.title, { 'en-US': 'Hello' }); assert.deepEqual(e.fields.tags, { 'en-US': ['a', 'b'] }); assert.deepEqual(e.fields.cover, { 'en-US': { sys: { type: 'Link', linkType: 'Asset', id: 'pic1' } } })
  assert.equal(e.sys.type, 'Entry'); assert.equal(e.sys.id, 'article.hello'); assert.equal(e.sys.version, 6); assert.equal(e.sys.publishedVersion, 6); assert.equal(e.sys.publishedAt, '2026-09-10T00:00:00.000Z'); assert.equal(e.sys.firstPublishedAt, '2026-09-01T00:00:00.000Z')
  assert.deepEqual(e.sys.createdBy, { sys: { type: 'Link', linkType: 'User', id: 'u1' } }); assert.deepEqual(e.sys.updatedBy, { sys: { type: 'Link', linkType: 'User', id: 'u2' } }); assert.deepEqual(e.sys.contentType, delivery.sys.contentType); assert.deepEqual(e.metadata, { tags: [] })
  assert.equal(versionOf({ revision: 3, draft: true }), 7, 'a draft over the live version is odd'); assert.equal(versionOf({ revision: 1 }), 2)
  const d = managementEntryOf(delivery, { ...r, draft: true }, ctx); assert.equal(d.sys.version, 7); assert.equal(d.sys.publishedVersion, 6)
  const never = managementEntryOf(delivery, { revision: 1, created: '2026-09-01T00:00:00Z', updated: '2026-09-01T00:00:00Z', draft: true }, ctx); assert.equal(never.sys.publishedVersion, undefined); assert.equal(never.sys.publishedAt, undefined)
  for (const k of ['space', 'id', 'type', 'createdAt', 'updatedAt', 'environment', 'version', 'createdBy', 'updatedBy', 'contentType']) assert.ok(k in e.sys, 'sys.' + k)
})
await ok('a Management entry back to the record: every type, links to their address and path, Rich Text to markdown, the twin winning, an unknown field refused', () => {
  const doc = richTextFromMarkdown('# Head\n\nA **bold** line.\n', {})
  const entry = { fields: { title: { 'en-US': 'Hello' }, date: { 'en-US': '2026-09-01T00:00:00Z' }, rating: { 'en-US': '4.5' }, count: { 'en-US': 3 }, tags: { 'en-US': ['a'] }, cover: { 'en-US': { sys: { type: 'Link', linkType: 'Asset', id: 'pic1' } } }, book: { 'en-US': { sys: { type: 'Link', linkType: 'Entry', id: 'book.the-quiet-room' } } }, related: { 'en-US': [{ sys: { type: 'Link', linkType: 'Entry', id: 'article.guides.one' } }] }, summary: { 'en-US': doc }, meta: { 'en-US': { a: 1 } }, body: { 'en-US': doc }, bodyMarkdown: { 'en-US': 'The twin wins.\n' } } }
  const { data, body } = recordOf(entry, TYPE, MODEL, ctx)
  assert.deepEqual(data, { title: 'Hello', date: '2026-09-01T00:00:00Z', rating: 4.5, count: 3, tags: ['a'], cover: '/uploads/pic.png', book: 'the-quiet-room', related: ['guides/one'], summary: '# Head\n\nA **bold** line.\n', meta: { a: 1 } })
  assert.equal(body, 'The twin wins.\n')
  const noTwin = recordOf({ fields: { body: { 'en-US': doc } } }, TYPE, MODEL, ctx); assert.equal(noTwin.body, '# Head\n\nA **bold** line.\n')
  const twinOnly = recordOf({ fields: { summaryMarkdown: { 'en-US': 'Plain.' } } }, TYPE, MODEL, ctx); assert.equal(twinOnly.data.summary, 'Plain.')
  assert.throws(() => recordOf({ fields: { nope: { 'en-US': 1 } } }, TYPE, MODEL, ctx), (e) => e.code === 'UnknownField' && e.fields[0] === 'nope')
  assert.throws(() => recordOf({ fields: { cover: { 'en-US': { sys: { type: 'Link', linkType: 'Asset', id: 'ghost' } } } } }, TYPE, MODEL, ctx), (e) => e.code === 'UnresolvedLink')
  assert.throws(() => recordOf({ fields: { rating: { 'en-US': 'x' } } }, TYPE, MODEL, ctx), (e) => e.code === 'ValidationFailed')
  assert.equal(unwrap({ 'de-DE': 'x' }, 'en-US'), 'x', 'another locale is taken when the asked one is missing'); assert.equal(unwrap('flat', 'en-US'), 'flat')
  const flat = recordOf({ fields: { title: 'Flat' } }, TYPE, MODEL, ctx); assert.equal(flat.data.title, 'Flat', 'a client that sends flat fields is taken too')
})
await ok('Rich Text → markdown is the reverse of the reader\'s converter: markdown → document → markdown equal on every node', () => {
  const md = '# Head\n\nA **bold** and *soft* and `code` and __under__ [link](https://x.y) line.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n![](/uploads/pic.png)\n\nLast.\n'
  const assets = new Map([['/uploads/pic.png', { address: '/uploads/pic.png' }]])
  const doc = richTextFromMarkdown(md, { assetsByAddress: assets })
  const back = markdownFromRichText(doc, { assetAddress: (id) => (id === assetId('/uploads/pic.png') ? '/uploads/pic.png' : null) })
  assert.equal(back, md.replace('__under__', '**under**'), 'CommonMark reads __x__ as bold, so it comes back as bold')
  const again = richTextFromMarkdown(back, { assetsByAddress: assets })
  assert.deepEqual(again, doc, 'the document made again from the markdown is the same document')
  assert.equal(markdownFromRichText({ nodeType: 'document', content: [{ nodeType: 'embedded-entry-block', data: {}, content: [] }, { nodeType: 'paragraph', content: [{ nodeType: 'text', value: 'x', marks: [], data: {} }], data: {} }] }), 'x\n', 'a node the reader never writes is dropped')
  assert.equal(markdownFromRichText(null), '')
})
await ok('the ids: a POST\'s from the slug, else the title, else none; an id split; an API-made asset\'s from its address', () => {
  assert.equal(idFor(TYPE, { slug: 'Read It Aloud', title: 'x' }), 'article.read-it-aloud'); assert.equal(idFor(TYPE, { title: 'Ünïcode Title!' }), 'article.unicode-title'); assert.equal(idFor(TYPE, { count: 1 }), null)
  assert.deepEqual(splitId('doc.guides.highlights'), { typeId: 'doc', path: 'guides/highlights' }); assert.equal(splitId('nodot'), null)
  assert.equal(assetId(apiAssetAddress('apiA', 'photo.png')), 'apiA'); assert.equal(assetId('/uploads/api/apiA/photo.png'), 'apiA'); assert.equal(assetId('/uploads/pic.png').length, 16)
  assert.equal(slugify('  Hello, World  '), 'hello-world'); assert.equal(entryId('article', 'guides/one'), 'article.guides.one')
})
await ok('an asset and an upload in the Management shape; a webhook definition and its topics; ValidationFailed from the pipe\'s issues', () => {
  const a = managementAssetOf('demo', 'apiA', { name: 'photo.png', title: 'A photo', address: '/uploads/api/apiA/photo.png', url: '//x/images/demo/apiA/h/photo.png', size: 10, mime: 'image/png', width: 4, height: 3, revision: 1, created: '2026-09-01T00:00:00Z', updated: '2026-09-01T00:00:00Z', publishedAt: '2026-09-01T00:00:00Z', published: true }, ctx)
  assert.equal(a.sys.type, 'Asset'); assert.deepEqual(a.fields.title, { 'en-US': 'A photo' }); assert.equal(a.fields.file['en-US'].fileName, 'photo.png'); assert.deepEqual(a.fields.file['en-US'].details, { size: 10, image: { width: 4, height: 3 } }); assert.equal(a.sys.publishedVersion, 2)
  const pending = managementAssetOf('demo', 'apiB', { name: 'p.png', title: 'P', revision: 1, created: '2026-09-01T00:00:00Z', updated: '2026-09-01T00:00:00Z', draft: true, pendingFile: { fileName: 'p.png', contentType: 'image/png', uploadFrom: { sys: { type: 'Link', linkType: 'Upload', id: 'up1' } } } }, ctx)
  assert.equal(pending.fields.file['en-US'].uploadFrom.sys.id, 'up1'); assert.equal(pending.sys.version, 3)
  const row = { id: 'w1', name: 'CRM', url: 'https://x.y/hook', topics: ['Entry.publish', 'Asset.*'], headers: { 'X-Secret': 's', 'X-Env': 'prod' }, active: true, created_by: 'u1', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', last_at: null, last_error: null }
  const w = webhookDefinitionOf('demo', row)
  assert.equal(w.sys.type, 'WebhookDefinition'); assert.equal(w.name, 'CRM'); assert.deepEqual(w.topics, ['Entry.publish', 'Asset.*']); assert.deepEqual(w.headers, [{ key: 'X-Secret', secret: true }, { key: 'X-Env', value: 'prod' }]); assert.equal(w.active, true)
  assert.ok(topicMatches(['Entry.publish'], 'Entry.publish') && topicMatches(['Asset.*'], 'Asset.delete') && topicMatches(['*.*'], 'Entry.save') && topicMatches(['*.publish'], 'Asset.publish') && !topicMatches(['Entry.publish'], 'Entry.save'))
  assert.ok(webhookDefinitionInput({ name: 'x', url: 'https://x.y', topics: ['Entry.publish'] }).value.active); assert.ok(webhookDefinitionInput({ name: 'x', url: 'ftp://x', topics: ['Entry.publish'] }).error); assert.ok(webhookDefinitionInput({ name: 'x', url: 'https://x.y', topics: ['Nope.publish'] }).error)
  const v = validationFailed([{ path: 'title', message: 'Required' }], 'rid'); assert.equal(v.sys.id, 'ValidationFailed'); assert.deepEqual(v.details.errors[0], { name: 'invalid', path: ['title'], details: 'Required' })
})
note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''}`)
process.exit(fail ? 1 : 0)
