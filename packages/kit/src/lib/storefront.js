/*
 * The storefront's view of what it sells: the products and collections written
 * in content/store — title, copy, imagery, sizes, curation, AND the offer itself
 * (sku, price in dollars, once or a subscription with its period, a
 * membership's tier). The file is the source of truth; Stripe is made to match
 * it on deploy and at checkout (supabase/functions/_shared/offers.ts), so
 * nothing here waits on a network: the store renders the same with no Supabase
 * and no Stripe in the environment. Books borrow their cover from the books
 * collection. A book with a `print` block is a product too — one page for the book
 * in print, its formats (hardcover, casewrap, softcover, pdf, epub) the choice on it —
 * derived here from the book by src/lib/print-offers.js, the same rule build/catalog.mjs
 * uses, so the printed editions have no file of their own.
 */
import { ref, computed } from 'vue'
import { products as PRODUCTS, collections as COLLECTIONS, books as BOOKS, storefront as STOREFRONT, prices as PRICE_LISTS, promotions as PROMOS } from '#content'
import { printOffers, printSpec, coverFor, PRINTED } from './print-offers.js'
import { bookCoverOf } from './book-art.js'
import { us } from './content.js'
import { optionsOf, variantsOf } from './variants.js'
import { total as cartTotal } from './cart.js'
import { isSignedIn, memberTiers } from './auth.js'

/* the storefront's own settings (content/store/storefront.md): the hero and
   what shows in what order. `arrange(cfg)` resolves a settings object — the
   compiled one, or a draft from the admin's live preview — into the lists the
   page renders; an empty list means "all of them, in their own order". */
export const settings = STOREFRONT
/* whether the store offers the book online at all (`showOnline` in storefront.md): off, the
   store is the printed books alone — a book's page is its print page, the unlock's page is the
   reader's own way in and never listed, and no page mentions reading the book online */
export const ONLINE = STOREFRONT.showOnline !== false
/* what sold (build/sales.mjs → .velite/sales.json, read at build time from the paid purchases of
   the last ninety days): the best seller is the book with the most, and the only book that wears
   the badge — never a field on a product. No sales, no badge. */
const SALES = Object.values(import.meta.glob('#content/sales.json', { eager: true, import: 'default' }))[0] || { books: {}, bestseller: null }
export const BESTSELLER = SALES.bestseller || null
export function arrange(cfg) {
  const c = cfg || STOREFRONT
  const pick = (ids, all, find) => (ids && ids.length ? ids.map(find).filter(Boolean) : all)
  const rail = pick(c.featured, featured.value, product)
  /* the books the hero stands up: in the middle, nearest, the best seller — the book that sold
     most — or else the longest of the featured books; either side of it the shortest and
     the longest of the rest. The rest are the featured books when three or more are in print, else
     every book that is. */
  const isSeller = (p) => p && p.book && p.book === BESTSELLER && !p.hidden
  const featuredBooks = [...new Map(rail.filter((p) => p.book).map((p) => [p.book, bookArtOf(p.book)]).filter(([, b]) => b)).values()]
  /* …and only books that are for sale: a priced printed edition, or — for a shop that sells its
     books online and nothing else — the unlock. The hero never stands up a book whose page would
     say "not available". */
  const onSale = (slug) => !!hardcoverOf(slug) || products.value.some((p) => p.book === slug && p.kind === 'book' && p.available !== false)
  const pool = (featuredBooks.length >= 3 ? featuredBooks : [...new Map(BOOKS.map((b) => [b.slug, bookArtOf(b.slug)]).filter(([, b]) => b)).values()]).filter((b) => onSale(b.slug))
  const longest = (list) => [...list].sort((x, y) => (y.pages || 0) - (x.pages || 0))[0] || null
  const seller = rail.find(isSeller) || products.value.find(isSeller)
  const middle = (seller && pool.find((b) => b.slug === seller.book)) || longest(featuredBooks) || longest(pool)
  const rest = pool.filter((b) => !middle || b.slug !== middle.slug).sort((x, y) => (x.pages || 0) - (y.pages || 0))
  const trio = middle && rest.length >= 2 ? [rest[0], middle, rest[rest.length - 1]] : pool.slice(0, 3)
  return {
    hero: {
      eyebrow: c.heroEyebrow || '', title: c.heroTitle || '', subtitle: c.heroSubtitle || '', image: c.heroImage || '',
      primary: c.heroCta ? { label: c.heroCta, href: c.heroHref || '#collections' } : null,
      /* a quiet second button only when the file names one; the hero never points at a book on its own */
      secondary: c.heroCta2 ? { label: c.heroCta2, href: c.heroHref2 || '#collections' } : null,
    },
    tiles: pick(c.collections, collections.value, collection),
    rail,
    shelves: pick(c.shelves, collections.value, collection),
    showMembership: c.showMembership !== false,
    showCollections: c.showCollections !== false,
    showEditions: c.showEditions !== false,
    /* the hero's books: the trio above, or the slugs the file names when it names them */
    heroBooks: c.heroBooks && c.heroBooks.length ? c.heroBooks.map(bookArtOf).filter(Boolean).slice(0, 3) : trio,
    showFeatured: c.showFeatured !== false,
    showOnline: c.showOnline !== false,
  }
}

