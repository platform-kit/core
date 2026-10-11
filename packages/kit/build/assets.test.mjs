/* The build's one way from an address to a file (build/assets.mjs): /uploads/… under content/uploads, /… under
   public, a bucket url to the file the export pulled — or fetched once and kept — and a path beside a record as
   the old way, warned once; and the migration (build/migrate-assets.mjs) over a scratch site: every picture beside
   a record moved under content/uploads/<model>/ and its field rewritten, a second run idle. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveAsset, addressOf, pathOfAddress, assetUsage } from './assets.mjs'
import { gitStore } from './store/git.mjs'
import { migrateAssets } from './migrate-assets.mjs'

let n = 0, bad = 0
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'))
const put = (rel, text = 'x') => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }

await ta('addresses and their paths', async () => {
  assert.equal(addressOf('content/uploads/a/b.png'), '/uploads/a/b.png'); assert.equal(addressOf('public/img/c.jpg'), '/img/c.jpg'); assert.equal(addressOf('content/books/x.md'), null)
  assert.equal(pathOfAddress('/uploads/a/b.png'), 'content/uploads/a/b.png'); assert.equal(pathOfAddress('/img/c.jpg'), 'public/img/c.jpg')
  assert.equal(pathOfAddress('http://127.0.0.1:54321/storage/v1/object/public/content-assets/content/uploads/a/b.png'), 'content/uploads/a/b.png')
  assert.equal(pathOfAddress('https://elsewhere.example/x.png'), null); assert.equal(pathOfAddress('./x.png'), null)
})
await ta('the resolver: the four kinds', async () => {
  put('content/uploads/books/one.png'); put('public/img/two.jpg'); put('content/books/three.md', '---\ncover: ./three.png\n---\n'); put('content/books/three.png')
  const logs = []; const log = (m) => logs.push(m)
  assert.equal(await resolveAsset('/uploads/books/one.png', { root }), path.join(root, 'content/uploads/books/one.png'))
  assert.equal(await resolveAsset('/img/two.jpg', { root }), path.join(root, 'public/img/two.jpg'))
  assert.equal(await resolveAsset('/img/none.jpg', { root }), null)
  const pulled = 'http://127.0.0.1:54321/storage/v1/object/public/content-assets/content/uploads/books/one.png'
  assert.equal(await resolveAsset(pulled, { root, fetchFn: () => { throw new Error('never fetched: the export pulled it') } }), path.join(root, 'content/uploads/books/one.png'))
  let fetched = 0
  const fetchFn = async () => { fetched++; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } }
  const far = 'https://elsewhere.example/pic/four.png'
  const got = await resolveAsset(far, { root, fetchFn })
  assert.ok(got && got.startsWith(path.join(root, 'node_modules', '.cache', 'platformkit', 'assets')) && got.endsWith('.png')); assert.equal(fs.readFileSync(got).length, 3)
  await resolveAsset(far, { root, fetchFn }); assert.equal(fetched, 1, 'fetched once, kept')
  assert.equal(await resolveAsset('https://elsewhere.example/gone.png', { root, fetchFn: async () => ({ ok: false, status: 404 }), log }), null); assert.match(logs.pop(), /404/)
  const beside = await resolveAsset('./three.png', { root, fromFile: path.join(root, 'content/books/three.md'), log })
  assert.equal(beside, path.join(root, 'content/books/three.png')); assert.match(logs.pop(), /the old way/)
  await resolveAsset('./three.png', { root, fromFile: path.join(root, 'content/books/three.md'), log }); assert.equal(logs.length, 0, 'warned once per file')
})
await ta('the migration: beside the record → under content/uploads/<model>/, the field rewritten, then idle', async () => {
  put('content/books/four.md', '---\ntitle: Four\ncover: ./four.jpg\nshare: /img/two.jpg\n---\n\n# One\n\ntext\n'); put('content/books/four.jpg', 'FOUR')
  put('content/books/five.md', '---\ntitle: Five\ncover: /uploads/books/one.png\n---\n'); put('content/wiki/six.md', '---\ntitle: Six\ncover: ./six.png\n---\n'); put('content/wiki/six.png', 'SIX')
  const dry = await migrateAssets(root, { dry: true })
  assert.equal(dry.moved.length, 3, 'four, six — and three from the resolver\'s check above'); assert.ok(fs.existsSync(path.join(root, 'content/books/four.jpg')), 'dry moves nothing')
  const r = await migrateAssets(root)
  assert.deepEqual(r.moved.map((m) => [m.from, m.to]).sort(), [['content/books/four.jpg', 'content/uploads/books/four.jpg'], ['content/books/three.png', 'content/uploads/books/three.png'], ['content/wiki/six.png', 'content/uploads/wiki/six.png']])
  assert.ok(!fs.existsSync(path.join(root, 'content/books/four.jpg')) && fs.readFileSync(path.join(root, 'content/uploads/books/four.jpg'), 'utf8') === 'FOUR')
  const four = fs.readFileSync(path.join(root, 'content/books/four.md'), 'utf8')
  assert.match(four, /^cover: \/uploads\/books\/four\.jpg$/m); assert.match(four, /^share: \/img\/two\.jpg$/m, 'an address already is left alone'); assert.match(four, /# One\n\ntext/, 'the body untouched')
  assert.match(fs.readFileSync(path.join(root, 'content/wiki/six.md'), 'utf8'), /^cover: \/uploads\/wiki\/six\.png$/m)
  assert.equal((await migrateAssets(root)).moved.length, 0, 'a second run moves nothing')
})
/* a file in use: the records that name it, by every form the address takes; a near miss is not a use; a folder is
   every file under it */
