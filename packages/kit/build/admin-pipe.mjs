/*
 * The admin's content API as one function of a request — no server in it, no Node in it — so the dev server's
 * middleware (admin-server.mjs) and the `admin` Edge Function of cloud mode answer the same calls with the same
 * pipe (build/models) over the store they are given (the checkout, or the rows).
 *
 *   adminRequest(env, { method, seg, q, body })  →  { status, body } | { status, bytes, type }
 *
 * env: { root, store, models() → the registry, describe, validateSections, by (who is saving), theme (the theme's
 * string scopes, where no manifest can be read), preview(rec, models) (a compile where one is possible: the dev
 * server's velite; the function answers the parsed record) }. The machine-bound routes — the enrichment runs, a
 * rendered print file streamed — are the dev server's own and not here.
 *
 *   GET    collections                every model: its fields, its parts, its count
 *   GET    list?col=                  every record of a model
 *   GET    file?col=&name=            one record
 *   POST   file                       { col, name, data, content, parsed, create?, check?, rename? } → the pipe
 *   DELETE file?col=&name=
 *   POST   preview                    { col, name, data, content } → the entry (or the record, where nothing compiles)
 *   GET    options?key=               an option list
 *   POST   action                     { col, action, name?, …payload } → the model's action
 *   POST   upload                     { col, filename, dataBase64 } → the model's upload folder; answers the file's address
 *   POST   upload-image               the body editor's images, content/uploads
 *   GET    asset?col=&file=           an asset
 *   GET    drafts                     every draft waiting to be published (cloud mode; empty from the checkout)
 *   POST   publish                    { col?, name?, message? } → one record's draft live, or every draft; the function pushes after
 *   POST   keep                       { path } → a draft removal called off
 *   POST   media                      { op, … } the library (media-library): list { dir } · mkdir { dir } · rename { path, name } ·
 *                                     move { path, to } · copy { path, to } · remove { path } · search { dir, q } · upload { dir, filename, dataBase64 }
 *   GET    media-file?path=           a file of the library, for the checkout's preview (cloud mode previews the bucket's url)
 */
import matter from 'gray-matter'
import { byKey, list, read, write, remove, rename, runAction, optionList, Refusal, compact, drafts, publish, publishAll, keep } from './models/index.mjs'
import { readModels, entryNames } from './model-io.mjs'
import { addressOf, assetUsage } from './assets.mjs'
import { insideRoots, cleanName as cleanEntryName, mimeOf as mimeOfName, refuse } from './store/index.mjs'
import { SOURCES, sourceOf, configuredSources, missingFor, assetName } from './images/index.js'

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', pdf: 'application/pdf' }
export const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'
const b64 = (s) => { const t = String(s || '').replace(/^data:[^;]+;base64,/, ''); const bin = atob(t); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out }
const cleanName = (filename) => String(filename || '').split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[-.]+/, '')

/* WHOSE PAGES THESE ARE.
 *
 * An editor edits the site's content. A COACH edits one thing: their own page. They are not an
 * editor and must not become one by being given the door — so the caller may arrive with a fence
 * (env.only = { col, field, value }), and while it is up the pipe answers for exactly one model and
 * exactly the records whose field carries their name.
 *
 * It is a fence and not a filter: the list is filtered, and every read, write, rename, delete and
 * publish is refused outright for a record that is not theirs. A surface that showed them only
 * their own rows would still leave every other row one hand-written request away. */