const byKind = { book: 'book_unlock', good: 'store_good', membership: 'subscription', session: 'session', print: 'print' }
/* what ships: a good, or a printed book */
/*
 * THE PRICE LISTS, INCLUDING THE SHOP’S OWN.
 *
 * The base list is composed here rather than read from the catalog, because the catalog is a
 * build artefact the browser does not have — but it is composed by the SAME rule
 * (`priceLists` in catalog.mjs), from the same offers, so the two agree. The checkout resolves
 * over the catalog’s copy and the page over this one, and `prices.test.mjs` holds the rule
 * they share.
 */
export function lists() {
  const base = { name: 'base', kind: 'base', rules: [], priority: 0, prices: [] }
  for (const d of PRODUCTS) {
    if (!d || d.published === false || !d.sku) continue
    const opts = optionsOf(d)
    if (opts.length) {
      for (const v of variantsOf({ sku: d.sku, key: d.key }, opts)) {
        const own = (d.variants || {})[v.variant]
        base.prices.push({ sku: d.sku, variant: v.variant, amount: Math.round(Number(own && own.price != null ? own.price : d.price) * 100), currency: (d.currency || 'usd').toLowerCase() })
      }
    } else base.prices.push({ sku: d.sku, variant: '', amount: Math.round(Number(d.price) * 100), currency: (d.currency || 'usd').toLowerCase() })
  }
  const further = (PRICE_LISTS || []).filter((r) => r && r.published !== false).map((r) => ({
    name: r.path || r.title, kind: r.kind, rules: r.rules || [], priority: Number(r.priority) || 0,
    starts: r.starts || null, ends: r.ends || null,
    prices: (r.prices || []).map((x) => ({
      sku: x.sku, variant: x.variant || '', amount: Math.round(Number(x.amount) * 100),
      currency: String(x.currency || r.currency || 'usd').toLowerCase(),
      ...(x.min_quantity != null ? { min_quantity: x.min_quantity } : {}),
      ...(x.max_quantity != null ? { max_quantity: x.max_quantity } : {}),
    })),
  }))
  return [base, ...further]
}

/* WHO IS ASKING, as a rule may ask it. The page shows what this reader would pay; the checkout
   builds the same context from the entitlements and never trusts this one. */
/* the discounts, as the resolver wants them — money in pence, everything else as written. The
   same shape catalog.mjs builds for the function, from the same records. */
export function promotions() {
  return (PROMOS || []).filter((r) => r && r.published !== false).map((r) => ({
    name: r.path || r.title, title: r.title || r.path, kind: r.kind || 'standard', status: r.status || 'active',
    method: r.method || 'percentage', value: Number(r.value) || 0,
    target: r.target || 'items', allocation: r.allocation || 'each',
    ...(r.max_quantity != null ? { max_quantity: Number(r.max_quantity) } : {}),
    applies: r.applies || [], rules: r.rules || [],
    starts: r.starts || null, ends: r.ends || null,
  }))
}

export function priceContext() {
  /* `item_total` is the BAG as it stands, in pence. It was a literal 0 here, which made every
     "over £50" rule dead and every "under £50" rule true — a discount meant for small baskets
     given to every basket, with nothing saying so. A page asking about one product passes the
     bag it would be added to, which is what a shopper is actually deciding about. */
  const bag = cartTotal.value || 0   /* a computed ref: read at the moment a price is asked for */
  return { customer: { class: isSignedIn.value ? (memberTiers.value.length ? 'subscribed' : 'authenticated') : 'guest', tiers: memberTiers.value }, item_total: bag }
}

export const ships = (p) => p && (p.kind === 'good' || p.kind === 'print')

/* kept for the pages that awaited the catalog: there is nothing to load now */
export const ready = ref(true)
export const error = ref('')
export function load() { return Promise.resolve() }

/* one resolved product: the file's offer + (for a book) its cover. Also what
   the admin's live preview feeds a draft through — so the price is read from the
   draft's own fields, dollars to cents here as velite does. */
