/*
 * The Store API — the site's store served as Shopify's Storefront API (store-api): one GraphQL endpoint at
 * <domain>/api/<version>/graphql.json (the host rewrite `/api/*` → this function; its own address answers too), the
 * public token a key of kind `storefront` sent as X-Shopify-Storefront-Access-Token (or a bearer), so a headless
 * storefront, `@shopify/storefront-api-client` or Hydrogen's storefront client work with the domain swapped. The
 * schema is the Storefront core (_shared/api/shopify/schema.js) over what the site's bag sells (products.js: the
 * catalog's offers and the content index's product, collection and book records); a cart is a row of
 * storefront_carts, its checkoutUrl the site's own handoff page (/cart/c/<token>), which fills the bag and checks out
 * as the site does — nothing is bought through this door. Shopify's error shape ({ errors: [{ message }] }) for the
 * door's own refusals; GraphQL's for a query's.
 *
 *   POST /api/<version>/graphql.json  { query, variables, operationName }     GET …/graphql.json?query=
 *   GET  /api/carts/<token>                                                    the handoff page's read (no token: the id is the secret)
 */
import { admin, appUrl } from '../_shared/lib.ts'
import { tokenOf, keyOf, rateLimit } from '../_shared/api/keys.ts'
import { API_ON, STORE_ON } from '../_shared/api/flags.ts'
import { OFFERS } from '../_shared/offers.ts'
import { of } from '../_shared/compiled.ts'
/* the catalog as this deployment has it: the shipped file, or the row a publish wrote */
const catalog = of<Record<string, any>>('catalog')
import { contentIndexes } from '../_shared/content-index.ts'
import { makeContext } from '../_shared/api/context.js'
import { assetUrl } from '../_shared/api/entry.js'
import { storefrontOf, GID } from '../_shared/api/shopify/products.js'
import { execute } from '../_shared/api/shopify/schema.js'
import { cartOf } from '../_shared/api/shopify/cart.js'
import { fresh } from '../_shared/compiled.ts'   /* the compiled artefacts, re-read within a few seconds of a publish */

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept, x-shopify-storefront-access-token, shopify-storefront-private-token, x-sdk-variant, x-sdk-version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const site = () => appUrl()
const TABLE = 'storefront_carts'
let cached: { at: number; store: any } | null = null
const TTL = 5000

