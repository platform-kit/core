/*
 * THE SEARCH INDEX, MADE FROM THE ROWS — the half that needs a database and not a disk.
 *
 * content_search is the index a bot asks. On a machine it is built from `.velite`, which is the
 * compiled content; in a deployment where nothing rebuilds there is no `.velite` and never will be
 * again, so the index the deployment shipped with is the last one it will ever have. An article
 * published there is invisible to every bot that searches, and nothing says so.
 *
 * So the collections are rebuilt here from `public.content` through the SAME adapter the browser
 * uses in cloud mode — `src/lib/entry.js`, which is what turns a row into the entry velite would
 * have made — and the rows handed to the same pure `searchRows` the build uses. One grammar, two
 * sources, and `build/entry.test.mjs` already pins the adapter against velite field for field.
 *
 * Nothing here opens a file, so the admin's pipe can carry it and a publish can run it.
 */
import { searchRows } from '../src/lib/search-rows.js'
import { renderer } from '../src/lib/markdown.js'

/* the collections the index is drawn from, and nothing else — a landing page is a sales surface
   with experiments running on it, and a product's price belongs to the catalog (see search-push) */
export const INDEXED = ['articles', 'wiki', 'docs', 'books']

/* every published entry of those collections, rebuilt from the rows */
export async function collectionsFrom(store, { renderer } = {}) {
  const db = store && store.client
  if (!db) return {}
  const { toEntry, targetOf } = await import('../src/lib/entry.js')
  const { data, error } = await db.from('content')
    .select('collection, slug, path, published, data, body, text')
    .is('deleted_at', null).order('path')
  if (error) throw error
  const R = renderer ? renderer() : null
  const ctx = { render: (md) => (R ? R.parse(md) : String(md || '')), toc: () => [], bundle: {}, models: [] }
  const by = {}
  for (const row of data || []) {
    const target = targetOf(row)
    if (!target || !INDEXED.includes(target)) continue
    let entry = null
    try { entry = toEntry(target, row, ctx) } catch (error) {
      throw new Error(`search: could not adapt ${row.path}: ${error.message}`)
    }
    if (!entry || entry.published === false) continue
    ;(by[target] = by[target] || []).push(entry)
  }
  return by
}

/* a document's body is what a search matches on, and it is the whole of it — but a book is a
   hundred thousand words and a tsvector has a megabyte to live in, so it is capped. The cap is
   generous enough that the cut is never what somebody was looking for. */
export const BODY_MAX = 200_000

/* the rows as the table takes them — the one shape, whichever side built the collections */
export function indexRows(rows) {
  const now = new Date().toISOString()
  return rows.map((r) => ({
    kind: r.kind, ref: String(r.id),
    title: r.title || String(r.id), sub: r.sub || '', href: r.href,
    image: r.image || null, date: r.date || null,
    tags: r.tags || [], tag_text: (r.tags || []).join(' '),
    /* the bar the record already declares (lib/access.js): a MINIMUM rung on the class ladder,
       empty meaning everyone. The same field the reader's own page is gated by. */
    access: r.canAccess || [],
    body: String(r.text || '').slice(0, BODY_MAX),
    /* what may be shown back. For a book that is its description and nothing else: see
       FREE_TO_QUOTE in lib/search-rows.js for why the two are not the same column. */
    quote: String(r.quote == null ? r.text : r.quote).slice(0, BODY_MAX),
    updated_at: now,
  }))
}

/* the index, written. One way: whatever the content no longer holds is removed. */
export async function projectSearch({ rows, db, log = () => {} } = {}) {
  const want = indexRows(rows || [])
  if (!want.length) { log('search: nothing to index'); return { pushed: 0 } }
  const { error } = await db.from('content_search').upsert(want, { onConflict: 'kind,ref' })
  if (error) throw new Error(`search: could not index documents: ${error.message}`)
  const { data: had, error: hadError } = await db.from('content_search').select('id, kind, ref')
  if (hadError) throw new Error(`search: could not read existing documents: ${hadError.message}`)
  if (!Array.isArray(had)) throw new Error('search: could not read existing documents: expected a row list')
  const keep = new Set(want.map((r) => r.kind + '\u0000' + r.ref))
  const gone = had.filter((r) => !keep.has(r.kind + '\u0000' + r.ref))
  if (gone.length) {
    const { error: deleteError } = await db.from('content_search').delete().in('id', gone.map((r) => r.id))
    if (deleteError) throw new Error(`search: could not remove stale documents: ${deleteError.message}`)
  }
  log(`search: ${want.length} documents indexed${gone.length ? `, ${gone.length} gone` : ''}`)
  return { pushed: want.length, gone: gone.length }
}

/* the whole of it, from a rows store: rebuild the collections, make the rows, write the index */
export async function projectSearchFromStore(store, { log = () => {} } = {}) {
  const db = store && store.client
  if (!db) return { pushed: 0 }
  const by = await collectionsFrom(store, { renderer })
  return projectSearch({ rows: searchRows(by), db, log })
}