export function resolveProduct(p) {
  const cents = typeof p.unit_amount === 'number' ? p.unit_amount : Math.round(Number(p.price || 0) * 100)
  const priced = typeof p.price === 'number' || typeof p.unit_amount === 'number'
  const recurring = p.billing === 'subscription'
  const book = (p.kind === 'book' || p.kind === 'print') && p.book ? BOOKS.find((b) => b.slug === p.book) : null
  const cover = book && book.cover ? book.cover : null
  const images = [].concat(
    p.image ? [{ src: p.image, blur: null }] : cover ? [{ src: cover.src, blur: cover.blurDataURL }] : [],
    (p.gallery || []).map((src) => ({ src, blur: null })))
  return {
    ...p,
    kindKey: byKind[p.kind],
    available: priced && !!p.sku,
    unit_amount: priced ? cents : null,
    currency: (p.currency || 'usd').toLowerCase(),
    recurring,
    /* the store's per-period words are keyed month | week (H['per-month']) */
    interval: recurring ? (p.period === 'weekly' ? 'week' : 'month') : null,
    images,
    image: images[0] || null,
    bookMeta: book ? { author: book.author || '', chapters: book.chapters || 0, slug: book.slug, difficulty: book.difficulty || '' } : null,
    /* a book in print: its formats and the choices on them, for the page */
    print: p.kind === 'print' ? { trim: p.trim, paper: p.paper, cloth: p.cloth, foil: p.foil, contents: p.contents || ['parts'], formats: p.formats || [], includes: p.includes || [], files: p.files || [], ebook: p.ebook !== false, main: p.main || 'hardcover' } : null,
    href: '/store/products/' + p.id,
  }
}

/* the editions build/print.mjs has set (content/store/print.json), by book: pages and quotes by contents; none is fine */
import { editionsOf } from './print-index.js'
export const editionOf = (slug) => editionsOf(slug)
/* a book's printed self, for a Book3D: its main offer's cover art and that binding's
   dimensions, from the edition of its first contents — null while nothing is set */
/* a book's page in the store: the unlock's when it has one (every format is on it), else its print
   page — and the print page first when the book online is off */
export const bookHref = (slug) => { const p = products.value.find((x) => x.book === slug && x.kind === (ONLINE ? 'book' : 'print')) || products.value.find((x) => x.book === slug && (x.kind === 'book' || x.kind === 'print')); return p ? p.href : '/store/products/' + slug }
/* a book with no printed edition, as an object anyway: its own cover, a paperback, and a thickness
   read off how much text it holds — which is also what orders the hero's trio by length */
function plainArt(b) {
  const src = b && b.cover ? (typeof b.cover === 'string' ? b.cover : b.cover.src) : ''
  if (!src) return null
  const chars = (b.raw || '').length || (b.chapters || []).length * 1800
  return { slug: b.slug, title: b.title, author: b.author || '', art: src, fallbackArt: src, dims: null, binding: 'softcover',
    jacket: false, cloth: '', foil: '', foilArt: '', edges: null, sheets: [], trim: '6x9',
    pages: Math.max(24, Math.round(chars / 1800)) }
}
export function bookArtOf(slug) {
  const b = BOOKS.find((x) => x.slug === slug); const spec = b && printSpec(b.print)
  const ed = spec && editionsOf(slug); const e = ed && ed.editions && ed.editions[spec.contents[0]]
  /*
   * A BOOK STANDS AS A BOOK WHETHER OR NOT IT IS IN PRINT.
   *
   * This said null for a book with no printed edition, so the hero of a shop that sells its books
   * online and nothing else stood nothing up at all and fell back to its words alone — and a site
   * that filled the gap with a photograph got a flat panel where the books should be. Book3D takes
   * the plain picture for a book that is not in print; this is the caller catching up to it.
   */
  if (!e || !e.art || !e.dims) return plainArt(b)
  /* the main offer's format, or the first printed one the edition has */
  const format = PRINTED.includes(spec.main) && e.printers && e.printers[spec.main] ? spec.main : PRINTED.find((f) => e.printers && e.printers[f])
  const cv = format && coverFor(e, format, spec.cloth, spec.foil)
  return cv ? { slug, title: b.title, author: b.author || '', art: cv.art, fallbackArt: bookCoverOf(slug), dims: cv.dims, binding: cv.binding, jacket: cv.jacket, cloth: cv.cloth, foil: cv.foil, foilArt: cv.foilArt, edges: cv.edges, sheets: cv.sheets, trim: spec.trim, pages: e.pages } : null
}
/* the books in print, worded by the store's own strings */
const HARDCOVERS = () => { const w = (us('store').product || {}).print || {}; return printOffers(BOOKS, { ...w, suffix: w.suffix ? w.suffix.replace(/ /g, '\u00a0') : '' }, editionOf)
  /* the page's About is the unlock's opening — what its file says about the book, before
     its own `## ` sections, which are about the unlock */
  /* …and a book that has an unlock is one page, the unlock's, with the print formats on it: the
     print page still resolves by id (the bag's lines point at it) but is never listed. With the
     book online off, it is the other way round: the print page is the book's, the unlock's hidden. */
  .map((o) => { const unlock = PRODUCTS.find((p) => p.kind === 'book' && p.book === o.book); return { ...o, hidden: !!unlock && ONLINE, ebook: o.ebook && ONLINE, body: ((unlock || {}).body || '').split(/<h2\b/)[0] } }) }
