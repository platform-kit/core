/*
 * The store as Shopify's Storefront API sees it — the products, their variants and options, the collections — made
 * from what the site's bag and checkout already read: the catalog's offers (sku, kind, price, a print offer's contents,
 * cloth and foil) and the content index's records (products, collections, books: the words, the pictures, the order).
 * Plain JavaScript, no imports, pinned under Node (build/storefront-api.test.mjs).
 *
 * The map: a `good` is a product, its record's `sizes` one option (Size) with a variant each, none a single "Default
 * Title" variant; a book is ONE product, as the store has one page per book — its handle the store page's id (the
 * unlock product's file name, else `<slug>-print`), the option Format holding "Read online" (the unlock offer) and every
 * printed and downloadable format the offers say, then Contents, Cloth and Foil as options when the print block offers
 * a choice, the variants the allowed combinations (the unlock and a download take no print choice); a `download` sold
 * on its own likewise a variant of its book's product; memberships and sessions are not products. A variant's id is
 * `gid://shopify/ProductVariant/<sku>[/<variant string>]`, so a cart line comes back as { sku, variant } exactly as the
 * bag sends them (`lineOf`). Money is Shopify's `{ amount: "15.0", currencyCode: "USD" }`.
 */
export const GID = { product: 'gid://shopify/Product/', variant: 'gid://shopify/ProductVariant/', collection: 'gid://shopify/Collection/', cart: 'gid://shopify/Cart/', line: 'gid://shopify/CartLine/', image: 'gid://shopify/ProductImage/', shop: 'gid://shopify/Shop/' }
export const money = (cents: any, currency: any) => ({ amount: ((Number(cents) || 0) / 100).toFixed(2).replace(/0$/, ''), currencyCode: String(currency || 'usd').toUpperCase() })
const title = (s: any) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase())
const FORMAT_WORDS: any = { softcover: 'Softcover', hardcover: 'Hardcover', premium: 'Premium hardcover', pdf: 'PDF', epub: 'EPUB', book: 'Read online' }
/* a Shopify option, the one shape both branches build */
const opt = (p: any, name: any, values: any) => ({ id: p.id + '/' + name, name, values, optionValues: values.map((v: any) => ({ id: p.id + '/' + name + '/' + v, name: v })) })
/* a variant key back into Shopify's selectedOptions, by the options' declared order — the same
   positional reading `readVariantKey` makes, written here so this file keeps its no-imports rule */
