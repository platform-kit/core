/*
 * Where a site's content lives: one async shape the pipe, the grammars and the build read and write
 * through, never the disk directly — so a model, an editor or a script knows nothing of the mode.
 *
 *   read(path) → text | null        the file's text (null when there is none)
 *   write(path, text, meta?)        the whole file (meta: { data, body, collection, slug, published, by } for the rows)
 *   exists(path) → boolean
 *   remove(path)
 *   rename(from, to)                refused when `to` is taken
 *   list(dir, { ext = 'md', deep = false }) → names without the extension, sorted (deep: 'a/b' for nested)
 *   dirs(dir) → the folders under it
 *   getAsset(path) → Uint8Array | null · putAsset(path, bytes, type?) · removeAsset(path) · assetUrl(path)
 *   assets — the library's browse over the two file roots (content/uploads, public — ROOTS; media-library):
 *     list(dir) → [{ path, name, type: 'file' | 'dir', size, modified, mime, url }] · mkdir(dir) · rename(from, to) ·
 *     move(from, toDir) · copy(from, toDir) · remove(path) (a folder with everything under it) · search(dir, q, deep)
 *     — every call refused (400) for a path outside the roots or with a dot-segment (insideRoots)
 *
 * Every path is relative to the site's root (`content/articles/x.md`), never absolute. `git.mjs` is the
 * checkout, the default; `rows.mjs` is the `content` table and the `content-assets` bucket of cloud mode
 * (`CONTENT_STORE=cloud`). `storeFor(root)` picks by the switch; a script that wants the disk whatever the
 * mode (the deploy's export) asks for `gitStore(root)` by name.
 */
import { gitStore } from './git.mjs'

export { gitStore }
/* a store, or a root that means the checkout — every file-touching function of the build takes either */
export const asStore = (x) => (x && typeof x === 'object' && typeof x.read === 'function' ? x : gitStore(x || process.cwd()))
export const MODE = () => (process.env.CONTENT_STORE === 'cloud' ? 'cloud' : 'git')
export async function storeFor(root = process.cwd(), opts = {}) {
  if (MODE() !== 'cloud') return gitStore(root)
  const { rowsStore } = await import('./rows.mjs')
  return rowsStore(opts)
}
/* the collection a content path belongs to (velite's name for it) and its slug — the row's keys, and what the
   site loads by; the deeper folders first, then the first segment for a kind the kit does not name */
const DIRS = [['content/store/products', 'products'], ['content/store/prices', 'prices'], ['content/store/promotions', 'promotions'], ['content/store/collections', 'collections'], ['content/app/tests', 'tests'], ['content/app/ui', 'ui'], ['content/strings', 'strings'], ['content/models', 'models'], ['content/uploads', 'uploads']]
export function collectionOf(rel) {
  const p = String(rel).replace(/\\/g, '/').replace(/^\.?\//, '')
  if (p === 'content/store/storefront.md') return { collection: 'storefront', slug: 'storefront', ext: 'md' }   /* the store's one file */
  for (const [dir, name] of DIRS) if (p.startsWith(dir + '/')) return { collection: name, slug: p.slice(dir.length + 1).replace(/\.[a-z0-9]+$/, ''), ext: (p.match(/\.([a-z0-9]+)$/) || [])[1] || '' }
  const m = /^content\/([^/]+)\/(.+?)(?:\.([a-z0-9]+))?$/.exec(p)
  if (!m) { const one = /^content\/([^/.]+)\.([a-z0-9]+)$/.exec(p); return one ? { collection: one[1], slug: one[1], ext: one[2] } : { collection: '', slug: p, ext: '' } }   /* content/site.md: a collection of one */
  return { collection: m[1], slug: m[2], ext: m[3] || '' }
}

/* the library's roots: the only directories the media manager reaches — a path outside them, or with a dot-segment
   or a slash where a name is wanted, is refused before any store looks */
export const ROOTS = ['content/uploads', 'public']
export function insideRoots(rel) {
  const p = String(rel || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/$/, '')
  if (!p || p.split('/').some((seg) => seg === '..' || seg === '')) return null
  return ROOTS.some((r) => p === r || p.startsWith(r + '/')) ? p : null
}
export const refuse = (msg, code = 400) => Object.assign(new Error(msg), { code })
export const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain', md: 'text/markdown', json: 'application/json', css: 'text/css', js: 'text/javascript', woff2: 'font/woff2', woff: 'font/woff', zip: 'application/zip' }
export const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'
/* a good name for a file or folder: no slash, no dot-segment, nothing that would be hidden */
export const cleanName = (name) => { const n = String(name || '').trim(); if (!n || n === '.' || n === '..' || /[\\/]/.test(n) || n.startsWith('.')) throw refuse('a name is one word with no slash, and does not start with a dot'); return n }