/* the best seller's badge, on the book's visible page alone; a product's own badge field says anything else ("New") */
const badged = (p) => (p.book && p.book === BESTSELLER && !p.hidden ? { ...p, badge: (us('store').product.ui || {}).bestseller || p.badge } : p)
export const products = computed(() => PRODUCTS.map((p) => (p.kind === 'book' && !ONLINE ? { ...p, hidden: true } : p)).concat(HARDCOVERS()).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)).map(badged).map(resolveProduct))
export const product = (id) => products.value.find((p) => p.id === id) || null
export const byBook = (slug) => products.value.find((p) => p.kind === 'book' && p.book === slug) || null
/* a book's page in print, when something of it is for sale */
export const hardcoverOf = (slug) => products.value.find((p) => p.kind === 'print' && p.book === slug) || null
export const printOf = hardcoverOf

/* the page a product stands for on a shelf: itself, or — a hidden one for a book (the unlock while
   the book online is off, the print page while it is on) — the book's visible page */
const shown = (p) => (p && p.hidden && p.book ? products.value.find((x) => x.book === p.book && !x.hidden && (x.kind === 'book' || x.kind === 'print')) || null : p)
export function resolveCollection(c) {
  /* curated order first, then anything else that claims the collection — a curated id naming a
     book's other page stands for its visible one, once */
  const curated = [...new Set((c.products || []).map(product).map(shown).filter(Boolean))]
  const rest = products.value.filter((p) => (p.collections || []).includes(c.id) && !curated.includes(p) && !p.hidden)
  const items = curated.concat(rest)
  return { ...c, items, href: '/store/collections/' + c.id, image: c.image || null, covers: items.filter((p) => p.image).slice(0, 3).map((p) => p.image) }
}
export const collections = computed(() => COLLECTIONS.slice().sort((a, b) => a.order - b.order).map(resolveCollection))
export const collection = (id) => collections.value.find((c) => c.id === id) || null
export const featured = computed(() => products.value.filter((p) => p.featured && p.kind !== 'membership' && p.kind !== 'session' && !p.hidden))
/* the memberships, lowest tier first; `membership` is the first of them, for anything
   that only needs one way in */
/* the memberships as TIERS: one entry per tier slug, by rank, with its offers —
   the ways to pay for it (weekly, monthly), each a product of its own */
const PERIOD_ORDER = { weekly: 0, monthly: 1 }
export const tiers = computed(() => {
  const by = new Map()
  for (const p of products.value.filter((x) => x.kind === 'membership' && x.tier)) {
    const t = by.get(p.tier) || { tier: p.tier, rank: p.rank || 0, title: p.title, subtitle: p.subtitle || '', id: p.id, href: p.href, offers: [] }
    t.offers.push(p); by.set(p.tier, t)
  }
  return [...by.values()].sort((a, b) => a.rank - b.rank).map((t) => ({ ...t, offers: t.offers.sort((a, b) => (PERIOD_ORDER[a.period] ?? 9) - (PERIOD_ORDER[b.period] ?? 9)) }))
})
export const memberships = computed(() => products.value.filter((p) => p.kind === 'membership').sort((a, b) => (a.rank || 99) - (b.rank || 99) || a.order - b.order))
export const membership = computed(() => memberships.value[0] || null)
/* a tier's rank, by its slug; unknown = 0 */
export const tierRank = (slug) => { const p = memberships.value.find((m) => m.tier === slug); return p ? (p.rank || 0) : 0 }
/* the same collection's other pieces first, then anything else — "you may also like" */
export function related(p, n = 4) {
  const same = products.value.filter((x) => x.id !== p.id && x.kind !== 'membership' && !x.hidden && (x.collections || []).some((c) => (p.collections || []).includes(c)))
  const rest = products.value.filter((x) => x.id !== p.id && x.kind !== 'membership' && !x.hidden && !same.includes(x))
  return same.concat(rest).slice(0, n)
}
/* the collection a product belongs to, for its eyebrow and breadcrumb */
export const collectionOf = (p) => (p.collections || []).map(collection).find(Boolean) || null
