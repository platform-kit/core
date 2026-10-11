/*
 * Every public address the site has, from the compiled content: the landing
 * pages, the library and each piece in it, the store and each product and
 * collection. The prerender walks this list and the sitemap is written from it.
 * The instrument (/app), the admin and the dev-only pages are not here.
 */
import { pages, articles, wiki, docs, books, products, collections, storefront, forms, models, entriesOf } from './content-node.mjs'
import { printOffer, PAGE_ID } from '../src/lib/print-offers.js'
import { loadSite } from './site.mjs'

/* the site's own pages (platformkit.config.js routes), each prerendered unless it says prerender: false;
   the store as the bundle reads it (router.js STORE_ON): the module's switch */
const SITE = await loadSite()
export const STORE_ON = SITE.modules.store !== false
/* the library's kinds as modules, and the docs-only site, as the bundle reads them (src/lib/router.js) */
const M = SITE.modules
const ON = { articles: M.articles !== false, books: M.books !== false, wiki: M.wiki !== false, docs: M.docs !== false }
const ACCOUNTS_ON = ['store', 'memberships', 'sessions', 'coaching', 'support', 'instrument', 'recommendations'].some((m) => M[m] !== false)
export const DOCS_ONLY = ON.docs && !ON.articles && !ON.books && !ON.wiki && !ACCOUNTS_ON
export const FORMS_ON = M.forms !== false
export const MODELS_ON = M.models !== false


export function publicRoutes() {
  const r = new Set(['/'])
  if (DOCS_ONLY) { r.add('/docs'); for (const d of docs || []) r.add('/docs/' + d.id) }
  else {
    r.add('/content')
    for (const k of ['articles', 'wiki', 'docs', 'books']) if (ON[k]) r.add('/content/' + k)
    if (ON.articles) for (const a of articles || []) r.add('/content/articles/' + a.id)
    if (ON.wiki) for (const w of wiki || []) r.add('/content/wiki/' + w.id)
    if (ON.docs) for (const d of docs || []) r.add('/content/docs/' + d.id)
    if (ON.books) for (const b of books || []) if (b.published !== false && (b.slug || b.id)) r.add('/content/books/' + (b.slug || b.id))   /* a book goes by its slug */
  }
  for (const p of pages || []) r.add(p.route || '/')
  /* every published form's own page (the document and its model are written beside it by the prerender) */
  if (FORMS_ON) for (const f of forms || []) if (f.published !== false) r.add('/form/' + f.slug)
  /* a content model with pages on: its index and a page per published entry (the unpublished never reach .velite) */
  if (MODELS_ON) for (const m of models || []) if (m.deliver && m.deliver.pages) { r.add('/c/' + m.key); const list = entriesOf(m.key); for (const e of Array.isArray(list) ? list : [list]) if (e && e.slug) r.add('/c/' + m.key + '/' + e.slug) }
  for (const x of SITE.routes || []) if (x.prerender !== false) r.add(x.path)
  if (STORE_ON) {
    r.add('/store'); r.add('/store/collections')
    /* the unlocks' pages while the store offers the book online; a book in print has its own page,
       the store's page for it when the book online is off (the same rule as src/lib/storefront.js) */
    const online = !(storefront && storefront.showOnline === false)
    for (const p of products || []) if (online || p.kind !== 'book') r.add('/store/products/' + p.id)
    for (const b of books || []) if (b.published !== false && printOffer(b) && (!online || !(products || []).some((p) => p.kind === 'book' && p.book === b.slug))) r.add('/store/products/' + PAGE_ID(b.slug))
    for (const c of collections || []) r.add('/store/collections/' + c.id)
  }
  return [...r]
}
