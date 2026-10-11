/*
 * A file by its address, for the build. Every file field of a record holds an address — `/uploads/<path>` for a
 * file under content/uploads, `/<path>` for one under public, or a bucket url for one uploaded in cloud mode —
 * and this is the one place the build turns an address into a file it can read: velite's cover sizing, the
 * print's paperback picture and edition hash, the share cards. Nothing lives beside a record any more (the
 * migration, build/migrate-assets.mjs); a relative `./x` beside a record still resolves, as the old way, and
 * says so once.
 *
 *   resolveAsset(ref, { root, fromFile, fetchFn }) → an absolute path on disk, or null
 *     /uploads/x.png                     <root>/content/uploads/x.png
 *     /img/x.png                         <root>/public/img/x.png
 *     https://…/content-assets/<p>       <root>/<p> when the export pulled it; else fetched once into node_modules/.cache/platformkit/assets/
 *     ./x.png, x.png                     beside fromFile (the old way; warned once per file)
 *   addressOf(rel)                       the served address of a site-root-relative path: content/uploads/x → /uploads/x, public/x → /x
 *   assetUsage(store, paths)             the records that name each file — a file in use is never removed, renamed or moved
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { collectionOf } from './store/index.mjs'
import { platformkitRuntimePath } from './runtime-paths.mjs'

const warned = new Set()
const BUCKET_RE = /\/storage\/v1\/object\/(?:public\/)?content-assets\/(.+)$/

export function addressOf(rel) {
  const p = String(rel || '').replace(/\\/g, '/').replace(/^\.?\//, '')
  if (p.startsWith('content/uploads/')) return '/uploads/' + p.slice('content/uploads/'.length)
  if (p.startsWith('public/')) return '/' + p.slice('public/'.length)
  return null
}
/* the site-root-relative path an address names, or null for one that is not the site's (another host's url) */
export function pathOfAddress(ref) {
  const s = String(ref || '').trim()
  if (!s) return null
  const m = BUCKET_RE.exec(s)
  if (m) return decodeURIComponent(m[1].split('?')[0])
  if (/^https?:\/\//i.test(s)) return null
  if (s.startsWith('/uploads/')) return 'content/uploads/' + s.slice('/uploads/'.length)
  if (s.startsWith('/')) return 'public' + s
  return null
}
export async function resolveAsset(ref, { root = process.cwd(), fromFile = null, fetchFn = globalThis.fetch, log = console.warn } = {}) {
  const s = String(ref || '').trim()
  if (!s) return null
  const rel = pathOfAddress(s)
  if (rel) {
    const abs = path.resolve(root, rel)
    if (fs.existsSync(abs)) return abs
    if (!/^https?:\/\//i.test(s)) return null
  }
  if (/^https?:\/\//i.test(s)) {
    /* the bucket's, not yet pulled (or another host's): fetched once, kept by the url's hash */
    const dir = platformkitRuntimePath(root, 'assets')
    const ext = (path.extname(new URL(s).pathname) || '.bin').toLowerCase()
    const out = path.join(dir, createHash('sha1').update(s).digest('hex').slice(0, 16) + ext)
    if (fs.existsSync(out)) return out
    try {
      const r = await fetchFn(s)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()))
      return out
    } catch (e) { log(`[assets] ${s}: could not be fetched — ${e.message}`); return null }
  }
  /* the old way: a path beside the record */
  if (!fromFile) return null
  const abs = path.resolve(path.dirname(fromFile), s)
  if (!fs.existsSync(abs)) return null
  const key = fromFile + ':' + s
  if (!warned.has(key)) { warned.add(key); log(`[assets] ${path.relative(root, fromFile)}: "${s}" sits beside the record — the old way; node build/migrate-assets.mjs moves it under content/uploads and rewrites the field`) }
  return abs
}

/* ---- a file in use: the records that name it ----
   A reference is the file's address in a record's text: its served address (/uploads/x.png, /img/x.jpg) or the bucket's
   url for the same path (…/content-assets/content/uploads/x.png), followed by nothing that could continue a path — so
   /img/a.png never matches /img/a.png.bak. Every markdown record under content/ but the library itself, and the emails'
   designs, read once through the store for the whole call (a folder asks about many files); in cloud mode the draft
   and the live version both count, since either may still show the file. A folder's paths expand to the files under
   it. Answers { [path]: [{ file, collection, title }] } for the paths in use alone. */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const titleOf = (text, file) => { const m = /^title:\s*(.+?)\s*$/m.exec(text.split(/^---\s*$/m)[1] || ''); const t = m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : ''; return t || file.split('/').pop().replace(/\.[a-z0-9]+$/, '') }
export async function assetUsage(store, paths) {
  const list = [].concat(paths || []).map((p) => String(p).replace(/\\/g, '/').replace(/^\.?\//, '')).filter(Boolean)
  if (!list.length) return {}
  /* a folder stands for every file under it */
  const files = []
  for (const p of list) {
    const A = store.assets
    let isDir = false
    if (A && A.list) { const parent = p.split('/').slice(0, -1).join('/'); try { isDir = (await A.list(parent)).some((e) => e.path === p && e.type === 'dir') } catch { isDir = false } }
    if (isDir) { const under = await A.search(p, '', true); for (const e of under) if (e.type === 'file') files.push({ file: e.path, of: p }) }
    else files.push({ file: p, of: p })
  }
  const forms = files.map(({ file, of }) => { const a = addressOf(file); const alts = [a, 'content-assets/' + file].filter(Boolean); return { file, of, re: new RegExp('(?:' + alts.map(esc).join('|') + ')(?![\\w\\-./])') } })
  /* the records, read once: every markdown under content/ but the library, and the emails' designs — the store's
     texts() where it has one (the rows in one query, the draft's text and the live version's both), else file by file */
  const wanted = (file) => (file.endsWith('.md') && !file.startsWith('content/uploads/')) || (file.endsWith('.json') && file.startsWith('content/emails/'))
  let found
  if (store.texts) found = (await store.texts('content')).filter((r) => wanted(r.file))
  else {
    found = []
    for (const rel of await store.list('content', { ext: '', deep: true })) { const file = 'content/' + rel; if (!wanted(file)) continue; const t = await store.read(file); if (t != null) found.push({ file, texts: [t] }) }
  }
  const texts = found.filter((r) => r.texts.length).map((r) => ({ file: r.file, text: r.texts.join('\n'), ...collectionOf(r.file), title: titleOf(r.texts[0], r.file) }))
  const out = {}
  for (const { file, of, re } of forms) {
    for (const r of texts) if (re.test(r.text)) { (out[of] ||= []); if (!out[of].some((x) => x.file === r.file)) out[of].push({ file: r.file, collection: r.collection, title: r.title }) }
  }
  return out
}
