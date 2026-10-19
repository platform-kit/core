/* The store under the pipe: the checkout (git.mjs) over a scratch directory — write, read, exists, list (flat and
   deep), rename (refused when taken), remove, an asset — and the rows (rows.mjs) against the local stack's `content`
   table with the same calls, plus what the policies say: a reader sees the published rows and none of the drafts.
   Then the pipe itself over both: one record written through a model reads back byte-identical either side; the
   draft's life (a save a draft, publish live, a removal waiting, keep); and the deploy's export (content-export.mjs)
   over a scratch directory: a pending row wins, a newer file wins, a published removal removes the file, a file
   with no row becomes one, a row with no file goes, a draft is left alone. The push to the repository
   (_shared/github.js) with GitHub's git data API mocked: everything pending as one commit — the blobs, one tree,
   one commit, the ref — cleared together once the ref has moved, every row left pending when it is refused. The
   library's browse (assets.list/mkdir/rename/move/copy/remove/search) over both, the same entries either side, the
   roots held. And the `admin` function's
   door, when the stack serves it: a guest, a reader and a support agent refused, the administrator through. The
   rows part skips itself with a note when the local stack is down (POLICY_TEST=0 skips it too). */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gitStore } from './store/index.mjs'
import { adminRequest } from './admin-pipe.mjs'
import { registry, byKey, write, read } from './models/index.mjs'

let n = 0, bad = 0
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }

