/*
 * The offers, and Stripe made to match them.
 *
 * catalog.json is written from content/store/products/*.md by build/catalog.mjs
 * (deploy runs it before the functions are deployed) — the product files are the
 * source of truth for what is sold, and Stripe is only where it is paid for.
 * `ensureOffer(sku)` finds or creates the Stripe product and price an offer
 * needs, so an empty Stripe account and a file that landed since the last push
 * both just work: the checkout function calls it for every sku in a cart, and
 * the push function calls `ensureAll()` on deploy.
 *
 * How an offer is found in Stripe: the product by metadata.sku, the price by
 * lookup_key = sku. A price is immutable in Stripe, so when the file's amount,
 * currency or period no longer matches the live price, a NEW price is made
 * under the same lookup key (transferred), the old one is retired (active:
 * false — an existing subscription keeps it), and the product's default price
 * moves. Every price carries metadata.tier for a membership, which is what the
 * webhook writes on the entitlement — so a subscriber on the old price and one
 * on the new both hold the tier.
 */
import { stripe } from './lib.ts'
import { of, onRefresh } from './compiled.ts'

export type Offer = {
  sku: string; key: string; title: string; kind: 'book' | 'good' | 'membership' | 'session' | 'print' | 'download' | 'event'; billing: 'once' | 'subscription'
  period: 'weekly' | 'monthly' | null; unit_amount: number; currency: string
  tier: string | null; rank: number | null; book: string | null
  /* a book in print (src/lib/print-offers.js): the format this sku is, its binding, the choices a line may carry, the files that come with it */
  format?: string; binding?: string | null; trim?: string; paper?: string; contents?: string[]; cloth?: string[] | null; foil?: string[] | null; includes?: string[]
}
/* What ships and what a variant may be are decisions over plain data, so they live in
   ledger-rules.js where they can be checked without a stack — and are re-exported here because this
   is where callers expect to find them. Defined once: the same two rules written in two places is
   how the checkout and the confirmation come to disagree about what somebody bought. */
export { ships, printVariant } from './ledger-rules.js'
/* live bindings over the catalog: the file the build shipped, or the row a publish wrote where
   nothing rebuilds (./compiled.ts) */
export let LISTS: any[] = []
export let PROMOTIONS: any[] = []
export let OFFERS: Record<string, Offer> = {}
export let TIERS: Record<string, number> = {}
/* the words Checkout shows, from the store's strings (build/catalog.mjs carries them) */
export let WORDS: Record<string, string> = {}
onRefresh(() => {
  const catalog = of<Record<string, any>>('catalog')
  OFFERS = catalog.offers ?? {}
  LISTS = catalog.lists ?? []
  PROMOTIONS = catalog.promotions ?? []
  TIERS = catalog.tiers ?? {}
  WORDS = catalog.words ?? {}
})
export const offer = (sku: string): Offer | null => OFFERS[sku] ?? null
/* by the identity a sale is attributed by — a price's lookup key, a ledger row's key */
export const offerByKey = (key: string): Offer | null => Object.values(OFFERS).find((o) => o.key === key) ?? null

const interval = (o: Offer) => (o.period === 'weekly' ? 'week' : 'month')
const priceMatches = (p: any, o: Offer) =>
  p.active && p.unit_amount === o.unit_amount && p.currency === o.currency &&
  (o.billing === 'subscription' ? p.type === 'recurring' && p.recurring?.interval === interval(o) && (p.recurring?.interval_count ?? 1) === 1 : p.type === 'one_time')

const meta = (o: Offer) => ({ key: o.key, sku: o.sku, kind: o.kind, ...(o.tier ? { tier: o.tier } : {}), ...(o.book ? { book: o.book } : {}) })

/* the Stripe product for an offer: found by metadata.key (the offer's identity), else
   created; its name and sku kept current, since both may change */