await ta('a file in use: the records that name it', async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-use-'))
  const w = (rel, text) => { const f = path.join(site, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }
  for (const p of ['content/uploads/books/a.png', 'content/uploads/books/free.png', 'content/uploads/hero.png', 'content/uploads/hero.png.bak', 'public/img/b.jpg', 'public/img/c.jpg', 'content/uploads/mail.png']) w(p, 'x')
  w('content/books/one.md', '---\ntitle: "Book One"\ncover: /uploads/books/a.png\n---\n# 1\n')
  w('content/pages/home.md', '---\ntitle: Home\nsections:\n  - component: Hero\n    props:\n      image: /img/b.jpg\n---\n')
  w('content/articles/piece.md', '---\ntitle: A piece\n---\n![](/uploads/hero.png.bak)\n\nAnd http://127.0.0.1:54321/storage/v1/object/public/content-assets/content/uploads/hero.png here.\n')
  w('content/emails/order.json', JSON.stringify({ blocks: [{ src: '/uploads/mail.png' }] }))
  w('content/site.md', '---\nname: Site\n---\n')
  const st = gitStore(site)
  const u = await assetUsage(st, ['content/uploads/books/a.png', 'content/uploads/books/free.png', 'content/uploads/hero.png', 'public/img/b.jpg', 'public/img/c.jpg', 'content/uploads/mail.png', 'content/uploads/books'])
  assert.deepEqual(u['content/uploads/books/a.png'], [{ file: 'content/books/one.md', collection: 'books', title: 'Book One' }], 'a cover by its address, the title unquoted')
  assert.equal(u['content/uploads/books/free.png'], undefined, 'a file no record names')
  assert.deepEqual(u['content/uploads/hero.png'].map((r) => r.file), ['content/articles/piece.md'], 'a bucket url counts; /uploads/hero.png.bak is not /uploads/hero.png')
  assert.deepEqual(u['public/img/b.jpg'].map((r) => r.title), ['Home'], 'a section picture under public')
  assert.equal(u['public/img/c.jpg'], undefined)
  assert.deepEqual(u['content/uploads/mail.png'].map((r) => r.collection), ['emails'], 'an email design')
  assert.deepEqual(u['content/uploads/books'].map((r) => r.file), ['content/books/one.md'], 'a folder: any file under it')
  fs.rmSync(site, { recursive: true, force: true })
})
fs.rmSync(root, { recursive: true, force: true })
console.log(`${bad ? '✖' : '✔'} assets: ${n - bad}/${n} checks`)
process.exit(bad ? 1 : 0)
