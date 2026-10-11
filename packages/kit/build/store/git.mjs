/* the checkout: every path under the site's root on disk */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { insideRoots, refuse, mimeOf, cleanName } from './index.mjs'

export function gitStore(root = process.cwd()) {
  const abs = (rel) => {
    const p = path.resolve(root, String(rel || ''))
    if (p !== root && !p.startsWith(root + path.sep)) throw Object.assign(new Error('bad path'), { code: 400 })
    return p
  }
  const store = {
    /* NO `drafts` BOOLEAN HERE. There is a `drafts()` method below, and a property of the same
       name would be shadowed by it — which is exactly what happened: `drafts: false` sat here while
       `store.drafts` was a truthy function, so every `if (store.drafts)` took the cloud branch on a
       checkout. Ask `kind` to tell the two stores apart. */
    kind: 'git', root,
    abs,
    async readLive(rel) { return store.read(rel) },
    /* every file under a directory with its text (the rows' shape: one text, no draft) */
    async texts(dir) { const out = []; for (const rel of await store.list(dir, { ext: '', deep: true })) { const file = dir.replace(/\/$/, '') + '/' + rel; const t = await store.read(file); if (t != null) out.push({ file, texts: [t] }) } return out },
    async drafts() { return [] },
    async publish() { return [] },
    async keep() {},
    async read(rel) { try { return await fs.readFile(abs(rel), 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e } },
    async write(rel, text) { const f = abs(rel); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, text, 'utf8') },
    async exists(rel) { try { await fs.access(abs(rel)); return true } catch { return false } },
    async remove(rel) { try { await fs.unlink(abs(rel)) } catch (e) { if (e.code !== 'ENOENT') throw e } },
    async rename(from, to) { const t = abs(to); if (fsSync.existsSync(t)) throw Object.assign(new Error('an entry with that slug exists'), { code: 409 }); await fs.mkdir(path.dirname(t), { recursive: true }); await fs.rename(abs(from), t) },
    async list(dir, { ext = 'md', deep = false } = {}) {
      const walk = (d, base) => {
        let entries = []
        try { entries = fsSync.readdirSync(d, { withFileTypes: true }) } catch { return [] }
        const out = []
        for (const e of entries) {
          const rel = base ? base + '/' + e.name : e.name
          if (e.isDirectory()) { if (deep) out.push(...walk(path.join(d, e.name), rel)) }
          else if (!ext || e.name.endsWith('.' + ext)) out.push(ext ? rel.slice(0, -(ext.length + 1)) : rel)
        }
        return out
      }
      return walk(abs(dir), '').sort()
    },
    async dirs(dir) { try { return fsSync.readdirSync(abs(dir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() } catch { return [] } },
    async getAsset(rel) { try { return new Uint8Array(await fs.readFile(abs(rel))) } catch (e) { if (e.code === 'ENOENT') return null; throw e } },
    async putAsset(rel, bytes) { const f = abs(rel); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, bytes) },
    async removeAsset(rel) { return this.remove(rel) },
    /* an asset's address on the site: a file under public/ is served at its path; one under content/uploads at /uploads */
    assetUrl(rel) { const p = String(rel).replace(/\\/g, '/'); return p.startsWith('public/') ? '/' + p.slice(7) : p.startsWith('content/uploads/') ? '/uploads/' + p.slice(16) : '/' + p },
    /* the library's browse: the two roots on disk */
    assets: {
      async list(dir) {
        const d = guard(dir); const a = abs(d)
        let entries = []
        try { entries = fsSync.readdirSync(a, { withFileTypes: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
        const out = []
        for (const e of entries) {
          if (e.name.startsWith('.')) continue
          const rel = d + '/' + e.name, st = fsSync.statSync(path.join(a, e.name))
          out.push(e.isDirectory() ? { path: rel, name: e.name, type: 'dir', size: null, modified: st.mtimeMs, mime: null, url: null } : { path: rel, name: e.name, type: 'file', size: st.size, modified: st.mtimeMs, mime: mimeOf(e.name), url: store.assetUrl(rel) })
        }
        return out.sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === 'dir' ? -1 : 1))
      },
      async mkdir(dir) { const d = guard(dir); cleanName(d.split('/').pop()); await fs.mkdir(abs(d), { recursive: true }) },
      async rename(from, name) { const f = guard(from); const to = f.split('/').slice(0, -1).concat(cleanName(name)).join('/'); if (fsSync.existsSync(abs(to))) throw refuse('a file with that name is there already', 409); await fs.rename(abs(f), abs(to)); return to },
      async move(from, toDir) { const f = guard(from), d = guard(toDir); const to = d + '/' + f.split('/').pop(); if (to === f) return to; if (fsSync.existsSync(abs(to))) throw refuse('a file with that name is there already', 409); await fs.mkdir(abs(d), { recursive: true }); await fs.rename(abs(f), abs(to)); return to },
      async copy(from, toDir) { const f = guard(from), d = guard(toDir); let to = d + '/' + f.split('/').pop(); if (fsSync.existsSync(abs(to))) { const n = f.split('/').pop(), i = n.lastIndexOf('.'); to = d + '/' + (i > 0 ? n.slice(0, i) + '-copy' + n.slice(i) : n + '-copy') } await fs.mkdir(abs(d), { recursive: true }); await fs.cp(abs(f), abs(to), { recursive: true }); return to },
      async remove(rel) { const f = guard(rel); if (f === 'content/uploads' || f === 'public') throw refuse('a root is not removed'); await fs.rm(abs(f), { recursive: true, force: true }) },
      async search(dir, q, deep = true) {
        const d = guard(dir), needle = String(q || '').toLowerCase()
        const out = []
        const walk = async (rel) => { for (const e of await store.assets.list(rel)) { if (e.name.toLowerCase().includes(needle)) out.push(e); if (deep && e.type === 'dir') await walk(e.path) } }
        await walk(d); return out
      },
    },
  }
  const guard = (rel) => { const p = insideRoots(rel); if (!p) throw refuse('not a path the library reaches'); return p }
  return store
}