export async function ensureProduct(o: Offer) {
  const found = await stripe.products.search({ query: `active:'true' AND metadata['key']:'${o.key}'`, limit: 1 })
  let p = found.data[0]
  /* a product made before offers had keys is found by its sku once, and given its key */
  if (!p) { const old = await stripe.products.search({ query: `active:'true' AND metadata['sku']:'${o.sku}'`, limit: 1 }); p = old.data[0] }
  if (!p) p = await stripe.products.create({ name: o.title, metadata: meta(o) })
  else if (p.name !== o.title || p.metadata?.sku !== o.sku || p.metadata?.key !== o.key) p = await stripe.products.update(p.id, { name: o.title, metadata: meta(o) })
  return p
}

/* the Stripe price for a sku: the live one under the offer's key (its lookup key) when
   it matches the file, else a new one under that key with the old retired */
/* every currency the lists price this offer in, besides its own — each a `unit_amount` under its
   ISO code, which is exactly the shape Stripe wants */
function currencyOptionsOf(o: any): Record<string, { unit_amount: number }> {
  const out: Record<string, { unit_amount: number }> = {}
  for (const list of LISTS || []) {
    for (const x of list.prices || []) {
      if (x.sku !== o.sku) continue
      const cur = String(x.currency || 'usd').toLowerCase()
      if (cur === String(o.currency).toLowerCase()) continue
      /* the offer-level price, not a variant’s: a variant is charged inline where it differs */
      if ((x.variant || '') !== '') continue
      out[cur] = { unit_amount: x.amount }
    }
  }
  return out
}

export async function ensureOffer(sku: string): Promise<{ product: string; price: string; made: boolean }> {
  const o = offer(sku)
  if (!o) throw new Error(`unknown offer ${sku}`)
  const product = await ensureProduct(o)
  const live = await stripe.prices.list({ lookup_keys: [o.key], active: true, limit: 1 })
  const current = live.data[0]
  /* a price still under the sku from before offers had keys retires, so one offer has one live price */
  const retireBySku = async (keep: string) => { const bySku = await stripe.prices.list({ lookup_keys: [o.sku], active: true, limit: 1 }); for (const p of bySku.data) if (p.product === product.id && p.id !== keep) { await stripe.products.update(product.id, { default_price: keep }); await stripe.prices.update(p.id, { active: false }) } }
  if (current && current.product === product.id && priceMatches(current, o)) { await retireBySku(current.id); return { product: product.id, price: current.id, made: false } }
  /*
   * A SECOND CURRENCY IS AN ENTRY ON THIS PRICE, NOT A SECOND PRICE.
   *
   * Stripe's `currency_options` carries an amount per ISO code on one price, so an offer keeps
   * ONE key and one identity however many currencies it is sold in. Minting a price per
   * currency would scatter the thing every purchase, subscription and lookup hangs off.
   *
   * It is not returned by default — a read must expand it — which is why `priceMatches` asks
   * for it rather than assuming what it finds is the whole price.
   */
  const options = currencyOptionsOf(o)
  const price = await stripe.prices.create({
    product: product.id, unit_amount: o.unit_amount, currency: o.currency,
    lookup_key: o.key, transfer_lookup_key: true, metadata: meta(o),
    ...(Object.keys(options).length ? { currency_options: options } : {}),
    ...(o.billing === 'subscription' ? { recurring: { interval: interval(o) } } : {}),
  })
  /* the new price becomes the product's default first — Stripe will not archive a default — then the old one retires */
  await stripe.products.update(product.id, { default_price: price.id })
  if (current) await stripe.prices.update(current.id, { active: false })
  await retireBySku(price.id)
  return { product: product.id, price: price.id, made: true }
}

/* every offer, for the deploy's push */
export async function ensureAll() {
  const out: Record<string, { product: string; price: string; made: boolean }> = {}
  for (const sku of Object.keys(OFFERS)) out[sku] = await ensureOffer(sku)
  return out
}