/* the rows are one table for the whole site, so the lists are read for the probes alone */
const probes = (l) => l.filter((x) => x.includes('probe-'))
async function exercise(st, tag) {
  await st.write('content/articles/probe-a.md', '---\ntitle: A\n---\nbody a\n', { collection: 'articles', slug: 'probe-a', data: { title: 'A' }, body: 'body a', published: true })
  await st.write('content/articles/probe-b.md', '---\ntitle: B\npublished: false\n---\n', { collection: 'articles', slug: 'probe-b', data: { title: 'B', published: false }, body: '', published: false })
  await st.write('content/articles/deep/probe-d.md', '---\ntitle: D\n---\n', { collection: 'articles', slug: 'deep/probe-d', data: { title: 'D' }, body: '' })
  assert.equal(await st.read('content/articles/probe-a.md'), '---\ntitle: A\n---\nbody a\n', tag + ' read')
  assert.equal(await st.read('content/articles/nope.md'), null, tag + ' a missing file is null')
  assert.equal(await st.exists('content/articles/probe-b.md'), true)
  assert.deepEqual(probes(await st.list('content/articles')), ['probe-a', 'probe-b'], tag + ' flat list')
  assert.deepEqual(probes(await st.list('content/articles', { deep: true })), ['deep/probe-d', 'probe-a', 'probe-b'], tag + ' deep list')
  await assert.rejects(() => st.rename('content/articles/probe-a.md', 'content/articles/probe-b.md'), /exists/, tag + ' a taken name is refused')
  await st.rename('content/articles/probe-a.md', 'content/articles/probe-c.md')
  assert.deepEqual(probes(await st.list('content/articles')), ['probe-b', 'probe-c'], tag + ' renamed')
  assert.equal(await st.exists('content/articles/probe-a.md'), false)
  await st.putAsset('content/uploads/probe.bin', new Uint8Array([1, 2, 3]), 'application/octet-stream')
  assert.deepEqual([...(await st.getAsset('content/uploads/probe.bin'))], [1, 2, 3], tag + ' asset')
  assert.ok(typeof st.assetUrl('content/uploads/probe.bin') === 'string' && st.assetUrl('content/uploads/probe.bin').includes('probe.bin'))
  await st.removeAsset('content/uploads/probe.bin')
  for (const f of ['content/articles/probe-b.md', 'content/articles/probe-c.md', 'content/articles/deep/probe-d.md']) await st.remove(f)
  assert.deepEqual(probes(await st.list('content/articles', { deep: true })), [], tag + ' removed')
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'))
await ta('the checkout store', async () => { await exercise(gitStore(dir), 'git') })
/* the library's browse: the same files either side, the entries the same but for the address; the roots held */
async function browse(st, tag) {
  const A = st.assets, U = 'content/uploads/probe-lib'
  await st.assets.remove(U).catch(() => {})
  await st.putAsset(U + '/one.png', new Uint8Array([1, 2, 3]), 'image/png')
  await st.putAsset(U + '/two.txt', new Uint8Array([4, 5]), 'text/plain')
  await A.mkdir(U + '/inner')
  await st.putAsset(U + '/inner/three.png', new Uint8Array([6]), 'image/png')
  const shape = (e) => ({ path: e.path, name: e.name, type: e.type, size: e.size, mime: e.mime })
  const top = (await A.list(U)).map(shape)
  assert.deepEqual(top, [{ path: U + '/inner', name: 'inner', type: 'dir', size: null, mime: null }, { path: U + '/one.png', name: 'one.png', type: 'file', size: 3, mime: 'image/png' }, { path: U + '/two.txt', name: 'two.txt', type: 'file', size: 2, mime: 'text/plain' }], tag + ' list')
  const one = (await A.list(U)).find((e) => e.name === 'one.png'); assert.ok(one.url && /probe-lib\/one\.png$/.test(one.url), tag + ' an address'); assert.ok(one.modified > 0)
  assert.equal(await A.rename(U + '/two.txt', 'deux.txt'), U + '/deux.txt')
  assert.equal(await A.move(U + '/deux.txt', U + '/inner'), U + '/inner/deux.txt')
  assert.deepEqual((await A.list(U + '/inner')).map((e) => e.name), ['deux.txt', 'three.png'], tag + ' moved')
  assert.equal(await A.copy(U + '/one.png', U + '/inner'), U + '/inner/one.png')
  assert.equal(await A.copy(U + '/one.png', U), U + '/one-copy.png', tag + ' a copy beside itself takes a new name')
  await assert.rejects(() => A.rename(U + '/one-copy.png', 'one.png'), /already/, tag + ' a taken name is refused')
  await assert.rejects(() => A.rename(U + '/one-copy.png', 'a/b.png'), /slash/, tag + ' a name with a slash is refused')
  assert.deepEqual((await A.search(U, 'one')).map((e) => e.path).sort(), [U + '/inner/one.png', U + '/one-copy.png', U + '/one.png'], tag + ' search, deep')
  assert.deepEqual((await A.search(U, 'one', false)).map((e) => e.name).sort(), ['one-copy.png', 'one.png'], tag + ' search, shallow')
  await A.remove(U + '/inner')
  assert.deepEqual((await A.list(U)).map((e) => e.name), ['one-copy.png', 'one.png'], tag + ' a folder removed with what is under it')
  for (const bad of ['content/books', 'content/uploads/../books', 'public/../content', '']) await assert.rejects(() => A.list(bad), /reaches/, tag + ' outside the roots: ' + JSON.stringify(bad))
  await assert.rejects(() => A.remove('content/uploads'), /root/, tag + ' a root is not removed')
  await A.remove(U)
  assert.equal((await A.list('content/uploads')).some((e) => e.name === 'probe-lib'), false, tag + ' gone')
}
/* a file in use is kept: the pipe refuses to remove, rename or move a file a record names — a folder for any file
   under it — and writes nothing; a free file goes through */
async function kept(st, tag) {
  const U = 'content/uploads/probe-kept'
  await st.assets.remove(U).catch(() => {})
  await st.putAsset(U + '/used.png', new Uint8Array([1]), 'image/png'); await st.putAsset(U + '/free.png', new Uint8Array([2]), 'image/png')
  await st.write('content/articles/probe-kept.md', '---\ntitle: Probe\n---\n![](/uploads/probe-kept/used.png)\n', { live: true, pending: false })
  const env = { root: dir, store: st, models: async () => [], by: 'store.test' }
  const call = (body) => adminRequest(env, { method: 'POST', seg: 'media', q: {}, body })
  for (const body of [{ op: 'remove', paths: [U + '/used.png'] }, { op: 'rename', path: U + '/used.png', name: 'other.png' }, { op: 'move', paths: [U + '/used.png'], to: 'content/uploads' }, { op: 'remove', paths: [U] }]) {
    const r = await call(body); assert.equal(r.status, 409, tag + ' refused: ' + body.op + ' ' + JSON.stringify(r.body).slice(0, 200)); assert.equal(r.body.error, 'in use'); assert.deepEqual(Object.values(r.body.used)[0].map((x) => x.title), ['Probe'], tag + ' the record named')
  }
  assert.ok(await st.getAsset(U + '/used.png'), tag + ' still there')
  const usage = await call({ op: 'usage', paths: [U + '/used.png', U + '/free.png'] }); assert.deepEqual(Object.keys(usage.body.usage), [U + '/used.png'], tag + ' usage')
  assert.equal((await call({ op: 'remove', paths: [U + '/free.png'] })).status, 200, tag + ' a free file goes')
  await st.remove('content/articles/probe-kept.md'); if (st.kind !== 'git') await st.publish(['content/articles/probe-kept.md'])
  assert.equal((await call({ op: 'remove', paths: [U] })).status, 200, tag + ' and then the folder')
}
await ta('the library over the checkout', async () => { await browse(gitStore(dir), 'git') })
await ta('a file in use is kept, over the checkout', async () => { await kept(gitStore(dir), 'git') })


/* the pipe over a store: the funnels model, the same record either side */
const ALL = { root: dir, modules: {}, admin: {} }
const funnels = byKey(await registry(dir, { site: ALL }), 'funnels')
const rec = { data: { title: 'Welcome', published: true }, parsed: { steps: [{ title: 'One', after: '1d', subject: 'Hi', body: 'Hello' }] } }
await ta('a record through the pipe over the checkout', async () => {
  const st = gitStore(dir)
  await write({ ...funnels, after: null }, 'welcome', rec, dir, { create: true, store: st })
  const back = await read(funnels, 'welcome', dir, { store: st })
  assert.equal(back.data.title, 'Welcome'); assert.equal(back.parsed.steps.length, 1)
})
const gitText = fs.readFileSync(path.join(dir, 'content/funnels/welcome.md'), 'utf8')

let rows = null
if (process.env.POLICY_TEST === '0') console.log('store: the rows skipped (POLICY_TEST=0)')
else {
  const { supabaseUrl, localStack, serviceKey } = await import('./tts/storage.mjs')
  const url = supabaseUrl(), anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
  let up = false
  try { up = url && localStack() && (await fetch(url + '/rest/v1/', { headers: { apikey: anonKey }, signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
  if (!up) console.log('store: the rows skipped — the local stack is not up')
  else {
    const { rowsStore } = await import('./store/rows.mjs')
    rows = rowsStore({ url, key: serviceKey(), by: 'store.test' })
    await ta('the row store on the local stack', async () => { await exercise(rows, 'rows') })
    await ta('the library over the bucket', async () => { await browse(rows, 'rows') })
    await ta('a file in use is kept, over the rows', async () => { await kept(rows, 'rows') })
    await ta('a reader reads no row directly — the published rows reach them through reader-content, cut to what a guest may read', async () => {
      await rows.write('content/articles/probe-pub.md', '---\ntitle: P\n---\n', { collection: 'articles', slug: 'probe-pub', published: true, live: true })
      await rows.write('content/articles/probe-draft.md', '---\ntitle: D\npublished: false\n---\n', { collection: 'articles', slug: 'probe-draft', published: false, live: true })
      await rows.write('content/articles/probe-fresh.md', '---\ntitle: F\n---\n', { collection: 'articles', slug: 'probe-fresh' })   /* a first save: a draft, no live version */
      await rows.write('content/articles/probe-pub.md', '---\ntitle: P2\n---\n', { collection: 'articles', slug: 'probe-pub', data: { title: 'P2' } })   /* a draft over a live row */
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(url, anonKey, { auth: { persistSession: false } })
      const seen = (await anon.from('content').select('path, text').like('path', 'content/articles/probe-%')).data
      assert.deepEqual(seen, [], 'no row is a reader\'s to read from the table (reader-content.test.mjs holds what they are sent)')
      const leak = await anon.from('content_drafts').select('path').eq('path', 'content/articles/probe-pub.md')
      assert.ok(!leak.error && leak.data.length === 0, 'a draft is not a reader\'s to read (RLS on, no policy)')
      const leak2 = await anon.from('content').select('path, content_drafts(text)').eq('path', 'content/articles/probe-pub.md')
      assert.ok(!leak2.error && !leak2.data.length, 'nor through the join')
      const ins = await anon.from('content').insert({ path: 'content/articles/probe-x.md', text: 'x' })
      assert.ok(ins.error, 'a client cannot write')
    })
    await ta('a save is a draft; publish makes it live; a removal waits too', async () => {
      const P = 'content/articles/probe-life.md'
      await rows.write(P, 'v1', { collection: 'articles', slug: 'probe-life', data: { title: 'One' } })
      let r = await rows.row(P); assert.equal(r.text, null); assert.equal(r.draft_text, 'v1'); assert.equal(r.pending, false)
      assert.equal(await rows.read(P), 'v1', 'the admin reads the draft'); assert.equal(await rows.readLive(P), null, 'nothing live yet')
      let d = await rows.drafts(); const mine = d.find((x) => x.path === P); assert.ok(mine && mine.fresh && !mine.removed && mine.title === 'One')
      await rows.publish([P])
      r = await rows.row(P); assert.equal(r.text, 'v1'); assert.equal(r.draft_text, null); assert.equal(r.pending, true); assert.ok(r.published_at)
      assert.ok(!(await rows.drafts()).some((x) => x.path === P), 'published: no draft')
      await rows.write(P, 'v2', { collection: 'articles', slug: 'probe-life', data: { title: 'Two' } })
      assert.equal(await rows.read(P), 'v2'); assert.equal(await rows.readLive(P), 'v1', 'the live version stands while the draft waits')
      assert.equal((await rows.drafts()).find((x) => x.path === P).title, 'Two')
      await rows.remove(P)
      r = await rows.row(P); assert.equal(r, null, 'a draft removal leaves the admin\'s list'); assert.equal(await rows.readLive(P), 'v1', 'and keeps the page live')
      d = (await rows.drafts()).find((x) => x.path === P); assert.ok(d.removed)
      await rows.keep(P); assert.ok(await rows.row(P), 'kept: back on the list'); assert.equal((await rows.row(P)).draft_text, null, 'the removal took the draft with it')
      await rows.remove(P); await rows.publish('all')
      const { data: gone } = await rows.client.from('content').select('deleted_at, pending').eq('path', P).single(); assert.ok(gone.deleted_at && gone.pending, 'published removal: deleted, pending for the push')
      assert.equal((await rows.client.from('content_drafts').select('path').eq('path', P)).data.length, 0, 'the draft row is gone with the publish')
      const F = 'content/articles/probe-never.md'
      await rows.write(F, 'x', { collection: 'articles', slug: 'probe-never' }); await rows.remove(F)
      assert.equal((await rows.client.from('content').select('path').eq('path', F)).data.length, 0, 'a row never published is simply gone')
    })
    await ta('a save that says nothing about a record does not unsay what it is', async () => {
      /*
       * A caller may write TEXT and no meta — the enrichment writes a companion that way — and the
       * row it saves over already knows what it is. Reading an absent \`collection\` as null and an
       * absent \`published\` as true is right for a row being made and wrong for one being edited:
       * every collection is read through the (collection, slug) index, so the record stays in the
       * table and vanishes from the site, and anything unpublished comes back published. Found by a
       * companion that disappeared from its collection on a save that changed one field.
       */
      const P = 'content/articles/probe-keys.md'
      await rows.write(P, 'v1', { collection: 'articles', slug: 'probe-keys', published: false, data: { title: 'K' }, live: true })
      await rows.write(P, 'v2')   /* text alone, as a build script writes it */
      const { data: r } = await rows.client.from('content').select('collection, slug, published').eq('path', P).single()
      assert.equal(r.collection, 'articles', 'the collection it was in')
      assert.equal(r.slug, 'probe-keys', 'and the slug it was at')
      assert.equal(r.published, false, 'and unpublished is not quietly published again')
      assert.equal(await rows.read(P), 'v2', 'while the save itself happened')
      /* and a caller that DOES say something still moves it */
      await rows.write(P, 'v3', { collection: 'wiki', slug: 'moved', published: true })
      const { data: m } = await rows.client.from('content').select('collection, slug, published').eq('path', P).single()
      assert.deepEqual([m.collection, m.slug, m.published], ['wiki', 'moved', true], 'what a caller names, it sets')
      await rows.client.from('content_drafts').delete().eq('path', P)
      await rows.client.from('content').delete().eq('path', P)
    })
    await ta('a record through the pipe over the rows, byte-identical to the checkout', async () => {
      await write({ ...funnels, after: null }, 'probe-welcome', rec, dir, { create: true, store: rows })
      const text = await rows.read('content/funnels/probe-welcome.md')
      const noId = (t) => t.replace(/^id: [0-9a-f-]{36}$/m, 'id: <uuid>')   /* the step's id is minted on the first save */
      assert.equal(noId(text), noId(gitText))
      const row = await rows.row('content/funnels/probe-welcome.md')
      assert.equal(row.collection, 'funnels'); assert.equal(row.slug, 'probe-welcome'); assert.equal(row.pending, false, 'a save is a draft: nothing to push yet'); assert.equal(row.text, null); assert.equal(row.draft_data.title, 'Welcome')
    })
    await ta('the export: a pending row wins, a newer file wins, the rest follow', async () => {
      const { exportRows } = await import('./content-export.mjs')
      const U = 'content/probe-export', xdir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'))
      const g = gitStore(xdir)
      await rows.client.from('content').delete().like('path', U + '/%')
      /* a pending edit with no file yet, a pending edit over an older file, a pushed row whose file moved on, a pending deletion, a pushed row whose file went, a file with no row */
      const L = { collection: 'articles', live: true }
      await rows.write(U + '/new.md', '---\ntitle: New\n---\n', { ...L, slug: 'new' })
      await rows.write(U + '/edited.md', '---\ntitle: Edited\n---\n', { ...L, slug: 'edited' }); await g.write(U + '/edited.md', '---\ntitle: Old\n---\n')
      await rows.write(U + '/moved-on.md', '---\ntitle: Row\n---\n', { ...L, slug: 'moved-on', pending: false }); await g.write(U + '/moved-on.md', '---\ntitle: File\n---\n')
      await rows.write(U + '/gone.md', 'x', { ...L, slug: 'gone', pending: false }); await g.write(U + '/gone.md', 'x'); await rows.remove(U + '/gone.md'); await rows.publish([U + '/gone.md'])   /* a published removal */
      await rows.write(U + '/orphan.md', 'x', { ...L, slug: 'orphan', pending: false })
      await g.write(U + '/fresh.md', '---\ntitle: Fresh\n---\n')
      /* a draft over a live row, and a never-published draft: neither is the export's */
      await rows.write(U + '/drafted.md', 'live', { ...L, slug: 'drafted', pending: false }); await g.write(U + '/drafted.md', 'live'); await rows.write(U + '/drafted.md', 'draft', { collection: 'articles', slug: 'drafted' })
      await rows.write(U + '/unborn.md', 'draft only', { collection: 'articles', slug: 'unborn' })
      const dry = await exportRows(xdir, rows, { dry: true, under: U })
      assert.deepEqual(dry.written.sort(), [U + '/edited.md', U + '/new.md']); assert.equal(await g.read(U + '/edited.md'), '---\ntitle: Old\n---\n', 'dry touches nothing')
      const out = await exportRows(xdir, rows, { under: U })
      assert.deepEqual(out.written.sort(), [U + '/edited.md', U + '/new.md']); assert.deepEqual(out.updated, [U + '/moved-on.md']); assert.deepEqual(out.inserted, [U + '/fresh.md'])
      assert.deepEqual(out.removedFiles, [U + '/gone.md']); assert.deepEqual(out.removedRows, [U + '/orphan.md'])
      assert.equal(await g.read(U + '/new.md'), '---\ntitle: New\n---\n'); assert.equal(await g.read(U + '/edited.md'), '---\ntitle: Edited\n---\n'); assert.equal(await g.read(U + '/gone.md'), null)
      const moved = await rows.row(U + '/moved-on.md'); assert.equal(moved.text, '---\ntitle: File\n---\n'); assert.equal(moved.pending, false); assert.equal(moved.data.title, 'File')
      const fresh = await rows.row(U + '/fresh.md'); assert.equal(fresh.pending, false); assert.equal(fresh.slug, 'fresh'); assert.equal(fresh.text, '---\ntitle: Fresh\n---\n', 'a file with no row is live')
      const drafted = await rows.row(U + '/drafted.md'); assert.equal(drafted.text, 'live'); assert.equal(drafted.draft_text, 'draft', 'the draft survives the export'); assert.equal(await g.read(U + '/drafted.md'), 'live')
      assert.equal(await g.read(U + '/unborn.md'), null, 'a draft never published makes no file'); assert.equal((await rows.row(U + '/unborn.md')).draft_text, 'draft only')
      assert.equal(await rows.row(U + '/orphan.md'), null)
      const again = await exportRows(xdir, rows, { under: U })
      assert.equal(Object.values(again).flat().length, 0, 'a second run does nothing')
      await rows.client.from('content').delete().like('path', U + '/%')
      fs.rmSync(xdir, { recursive: true, force: true })
    })
    await ta('the export with git out of the cycle: one way, and no row is ever deleted', async () => {
      /*
       * THE CASE THIS WHOLE CHANGE EXISTS FOR. A deployment with no repository has no content in its
       * checkout at all, so every row looks to the export like a file somebody deleted. It was
       * unreachable only because nothing ever pushes and so nothing is ever not-pending — safety by
       * side-effect, one cleared token away from wiping the content. With `cloud: { repo: false }`
       * the repository's three rules do not run: nothing is read back, nothing is deleted.
       */
      const { exportRows } = await import('./content-export.mjs')
      const U = 'content/probe-nogit', xdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'))
      const g = gitStore(xdir)
      await rows.client.from('content').delete().like('path', U + '/%')
      const L = { collection: 'articles', live: true }
      /* every row NOT pending and no file for any of them — a pushed site whose checkout has no content */
      await rows.write(U + '/one.md', '---\ntitle: One\n---\n', { ...L, slug: 'one', pending: false })
      await rows.write(U + '/two.md', '---\ntitle: Two\n---\n', { ...L, slug: 'two', pending: false })
      /* and a stray file the export must not adopt, since the checkout is not a record here */
      await g.write(U + '/stray.md', '---\ntitle: Stray\n---\n')

      const out = await exportRows(xdir, rows, { under: U, mode: 'off' })
      assert.ok(out.removedRows.length === 0, 'no row is deleted')
      assert.ok(out.written.sort().join() === [U + '/one.md', U + '/two.md'].join(), 'both are written out')
      assert.ok(!!(await rows.row(U + '/one.md')) && !!(await rows.row(U + '/two.md')), '…and the rows are still there')
      assert.ok((await g.read(U + '/one.md')) === '---\ntitle: One\n---\n', '…with their files on disk for the build')
      assert.ok(out.inserted.length === 0 && (await rows.row(U + '/stray.md')) === null, 'a stray file is not adopted')

      /* a file that differs is not read back either: the rows are the record */
      await g.write(U + '/one.md', '---\ntitle: Tampered\n---\n')
      const again = await exportRows(xdir, rows, { under: U, mode: 'off' })
      assert.ok((await rows.row(U + '/one.md')).text === '---\ntitle: One\n---\n', 'a differing file does not win: the row is the record')
      assert.ok((await g.read(U + '/one.md')) === '---\ntitle: One\n---\n', '…it is overwritten by the row')

      /* and with a repository in the cycle the same shape behaves as it always has */
      const withGit = await exportRows(xdir, rows, { under: U, mode: 'git' })
      assert.ok(withGit.inserted.includes(U + '/stray.md'), 'with a repository, the stray file becomes a row')

      await rows.client.from('content').delete().like('path', U + '/%')
      fs.rmSync(xdir, { recursive: true, force: true })
    })
    await ta('the deploy hook: what asks the host to build where a push does not', async () => {
      /* A publish is live for a reader at once; the prerendered pages and the share images are the
         last build's until the host builds again. With a repository the commit does that. Without
         one nothing does, so this is the only thing that closes the gap — and it must never be able
         to fail a publish, because the rows were written before it was asked. */
      const { saveHook, askRebuild, githubSettings } = await import('../supabase/functions/_shared/github.js')
      const sb = rows.client
      let refused = null
      try { await saveHook(sb, 'http://plain.example/hook') } catch (e) { refused = e.message }
      assert.ok(refused && /https/.test(refused), 'a hook must be https')

      await saveHook(sb, '')
      assert.deepEqual(await askRebuild(sb), { asked: false }, 'no hook, nothing asked')

      await saveHook(sb, 'https://hook.example/build')
      const calls = []
      const ok = await askRebuild(sb, { fetchFn: async (u, o) => { calls.push(u + ' ' + o.method); return { ok: true, status: 200 } } })
      assert.deepEqual(ok, { asked: true, error: null }, 'a hook that answers is asked and says nothing')
      assert.deepEqual(calls, ['https://hook.example/build POST'])

      const bad = await askRebuild(sb, { fetchFn: async () => ({ ok: false, status: 503 }) })
      assert.ok(bad.asked && /503/.test(bad.error), 'a hook that refuses is recorded, not thrown')
      const st = await githubSettings(sb)
      assert.ok(st.hook === true && /503/.test(st.hook_error || ''), 'and the page can say so')
      await saveHook(sb, '')
    })
    await ta('the push: everything pending as one commit, cleared together, or nothing at all', async () => {
      const { pushPending, githubSettings, saveGithubSettings, readSettings } = await import('../supabase/functions/_shared/github.js')
      const sb = rows.client
      const was = await readSettings(sb)
      const U = 'content/probe-push'
      await sb.from('content').delete().like('path', U + '/%')
      await saveGithubSettings(sb, { repo: 'acme/site', branch: 'main', token: 'ghp_probe' })
      const st0 = await githubSettings(sb); assert.equal(st0.connected, true); assert.equal(st0.token, true, 'the token is a yes, never the value')
      /* two published edits and a published removal wait */
      await rows.write(U + '/one.md', 'one', { collection: 'articles', slug: 'one', live: true })
      await rows.write(U + '/two.md', 'two', { collection: 'articles', slug: 'two', live: true })
      await rows.write(U + '/gone.md', 'x', { collection: 'articles', slug: 'gone', live: true, pending: false }); await rows.remove(U + '/gone.md'); await rows.publish([U + '/gone.md'])
      /* the table may hold other pending rows (another test's, an editor's): the mock answers them too and the checks are on the probes */
      const calls = []
      const github = ({ failRef = false } = {}) => async (u, init = {}) => {
        const m = init.method || 'GET', path = u.replace('https://api.github.com', ''), body = init.body ? JSON.parse(init.body) : null
        calls.push({ m, path, body })
        const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) })
        if (m === 'GET' && /\/git\/ref\/heads\/main$/.test(path)) return json({ object: { sha: 'head0' } })
        if (m === 'GET' && /\/git\/commits\/head0$/.test(path)) return json({ tree: { sha: 'tree0' } })
        if (m === 'POST' && /\/git\/blobs$/.test(path)) return json({ sha: 'blob-' + Buffer.from(body.content, 'base64').toString('utf8').slice(0, 8) })
        if (m === 'POST' && /\/git\/trees$/.test(path)) return json({ sha: 'tree1' })
        if (m === 'POST' && /\/git\/commits$/.test(path)) return json({ sha: 'commit1' })
        if (m === 'PATCH' && /\/git\/refs\/heads\/main$/.test(path)) return failRef ? { ok: false, status: 401, text: async () => 'Bad credentials' } : json({ object: { sha: body.sha } })
        return { ok: false, status: 404, text: async () => 'no' }
      }
      /* the ref refused: nothing moves, every row stays pending with the reason */
      const r1 = await pushPending(sb, 'Tester', { fetchFn: github({ failRef: true }), message: 'Autumn list' })
      assert.equal(r1.pushed, 0); assert.match(r1.error, /401/)
      for (const f of ['one', 'two']) { const r = await rows.row(U + '/' + f + '.md'); assert.equal(r.pending, true); assert.match(r.push_error, /401/) }
      assert.equal((await sb.from('content').select('path').eq('path', U + '/gone.md')).data.length, 1, 'the removal waits too')
      assert.match((await githubSettings(sb)).error, /401/)
      /* the same again, the ref accepted: one commit with every file, the message and the name */
      calls.length = 0
      const r2 = await pushPending(sb, 'Tester', { fetchFn: github(), message: 'Autumn list' })
      assert.ok(r2.pushed >= 3); assert.equal(r2.error, null); assert.equal(r2.commit, 'commit1')
      const commits = calls.filter((c) => c.m === 'POST' && /\/git\/commits$/.test(c.path))
      assert.equal(commits.length, 1, 'one commit'); assert.equal(commits[0].body.message, 'Autumn list (Tester)'); assert.deepEqual(commits[0].body.parents, ['head0']); assert.equal(commits[0].body.tree, 'tree1')
      const tree = calls.find((c) => c.m === 'POST' && /\/git\/trees$/.test(c.path)).body
      assert.equal(tree.base_tree, 'tree0')
      const entry = (p) => tree.tree.find((e) => e.path === p)
      assert.equal(entry(U + '/one.md').sha, 'blob-one'); assert.equal(entry(U + '/two.md').sha, 'blob-two'); assert.equal(entry(U + '/gone.md').sha, null, 'a removal is an entry with no blob')
      assert.equal(calls.filter((c) => c.m === 'PATCH').length, 1)
      for (const f of ['one', 'two']) { const r = await rows.row(U + '/' + f + '.md'); assert.equal(r.pending, false); assert.equal(r.push_error, null); assert.ok(r.pushed_at) }
      assert.equal((await sb.from('content').select('path').eq('path', U + '/gone.md')).data.length, 0, 'a removal is gone once pushed')
      const st2 = await githubSettings(sb); assert.equal(st2.error, null); assert.ok(st2.last_push)
      /* nothing pending: no call at all */
      calls.length = 0; await sb.from('content').update({ pending: false }).eq('pending', true)
      const r3 = await pushPending(sb, 'Tester', { fetchFn: github() }); assert.equal(r3.pushed, 0); assert.equal(calls.length, 0)
      /* a branch with no commit yet is said plainly */
      await rows.write(U + '/three.md', 'three', { collection: 'articles', slug: 'three', live: true })
      const r4 = await pushPending(sb, 'Tester', { fetchFn: async () => ({ ok: false, status: 404, text: async () => 'Not Found' }) }); assert.match(r4.error, /no commit yet/)
      await sb.from('content').delete().like('path', U + '/%')
      await sb.from('app_settings').upsert(['repo', 'branch', 'token', 'last_push', 'error'].map((k) => ({ key: 'github:' + k, value: was[k] || '', updated_at: new Date().toISOString() })), { onConflict: 'key' })
    })
    /* the function's door, when the stack serves it (npm run dev does): a guest, a reader and the desk refused; the administrator through */
    let served = false
    try { served = (await fetch(url + '/functions/v1/admin', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* not served */ }
    if (!served) console.log('store: the admin function skipped — not served (npm run dev serves it)')
    else await ta('the admin function: administrators only', async () => {
      const { createClient } = await import('@supabase/supabase-js')
      const as = async (email) => { const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }); if (email) { const { error } = await sb.auth.signInWithPassword({ email, password: 'password123' }); if (error) throw new Error(email + ': ' + error.message) } return sb }
      const knock = async (sb) => { const { data, error } = await sb.functions.invoke('admin', { body: { seg: 'collections', method: 'GET' } }); return error ? (error.context ? error.context.status : 500) : (data && data.collections ? 200 : 500) }
      assert.equal(await knock(await as(null)), 401, 'a guest')
      assert.equal(await knock(await as('free@example.com')), 403, 'a reader')
      { const sb = await as('free@example.com'); const { error } = await sb.functions.invoke('admin', { body: { seg: 'publish', method: 'POST', body: {} } }); assert.equal(error && error.context ? error.context.status : 500, 403, 'a reader\'s publish') }
      { const sb = await as('free@example.com'); const { error } = await sb.functions.invoke('admin', { body: { seg: 'media', method: 'POST', body: { op: 'list', dir: 'content/uploads' } } }); assert.equal(error && error.context ? error.context.status : 500, 403, 'a reader\'s library') }
      assert.equal(await knock(await as('support@example.com')), 403, 'the desk')
      assert.equal(await knock(await as('admin@example.com')), 200, 'the administrator')
    })
    await rows.client.from('content').delete().like('path', 'content/%/probe-%')
    await rows.client.from('content').delete().like('path', 'content/articles/deep/probe-%')
  }
}
fs.rmSync(dir, { recursive: true, force: true })
console.log(`${bad ? '✖' : '✔'} store: ${n - bad}/${n} checks`)
process.exit(bad ? 1 : 0)
