/*
 * Cloud mode: every markdown file a row of public.content — its path, collection, slug, published, the
 * frontmatter as JSON, the body, and the text exactly as the grammar wrote it — and every asset an object of
 * the public `content-assets` bucket under its path. A row is the LIVE version (text, data, body — what the site
 * reads, what the export writes, what the push sends); its DRAFT is a row of content_drafts beside it (the edit's
 * text, data and body, who and when; `deleted` for a removal not yet published), which no client can read. A
 * save writes the draft and never the live version; `read` answers the draft where there is one (the admin's view), `readLive` the live
 * version alone; `remove` is a draft removal on a row with a live version and a hard delete on one without;
 * `rename` a draft under the new path and a draft removal of the old; `publish` moves the drafts named into
 * the live columns — a removal into `deleted_at` — and marks the rows pending for the push, which clears them
 * once the repository has them (a published removal is gone then). Written with the service role (the `admin`
 * function is the door; there is no client write), read by the same. Plain JavaScript on supabase-js alone,
 * so the function (Deno) and a build script (Node) run this one file. `drafts: true` says the mode has them.
 * `onEvent`, when given, is told of every change — { kind: 'Entry' | 'Asset', topic: create | save | publish | unpublish |
 * delete, path, collection, slug, data, body, by } — after it is made and never before; the content webhooks
 * (content-management-api) hang off it. It is best-effort: a hook that throws changes nothing.
 */
import { createClient } from '@supabase/supabase-js'
import { insideRoots, refuse, mimeOf, cleanName } from './index.mjs'