/* the store, from the live index (the drafts never) and the catalog; kept a few seconds */
async function storeNow() {
  if (cached && Date.now() - cached.at < TTL) return cached.store
  const { live } = await contentIndexes()
  const imagesBase = (live.site.url || site()).replace(/^https?:/, '') + '/images'
  const ctx = makeContext(live, { imagesBase })
  const recs = (m: string) => live.records.filter((r: any) => r.model === m)
  const store = storefrontOf({
    offers: OFFERS, products: recs('products'), collections: recs('collections'), books: recs('books'),
    site: { name: live.site.name, url: live.site.url || site(), description: live.site.description },
    imageUrl: (address: string) => { const a = ctx.assetsByAddress.get(address); return a ? 'https:' + assetUrl(a, ctx) : (address && /^https?:/.test(address) ? address : null) },
    imageSize: (address: string) => { const a: any = ctx.assetsByAddress.get(address); return a && a.width ? { width: a.width, height: a.height } : null },
    shipsTo: ((catalog as any).shipping?.countries ?? []),
  })
  cached = { at: Date.now(), store }
  return store
}
const newToken = () => { const b = new Uint8Array(18); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') }
const carts = (keyId: string | null) => ({
  get: async (id: string) => { if (!/^[a-f0-9]{36}$/.test(id)) return null; const { data } = await admin.from(TABLE).select('*').eq('id', id).maybeSingle(); return data ?? null },
  create: async (row: any) => { const rec = { ...row, id: newToken(), key_id: keyId }; const { data, error } = await admin.from(TABLE).insert(rec).select('*').single(); if (error) throw new Error(error.message); return data },
  save: async (row: any) => { const { id, ...rest } = row; const { data, error } = await admin.from(TABLE).update(rest).eq('id', id).select('*').single(); if (error) throw new Error(error.message); return data },
})

Deno.serve(async (req) => {
  await fresh()
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const path = url.pathname.replace(/^(?:.*?\/functions\/v1)?\/storefront-api(?=\/|$)/, '').replace(/\/+$/, '') || '/'
  let extra: Record<string, string> = {}
  const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, ...extra, 'Content-Type': 'application/json', ...headers } })
  const fail = (status: number, message: string) => reply({ errors: [{ message }] }, status)
  /* This function is the store and only the store. Each API has a room of its own under /api
     (/api/store here) and the host's rule sends each to its own function, so nothing is routed
     through here and nothing pays for a hop that is not its own. */
  if (!API_ON || !STORE_ON) return fail(404, 'The Store API is not on for this site.')

  /* the handoff page's read: the cart by its token, with the lines the bag takes */
  /* The store's room is /api/store, and its alias is /api — Shopify's client discards a path on
     the storeDomain and asks at the top whatever it is given. Both arrive here the same, bar the
     /api their own endpoint carries, so the handoff read is matched with or without it. */
  const handoff = /^\/(?:api\/)?carts\/([a-f0-9]{36})$/.exec(path)
  if (handoff && req.method === 'GET') {
    const row = await carts(null).get(handoff[1])
    if (!row) return fail(404, 'The cart does not exist.')
    const store = await storeNow()
    const c = cartOf(store, row, { site: site() })
    return reply({ id: row.id, checkoutUrl: c.checkoutUrl, buyerIdentity: c.buyerIdentity, totalQuantity: c.totalQuantity, lines: c._lines.map((l: any) => ({ id: l.id, quantity: l.quantity, sku: l.merchandise._line.sku, variant: l.merchandise._line.variant, kind: l.merchandise._line.kind, name: l.merchandise._line.name, label: l.merchandise._line.label, unit_amount: Math.round(Number(l.merchandise.price.amount) * 100), currency: l.merchandise.price.currencyCode.toLowerCase(), image: l.merchandise.image?._address ?? l.merchandise.image?.url ?? null, handle: l.merchandise.product.handle })) })   /* the picture by its own address: the site serves it, as the product page's line does */
  }

  if (!/^\/api\/[^/]+\/graphql(\.json)?$/.test(path)) return fail(404, 'Not found: the endpoint is /api/<version>/graphql.json.')
  const q: Record<string, string> = {}; url.searchParams.forEach((v, k) => { q[k] = v })
  const token = req.headers.get('x-shopify-storefront-access-token') || req.headers.get('shopify-storefront-private-token') || tokenOf(req, q)
  const caller = await keyOf(token, ['storefront'])
  if (caller === 'other-kind') return fail(403, 'This key does not open the Store API: make one of kind storefront under Settings → API.')
  if (!caller) return fail(401, 'The Storefront access token is invalid (X-Shopify-Storefront-Access-Token).')
  const rl = await rateLimit(caller.id ?? 'key'); extra = rl.headers
  if (rl.over) return reply({ errors: [{ message: 'Throttled' }] }, 429, { 'Retry-After': String(rl.reset) })

  let body: any = {}
  if (req.method === 'POST') { try { body = await req.json() } catch { return fail(400, 'The body is not JSON.') } }
  else if (req.method === 'GET') body = { query: q.query, variables: q.variables ? JSON.parse(q.variables) : {}, operationName: q.operationName }
  else return fail(405, 'GET or POST.')
  if (!body || typeof body.query !== 'string') return fail(400, 'A query is required.')
  try {
    const store = await storeNow()
    const out = await execute(store, { query: body.query, variables: body.variables || {}, operationName: body.operationName }, carts(caller.id), { site: site(), keyId: caller.id })
    return reply(out)
  } catch (e) {
    console.error('storefront-api', e)
    return fail(500, String((e as Error)?.message ?? e))
  }
})
