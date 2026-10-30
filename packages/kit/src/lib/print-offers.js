/*
 * A book in print, as the offers it is — derived from the book's own `print`
 * block, never a second file. Pure and shared: the storefront makes the store's
 * page from it, build/catalog.mjs the catalog's offers, build/print.mjs the
 * editions, with one rule between them.
 *
 * The block says what is sold: `formats` (softcover — perfect bound; hardcover — a
 * case, with a jacket; premium — cloth, foil, ribbon, endpapers, sprayed edges; pdf;
 * epub), each with its own `price` or `markup`; `printers`, which printer makes each
 * printed format (lulu | mixam | bookvault, or auto — the cheapest with keys);
 * `providers`, each printer's own options; `contents`, what the buyer may choose to
 * have in the book (parts, full, summary — the first is the default); a hardcover's
 * `cloth` and `foil` as a list, when the buyer picks them; `includes`, the files that
 * come with a printed copy; `ebook`, whether the page mentions the book online; `proofed`, per
 * contents, the id of the edition a printed proof was read and passed — a record for the admin
 * (it says when the set edition is not the one that was read), never a gate on the sale. One
 * page per book (`<slug>-print`); one sku per format
 * (`<slug>-<format>`), since Stripe holds one price per sku; the buyer's choices
 * (contents, cloth, foil) ride on the line as its variant.
 */
export const FORMATS = ['softcover', 'hardcover', 'premium', 'pdf', 'epub']
export const PRINTED = ['softcover', 'hardcover', 'premium']   /* what ships */
export const PRINTERS = ['lulu', 'mixam', 'bookvault']         /* who prints; 'auto' is the cheapest with keys */
export const FILES = ['pdf', 'epub']                           /* what downloads */
export const CONTENTS = ['parts', 'full', 'summary', 'both']
export const CLOTHS = ['navy', 'gray', 'red', 'black', 'tan', 'forest']
export const FOILS = ['gold', 'black', 'white']
export const TRIMS = ['6x9', '5x8']
export const PAPERS = ['cream', 'white']
/* a format's binding, as the book is drawn: a paperback's cover, or boards */
export const BINDING = { softcover: 'softcover', hardcover: 'hardcover', premium: 'premium' }
export const MAINS = ['online', ...FORMATS]   /* what a page may open on */

export const PAGE_ID = (slug) => slug + '-print'
export const FORMAT_SKU = (slug, format) => slug + '-' + format
/* the hardcover keeps the block's key (what has sold under it); every other format's key is
   made from it, once and always the same — eight hex characters of FNV-1a over key:format */
