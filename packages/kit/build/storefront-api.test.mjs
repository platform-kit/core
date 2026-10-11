/* The Store API (store-api): the site's store as Shopify's Storefront API.
   (1) Under Node: the products from the offers and the records (a good with sizes, a book in print with a contents
       and a cloth choice, a book online, a download) — the options, the variants, the ids and their inverse, the
       collections, the money; the schema built and introspected; a cart's arithmetic and errors. (2) With the stack up
       and the function served: `@shopify/storefront-api-client` with `storeDomain` set to the site (its https-only
       fetch mapped to the stack's http, as the host's rewrite would carry it) — shop, products, a product by handle, a
       collection, a cart's life (create, add, update, remove, the buyer identity, the errors), the refusals (no token,
       a revoked key, a delivery key). (3) On Playwright: the cart's checkoutUrl followed — a guest's paperback paid
       under the Stripe mock, a book online landing on the bag with the sign-in, an unknown token expired. Skipped where
       the stack is down or the store or api module is off; STOREFRONT_API_TEST=0 skips it. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { loadSite } from './site.mjs'
import { storefrontOf, lineOf, findVariant, GID, money } from '../supabase/functions/_shared/api/shopify/products.js'
import { optionsOf, variantsOf } from './variants.mjs'
import { execute, schemaOf } from '../supabase/functions/_shared/api/shopify/schema.js'
import { linesIn, linesUpdated, cartOf } from '../supabase/functions/_shared/api/shopify/cart.js'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */

const note = (m) => console.log('storefront-api: ' + m)
if (process.env.STOREFRONT_API_TEST === '0') { note('skipped (STOREFRONT_API_TEST=0)'); process.exit(0) }
const ROOT = process.cwd()
const c = await loadSite(ROOT)
if ((c.modules && c.modules.store === false) || (c.modules && c.modules.api === false)) { note('skipped — the store or the api module is off'); process.exit(0) }
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }

/* ---- (1) the shapes ---- */
/*
 * THE FIXTURE IS WHAT THE CATALOG WRITES, not a hand-typed guess at it.
 *
 * `catalog.mjs` puts an offer's options and every variant — sku, lookup key, price, sold — onto
 * its record, and the storefront reads them rather than deriving any of it a second time. If
 * this fixture typed those by hand it would be a third implementation, and it would be the one
 * that kept passing while the real two drifted. So it calls the same two functions the catalog
 * calls, over the same record fields.
 */
