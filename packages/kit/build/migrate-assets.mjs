/*
 * Once per site: every picture kept beside a record — `cover: ./the-kybalion.png` next to the book's markdown,
 * the old way — moved under content/uploads/<model>/ and its field rewritten to the address (/uploads/<model>/<name>).
 * Through the store, so it runs over the checkout or the rows; through each model's grammar, so nothing but the
 * field changes in the file. A field that already holds an address is left alone; a name already taken under the
 * model's folder gets the record's slug in front. Idempotent: a second run moves nothing.
 *
 *   node build/migrate-assets.mjs [--dry]        this site
 *   migrateAssets(root | store, { dry, log }) → { moved: [{ file, field, from, to }] }
 */
import matter from 'gray-matter'
import { asStore, collectionOf } from './store/index.mjs'
import { addressOf } from './assets.mjs'

const IMAGE_FIELDS = ['cover', 'image', 'share', 'heroImage', 'portrait', 'photo', 'picture']
/* the models whose records kept pictures beside them, and where those go */
const RELATIVE = [['content/books', 'books'], ['content/wiki', 'wiki'], ['content/docs', 'docs']]
const isRelative = (v) => typeof v === 'string' && v.trim() && !/^(https?:)?\//i.test(v.trim()) && !v.includes('..')

export async function migrateAssets(root, { dry = false, log = () => {} } = {}) {
  const store = asStore(root)
  const moved = []
  /* the content models' entries kept theirs beside them too: content/models/<key>/ → content/uploads/models/<key>/ */
  const dirs = [...RELATIVE]
  for (const key of await store.dirs('content/models')) dirs.push(['content/models/' + key, 'models/' + key])
  for (const [dir, folder] of dirs) {
    for (const name of await store.list(dir, { deep: true })) {
      const file = dir + '/' + name + '.md'
      const text = await store.read(file); if (text == null) continue
      const fm = matter(text)
      const changes = []
      for (const key of IMAGE_FIELDS) {
        const v = fm.data[key]
        if (!isRelative(v)) continue
        const from = dir + '/' + name.split('/').slice(0, -1).concat(String(v).trim().replace(/^\.\//, '')).join('/')
        if (!(await store.exists(from)) && !(await store.getAsset(from))) { log(`${file}: ${key} "${v}" — no such file beside it, left as it is`); continue }
        let base = from.split('/').pop()
        let to = `content/uploads/${folder}/${base}`
        if (await store.getAsset(to)) { base = name.split('/').pop() + '-' + base; to = `content/uploads/${folder}/${base}` }
        changes.push({ key, from, to, address: addressOf(to) })
      }
      if (!changes.length) continue
      for (const c of changes) {
        moved.push({ file, field: c.key, from: c.from, to: c.to })
        log(`${file}: ${c.key} ${fm.data[c.key]} → ${c.address}${dry ? ' (dry)' : ''}`)
        if (dry) continue
        const bytes = await store.getAsset(c.from)
        await store.putAsset(c.to, bytes, mimeOf(c.to))
        await store.removeAsset(c.from)
      }
      if (dry) continue
      /* the field alone: its line rewritten in place, the rest of the file byte for byte */
      let out = text
      for (const c of changes) {
        const re = new RegExp(`^(${c.key}:\\s*)(['"]?)${escapeRe(String(fm.data[c.key]))}\\2\\s*$`, 'm')
        if (!re.test(out)) throw new Error(`${file}: the ${c.key} line could not be found to rewrite`)
        out = out.replace(re, `$1${c.address}`)
      }
      const parsed = matter(out)
      await store.write(file, out, { ...collectionOf(file), data: parsed.data, body: parsed.content, published: parsed.data.published !== false, live: true, pending: false })
    }
  }
  return { moved }
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mimeOf = (p) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' })[String(p).split('.').pop().toLowerCase()] || 'application/octet-stream'

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const dry = process.argv.includes('--dry')
  const { storeFor } = await import('./store/index.mjs')
  const r = await migrateAssets(await storeFor(process.cwd()), { dry, log: console.log })
  console.log(`migrate-assets: ${r.moved.length} file(s) ${dry ? 'would move' : 'moved'}`)
}
