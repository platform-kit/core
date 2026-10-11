/*
 * Cloud mode's live layer: before the app's modules are evaluated, the rows of public.content are loaded and
 * put into the bundled collections in place — `#content`'s arrays emptied and refilled, its single records
 * reassigned key by key — so every importer of `#content`, and every list a module makes of one at import
 * time, sees the content as the editors left it a moment ago, not as the last deploy built it. Anyone sees
 * the published rows; an administrator's session sees the drafts too (the table's policies). Each row goes
 * through the one adapter (lib/entry.js) with the shared renderer; the palette's rows are made again from
 * what was loaded, a built row keeping its vector while its words have not changed. In git mode, or when the
 * query fails or takes too long, nothing moves and the bundle stands as built — the site is never worse
 * than the last deploy. The prerendered html a crawler was served is the build's until the redeploy;
 * hydration replaces it.
 *
 *   load({ timeout }) → { rows, collections } | null      main.js awaits it before importing the app
 *   loaded                                                  what the last load did, for the preview and the admin
 *   previewEntry(col, name, { data, content })              a draft as the entry, made here (the dev server compiles one through velite instead)
 */
/* the switch read here rather than from router.js: that module makes its route lists of #content as it is
   evaluated, so it must come after the load, with the rest of the app */
const CLOUD = import.meta.env.CONTENT_STORE === 'cloud'
import * as CONTENT from '#content'
import { loadedCorpus } from './search-index.js'

export const loaded = { at: null, rows: 0, collections: [], error: null, editions: false }
const SINGLE = new Set(['site', 'storefront'])

export async function load({ timeout = 8000 } = {}) {
  if (!CLOUD) return null
  const { supabase, configured } = await import('./supabase.js')
  if (!configured || !supabase) return null
  const { renderer } = await import('./markdown.js')
  const { toEntry, targetOf } = await import('./entry.js')
  const { searchRows } = await import('./search-rows.js')
  let rows
  try {
    const q = supabase.from('content').select('collection, slug, path, published, data, body, text').is('deleted_at', null).order('path')
    const r = await Promise.race([q, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))])
    if (r.error) throw r.error
    rows = r.data || []
  } catch (e) { loaded.error = String(e.message || e); return null }
  /*
   * AND THE DERIVED JSONS THAT ARE ALSO ROWS. `content/store/print.json` carries every book's set
   * editions — their pages, their quotes, their cover art, the pictures of their pages — and it is
   * derived, so it has no collection and `apply` below would never look at it.
   *
   * It had to be said out loud because the consequence was silent: a book SET in a cloud-only admin
   * wrote its editions to the row, and the store went on pricing and drawing whatever the last build
   * knew — which in cloud mode is forever. The editions existed, were quoted, were orderable, and
   * were invisible. Nothing failed anywhere.
   */
  const idx = rows.find((r) => r.path === 'content/store/print.json')
  if (idx) { const { setEditions } = await import('./print-index.js'); if (setEditions(idx.text)) loaded.editions = true }
  return apply(rows, { renderer, toEntry, targetOf, searchRows })
}

/* the rows into the bundle: only the collections the bundle carries move; a collection with no row at all is left as built */
export function apply(rows, { renderer, toEntry, targetOf, searchRows }) {
  const R = renderer()
  const ctx = { render: (md) => R.parse(md), toc: (md) => R.toc(md), bundle: CONTENT, models: CONTENT.models }
  const by = {}
  for (const row of rows) {
    const target = targetOf(row)
    if (!target || !(target in CONTENT)) continue
    const entry = toEntry(target, row, ctx)
    if (!entry) continue
    if (entry.published === false) continue
    ;(by[target] = by[target] || []).push(entry)
  }
  /* a companion goes with its book, as velite's prepare says */
  if (by.companions && by.books) { const live = new Set(by.books.map((b) => b.slug)); by.companions = by.companions.filter((c) => live.has(c.book)) }
  for (const [target, list] of Object.entries(by)) {
    const cur = CONTENT[target]
    if (SINGLE.has(target) || (cur && !Array.isArray(cur))) { for (const k of Object.keys(cur)) delete cur[k]; Object.assign(cur, list[0]); continue }
    if (!Array.isArray(cur)) continue
    /* the strings: the theme's scopes stay as built, a site's file replaces its scope (a file removed in cloud mode keeps its words until the deploy) */
    if (target === 'ui') { for (const e of list) { const i = cur.findIndex((u) => u && u.scope === e.scope); if (i >= 0) cur.splice(i, 1, e); else cur.push(e) } continue }
    cur.length = 0; cur.push(...list)
  }
  /* the palette's rows again from what is live; a built row keeps its vector while its words are the same */
  /* only what has already been fetched: with no index in hand there is nothing of its to rewrite */
  const SEARCH = loadedCorpus()
  if (Array.isArray(SEARCH) && (by.articles || by.wiki || by.docs || by.books || by.products)) {
    const was = new Map(SEARCH.map((r) => [r.kind + ':' + r.id, r]))
    const next = searchRows({ articles: CONTENT.articles, wiki: CONTENT.wiki, docs: CONTENT.docs, books: CONTENT.books, products: CONTENT.products })
    for (const r of next) { const w = was.get(r.kind + ':' + r.id); if (w && w.text === r.text && w.vec) r.vec = w.vec }
    SEARCH.length = 0; SEARCH.push(...next)
  }
  Object.assign(loaded, { at: new Date().toISOString(), rows: rows.length, collections: Object.keys(by), error: null })
  return { rows: rows.length, collections: Object.keys(by) }
}

/* the admin's live preview in cloud mode: the draft through the same adapter, in the browser, no round trip */
export async function previewEntry(col, name, { data, content }) {
  const { renderer } = await import('./markdown.js')
  const { toEntry, pathOf } = await import('./entry.js')
  const R = renderer()
  const ctx = { render: (md) => R.parse(md), toc: (md) => R.toc(md), bundle: CONTENT, models: CONTENT.models }
  const path = pathOf(col, name || 'preview')
  const entry = toEntry(col, { path, collection: col, slug: name || 'preview', data: data || {}, body: content || '', text: content || '' }, ctx)
  return entry ? { entry } : { issues: [{ path: '', message: 'nothing to preview' }] }
}