const shaped = (offer, d) => {
  const opts = optionsOf(d)
  return { ...offer, options: opts.map((o) => ({ name: o.name, values: o.values })),
    variants: variantsOf({ sku: offer.sku, key: offer.key }, opts, { sold: { not: d.unsold || [] } }).map((v) => ({
      variant: v.variant, sku: v.sku, key: v.lookup, label: v.label, sold: v.sold,
      unit_amount: d.variants && d.variants[v.variant] != null ? Math.round(d.variants[v.variant].price * 100) : offer.unit_amount,
    })) }
}
const FIX = {
  offers: {
    tee: shaped({ sku: 'tee', key: 'a1', kind: 'good', unit_amount: 2500, currency: 'usd', title: 'The tee' },
      { sizes: ['S', 'M', 'L'], variants: { l: { price: 28 } }, unsold: ['s'] }),
    'quiet-room': { sku: 'quiet-room', key: 'a2', kind: 'book', unit_amount: 500, currency: 'usd', book: 'the-quiet-room', title: 'The Quiet Room' },
    'the-quiet-room-softcover': { sku: 'the-quiet-room-softcover', key: 'a3', kind: 'print', unit_amount: 1500, currency: 'usd', book: 'the-quiet-room', format: 'softcover', contents: ['parts', 'full'], cloth: null, foil: null },
    'the-quiet-room-hardcover': { sku: 'the-quiet-room-hardcover', key: 'a4', kind: 'print', unit_amount: 3500, currency: 'usd', book: 'the-quiet-room', format: 'hardcover', contents: ['parts', 'full'], cloth: ['black', 'green'], foil: ['gold'] },
    'the-quiet-room-pdf': { sku: 'the-quiet-room-pdf', key: 'a5', kind: 'download', unit_amount: 800, currency: 'usd', book: 'the-quiet-room', format: 'pdf', contents: ['parts', 'full'] },
    'member-monthly': { sku: 'member-monthly', key: 'a6', kind: 'membership', unit_amount: 900, currency: 'usd', tier: 'member' },
  },
  products: [
    { path: 'tee', data: { title: 'The tee', sku: 'tee', kind: 'good', price: 25, sizes: ['S', 'M', 'L'], image: '/img/tee.png', compare: '$30', tags: ['wear'], order: 2 }, body: 'A tee.', updated: '2026-01-02T00:00:00Z' },
    { path: 'quiet-room', data: { title: 'The Quiet Room', sku: 'quiet-room', kind: 'book', book: 'the-quiet-room', price: 5, order: 1 }, body: 'Read it online.', updated: '2026-01-01T00:00:00Z' },
    { path: 'member-monthly', data: { title: 'Member', sku: 'member-monthly', kind: 'membership', price: 9 }, body: '' },
  ],
  collections: [{ path: 'books', data: { title: 'Books', products: ['quiet-room'], order: 1 }, body: 'Every title.' }, { path: 'goods', data: { title: 'Goods', products: ['tee'], order: 2 }, body: '' }],
  books: [{ path: 'the-quiet-room', data: { title: 'The Quiet Room', author: 'A. Author', cover: '/img/quiet.png', description: 'A book.', tags: ['stillness'] }, updated: '2026-01-01T00:00:00Z' }],
  site: { name: 'Test Press', url: 'https://x.test' }, imageUrl: (a) => 'https://x.test/images' + a, imageSize: () => ({ width: 640, height: 960 }), shipsTo: ['US', 'GB'],
}
const store = storefrontOf(FIX)
await ok('the products from the offers: a good with sizes, one product per book with its formats and print choices as variants, no membership; the collections; the money', () => {
  assert.deepEqual(store.products.map((p) => p.handle), ['quiet-room', 'tee'], 'in the records\' order; no membership')
  const tee = store.products.find((p) => p.handle === 'tee')
  assert.deepEqual(tee.options.map((o) => o.name + ':' + o.values.join('/')), ['Size:S/M/L']); assert.equal(tee.variants.length, 3)
  /* the id and the cart line key on the OFFER's sku and the variant key, which is what the bag sends */
  assert.deepEqual(tee.variants.map((v) => v.id), ['gid://shopify/ProductVariant/tee/s', 'gid://shopify/ProductVariant/tee/m', 'gid://shopify/ProductVariant/tee/l'])
  /* and Shopify's own sku field is the variant's own, which is what that field means */
  assert.deepEqual(tee.variants.map((v) => v.sku), ['tee-s', 'tee-m', 'tee-l'])
  assert.deepEqual(tee.variants.map((v) => v.selectedOptions), [[{ name: 'Size', value: 'S' }], [{ name: 'Size', value: 'M' }], [{ name: 'Size', value: 'L' }]])
  assert.deepEqual(tee.variants[0].price, { amount: '25.0', currencyCode: 'USD' }); assert.deepEqual(tee.variants[0].compareAtPrice, { amount: '30.0', currencyCode: 'USD' }); assert.equal(tee.variants[0].requiresShipping, true)
  /* a shape with its own price carries it; one the shop has withdrawn is LISTED and unbuyable */
  assert.deepEqual(tee.variants[2].price, { amount: '28.0', currencyCode: 'USD' }, 'L is dearer')
  assert.equal(tee.variants[0].availableForSale, false, 'S was withdrawn'); assert.equal(tee.variants[0].currentlyNotInStock, true)
  assert.equal(tee.variants[1].availableForSale, true)
  assert.deepEqual(tee.priceRange.minVariantPrice, { amount: '25.0', currencyCode: 'USD' })
  assert.deepEqual(tee.priceRange.maxVariantPrice, { amount: '28.0', currencyCode: 'USD' }, 'the range follows the shapes')
  assert.equal(tee.featuredImage.url, 'https://x.test/images/img/tee.png'); assert.equal(tee.featuredImage.width, 640); assert.equal(tee.onlineStoreUrl, 'https://x.test/store/products/tee')
  const book = store.products.find((p) => p.handle === 'quiet-room')
  assert.equal(book.vendor, 'A. Author'); assert.equal(book.productType, 'book'); assert.equal(book.featuredImage.url, 'https://x.test/images/img/quiet.png')
  assert.deepEqual(book.options.map((o) => o.name + ':' + o.values.join('/')), ['Format:Read online/Softcover/Hardcover/PDF', 'Contents:Parts/Full', 'Cloth:Black/Green'])
  const ids = book.variants.map((v) => v.id.replace(GID.variant, ''))
  assert.deepEqual(ids, ['quiet-room', 'the-quiet-room-softcover/parts', 'the-quiet-room-softcover/full', 'the-quiet-room-hardcover/parts.black.gold', 'the-quiet-room-hardcover/parts.green.gold', 'the-quiet-room-hardcover/full.black.gold', 'the-quiet-room-hardcover/full.green.gold', 'the-quiet-room-pdf'])
  const hc = book.variants[4]; assert.deepEqual(hc.selectedOptions, [{ name: 'Format', value: 'Hardcover' }, { name: 'Contents', value: 'Parts' }, { name: 'Cloth', value: 'Green' }]); assert.equal(hc.sku, 'the-quiet-room-hardcover'); assert.equal(hc.title, 'Hardcover / Parts / Green')
  assert.deepEqual(lineOf(hc.id), { sku: 'the-quiet-room-hardcover', variant: 'parts.green.gold' }); assert.deepEqual(lineOf(book.variants[0].id), { sku: 'quiet-room', variant: '' })
  assert.equal(book.variants[0].requiresShipping, false); assert.equal(book.variants[7].requiresShipping, false); assert.equal(book.variants[1].requiresShipping, true)
  assert.deepEqual(book.priceRange, { minVariantPrice: { amount: '5.0', currencyCode: 'USD' }, maxVariantPrice: { amount: '35.0', currencyCode: 'USD' } })
  assert.deepEqual(store.collections.map((x) => x.handle + ':' + x._products.map((p) => p.handle).join(',')), ['books:quiet-room', 'goods:tee'])
  assert.deepEqual(store.shop.shipsToCountries, ['US', 'GB']); assert.equal(store.shop.primaryDomain.host, 'x.test')
  assert.deepEqual(money(1234, 'usd'), { amount: '12.34', currencyCode: 'USD' }); assert.deepEqual(money(1500, 'eur'), { amount: '15.0', currencyCode: 'EUR' })
})
await ok('the schema builds and introspects; a query over the fixture answers Shopify\'s shapes', async () => {
  const s = schemaOf(); assert.ok(s.getType('Product') && s.getType('Cart') && s.getMutationType().getFields().cartCreate)
  const carts = new Map(); const cs = { get: async (id) => carts.get(id) || null, create: async (row) => { const r = { id: 'tok', ...row }; carts.set('tok', r); return r }, save: async (row) => { carts.set(row.id, row); return row } }
  const r = await execute(store, { query: '{ shop { name } products(first: 5, sortKey: TITLE) { edges { cursor node { handle title variants(first: 10) { nodes { id sku price { amount currencyCode } selectedOptions { name value } } } } } pageInfo { hasNextPage } } collection(handle: "books") { products(first: 3) { nodes { handle } } } node(id: "gid://shopify/Product/tee") { ... on Product { title } } }' }, cs, { site: 'https://x.test' })
  assert.ok(!r.errors, JSON.stringify(r.errors)); assert.equal(r.data.shop.name, 'Test Press')
  assert.deepEqual(r.data.products.edges.map((e) => e.node.handle), ['quiet-room', 'tee']); assert.equal(r.data.products.edges[1].node.variants.nodes[1].selectedOptions[0].value, 'M')
  assert.deepEqual(r.data.collection.products.nodes.map((n) => n.handle), ['quiet-room']); assert.equal(r.data.node.title, 'The tee')
  const m = await execute(store, { query: 'mutation($l: [CartLineInput!]) { cartCreate(input: { lines: $l, buyerIdentity: { countryCode: GB, email: "a@b.c" }, attributes: [{ key: "gift", value: "yes" }] }) { cart { id checkoutUrl totalQuantity cost { totalAmount { amount } } lines(first: 5) { nodes { id quantity merchandise { ... on ProductVariant { sku title } } cost { totalAmount { amount } } } } buyerIdentity { countryCode email } attributes { key value } } userErrors { code field message } } }', variables: { l: [{ merchandiseId: 'gid://shopify/ProductVariant/tee/m', quantity: 2 }, { merchandiseId: 'gid://shopify/ProductVariant/the-quiet-room-hardcover/full.green.gold' }] } }, cs, { site: 'https://x.test' })
  assert.ok(!m.errors, JSON.stringify(m.errors)); const cart = m.data.cartCreate.cart
  assert.equal(cart.checkoutUrl, 'https://x.test/cart/c/tok'); assert.equal(cart.totalQuantity, 3); assert.equal(cart.cost.totalAmount.amount, '85.0'); assert.deepEqual(cart.lines.nodes.map((n) => n.merchandise.title), ['M', 'Hardcover / Full / Green']); assert.equal(cart.buyerIdentity.countryCode, 'GB'); assert.deepEqual(JSON.parse(JSON.stringify(cart.attributes)), [{ key: 'gift', value: 'yes' }])
  const bad = await execute(store, { query: 'mutation { cartLinesAdd(cartId: "gid://shopify/Cart/tok", lines: [{ merchandiseId: "gid://shopify/ProductVariant/nope" }, { merchandiseId: "gid://shopify/ProductVariant/tee/s", quantity: 0 }]) { cart { totalQuantity } userErrors { code field } } }' }, cs)
  assert.deepEqual(bad.data.cartLinesAdd.userErrors.map((e) => e.code), ['INVALID_MERCHANDISE_LINE', 'QUANTITY_MUST_BE_POSITIVE']); assert.equal(bad.data.cartLinesAdd.cart.totalQuantity, 3, 'nothing changed')
  const upd = await execute(store, { query: `mutation { cartLinesUpdate(cartId: "gid://shopify/Cart/tok", lines: [{ id: "${cart.lines.nodes[0].id}", quantity: 5 }]) { cart { totalQuantity cost { totalAmount { amount } } } userErrors { code } } }` }, cs)
  assert.equal(upd.data.cartLinesUpdate.cart.totalQuantity, 6); assert.equal(upd.data.cartLinesUpdate.cart.cost.totalAmount.amount, '160.0')
  const rm = await execute(store, { query: `mutation { cartLinesRemove(cartId: "gid://shopify/Cart/tok", lineIds: ["${cart.lines.nodes[1].id}"]) { cart { totalQuantity lines(first: 5) { nodes { merchandise { ... on ProductVariant { sku } } } } } } }` }, cs)
  assert.equal(rm.data.cartLinesRemove.cart.totalQuantity, 5); assert.deepEqual(rm.data.cartLinesRemove.cart.lines.nodes.map((n) => n.merchandise.sku), ['tee-m'], "the variant's own sku, as Shopify means that field")
  const gone = await execute(store, { query: '{ cart(id: "gid://shopify/Cart/none") { id } }' }, cs); assert.equal(gone.data.cart, null)
  const stack = linesIn(store, [{ merchandiseId: 'gid://shopify/ProductVariant/quiet-room', quantity: 3 }], []); assert.equal(stack.rows[0].quantity, 1, 'an unlock never stacks')
  const cap = linesIn(store, [{ merchandiseId: 'gid://shopify/ProductVariant/tee/s', quantity: 40 }], []); assert.equal(cap.rows[0].quantity, 10, 'the bag\'s cap')
  const c2 = cartOf(store, { id: 'x', lines: cap.rows }, { site: 'https://x.test' }); assert.equal(c2.cost.totalAmount.amount, '250.0'); assert.equal(linesUpdated(store, [{ id: cap.rows[0].id, quantity: 0 }], cap.rows).rows.length, 0, 'zero removes')
  const intro = await execute(store, { query: '{ __schema { mutationType { fields { name } } } }' }, cs); assert.ok(intro.data.__schema.mutationType.fields.some((f) => f.name === 'cartBuyerIdentityUpdate'))
})

