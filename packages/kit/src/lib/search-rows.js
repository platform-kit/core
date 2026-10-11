/*
 * The palette's index, one row per document — an article, a wiki page, a doc, a book, a product — from the
 * collections as the site reads them. The build makes them (build/embed-content.mjs) and embeds each; in cloud
 * mode the browser makes them again from the rows it loaded (lib/content-live.js), without a vector, so a page
 * saved a moment ago is found by its words until the deploy embeds it.
 */
/*
 * Some kinds are in the index for the SERVER to search — a bot asked what the site offers — and are
 * noise in a reader's palette, where a landing page called "Home" matches every other word. They
 * are in a search only when it is narrowed to that kind.
 */
export const OFF_PALETTE = ['product', 'page']

/*
 * WHAT MAY BE QUOTED BACK, which is not the same as what may be SEARCHED.
 *
 * A row carries two texts. `text` is what a search MATCHES on — everything the document says,
 * including the whole of a book. `quote` is what may be shown to whoever asked: a fragment, an
 * excerpt, a snippet in a bot's answer.
 *
 * For most kinds they are the same thing, because the document is free to read. For a BOOK they are
 * emphatically not: the body is the product. A reader pays to open it, the reader app gives away a
 * few chapters and gates the rest, and an index that will hand back forty words of any book for any
 * query is a way of reading the whole library for nothing — one search at a time, by anybody, with
 * no account. So a book matches on its full text and quotes only its description.
 *
 * The rule lives here, with the rows, rather than in whatever happens to be doing the searching:
 * the server's index (build/search-push.mjs) and the browser's palette read the same fact, and a
 * new kind of content has to say which it is.
 */
export const FREE_TO_QUOTE = { article: true, wiki: true, doc: true, page: true, product: true, book: false }
export const quotable = (kind) => FREE_TO_QUOTE[kind] !== false
export const offPalette = (rows, kind) =>
  (OFF_PALETTE.includes(kind) ? rows : rows.filter((r) => !OFF_PALETTE.includes(r.kind)))

const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const day = (d) => (d ? String(d).slice(0, 10) : null)

/*
 * A LANDING PAGE'S WORDS live in its sections' props, nested, as strings among numbers, booleans
 * and arrays of more of the same. So they are harvested rather than read from a body: every string
 * anywhere under the props, in order, joined. A section's copy IS the page — a page called
 * "Pricing" whose words are all inside a LandingPricing block has no body at all, and without this
 * the one place a site says what it offers is the one place nothing can search.
 */
export function pageWords(sections = []) {
  const out = []
  const walk = (v) => {
    if (typeof v === 'string') { const s = v.trim(); if (s && !/^(https?:|\/|#|[a-z-]+$)/.test(s)) out.push(s); return }
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k]) }
  }
  for (const sec of sections || []) walk(sec && sec.props)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

export function searchRows({ articles = [], wiki = [], docs = [], books = [], products = [], pages = [] }) {
  const rows = []
  articles.forEach((a) => rows.push({ kind: 'article', id: a.id, title: a.title, sub: a.description || '',
    href: '/content/articles/' + a.id, image: a.image || null, date: day(a.date), tags: a.tags || [],
    text: (a.description || '') + ' ' + stripHtml(a.body),
    canAccess: a.canAccess || [] }))
  wiki.forEach((w) => rows.push({ kind: 'wiki', id: w.id, title: w.title, sub: w.description || '',
    href: '/content/wiki/' + w.id, image: null, date: null, tags: w.tags || [], text: stripHtml(w.body),
    canAccess: w.canAccess || [] }))
  docs.forEach((d) => rows.push({ kind: 'doc', id: d.id, title: d.title, sub: d.description || '',
    href: '/content/docs/' + d.id, image: null, date: null, tags: d.tags || [], text: stripHtml(d.body),
    canAccess: d.canAccess || [] }))
  /* a book matches on the whole of itself and quotes only what is on its cover — see FREE_TO_QUOTE */
  books.forEach((b) => rows.push({ kind: 'book', id: b.slug, title: b.title, sub: b.description || '',
    href: '/content/books/' + b.slug, image: b.cover || null, date: day(b.date), tags: b.tags || [],
    text: (b.raw || '').replace(/[#*_`>[\]]/g, ' ').replace(/\s+/g, ' '),
    quote: b.description || '',
    canAccess: b.canAccess || [] }))
  /* the store's products: in the index, but the palette leaves them out unless asked */
  products.forEach((p) => rows.push({ kind: 'product', id: p.id, title: p.title, sub: p.subtitle || '',
    href: '/store/products/' + p.id, image: p.image ? { src: p.image } : null, date: null, tags: p.tags || [],
    text: (p.subtitle || '') + ' ' + stripHtml(p.body),
    canAccess: p.canAccess || [] }))
  /* the landing pages: what the site says about itself, which is what somebody asking "what do you
     offer" is actually after. In the index, and — like the products — out of the palette's own
     results unless a search asks for them. */
  pages.forEach((p) => rows.push({ kind: 'page', id: p.id, title: p.title, sub: p.description || '',
    href: p.route || ('/' + p.id), image: null, date: null, tags: [],
    text: (p.description || '') + ' ' + pageWords(p.sections) + ' ' + stripHtml(p.body),
    canAccess: p.canAccess || [] }))
  /* everything else is free to read, so what it matches on is what it may say back */
  for (const r of rows) if (r.quote == null) r.quote = r.text
  return rows
}