export function formatKey(key, format) {
  if (format === 'hardcover') return String(key)
  let h = 0x811c9dc5
  for (const ch of String(key) + ':' + format) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const list = (v, all, fallback) => {
  const arr = (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(/[,\s]+/)).map((x) => String(x).trim()).filter((x) => all.includes(x))
  return arr.length ? [...new Set(arr)] : fallback
}
const num = (v) => (v == null || v === '' ? null : Number(v))

/* the block as one shape, whatever was written: every list a list, every format a record with
   its price or markup, the linen's colour choices, the defaults filled in */
import { modules as MODULES } from '#site'
/* the print module's switch: off, no book is in print however its block reads. Given the book, a book whose
   text is withheld (`fullText: false`) keeps the summary edition alone, and is not in print without one */
export function printSpec(pr, book = null) {
  if (MODULES.print === false) return null
  if (!pr || typeof pr !== 'object') return null
  if (book && book.fullText === false) {
    const spec = printSpec(pr)
    const contents = spec ? spec.contents.filter((c) => c === 'summary') : []
    return contents.length ? { ...spec, contents } : null
  }
  const cloth = CLOTHS.includes(pr.cloth) ? pr.cloth : 'black', foil = FOILS.includes(pr.foil) ? pr.foil : 'gold'
  const formats = {}
  const given = { ...(pr.formats || {}) }
  /* a block from before there were printers sold a casewrap: that is a hardcover printed on the case, at Lulu */
  const providers = {}
  for (const id of PRINTERS) if (pr.providers && pr.providers[id] && typeof pr.providers[id] === 'object') providers[id] = { ...pr.providers[id] }
  if (given.casewrap != null && given.casewrap !== false && (given.hardcover == null || given.hardcover === false)) { given.hardcover = given.casewrap; providers.lulu = { ...(providers.lulu || {}), style: 'casewrap' } }
  delete given.casewrap
  if (pr.package && !(providers.lulu && providers.lulu.package)) providers.lulu = { ...(providers.lulu || {}), package: String(pr.package) }
  for (const f of FORMATS) {
    const v = given[f]
    if (v == null || v === false) continue
    const o = typeof v === 'object' ? v : { price: v }
    const rec = { price: num(o.price), markup: num(o.markup) }
    if (f === 'hardcover') { rec.cloth = list(o.cloth, CLOTHS, [cloth]); rec.foil = list(o.foil, FOILS, [foil]) }
    formats[f] = rec
  }
  /* who prints each format: named, or auto */
  const printers = {}
  for (const f of PRINTED) if (formats[f]) { const p = pr.printers && pr.printers[f]; printers[f] = PRINTERS.includes(p) ? p : f === 'premium' ? 'bookvault' : 'auto' }
  return {
    key: pr.key ? String(pr.key) : '', rights: String(pr.rights || '').trim(), currency: String(pr.currency || 'usd').toLowerCase(),
    trim: TRIMS.includes(pr.trim) ? pr.trim : '6x9', paper: PAPERS.includes(pr.paper) ? pr.paper : 'cream', cloth, foil,
    spine: pr.spine ? String(pr.spine) : '', blurb: pr.blurb ? String(pr.blurb) : '', flap: pr.flap ? String(pr.flap) : '', note: pr.note ? String(pr.note) : '', package: pr.package ? String(pr.package) : '',
    ebook: pr.ebook !== false,
    proofed: Object.fromEntries(CONTENTS.filter((c) => pr.proofed && /^[0-9a-f]{16}$/.test(String(pr.proofed[c] || ''))).map((c) => [c, String(pr.proofed[c])])),
    /* the main offer: the one the page opens on, the rest behind "see other formats" — a format
       sold here, or the book online (`online`); the first printed format when none is named */
    main: MAINS.includes(pr.main) && (pr.main === 'online' || formats[pr.main]) ? pr.main : FORMATS.find((f) => formats[f] && PRINTED.includes(f)) || FORMATS.find((f) => formats[f]) || 'online',
    contents: list(pr.contents, CONTENTS, ['parts']),
    formats, printers, providers,
    includes: list(pr.includes, FILES, []),
    files: Array.isArray(pr.files) ? pr.files.filter((x) => x && x.file).map((x) => ({ title: String(x.title || x.file), file: String(x.file) })) : [],
  }
}

/* what a proof says of each contents: the set edition (print.json) is the one a printed copy was
   read and passed at; proofed at an older one (a changed word is a new edition); or never. A
   record for the admin and the deploy log — nothing reads it to decide a sale. */
export const proofState = (spec, editions, c) => { const e = editions && editions.editions && editions.editions[c]; const p = spec && spec.proofed[c]; return !e || !e.edition ? 'unset' : p === e.edition ? 'proofed' : p ? 'stale' : 'never' }

/* what a format sells for: the price as written, or the markup over what the printer charges
   to make one copy (the costliest of the contents the buyer may choose, so the markup is a
   floor whatever they pick; the files cost nothing to make), rounded UP to the next $5 — never
   down; null while a markup has no quote to sit on */
export const PRICE_STEP = 5
export function formatPrice(spec, format, editions) {
  const f = spec && spec.formats && spec.formats[format]
  if (!f) return null
  if (f.price != null) return f.price > 0 ? f.price : null
  if (f.markup == null) return null
  if (FILES.includes(format)) return Math.ceil(f.markup / PRICE_STEP) * PRICE_STEP || null
  const costs = spec.contents.map((c) => { const e = editions && editions.editions && editions.editions[c]; const p = e && e.printers && e.printers[format]; return p ? costUsd(p) : null }).filter((x) => typeof x === 'number')
  if (costs.length < spec.contents.length) return null
  return Math.ceil((Math.max(...costs) + f.markup) / PRICE_STEP) * PRICE_STEP
}

/* a printer's quote in dollars: what it charges to make one copy, its currency turned to ours
   (a rough rate — the price is rounded up to the next $5 over it anyway) */
export const RATES = { USD: 1, GBP: 1.3, EUR: 1.1, AUD: 0.66, CAD: 0.74 }
export const costUsd = (p) => (p && typeof p.cost === 'number' ? p.cost * (RATES[p.currency || 'USD'] || 1) : null)

/* a format's cover in an edition (print.json): the key its printer's cover is filed under — a
   linen's by its cloth and foil — with the art, the dimensions, the product: what the book is
   drawn from. Null while the edition has no such format. */
export function coverFor(edition, format, cloth, foil) {
  const p = edition && edition.printers && edition.printers[format]
  if (!p) return null
  let key = p.key
  if (p.products && cloth) { const k = `${format}-${p.provider}-${cloth}-${foil || 'gold'}`; if (p.covers && p.covers[k]) key = k }
  const art = edition.art && edition.art[key], dims = edition.dims && edition.dims[key]
  if (!art || !dims) return null
  const product = p.product || {}
  const foilArt = edition.art['foil:' + key] || null
  const opts = p.options || {}
  /* what the printer's options say the object is: sprayed edges, a cloth by its stock */
  const edges = opts.sprayedEdges ? String(opts.sprayedEdges) : null
  const clothOf = product.coverStock ? ({ 146: 'black', 151: 'black', 147: 'red', 152: 'red', 148: 'forest', 153: 'forest', 150: 'navy', 154: 'navy' }[product.coverStock] || 'black') : null
  /* the printed pages the listing shows, for the leaves that slide out: the chapter's page, the highlights, the other text */
  const sh = edition.shots || {}
  const sheets = [sh.edition, sh.marks, sh.other].filter((x) => x && x.art).map((x) => x.art)
  return { key, format, provider: p.provider, art, dims, jacket: !!product.jacket, cloth: product.cloth || clothOf || cloth || null, foil: product.foil || (product.foilColour === 11 ? 'silver' : product.foilColour ? 'gold' : null) || foil || null, foilArt, edges, sheets, binding: format }
}

/* the spine's words: the title (or the block's shorter `spine`) and the edition's line, which the
   printer stamps as its two foil lines — at most SPINE_MAX characters between them, in the
   characters it stamps (no underscore, no middot: the jacket draws the dot, the foil cannot).
   `fits` says whether it will; `room` how many characters a title may have. */
export const SPINE_MAX = 42
export function spineWords(title, spine, edition) {
  const clean = (s) => String(s || '').replace(/[_·•]/g, ' ').replace(/\s+/g, ' ').trim()
  const t = clean(spine) || clean(title), e = clean(edition).toUpperCase()
  return { title: t, edition: e, fits: t.length + e.length <= SPINE_MAX, room: SPINE_MAX - e.length }
}


/* a line's variant: the choices, in one string the cart and the checkout carry ("parts.black.gold") */
export const variantOf = (contents, cloth, foil) => [contents, cloth, foil].filter(Boolean).join('.')
export const parseVariant = (v) => { const [contents, cloth, foil] = String(v || '').split('.'); return { contents: contents || '', cloth: cloth || '', foil: foil || '' } }

/* every format a book sells, each as the catalog's offer: sku, key, kind (print ships, download
   does not), price, the choices the buyer may make on it — null price = not for sale yet */
export function formatOffers(book, editions = null) {
  const spec = printSpec(book && book.print, book)
  if (!spec || !spec.key || !spec.rights) return []
  return FORMATS.filter((f) => spec.formats[f]).map((f) => {
    const rec = spec.formats[f]
    return {
      format: f, sku: FORMAT_SKU(book.slug, f), key: formatKey(spec.key, f), kind: PRINTED.includes(f) ? 'print' : 'download', binding: BINDING[f] || null, printer: spec.printers[f] || null,
      price: formatPrice(spec, f, editions), currency: spec.currency, book: book.slug,
      contents: spec.contents, cloth: f === 'hardcover' ? rec.cloth : null, foil: f === 'hardcover' ? rec.foil : null,
      includes: PRINTED.includes(f) ? spec.includes : [], trim: spec.trim, paper: spec.paper,
    }
  })
}

/* the store's page for a book in print: one product, its formats as the choice on it — the
   first priced format is what the page opens on; the page needs at least one */
export function printOffer(book, words = {}, editions = null) {
  const spec = printSpec(book && book.print, book)
  if (!spec) return null
  const formats = formatOffers(book, editions).filter((o) => o.price > 0)
  if (!formats.length) return null
  /* the page — and its card — carry the main offer's sku and price */
  const first = formats.find((o) => o.format === spec.main) || formats[0]
  return {
    id: PAGE_ID(book.slug), sku: first.sku, key: first.key, kind: 'print', billing: 'once', period: null,
    /* the store's suffix keeps its spaces unbreakable, so a title wraps before the dot, never after it */
    title: book.title,
    subtitle: words['subtitle-' + spec.contents[0]] || words.subtitle || 'The edition, printed and bound',
    price: first.price, currency: spec.currency,
    book: book.slug, trim: spec.trim, paper: spec.paper, rights: spec.rights, cloth: spec.cloth, foil: spec.foil,
    contents: spec.contents, formats, includes: spec.includes, files: spec.files, ebook: spec.ebook, main: spec.main,
    image: book.cover ? book.cover.src || book.cover : null,
    collections: ['books'], gallery: [], sizes: [], featured: false, order: 50, tags: [], published: book.published !== false,
    body: '',
  }
}
export const printOffers = (books, words, editionOf = () => null) => (books || []).map((b) => printOffer(b, words, editionOf(b.slug))).filter(Boolean)
