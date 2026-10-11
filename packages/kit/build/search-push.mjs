/*
 * THE SEARCH INDEX, PROJECTED — the same rows the palette searches in the browser, put where the
 * server can ask them (public.content_search, schemas/13-search.sql).
 *
 * The rows are built by the one shared grammar, src/lib/search-rows.js, so what a bot finds and
 * what a reader finds are the same documents described the same way. The vectors are not pushed:
 * Postgres ranks these lexically and the browser keeps the semantic half.
 *
 * One way, and the files own it: a row no collection has any more is removed. Nothing unpublished
 * is ever here, because nothing unpublished reaches velite's output in the first place.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { searchRows } from '../src/lib/search-rows.js'
import { projectSearch } from './search-db.mjs'
import { supabaseUrl, serviceKey } from './tts/storage.mjs'

/*
 * WHAT GOES IN, which is not everything a site publishes.
 *
 * The library by default — books, articles, wiki, docs — because those are what a site publishes
 * for people to READ, so a bot quoting one is quoting what the reader could already find.
 *
 * Landing pages and products are deliberately out. A page is a sales surface with experiments
 * running on it, and a bot has no business reading one variant at somebody who is not in it; a
 * product's price belongs to the catalog, which knows about currency and tiers, rather than to a
 * text search that would quote a number out of the middle of a paragraph.
 *
 * A site's own models are opt-in, named by a bot's `searches:`, and may hide fields. The index
 * holds the UNION of what every published bot may search, and each row carries its kind — the
 * filtering per bot happens at the question (search_content takes the kinds), because one index
 * serving several bots is simpler than an index per bot.
 */
export function rowsFrom(root = process.cwd(), { models = [] } = {}) {
  const dir = path.join(root, '.velite')
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return [] } }
  const rows = searchRows({
    articles: read('articles.json'), wiki: read('wiki.json'), docs: read('docs.json'),
    books: read('books.json'),
  })
  /* and a site's own, one kind per model, with whatever fields the bot's file hides left out */
  for (const { model, except } of models) {
    const hide = new Set([...(except || []), 'id', 'slug', 'published', 'body', 'raw'])
    for (const e of read(model + '.json')) {
      const said = Object.entries(e)
        .filter(([k, v]) => !hide.has(k) && (typeof v === 'string' || typeof v === 'number'))
        .map(([, v]) => String(v)).join(' ')
      const text = (said + ' ' + (hide.has('body') ? '' : String(e.body || ''))).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (!text) continue
      rows.push({ kind: model, id: String(e.id || e.slug || ''), title: e.title || String(e.id || ''),
        sub: e.description || '', href: '/' + model + '/' + (e.id || e.slug || ''),
        image: null, date: null, tags: e.tags || [], text, quote: text, canAccess: e.canAccess || [] })
    }
  }
  return rows
}

/* every model any published bot may search, and the fields none of them may see */
export async function modelsWanted(root = process.cwd(), store) {
  const { compileBots } = await import('./bots.mjs')
  const { bots } = await compileBots({ root, store, write: false })
  const want = new Map()
  for (const b of bots) for (const s of b.searches || []) {
    const had = want.get(s.model)
    /* a field is hidden only if EVERY bot that searches the model hides it — one bot's exclusion
       is not another's, and the filtering per bot is done at the question */
    want.set(s.model, had ? had.filter((f) => (s.except || []).includes(f)) : [...(s.except || [])])
  }
  return [...want].map(([model, except]) => ({ model, except }))
}

/* the cap, the row shape and the write live in build/search-db.mjs, which has no filesystem in it
   so the admin's pipe can carry it: the same index, whether the collections came from .velite on a
   machine or from the content rows on a publish */

export async function pushSearch({ root = process.cwd(), log = console.log } = {}) {
  const url = supabaseUrl()
  const key = serviceKey()
  if (!url || !key) { log('search: no database to push to'); return { pushed: 0 } }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const rows = rowsFrom(root, { models: await modelsWanted(root) })
  if (!rows.length) { log('search: no compiled content to index'); return { pushed: 0 } }
  return projectSearch({ rows, db, log })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  pushSearch().then((r) => process.exit(r.error ? 1 : 0))
}