const chosenOf = (options: any, key: any) => {
  const parts = String(key || '').split('.').filter(Boolean)
  return (options || []).map((o: any, i: any) => {
    const v = (o.values || []).find((x: any) => x.value === parts[i])
    return { name: o.name, value: v ? (v.label || v.value) : (parts[i] || '') }
  }).filter((x: any) => x.value)
}
const plain = (md: any) => String(md || '').replace(/^---[\s\S]*?---\s*/, '').replace(/[#*_>`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\n{2,}/g, '\n\n').trim()
export const handleOf = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * @param {object} o
 * @param {object} o.offers     the catalog's offers by sku
 * @param {Array}  o.products   the product records: { path, data: { title, subtitle, sku, kind, price, image, gallery, sizes, compare, tags, collections, order, published, book }, body, updated, created }
 * @param {Array}  o.collections the collection records: { path, data: { title, subtitle, image, order, featured, products: [ids] }, body }
 * @param {Array}  o.books      the book records: { path, data: { title, author, cover, description, tags, published }, updated, created }
 * @param {object} o.site       { name, url }
 * @param {function} o.imageUrl (address) → the images door's url, or null
 * @param {function} [o.imageSize] (address) → { width, height } | null
 * @param {function} [o.render]  (markdown) → html
 */
export function storefrontOf(o: any) {
  const offers = Object.values(o.offers || {}).filter((x: any) => x && x.sku)
  const site = o.site || {}
  const img = (address: any, alt: any) => { if (!address) return null; const url = o.imageUrl ? o.imageUrl(address) : null; if (!url) return null; const s = (o.imageSize && o.imageSize(address)) || {}; return { id: GID.image + handleOf(address), url, src: url, originalSrc: url, transformedSrc: url, altText: alt || null, width: s.width || null, height: s.height || null, _address: address } }
  const html = (md: any) => (o.render ? o.render(md) : '<p>' + plain(md).split('\n\n').join('</p><p>') + '</p>')
  const products: any = []
  const recBySku = new Map((o.products || []).filter((r: any) => r.data && r.data.sku).map((r: any) => [r.data.sku, r]))
  const recByBook = new Map((o.products || []).filter((r: any) => r.data && r.data.kind === 'book' && r.data.book).map((r: any) => [r.data.book, r]))
  const bookBy = new Map((o.books || []).map((b: any) => [b.path, b]))
  const seenBooks = new Set()
  const base = (handle: any, rec: any, times: any) => ({ id: GID.product + handle, handle, createdAt: times.created || times.updated || null, updatedAt: times.updated || null, publishedAt: times.updated || null, onlineStoreUrl: site.url ? `${String(site.url).replace(/\/+$/, '')}/store/products/${rec}` : null, availableForSale: true, requiresSellingPlan: false, isGiftCard: false, tags: [], productType: '', vendor: site.name || '', seo: { title: null, description: null }, metafield: null, metafields: [] })
  const variantOf = (product: any, sku: any, variant: any, opts: any, price: any, currency: any, extra: any = {}) => ({ id: GID.variant + sku + (variant ? '/' + variant : ''), sku: extra.variantSku || sku, title: opts.map((x: any) => x.value).join(' / ') || 'Default Title', selectedOptions: opts, price: money(price, currency), compareAtPrice: extra.compareAt ? money(extra.compareAt, currency) : null, availableForSale: extra.sold !== false, currentlyNotInStock: extra.sold === false, quantityAvailable: null, requiresShipping: !!extra.ships, weight: null, weightUnit: 'KILOGRAMS', image: product.featuredImage, barcode: null, taxable: true, unitPrice: null, unitPriceMeasurement: null, product, _line: { sku, variant: variant || '', kind: extra.kind, name: product.title, label: opts.map((x: any) => x.value).join(' · ') } })
  /* the goods, and the books (one product per book) */
  for (const rec of o.products || []) {
    const d = rec.data || {}; if (d.published === false) continue
    const offer: any = offers.find((x: any) => x.sku === d.sku); if (!offer) continue
    if (offer.kind === 'good') {
      const p: any = base(rec.path, rec.path, rec)
      Object.assign(p, { title: d.title || rec.path, description: plain(rec.body) || String(d.subtitle || ''), descriptionHtml: html(rec.body) || `<p>${d.subtitle || ''}</p>`, productType: 'good', tags: d.tags || [], featuredImage: img(d.image, d.title) })
      p.images = [p.featuredImage, ...(d.gallery || []).map((g: any) => img(g, d.title))].filter(Boolean)
      /*
       * THE SHAPES, READ OFF THE OFFER — never derived a second time here.
       *
       * The catalog already worked out this product's options, every combination, each one's
       * sku, its lookup key, its own price where it has one and whether it is sold. Computing
       * any of that again in this file would be a second implementation of the same rule, and
       * the two would disagree the first time one was edited: Shopify would then advertise a
       * variant at a price the checkout refuses, which is the worst kind of drift because both
       * halves look right on their own. `sizes` is folded into the options by `optionsOf`
       * before the catalog is written, so there is no size code here either.
       */
      const compareAt = d.compare ? Math.round(Number(String(d.compare).replace(/[^0-9.]/g, '')) * 100) || 0 : 0
      const shapes = Array.isArray(offer.variants) && offer.variants.length ? offer.variants : null
      p.options = shapes
        ? (offer.options || []).map((o: any) => opt(p, o.name, o.values.map((v: any) => v.label || v.value)))
        : [opt(p, 'Title', ['Default Title'])]
      /* the id and the cart line stay on the OFFER's sku — that is what the bag sends and what the
         checkout resolves; `v.sku` is the variant's own, which is what Shopify's `sku` field means.
         A shape the shop has withdrawn is listed and unbuyable (availableForSale false), never
         missing: a value that vanishes as another option is picked reads as a broken page. */
      p.variants = shapes
        ? shapes.map((v: any) => variantOf(p, offer.sku, v.variant, chosenOf(offer.options, v.variant), v.unit_amount, offer.currency, { ships: true, kind: 'good', compareAt, sold: v.sold, variantSku: v.sku }))
        : [variantOf(p, offer.sku, '', [], offer.unit_amount, offer.currency, { ships: true, kind: 'good', compareAt })]
      p._collections = (d.collections || []); p._order = Number(d.order) || 0; p._skus = [offer.sku]
      products.push(p)
    }
  }
  const bookOffers = (slug: any) => offers.filter((x: any) => x.book === slug && ['book', 'print', 'download'].includes(x.kind))
  for (const slug of new Set(offers.filter((x: any) => x.book && ['book', 'print', 'download'].includes(x.kind)).map((x: any) => x.book))) {
    if (seenBooks.has(slug)) continue; seenBooks.add(slug)
    const bookRec: any = bookBy.get(slug); const unlockRec: any = recByBook.get(slug)
    if (bookRec && bookRec.data && bookRec.data.published === false) continue
    const own = bookOffers(slug); if (!own.length) continue
    const handle = unlockRec ? unlockRec.path : slug + '-print'
    const d = (unlockRec && unlockRec.data) || {}; const b = (bookRec && bookRec.data) || {}
    const p: any = base(handle, handle, unlockRec || bookRec || {})
    const cover = b.cover || d.image || null
    Object.assign(p, { title: d.title || b.title || slug, description: plain(unlockRec ? unlockRec.body : '') || String(b.description || d.subtitle || ''), descriptionHtml: unlockRec && unlockRec.body ? html(unlockRec.body) : `<p>${b.description || d.subtitle || ''}</p>`, productType: 'book', vendor: b.author || site.name || '', tags: [...new Set([...(d.tags || []), ...(b.tags || [])])], featuredImage: img(cover, b.title || d.title) })
    p.images = [p.featuredImage, ...(d.gallery || []).map((g: any) => img(g, d.title))].filter(Boolean)
    /* the options: Format always; Contents, Cloth, Foil when any print offer gives a choice */
    const order = ['book', 'softcover', 'hardcover', 'premium', 'pdf', 'epub']
    const sorted = own.slice().sort((a: any, b2: any) => order.indexOf(a.kind === 'book' ? 'book' : a.format) - order.indexOf(b2.kind === 'book' ? 'book' : b2.format))
    const formats = sorted.map((x: any) => (x.kind === 'book' ? 'book' : x.format))
    const contentsAll = [...new Set(sorted.flatMap((x: any) => (x.kind === 'print' || x.kind === 'download') && Array.isArray(x.contents) ? x.contents : []))]
    const clothAll = [...new Set(sorted.flatMap((x: any) => (Array.isArray(x.cloth) ? x.cloth : [])))], foilAll = [...new Set(sorted.flatMap((x: any) => (Array.isArray(x.foil) ? x.foil : [])))]
    const withContents = contentsAll.length > 1, withCloth = clothAll.length > 1, withFoil = foilAll.length > 1
    p.options = [opt(p, 'Format', formats.map((f) => FORMAT_WORDS[f] || title(f)))]
    if (withContents) p.options.push(opt(p, 'Contents', contentsAll.map(title)))
    if (withCloth) p.options.push(opt(p, 'Cloth', clothAll.map(title)))
    if (withFoil) p.options.push(opt(p, 'Foil', foilAll.map(title)))
    p.variants = []
    for (const x of sorted) {
      const f = (x as any).kind === 'book' ? 'book' : (x as any).format
      const fmt = { name: 'Format', value: FORMAT_WORDS[f] || title(f) }
      const ships = (x as any).kind === 'print', kind = (x as any).kind
      if ((x as any).kind === 'book' || !Array.isArray((x as any).contents) || (x as any).kind === 'download') {
        /* a download's contents choice: every edition comes with the file (the store's rule), so one variant */
        p.variants.push(variantOf(p, (x as any).sku, '', [fmt], (x as any).unit_amount, (x as any).currency, { ships, kind })); continue
      }
      const cs = (x as any).contents.length ? (x as any).contents : ['parts'], cls = Array.isArray((x as any).cloth) && (x as any).cloth.length ? (x as any).cloth : [''], fs = Array.isArray((x as any).foil) && (x as any).foil.length ? (x as any).foil : ['']
      for (const c of cs) for (const cl of cls) for (const fo of fs) {
        const opts = [fmt]; if (withContents) opts.push({ name: 'Contents', value: title(c) }); if (withCloth && cl) opts.push({ name: 'Cloth', value: title(cl) }); if (withFoil && fo) opts.push({ name: 'Foil', value: title(fo) })
        /* the variant string the bag sends (contents.cloth.foil); none when the offer gives no choice (printVariant fills the defaults) */
        const variant = cs.length > 1 || cls.length > 1 || fs.length > 1 ? [c, cl, fo].join('.').replace(/\.+$/, '') : ''
        p.variants.push(variantOf(p, (x as any).sku, variant, opts, (x as any).unit_amount, (x as any).currency, { ships, kind }))
      }
    }
    p._collections = d.collections || []; p._order = Number(d.order) || 0; p._skus = own.map((x: any) => x.sku)
    products.push(p)
  }
  for (const p of products) {
    const prices = (p as any).variants.map((v: any) => Number(v.price.amount)); const cur = (p as any).variants[0] ? (p as any).variants[0].price.currencyCode : 'USD'
    const m = (n: any) => ({ amount: n.toFixed(2).replace(/0$/, ''), currencyCode: cur })
    ;(p as any).priceRange = { minVariantPrice: m(Math.min(...prices)), maxVariantPrice: m(Math.max(...prices)) }
    const cmp = (p as any).variants.map((v: any) => v.compareAtPrice && Number(v.compareAtPrice.amount)).filter((x: any) => x != null)
    ;(p as any).compareAtPriceRange = { minVariantPrice: m(cmp.length ? Math.min(...cmp) : 0), maxVariantPrice: m(cmp.length ? Math.max(...cmp) : 0) }
    ;(p as any).totalInventory = null
  }
  products.sort((a: any, b: any) => a._order - b._order || a.title.localeCompare(b.title))
  /* the collections: the records, their products by the ids they name (a sku, or a book's slug) */
  const collections = (o.collections || []).filter((c: any) => c.data && c.data.published !== false).slice().sort((a: any, b: any) => (Number(a.data.order) || 0) - (Number(b.data.order) || 0)).map((c: any) => {
    const ids = Array.isArray(c.data.products) ? c.data.products.map(String) : []
    const named: any = products.filter((p: any) => ids.includes(p.handle) || p._skus.some((s: any) => ids.includes(s)) || (p._collections || []).includes(c.path))
    return { id: GID.collection + c.path, handle: c.path, title: c.data.title || c.path, description: plain(c.body) || String(c.data.subtitle || ''), descriptionHtml: html(c.body) || `<p>${c.data.subtitle || ''}</p>`, image: img(c.data.image, c.data.title), updatedAt: c.updated || null, onlineStoreUrl: site.url ? `${String(site.url).replace(/\/+$/, '')}/store/collections/${c.path}` : null, seo: { title: null, description: null }, _products: named.slice().sort((a: any, b: any) => (ids.indexOf(a.handle) + 1 || 999) - (ids.indexOf(b.handle) + 1 || 999)) }
  })
  for (const p of products) (p as any)._collectionRefs = collections.filter((c: any) => c._products.includes(p))
  const shop = { id: GID.shop + '1', name: site.name || 'Store', description: site.description || null, primaryDomain: { url: site.url || null, host: site.url ? String(site.url).replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null, sslEnabled: true }, paymentSettings: { currencyCode: (products[0] && (products[0] as any).variants[0] && (products[0] as any).variants[0].price.currencyCode) || 'USD', enabledPresentmentCurrencies: [(products[0] && (products[0] as any).variants[0] && (products[0] as any).variants[0].price.currencyCode) || 'USD'], supportedDigitalWallets: [] }, shipsToCountries: o.shipsTo || [], moneyFormat: '${{amount}}', brand: null, privacyPolicy: null, refundPolicy: null, shippingPolicy: null, termsOfService: null }
  return { shop, products, collections }
}

/* a variant id (or a bare sku) back to the line the bag and checkout take */
export function lineOf(merchandiseId: any) {
  const s = String(merchandiseId || '')
  const tail = s.startsWith(GID.variant) ? s.slice(GID.variant.length) : s
  const i = tail.indexOf('/')
  return i < 0 ? { sku: tail, variant: '' } : { sku: tail.slice(0, i), variant: tail.slice(i + 1) }
}
export const findVariant = (store: any, merchandiseId: any) => { for (const p of store.products) for (const v of p.variants) if (v.id === merchandiseId) return v; return null }
export const findProduct = (store: any, id: any) => store.products.find((p: any) => p.id === id) || null

/* a word over title and description (Shopify's `query`, the simple form), a sort key, cursor paging */
export function pageOf(list: any, args: any = {}, { search = null, sort = null } = {}) {
  let items = list.slice()
  // @ts-expect-error TS2349, from the conversion: This expression is not callable. Type 'never' has no call signatures.
  if (args.query && search) { const q = String(args.query).toLowerCase().replace(/^title:/, '').replace(/['"*]/g, '').trim(); if (q) items = items.filter((x: any) => search(x).toLowerCase().includes(q)) }
  // @ts-expect-error TS2349, from the conversion: This expression is not callable. Type 'never' has no call signatures.
  if (args.sortKey && sort) { const key = String(args.sortKey); items.sort((a: any, b: any) => sort(key, a, b)) }
  if (args.reverse) items.reverse()
  const cursorOf = (i: any) => btoa(String(i))
  let from = 0; if (args.after) { try { from = Number(atob(String(args.after))) + 1 } catch { from = 0 } if (!Number.isFinite(from) || from < 0) from = 0 }
  const first = Math.min(250, Math.max(1, Number(args.first) || 20))
  const slice = items.slice(from, from + first)
  return { edges: slice.map((node: any, j: any) => ({ cursor: cursorOf(from + j), node })), nodes: slice, pageInfo: { hasNextPage: from + first < items.length, hasPreviousPage: from > 0, startCursor: slice.length ? cursorOf(from) : null, endCursor: slice.length ? cursorOf(from + slice.length - 1) : null }, totalCount: items.length }
}
export const productSort = (key: any, a: any, b: any) => key === 'TITLE' ? a.title.localeCompare(b.title) : key === 'PRICE' ? Number(a.priceRange.minVariantPrice.amount) - Number(b.priceRange.minVariantPrice.amount) : key === 'CREATED_AT' || key === 'UPDATED_AT' ? String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) : a._order - b._order