const TABLE = 'content', DRAFTS = 'content_drafts', BUCKET = 'content-assets'
const norm = (rel) => String(rel || '').replace(/\\/g, '/').replace(/^\.?\//, '')
export function rowsStore({ url, key, client, by = '', onEvent = null } = {}) {
  const sb = client || createClient(url || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, key || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const now = () => new Date().toISOString()
  const emit = async (e) => { if (!onEvent) return; try { await onEvent(e) } catch (err) { console.warn('content event', String(err && err.message || err)) } }
  /* a row with its draft folded in (draft_text …, draft_deleted), as the rest of the store reads it */
  const fold = (r) => { if (!r) return null; const d = Array.isArray(r.content_drafts) ? r.content_drafts[0] : r.content_drafts; const { content_drafts, ...row } = r; return { ...row, draft_text: d ? d.text : null, draft_data: d ? d.data : null, draft_body: d ? d.body : null, draft_by: d ? d.by : null, draft_at: d ? d.at : null, draft_deleted: !!(d && d.deleted) } }
  const SEL = '*, content_drafts(text, data, body, by, at, deleted)'
  /* a row as the admin sees it: not deleted, not a draft removal */
  const one = async (rel) => { const { data, error } = await sb.from(TABLE).select(SEL).eq('path', norm(rel)).is('deleted_at', null).maybeSingle(); if (error) throw error; const r = fold(data); return r && !r.draft_deleted ? r : null }
  const draftOf = async (path) => { const { data, error } = await sb.from(DRAFTS).select('*').eq('path', path).maybeSingle(); if (error) throw error; return data }
  const store = {
    /* no `drafts` boolean: the method below shadows it, and a caller reading it as a flag gets a
       function. `kind` is what tells the stores apart (see the note in store/git.mjs). */
    kind: 'rows', root: '', client: sb,
    /* the admin's view: the draft where there is one, else the live version */
    async read(rel) { const r = await one(rel); return r ? (r.draft_text ?? r.text) : null },
    /* the live version alone: what the site shows and the export writes (null for a row never published) */
    async readLive(rel) { const { data, error } = await sb.from(TABLE).select('text').eq('path', norm(rel)).is('deleted_at', null).maybeSingle(); if (error) throw error; return data ? data.text : null },
    async row(rel) { return one(rel) },
    /* every record under a directory with the text it holds either way — the draft's and the live version's — in one
       query: what a scan of the content (a file in use) reads, never a query per record */
    async texts(dir) {
      const base = norm(dir).replace(/\/$/, '') + '/'
      const { data, error } = await sb.from(TABLE).select('path, text, content_drafts(text)').like('path', base + '%').is('deleted_at', null); if (error) throw error
      return (data || []).map((r) => { const d = Array.isArray(r.content_drafts) ? r.content_drafts[0] : r.content_drafts; return { file: r.path, texts: [d && d.text, r.text].filter((t) => t != null) } })
    },
    /* meta: what the pipe knows of the file — parsed data and body, the collection and slug, whether it is published.
       A save is a draft; `live: true` writes the live version outright (the export's seeding, pending or not as it says) */
    async write(rel, text, meta = {}) {
      const path = norm(rel)
      const who = meta.by || by || null
      const keys = { collection: meta.collection ?? null, slug: meta.slug ?? null, published: meta.published !== false }
      if (meta.live) {
        const row = { path, text, ...keys, data: meta.data ?? null, body: meta.body ?? null, sha: await sha1(text), pending: meta.pending !== false, deleted_at: null, updated_at: now(), updated_by: who, published_at: now() }
        const { error } = await sb.from(TABLE).upsert(row, { onConflict: 'path' }); if (error) throw error
        return
      }
      const { data: cur } = await sb.from(TABLE).select('path, collection, slug, published').eq('path', path).is('deleted_at', null).maybeSingle()
      /*
       * ON A ROW THAT EXISTS, ONLY WHAT THE CALLER ACTUALLY SAID.
       *
       * `keys` reads an absent `collection` as null and an absent `published` as true, which is right
       * for a row being made and wrong for one being edited: a caller that writes text and no meta —
       * the enrichment, writing a companion — then erases the classification of the record it saved
       * and republishes anything that was unpublished. The index every collection is read through is
       * (collection, slug), so the record stays in the table and disappears from the site: this was
       * found by a companion that vanished from its collection on a save that changed one field.
       */
      const given = {}
      if (meta.collection !== undefined) given.collection = meta.collection
      if (meta.slug !== undefined) given.slug = meta.slug
      if (meta.published !== undefined) given.published = meta.published !== false
      const { error } = cur
        ? await sb.from(TABLE).update({ ...given, updated_at: now(), updated_by: who }).eq('path', path)
        : await sb.from(TABLE).insert({ path, ...keys, text: null, pending: false, updated_at: now(), updated_by: who })   /* a first save: no live version yet */
      if (error) throw error
      const { error: e2 } = await sb.from(DRAFTS).upsert({ path, text, data: meta.data ?? null, body: meta.body ?? null, by: who, at: now(), deleted: false }, { onConflict: 'path' }); if (e2) throw e2
      await emit({ kind: 'Entry', topic: cur ? 'save' : 'create', path, collection: cur ? (given.collection ?? cur.collection) : keys.collection, slug: cur ? (given.slug ?? cur.slug) : keys.slug, data: meta.data ?? null, body: meta.body ?? null, by: who })
    },
    async exists(rel) { return !!(await one(rel)) },
    /* a removal: a draft on a row with a live version (undone by `keep`), gone at once on a row that never had one */
    async remove(rel) {
      const r = await one(rel); if (!r) return
      if (r.text == null) { const { error } = await sb.from(TABLE).delete().eq('path', r.path); if (error) throw error; await emit({ kind: 'Entry', topic: 'delete', path: r.path, collection: r.collection, slug: r.slug, data: r.draft_data ?? r.data ?? null, body: null, by: by || null }); return }
      const { error } = await sb.from(DRAFTS).upsert({ path: r.path, text: null, data: null, body: null, by: by || null, at: now(), deleted: true }, { onConflict: 'path' }); if (error) throw error
    },
    /* a draft removal called off: the row is as it was */
    async keep(rel) { const { error } = await sb.from(DRAFTS).delete().eq('path', norm(rel)).eq('deleted', true); if (error) throw error },
    async rename(from, to) {
      if (await store.exists(to)) throw Object.assign(new Error('an entry with that slug exists'), { code: 409 })
      const r = await one(from); if (!r) throw Object.assign(new Error('no such file'), { code: 404 })
      /* the new path as a draft of the admin's view, the old as a removal — both published together */
      await store.write(to, r.draft_text ?? r.text, { collection: r.collection, slug: r.slug ? norm(to).replace(/^.*\//, '').replace(/\.md$/, '') : r.slug, published: r.published, data: r.draft_data ?? r.data, body: r.draft_body ?? r.body })
      await store.remove(from)
    },
    /* every draft: what waits to be published, oldest first */
    async drafts() {
      const { data, error } = await sb.from(DRAFTS).select('path, data, by, at, deleted, content!inner(collection, slug, data, text, deleted_at)').is('content.deleted_at', null).order('at', { ascending: true }); if (error) throw error
      return (data || []).map((r) => { const c = Array.isArray(r.content) ? r.content[0] : r.content; return { path: r.path, collection: c.collection, slug: c.slug, title: String(((r.deleted ? c.data : r.data) || c.data || {}).title || c.slug || r.path), by: r.by, at: r.at, removed: !!r.deleted, fresh: c.text == null } })
    },
    /* the drafts named (or every one) into the live columns, pending for the push; returns what was published */
    async publish(paths = 'all') {
      const all = await store.drafts()
      const want = paths === 'all' ? all : all.filter((d) => paths.map(norm).includes(d.path))
      const out = []
      for (const d of want) {
        const dr = await draftOf(d.path); if (!dr) continue
        const patch = dr.deleted
          ? { deleted_at: now(), pending: true, updated_at: now(), updated_by: dr.by || by || null }
          : { text: dr.text, data: dr.data, body: dr.body, sha: await sha1(dr.text), pending: true, published_at: now(), updated_at: now(), updated_by: dr.by || by || null, push_error: null }
        const { error } = await sb.from(TABLE).update(patch).eq('path', d.path); if (error) throw error
        const { error: e3 } = await sb.from(DRAFTS).delete().eq('path', d.path); if (e3) throw e3
        out.push(d)
        const wasOff = dr.data && dr.data.published === false
        await emit({ kind: 'Entry', topic: dr.deleted ? 'delete' : wasOff ? 'unpublish' : 'publish', path: d.path, collection: d.collection, slug: d.slug, data: dr.deleted ? null : dr.data, body: dr.deleted ? null : dr.body, by: dr.by || by || null })
      }
      return out
    },
    async list(dir, { ext = 'md', deep = false } = {}) {
      const base = norm(dir).replace(/\/$/, '') + '/'
      const { data, error } = await sb.from(TABLE).select('path, content_drafts(deleted)').like('path', base + '%').is('deleted_at', null); if (error) throw error
      const out = []
      for (const r of data || []) {
        if (fold(r).draft_deleted) continue   /* a draft removal: off the admin's list */
        const { path } = r
        const rel = path.slice(base.length)
        if (!deep && rel.includes('/')) continue
        if (ext && !rel.endsWith('.' + ext)) continue
        out.push(ext ? rel.slice(0, -(ext.length + 1)) : rel)
      }
      return out.sort()
    },
    async dirs(dir) {
      const base = norm(dir).replace(/\/$/, '') + '/'
      const { data, error } = await sb.from(TABLE).select('path, content_drafts(deleted)').like('path', base + '%').is('deleted_at', null); if (error) throw error
      return [...new Set((data || []).filter((r) => !fold(r).draft_deleted).map(({ path }) => path.slice(base.length)).filter((r) => r.includes('/')).map((r) => r.split('/')[0]))].sort()
    },
    async getAsset(rel) { const { data, error } = await sb.storage.from(BUCKET).download(norm(rel)); if (error) return null; return new Uint8Array(await data.arrayBuffer()) },
    async putAsset(rel, bytes, type = 'application/octet-stream') { const { error } = await sb.storage.from(BUCKET).upload(norm(rel), bytes, { upsert: true, contentType: type }); if (error) throw error; await emit({ kind: 'Asset', topic: 'publish', path: norm(rel), by: by || null }) },
    async removeAsset(rel) { await sb.storage.from(BUCKET).remove([norm(rel)]); await emit({ kind: 'Asset', topic: 'delete', path: norm(rel), by: by || null }) },
    assetUrl(rel) { return sb.storage.from(BUCKET).getPublicUrl(norm(rel)).data.publicUrl },
    /* the library's browse: the bucket under the same two roots. A folder is a name (a prefix); an empty one is held by
       a .keep object, never listed; a folder moves, copies or goes object by object */
    assets: {
      async list(dir) {
        const d = guard(dir)
        const out = []
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await sb.storage.from(BUCKET).list(d, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }); if (error) throw error
          for (const o of data || []) {
            if (o.name.startsWith('.')) continue
            const rel = d + '/' + o.name
            if (o.id == null) out.push({ path: rel, name: o.name, type: 'dir', size: null, modified: o.updated_at ? Date.parse(o.updated_at) : null, mime: null, url: null })
            else out.push({ path: rel, name: o.name, type: 'file', size: (o.metadata && o.metadata.size) || null, modified: o.updated_at ? Date.parse(o.updated_at) : null, mime: (o.metadata && o.metadata.mimetype) || mimeOf(o.name), url: store.assetUrl(rel) })
          }
          if (!data || data.length < 1000) break
        }
        return out.sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === 'dir' ? -1 : 1))
      },
      async mkdir(dir) { const d = guard(dir); cleanName(d.split('/').pop()); const { error } = await sb.storage.from(BUCKET).upload(d + '/.keep', new Uint8Array(0), { upsert: true, contentType: 'application/octet-stream' }); if (error) throw error },
      async rename(from, name) { const f = guard(from); const to = f.split('/').slice(0, -1).concat(cleanName(name)).join('/'); await transfer(f, to, 'move'); return to },
      async move(from, toDir) { const f = guard(from), d = guard(toDir); const to = d + '/' + f.split('/').pop(); if (to !== f) await transfer(f, to, 'move'); return to },
      async copy(from, toDir) { const f = guard(from), d = guard(toDir); let to = d + '/' + f.split('/').pop(); if (await exists(to)) { const n = f.split('/').pop(), i = n.lastIndexOf('.'); to = d + '/' + (i > 0 ? n.slice(0, i) + '-copy' + n.slice(i) : n + '-copy') } await transfer(f, to, 'copy'); return to },
      async remove(rel) { const f = guard(rel); if (f === 'content/uploads' || f === 'public') throw refuse('a root is not removed'); const all = await under(f); if (all.length) { const { error } = await sb.storage.from(BUCKET).remove(all); if (error) throw error } },
      async search(dir, q, deep = true) {
        const d = guard(dir), needle = String(q || '').toLowerCase()
        const out = []
        const walk = async (rel) => { for (const e of await store.assets.list(rel)) { if (e.name.toLowerCase().includes(needle)) out.push(e); if (deep && e.type === 'dir') await walk(e.path) } }
        await walk(d); return out
      },
    },
  }
  const guard = (rel) => { const p = insideRoots(rel); if (!p) throw refuse('not a path the library reaches'); return p }
  const exists = async (rel) => { const d = rel.split('/').slice(0, -1).join('/'), n = rel.split('/').pop(); const { data } = await sb.storage.from(BUCKET).list(d, { search: n, limit: 100 }); return !!(data || []).some((o) => o.name === n) }
  /* every object under a path: the object itself, or everything under a folder (the .keep objects too) */
  const under = async (rel) => {
    const { data } = await sb.storage.from(BUCKET).list(rel.split('/').slice(0, -1).join('/'), { search: rel.split('/').pop(), limit: 100 })
    const me = (data || []).find((o) => o.name === rel.split('/').pop())
    if (!me) return []
    if (me.id != null) return [rel]
    const out = []
    const walk = async (d) => { for (let offset = 0; ; offset += 1000) { const { data: kids, error } = await sb.storage.from(BUCKET).list(d, { limit: 1000, offset }); if (error) throw error; for (const o of kids || []) { if (o.id == null) await walk(d + '/' + o.name); else out.push(d + '/' + o.name) } if (!kids || kids.length < 1000) break } }
    await walk(rel); return out
  }
  const transfer = async (from, to, how) => {
    if (await exists(to)) throw refuse('a file with that name is there already', 409)
    const all = await under(from)
    if (!all.length) throw refuse('no such file', 404)
    for (const src of all) {
      const dest = to + src.slice(from.length)
      const { error } = await sb.storage.from(BUCKET)[how](src, dest); if (error) throw error
    }
  }
  return store
}
async function sha1(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