/* ---- (2) the served door ---- */
const url = supabaseUrl(), anon = process.env.VITE_SUPABASE_ANON_KEY || ''
const FN = url + '/functions/v1/storefront-api'
let served = false
try { served = !!(url && anon && localStack()) && (await fetch(FN + '/api/2024-10/graphql.json', { method: 'POST', body: '{}', signal: AbortSignal.timeout(4000) })).status === 401 } catch { /* down */ }
if (!served) { note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''} (the shapes — the local stack is not up or the storefront-api function is not served)`); process.exit(fail ? 1 : 0) }
const { createClient } = await import('@supabase/supabase-js')
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const sha256 = async (s) => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('') }
const made = []
const makeKey = async (kind) => { const key = `pk_${kind}_probe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; const { data: admin } = await service.from('profiles').select('id').eq('email', 'admin@example.com').maybeSingle(); const { error } = await service.from('api_keys').insert({ name: 'storefront-api test', kind, gated: false, prefix: key.slice(0, 12), hash: await sha256(key), created_by: admin ? admin.id : null }); if (error) throw new Error(error.message); made.push(key); return key }
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/catalog.json'), 'utf8'))
const offers = Object.values(catalog.offers || {})
const sellable = offers.filter((o) => ['good', 'book', 'print', 'download'].includes(o.kind))
if (!sellable.length) { note(`${pass} passed — nothing the bag sells on this site; the door is checked on the demo and the root`); process.exit(fail ? 1 : 0) }
/* the official client: storeDomain the site; its https-only url mapped onto the stack's function address, as the host's /api/* rewrite carries it in production */
const { createStorefrontApiClient } = await import('@shopify/storefront-api-client')