const fenced = (env, col) => {
  const o = env.only
  if (!o) return null
  if (String(col || '') !== o.col) throw new Refusal(403, 'not yours to edit')
  return o
}
export async function adminRequest(env, { method, seg, q, body }) {
  const { root, store } = env
  /* `editions` is how a caller with no machine sets a printed book: the Edge Function hands the
     print model a renderer and a way to fetch a rendered file, and where it is absent the model
     runs Typst itself (build/models/core/print.mjs) */
  const extra = { store, by: env.by, site: env.site, theme: env.theme, themeSkills: env.themeSkills, brand: env.brand, validateSections: env.validateSections, editions: env.editions }
  const models = () => env.models()
  const modelOf = async (col) => { const m = byKey(await models(), String(col || '')); if (!m) throw new Refusal(400, 'unknown collection'); return m }
  const get = (k) => (q && typeof q.get === 'function' ? q.get(k) : (q || {})[k])
  try {
    if (method === 'GET' && seg === 'collections') {
      const cols = {}
      for (const m of await models()) {
        /* a fenced caller is shown the one collection they may touch and no other: the rail is
           drawn from this, so a coach never sees a section they would be refused at */
        if (env.only && m.key !== env.only.col) continue
        cols[m.key] = await env.describe(m, root, store)
      }
      return { status: 200, body: { collections: cols } }
    }
    if (method === 'POST' && seg === 'preview') {
      const rec = body || {}
      if (env.preview) return env.preview(rec, await models())
      /* nothing compiles here: the record as the pipe reads it, for the frame to render through the site's own adapter */
      const m = await modelOf(rec.col)
      return { status: 200, body: { entry: { ...compact(rec.data || {}), body: rec.content || '', raw: rec.content || '', slug: String(rec.name || ''), path: m.dir + '/' + String(rec.name || '') + '.' + m.ext } } }
    }
    if (method === 'GET' && seg === 'list') {
      /* a plain listing is { items }; a model with a list of its own (print, the recommendations) answers in its own shape */
      const m = await modelOf(get('col')); const only = fenced(env, m.key)
      let r = await list(m, root, extra)
      if (only && Array.isArray(r)) r = r.filter((x) => String((x && (x[only.field] ?? (x.data && x.data[only.field]))) || '') === only.value)
      return { status: 200, body: Array.isArray(r) ? { items: r } : r }
    }
    if (seg === 'file') {
      if (method === 'GET') {
        const m = await modelOf(get('col')); const only = fenced(env, m.key)
        const rec = await read(m, get('name'), root, extra)
        if (only && String((rec && rec.data && rec.data[only.field]) || '') !== only.value) throw new Refusal(403, 'not yours to edit')
        return { status: 200, body: rec }
      }
      if (method === 'POST') {
        const { col, name, create, check, rename: to, ...rec } = body || {}
        const m = await modelOf(col); const only = fenced(env, m.key)
        if (only) {
          /* the record they are saving must be theirs, and must stay theirs: a record whose owner
             they changed on the way out is a record they no longer own */
          if (String((rec.data && rec.data[only.field]) || '') !== only.value) throw new Refusal(403, 'not yours to edit')
          if (!create) {
            const was = await read(m, name, root, extra)
            if (String((was && was.data && was.data[only.field]) || '') !== only.value) throw new Refusal(403, 'not yours to edit')
          }
        }
        if (to !== undefined) return { status: 200, body: await rename(m, name, to, root, extra) }
        return { status: 200, body: await write(m, name, rec, root, { ...extra, create: !!create, check: !!check }) }
      }
      if (method === 'DELETE') {
        const m = await modelOf(get('col')); const only = fenced(env, m.key)
        if (only) {
          const was = await read(m, get('name'), root, extra)
          if (String((was && was.data && was.data[only.field]) || '') !== only.value) throw new Refusal(403, 'not yours to edit')
        }
        return { status: 200, body: await remove(m, get('name'), root, extra) }
      }
    }
    if (seg === 'drafts' && method === 'GET') return { status: 200, body: { drafts: await drafts(await models(), root, extra), mode: store.kind === 'rows' ? 'cloud' : 'git' } }
    if (seg === 'publish' && method === 'POST') {
      const { col, name } = body || {}
      if (col) {
        const m = await modelOf(col); const only = fenced(env, m.key)
        if (only) {
          const was = await read(m, String(name || ''), root, extra)
          if (String((was && was.data && was.data[only.field]) || '') !== only.value) throw new Refusal(403, 'not yours to edit')
        }
        return { status: 200, body: await publish(m, String(name || ''), root, extra) }
      }
      /* "publish everything" is the site's act, not one person's */
      if (env.only) throw new Refusal(403, 'not yours to publish')
      return { status: 200, body: await publishAll(await models(), root, extra) }
    }
    /* ---- where else a picture can come from: the image sources (build/images) ----
     *
     * Three operations and no more. `sources` says which exist HERE, because a source with no
     * key must be absent rather than offered and then failing. `search` and `take` are the
     * source's own, called on the server so the key never reaches a browser.
     *
     * A chosen picture is put in the LIBRARY and the field is given an ordinary address: nothing
     * hotlinks, so a site keeps its pictures whatever happens to the account they came from, and
     * every rule about assets goes on working because there is nothing special about this one.
     */
    if (seg === 'images' && method === 'POST') {
      const { op, ...a } = body || {}
      if (op === 'sources') return { status: 200, body: { sources: configuredSources(process.env) } }

      const src = sourceOf(String(a.source || ''))
      if (!src) throw refuse('no such image source')
      const missing = missingFor(src.key, process.env)
      if (missing.length) throw refuse(`${src.key} is not configured here — ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set`)

      if (op === 'search') {
        const got = await src.search(String(a.q || ''), { page: Number(a.page) || 1, perPage: Number(a.perPage) || 24, orientation: a.orientation || '', env: process.env })
        if (got.error) throw refuse(got.error)
        return { status: 200, body: got }
      }

      if (op === 'take') {
        const result = a.result || {}
        if (!result.id) throw refuse('no picture was chosen')
        const { bytes, type, credit } = await src.take(result, { env: process.env })
        /* into the library, under the folder the field asked for, never beside a record */
        const d = insideRoots(a.dir || 'content/uploads')
        if (!d) throw refuse('not a path the library reaches')
        /* the library entry as the picker's own list reads it, so the field is handed exactly what
           Choose from the library would have handed it */
        const found = async (rel) => (await store.assets.list(rel.split('/').slice(0, -1).join('/'))).find((e) => e.path === rel) || null
        const name = assetName(src.key, result, type)
        const taken = new Set((await store.assets.list(d)).map((e) => e.name))
        /* the same picture chosen twice is the same file: hand back what is already there */
        if (!taken.has(name)) await store.putAsset(d + '/' + name, bytes, type)
        return { status: 200, body: { path: d + '/' + name, entry: await found(d + '/' + name), credit, reused: taken.has(name) } }
      }
      return { status: 400, body: { error: 'unknown image op' } }
    }

    /* ---- the library: the two roots through the store's browse; every path checked before the store looks ---- */
    if (seg === 'media' && method === 'POST') {
      const { op, ...a } = body || {}
      const A = store.assets
      const dir = (d) => { const p = insideRoots(d); if (!p) throw refuse('not a path the library reaches'); return p }
      const entry = async (rel) => (await A.list(rel.split('/').slice(0, -1).join('/'))).find((e) => e.path === rel) || null
      /* a file in use is kept: before a removal, a rename or a move, the records that name it (a folder: any file
         under it) — one found refuses the whole request with them, and nothing is written */
      const kept = async (paths) => { const used = await assetUsage(store, paths.map(dir)); if (Object.keys(used).length) throw Object.assign(new Error('in use'), { code: 409, extra: { used } }) }
      switch (String(op || '')) {
        case 'usage': return { status: 200, body: { usage: await assetUsage(store, [].concat(a.paths || a.path || []).map(dir)) } }
        case 'list': return { status: 200, body: { dir: dir(a.dir), files: await A.list(dir(a.dir)) } }
        case 'mkdir': { const d = dir(a.dir) + '/' + cleanEntryName(a.name); await A.mkdir(d); return { status: 200, body: { path: d } } }
        case 'rename': { await kept([a.path]); const to = await A.rename(dir(a.path), a.name); return { status: 200, body: { path: to, entry: await entry(to) } } }
        case 'move': { const out = []; await kept([].concat(a.paths || a.path || [])); for (const f of [].concat(a.paths || a.path || [])) out.push(await A.move(dir(f), dir(a.to))); return { status: 200, body: { paths: out } } }
        case 'copy': { const out = []; for (const f of [].concat(a.paths || a.path || [])) out.push(await A.copy(dir(f), dir(a.to))); return { status: 200, body: { paths: out } } }
        case 'remove': { await kept([].concat(a.paths || a.path || [])); for (const f of [].concat(a.paths || a.path || [])) await A.remove(dir(f)); return { status: 200, body: { ok: true } } }
        case 'search': return { status: 200, body: { files: await A.search(dir(a.dir), String(a.q || ''), a.deep !== false) } }
        case 'upload': {
          const d = dir(a.dir), clean = cleanName(a.filename)
          if (!clean || !/\.[a-z0-9]+$/i.test(clean)) return { status: 400, body: { error: 'bad filename' } }
          const taken = new Set((await A.list(d)).map((e) => e.name))
          const dot = clean.lastIndexOf('.'); const ext = clean.slice(dot), stem = clean.slice(0, dot)
          let name = clean, n = 1
          while (taken.has(name)) name = `${stem}-${n++}${ext}`
          await store.putAsset(d + '/' + name, b64(a.dataBase64), mimeOfName(name))
          return { status: 200, body: { path: d + '/' + name, entry: await entry(d + '/' + name) } }
        }
        default: return { status: 400, body: { error: 'unknown media op' } }
      }
    }
    if (seg === 'media-file' && method === 'GET') {
      const p = insideRoots(get('path')); if (!p) return { status: 400, body: { error: 'not a path the library reaches' } }
      const bytes = await store.getAsset(p)
      if (!bytes) return { status: 404, body: { error: 'no such file' } }
      return { status: 200, bytes, type: mimeOfName(p) }
    }
    if (seg === 'keep' && method === 'POST') return { status: 200, body: await keep(await models(), String((body || {}).path || ''), root, extra) }
    if (seg === 'action') {
      const payload = method === 'GET' ? Object.fromEntries(q.entries ? q.entries() : Object.entries(q || {})) : (body || {})
      const m = await modelOf(payload.col)
      if (env.refuseActions && env.refuseActions(m, String(payload.action || ''))) throw new Refusal(409, env.refuseActions(m, String(payload.action || '')))
      const out = await runAction(m, String(payload.action || ''), payload, root, { ...extra, name: payload.name })
      if (out && out.stream) return { status: 200, stream: out }
      /* the bytes of a file, where the action had no disk to stream from (the print's PDFs in the
         cloud): carried beside the answer rather than inside it, so nothing tries to JSON them */
      if (out && out.bytes) return { status: 200, bytes: out.bytes, type: out.type }
      return { status: 200, body: out }
    }
    /* ---- option lists for constrained selects: a model's own, or a custom model's entries by slug and title ---- */
    if (seg === 'options' && method === 'GET') {
      const key = get('key') || ''
      if (key.startsWith('model:')) {
        const mk = key.slice(6)
        const x = (await readModels(store)).find((m) => m.name === mk && m.model)
        if (!x) return { status: 404, body: { error: 'no such model' } }
        const out = []
        for (const name of await entryNames(store, mk)) { const fm = matter(await store.read('content/models/' + mk + '/' + name + '.md')); out.push({ value: name, label: String(fm.data[x.model.title] || name) }) }
        return { status: 200, body: { options: out.sort((a, b) => a.label.localeCompare(b.label)) } }
      }
      if (key === 'books') {
        const out = []
        for (const name of await store.list('content/books', { deep: true })) { const fm = matter(await store.read('content/books/' + name + '.md')); out.push({ value: name, label: fm.data.title || name }) }
        return { status: 200, body: { options: out.sort((a, b) => a.label.localeCompare(b.label)) } }
      }
      if (key === 'sessions') {
        const out = []
        for (const name of await store.list('content/sessions')) { const fm = matter(await store.read('content/sessions/' + name + '.md')); if (fm.data.published !== false) out.push({ value: name.replace(/\.md$/, ''), label: fm.data.title || name }) }
        return { status: 200, body: { options: out.sort((a, b) => a.label.localeCompare(b.label)) } }
      }
      if (key === 'areas') { const { areaListOf } = await import('./quiz-io.mjs'); return { status: 200, body: { options: (await areaListOf(store)).map((a) => ({ value: a.key, label: a.title })) } } }
      if (key === 'concepts') {
        const { parseStrings } = await import('./strings-admin.mjs')
        const raw = (await store.read('content/app/ui/concepts.md')) || ''
        const listOf = parseStrings(raw).groups.list || {}
        return { status: 200, body: { options: Object.entries(listOf).map(([slug, f]) => ({ value: slug, label: f.name || slug })) } }
      }
      return { status: 200, body: { options: await optionList(await models(), key, root, extra) } }
    }
    /* ---- file uploads (cover images and the like), into the model's asset store ---- */
    if (seg === 'upload' && method === 'POST') {
      const { col, filename, dataBase64 } = body || {}
      const a = (await modelOf(col)).assets
      if (!a) return { status: 400, body: { error: 'this collection has no asset store' } }
      const clean = cleanName(filename)
      if (!clean || !/\.[a-z0-9]+$/i.test(clean)) return { status: 400, body: { error: 'bad filename' } }
      /* a name already there is not written over: the upload takes the next free one */
      const taken = new Set(await store.list(a.dir, { ext: '' }))
      const dot = clean.lastIndexOf('.'); const ext = clean.slice(dot), stem = clean.slice(0, dot)
      let name = clean, n = 1
      while (taken.has(name)) name = `${stem}-${n++}${ext}`
      await store.putAsset(a.dir + '/' + name, b64(dataBase64), mimeOf(name))
      /* the field holds an address: the served one from the checkout, the bucket's own from the rows */
      const path = store.kind === 'git' ? addressOf(a.dir + '/' + name) : store.assetUrl(a.dir + '/' + name)
      return { status: 200, body: { path, file: name } }
    }
    /* ---- body-image uploads: the TipTap image button drops files here. They live in content/uploads and are referenced
       by an absolute path — /uploads/<file> from the checkout, the bucket's url in cloud mode ---- */
    if (seg === 'upload-image' && method === 'POST') {
      const { filename, dataBase64 } = body || {}
      const clean = cleanName(filename)
      if (!clean || !/\.[a-z0-9]+$/i.test(clean)) return { status: 400, body: { error: 'bad filename' } }
      const dot = clean.lastIndexOf('.'); const ext = clean.slice(dot), stem = clean.slice(0, dot)
      const taken = new Set(await store.list('content/uploads', { ext: '' }))
      let name = clean, n = 1
      while (taken.has(name)) name = `${stem}-${n++}${ext}`
      await store.putAsset('content/uploads/' + name, b64(dataBase64), mimeOf(name))
      return { status: 200, body: { path: store.kind === 'git' ? addressOf('content/uploads/' + name) : store.assetUrl('content/uploads/' + name) } }
    }
    /* ---- an asset for the preview ---- */
    if (seg === 'asset' && method === 'GET') {
      const a = (await modelOf(get('col'))).assets
      if (!a) return { status: 404, body: { error: 'no assets' } }
      const rel = (get('file') || '').replace(/^\.?\//, '')
      if (!rel || rel.includes('..')) return { status: 400, body: { error: 'bad path' } }
      const bytes = await store.getAsset(a.dir + '/' + rel)
      if (!bytes) return { status: 404, body: { error: 'no such asset' } }
      return { status: 200, bytes, type: mimeOf(rel) }
    }
    return { status: 404, body: { error: 'not found' } }
  } catch (e) {
    return { status: e.code && e.code < 600 ? e.code : 500, body: { error: String(e.message || e), ...(e.extra || {}) } }
  }
}