/* WHY THE STORE'S ROOM HAS AN ALIAS, pinned so the alias is never tidied away: Shopify's own
   client takes a storeDomain and throws away any path on it. Given <site>/api/store it still asks
   for <site>/api/<version>/graphql.json — so the same door is served there too, which is also why
   /api/* is the last rule under the prefix and nothing else may sit at the top of /api. */
await ok("the store's room needs an alias: Shopify's client discards a path on storeDomain", () => {
  const urlOf = (d) => createStorefrontApiClient({ storeDomain: d, apiVersion: '2024-10', publicAccessToken: 'x', retries: 0, logger: () => {} }).config.apiUrl
  const plain = urlOf('https://site.test')
  assert.equal(plain, 'https://site.test/api/2024-10/graphql.json')
  assert.equal(urlOf('https://site.test/api/store'), plain, 'a path on the domain is thrown away, so a room would never be asked for')
})
const clientFor = (token) => { const c = createStorefrontApiClient({ storeDomain: 'https://site.test', apiVersion: '2024-10', publicAccessToken: token, retries: 0, logger: () => {}, customFetchApi: (u, init) => fetch(String(u).replace('https://site.test', FN), init) }); return { request: async (q, o) => { const r = await c.request(q, o); if (r.errors) throw new Error('graphql: ' + JSON.stringify(r.errors).slice(0, 400)); return r } } }
const raw = async (token, body, headers = {}) => { const r = await fetch(FN + '/api/2024-10/graphql.json', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Shopify-Storefront-Access-Token': token } : {}), ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }
let createdCart = null
try {
  const key = await makeKey('storefront')
  const client = clientFor(key)
  await ok('the official client, one domain changed: shop, products with variants and prices from the catalog, a product by handle, a collection, introspection', async () => {
    const { data: shop, errors } = await client.request('{ shop { name primaryDomain { url } paymentSettings { currencyCode } } }'); assert.ok(!errors, JSON.stringify(errors)); assert.ok(shop.shop.name)
    const { data: list } = await client.request('{ products(first: 50) { nodes { id handle title productType vendor featuredImage { url } options { name values } variants(first: 50) { nodes { id sku title price { amount currencyCode } requiresShipping selectedOptions { name value } } } priceRange { minVariantPrice { amount } } } } }')
    assert.ok(list.products.nodes.length >= 1, 'products')
    for (const p of list.products.nodes) for (const v of p.variants.nodes) { const o = offers.find((x) => x.sku === v.sku); assert.ok(o, v.sku + ' is an offer'); assert.equal(Number(v.price.amount) * 100, o.unit_amount, v.id + ' at the catalog\'s price'); assert.equal(v.price.currencyCode, o.currency.toUpperCase()); assert.equal(v.requiresShipping, o.kind === 'good' || o.kind === 'print') }
    const bookProduct = list.products.nodes.find((p) => p.productType === 'book'); if (bookProduct) assert.ok(bookProduct.options[0].name === 'Format' && bookProduct.variants.nodes.length >= 1)
    const sized = list.products.nodes.find((p) => p.options.some((o) => o.name === 'Size')); if (sized) assert.equal(sized.variants.nodes.length, sized.options.find((o) => o.name === 'Size').values.length, 'a variant per size')
    const first = list.products.nodes[0]
    const { data: one } = await client.request('query($h: String!) { product(handle: $h) { id handle } productByHandle(handle: $h) { title } }', { variables: { h: first.handle } }); assert.equal(one.product.id, first.id); assert.equal(one.productByHandle.title, first.title)
    const { data: cols } = await client.request('{ collections(first: 10) { nodes { handle title products(first: 20) { nodes { handle } } } } }')
    for (const col of cols.collections.nodes) { const { data: c1 } = await client.request('query($h: String!) { collection(handle: $h) { handle products(first: 20) { nodes { handle } } } }', { variables: { h: col.handle } }); assert.deepEqual(c1.collection.products.nodes, col.products.nodes) }
    const { data: intro } = await client.request('{ __schema { queryType { name } } }'); assert.equal(intro.__schema.queryType.name, 'QueryRoot')
    const { data: search } = await client.request('query($q: String) { products(first: 5, query: $q) { nodes { title } } }', { variables: { q: first.title.split(' ')[0] } }); assert.ok(search.products.nodes.some((p) => p.title === first.title), 'the search finds it')
  })
  await ok('no token, a revoked key, a delivery key; a query fault is GraphQL\'s', async () => {
    assert.equal((await raw(null, { query: '{ shop { name } }' })).status, 401)
    const doomed = await makeKey('storefront'); await service.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('hash', await sha256(doomed)); assert.equal((await raw(doomed, { query: '{ shop { name } }' })).status, 401)
    const dk = await makeKey('delivery'); const other = await raw(dk, { query: '{ shop { name } }' }); assert.equal(other.status, 403); assert.ok(other.body.errors[0].message)
    const bad = await raw(key, { query: '{ shop { nosuch } }' }); assert.equal(bad.status, 200); assert.ok(bad.body.errors && bad.body.errors.length)
    const asBearer = await raw(null, { query: '{ shop { name } }' }, { Authorization: 'Bearer ' + key }); assert.equal(asBearer.status, 200)
  })
  await ok('a cart\'s life through the client: created, added to, updated, a line removed, the buyer identity, the cost the catalog\'s arithmetic, the errors, the checkout url', async () => {
    const { data: list } = await client.request('{ products(first: 50) { nodes { handle variants(first: 50) { nodes { id sku price { amount } requiresShipping } } } } }')
    const variants = list.products.nodes.flatMap((p) => p.variants.nodes)
    const ship = variants.find((v) => v.requiresShipping) || variants[0], other = variants.find((v) => v.sku !== ship.sku) || ship
    const FIELDS = 'id checkoutUrl totalQuantity cost { totalAmount { amount currencyCode } subtotalAmount { amount } } lines(first: 10) { nodes { id quantity merchandise { ... on ProductVariant { id sku price { amount } } } cost { totalAmount { amount } } } } buyerIdentity { email countryCode }'
    const CART = 'cart { ' + FIELDS + ' }'
    const { data: c } = await client.request(`mutation($l: [CartLineInput!]) { cartCreate(input: { lines: $l }) { ${CART} userErrors { code message } } }`, { variables: { l: [{ merchandiseId: ship.id, quantity: 2 }] } })
    assert.deepEqual(c.cartCreate.userErrors, []); createdCart = c.cartCreate.cart; assert.ok(createdCart.id.startsWith('gid://shopify/Cart/')); assert.match(createdCart.checkoutUrl, /\/cart\/c\/[a-f0-9]{36}$/)
    const shipQty = createdCart.lines.nodes[0].quantity   /* 2, or 1 for a line that never stacks */
    assert.equal(createdCart.totalQuantity, shipQty); assert.equal(Number(createdCart.cost.totalAmount.amount).toFixed(2), (Number(ship.price.amount) * shipQty).toFixed(2))
    const { data: a } = await client.request(`mutation($id: ID!, $l: [CartLineInput!]!) { cartLinesAdd(cartId: $id, lines: $l) { ${CART} userErrors { code } } }`, { variables: { id: createdCart.id, l: [{ merchandiseId: other.id, quantity: 1 }] } })
    const expect = other.sku === ship.sku ? Number(ship.price.amount) * Math.min(10, shipQty + 1) : Number(ship.price.amount) * shipQty + Number(other.price.amount)
    assert.equal(Number(a.cartLinesAdd.cart.cost.totalAmount.amount).toFixed(2), expect.toFixed(2), 'the arithmetic')
    const line = a.cartLinesAdd.cart.lines.nodes.find((n) => n.merchandise.id === other.id)
    const { data: u } = await client.request(`mutation($id: ID!, $l: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $id, lines: $l) { ${CART} userErrors { code } } }`, { variables: { id: createdCart.id, l: [{ id: line.id, quantity: 3 }] } })
    const uLine = u.cartLinesUpdate.cart.lines.nodes.find((n) => n.id === line.id); assert.ok(uLine.quantity === 3 || uLine.quantity === 1, 'updated (or held at one for a line that never stacks)')
    const { data: rm } = await client.request(`mutation($id: ID!, $ids: [ID!]!) { cartLinesRemove(cartId: $id, lineIds: $ids) { ${CART} userErrors { code } } }`, { variables: { id: createdCart.id, ids: [line.id] } })
    assert.ok(!rm.cartLinesRemove.cart.lines.nodes.some((n) => n.id === line.id))
    const { data: b } = await client.request(`mutation($id: ID!) { cartBuyerIdentityUpdate(cartId: $id, buyerIdentity: { email: "buyer@example.com", countryCode: US }) { ${CART} userErrors { code } } }`, { variables: { id: createdCart.id } })
    assert.deepEqual(JSON.parse(JSON.stringify(b.cartBuyerIdentityUpdate.cart.buyerIdentity)), { email: 'buyer@example.com', countryCode: 'US' })
    const { data: e } = await client.request(`mutation($id: ID!) { cartLinesAdd(cartId: $id, lines: [{ merchandiseId: "gid://shopify/ProductVariant/nope" }]) { cart { totalQuantity } userErrors { code field message } } }`, { variables: { id: createdCart.id } })
    assert.equal(e.cartLinesAdd.userErrors[0].code, 'INVALID_MERCHANDISE_LINE'); assert.equal(e.cartLinesAdd.cart.totalQuantity, b.cartBuyerIdentityUpdate.cart.totalQuantity, 'nothing changed')
    const { data: read } = await client.request(`query($id: ID!) { cart(id: $id) { ${FIELDS} } }`, { variables: { id: createdCart.id } }); assert.equal(read.cart.id, createdCart.id)
    const { data: none } = await client.request('{ cart(id: "gid://shopify/Cart/000000000000000000000000000000000000") { id } }'); assert.equal(none.cart, null)
    const hand = await fetch(FN + '/api/carts/' + createdCart.id.replace('gid://shopify/Cart/', '')); assert.equal(hand.status, 200); const h = await hand.json(); assert.ok(h.lines.length >= 1 && h.lines[0].sku && h.buyerIdentity.countryCode === 'US', 'the handoff read')
  })

  /* ---- (3) the checkout url, followed ---- */
  await ok('the checkout url followed: a guest\'s paperback paid under the mock; a book online on the bag with the sign-in; an unknown token expired', async () => {
    const appUrl = (process.env.VITE_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
    let up = false; try { up = (await fetch(appUrl + '/store', { signal: AbortSignal.timeout(3000) })).ok } catch { /* down */ }
    if (!up) { note('the dev server is not up at ' + appUrl + ' — the handoff is checked by hand'); return }
    const mock = process.env.STRIPE_MOCK === '1' || (fs.existsSync(path.join(ROOT, '.env.dev')) && /^STRIPE_MOCK=1/m.test(fs.readFileSync(path.join(ROOT, '.env.dev'), 'utf8')))   /* the functions must run under the mock too (their env file) */
    const printOffer = sellable.find((o) => o.kind === 'print') || sellable.find((o) => o.kind === 'download'), unlock = sellable.find((o) => o.kind === 'book')
    const { chromium } = await import('playwright')
    const shell = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync(shell) ? shell : undefined) })
    const shots = process.env.STOREFRONT_API_SHOTS
    try {
      const mk = async (merchandiseId, country) => { const { data } = await client.request('mutation($l: [CartLineInput!], $b: CartBuyerIdentityInput) { cartCreate(input: { lines: $l, buyerIdentity: $b }) { cart { id checkoutUrl } userErrors { code } } }', { variables: { l: [{ merchandiseId, quantity: 1 }], b: country ? { countryCode: country } : null } }); return data.cartCreate.cart }
      const local = (u) => u.replace(/^https?:\/\/[^/]+/, appUrl)
      if (printOffer && mock) {
        const { data: list } = await client.request('{ products(first: 50) { nodes { variants(first: 50) { nodes { id sku } } } } }')
        const v = list.products.nodes.flatMap((p) => p.variants.nodes).find((x) => x.sku === printOffer.sku)
        const cart = await mk(v.id, 'US')
        const pg = await (await browserContext(browser, { viewport: { width: 1280, height: 800 } })).newPage()
        await pg.goto(local(cart.checkoutUrl), { waitUntil: 'domcontentloaded', timeout: 30000 })
        if (shots) await pg.screenshot({ path: path.join(shots, 'handoff-loading.png') })
        await pg.waitForURL(/checkout=success/, { timeout: 30000 })
        const { data: rows } = await service.from('purchases').select('sku, user_id, email').eq('sku', printOffer.sku).order('created_at', { ascending: false }).limit(1)
        assert.ok(rows && rows.length && !rows[0].user_id, 'a guest\'s purchase of ' + printOffer.sku)
        if (printOffer.kind === 'print') { const { data: po } = await service.from('fulfilments').select('id, user_id').order('created_at', { ascending: false }).limit(1); assert.ok(po && po.length && !po[0].user_id, 'a guest\'s print order') }
        const bag = await pg.evaluate(() => { try { return localStorage.getItem('dl.cart.v2') } catch { return null } })
        note('a guest\'s ' + printOffer.kind + ' paid through the handoff' + (bag && JSON.parse(bag).length ? '' : ' (the bag emptied)'))
      } else note(printOffer ? 'no Stripe mock (STRIPE_MOCK=1 in .env) — the paid handoff is checked by hand' : 'no printed or downloadable offer on this site — the paid handoff is checked on the root')
      if (unlock) {
        const { data: pl } = await client.request('query($h: String!) { productByHandle(handle: $h) { title } }', { variables: { h: unlock.sku } })
        const cart = await mk('gid://shopify/ProductVariant/' + unlock.sku, null)
        const pg = await (await browserContext(browser, { viewport: { width: 1280, height: 800 } })).newPage()
        await pg.goto(local(cart.checkoutUrl), { waitUntil: 'domcontentloaded', timeout: 30000 })
        await pg.waitForSelector('.handoff-h', { timeout: 20000 }); await pg.waitForSelector('.au-card', { timeout: 20000 })
        const title = pl.productByHandle ? pl.productByHandle.title : unlock.title
        await pg.waitForFunction((t) => document.body.innerText.includes(t), title, { timeout: 20000 })   /* the bag drawer, open, holding the book */
        assert.ok(await pg.locator('.au-card').count(), 'the sign-in offered')
        if (shots) { await pg.screenshot({ path: path.join(shots, 'handoff-signin.png') }); await pg.emulateMedia({ colorScheme: 'dark' }); await pg.screenshot({ path: path.join(shots, 'handoff-signin-dark.png') }) }
      }
      const pg = await (await browserContext(browser, { viewport: { width: 1280, height: 800 } })).newPage()
      await pg.goto(appUrl + '/cart/c/' + '0'.repeat(36), { waitUntil: 'domcontentloaded', timeout: 30000 })
      await pg.waitForFunction((t) => document.body.innerText.includes(t), 'expired', { timeout: 20000 })
      if (shots) { await pg.screenshot({ path: path.join(shots, 'handoff-expired.png') }); await pg.emulateMedia({ colorScheme: 'dark' }); await pg.screenshot({ path: path.join(shots, 'handoff-expired-dark.png') }) }
    } finally { await browser.close() }
  })
} finally {
  const hashes = []; for (const k of made) hashes.push(await sha256(k))
  if (hashes.length) { await service.from('api_keys').delete().in('hash', hashes); await service.from('storefront_carts').delete().in('key_id', (await service.from('api_keys').select('id').in('hash', hashes)).data?.map((x) => x.id) || ['-']) }
  await service.from('storefront_carts').delete().is('key_id', null)
}
note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''}`)
process.exit(fail ? 1 : 0)
