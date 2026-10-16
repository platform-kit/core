/*
 * The offers, and the selected payment provider made to match them.
 *
 * catalog.json is written from content/store/products/*.md by build/catalog.mjs
 * (deploy runs it before the functions are deployed) — the product files are the
 * source of truth for what is sold, and Stripe is only where it is paid for.
 * `ensureOffer(sku)` synchronizes the selected provider's catalog for an offer
 * needs, so an empty Stripe account and a file that landed since the last push
 * both just work: the checkout function calls it for every sku in a cart, and
 * the push function calls `ensureAll()` on deploy.
 *
 * Stripe finds the product by offer metadata and the price by its lookup key.
 * A Stripe price is immutable, so when the file's amount,
 * currency or period no longer matches the live price, a NEW price is made
 * under the same lookup key (transferred), the old one is retired (active:
 * false — an existing subscription keeps it), and the product's default price
 * moves. Every price carries metadata.tier for a membership, which is what the
 * webhook writes on the entitlement — so a subscriber on the old price and one
 * on the new both hold the tier.
 */
import { getPaymentProvider } from './lib.ts'
import { of, onRefresh } from './compiled.ts'
import {
  assertPaymentCapabilities,
  PaymentProviderError,
} from './payment-provider.mjs'
import type { PaymentCatalogOffer } from './payment-provider.d.ts'

export type Offer = {
  sku: string; key: string; title: string; kind: 'book' | 'good' | 'membership' | 'session' | 'print' | 'download' | 'event'; billing: 'once' | 'subscription'
  period: 'weekly' | 'monthly' | null; unit_amount: number; currency: string
  tier: string | null; rank: number | null; book: string | null
  usage?: { unit: string; rate_micros: number; grant_micros?: number; included_micros?: number; meter?: string; overage_price_micros?: number; incremental_charge_minor?: number; speech_cost_per_second_micros?: number }
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

export const offerMetadata = (o: Offer): Record<string, string> => ({
  key: o.key,
  sku: o.sku,
  kind: o.kind,
  ...(o.tier ? { tier: o.tier } : {}),
  ...(o.book ? { book: o.book } : {}),
  ...(o.usage ? {
    usage_unit: o.usage.unit,
    usage_rate_micros: String(o.usage.rate_micros),
    ...(o.usage.grant_micros === undefined ? {} : { usage_grant_micros: String(o.usage.grant_micros) }),
    ...(o.usage.included_micros === undefined ? {} : { usage_included_micros: String(o.usage.included_micros) }),
    ...(o.usage.meter ? { usage_meter: o.usage.meter } : {}),
    ...(o.usage.overage_price_micros === undefined ? {} : { usage_overage_price_micros: String(o.usage.overage_price_micros) }),
    ...(o.usage.incremental_charge_minor === undefined ? {} : { usage_incremental_charge_minor: String(o.usage.incremental_charge_minor) }),
    ...(o.usage.incremental_charge_minor === undefined ? {} : { usage_incremental_charge_currency: o.currency.toLowerCase() }),
    usage_speech_cost_per_second_micros: String(o.usage.speech_cost_per_second_micros ?? 0),
  } : {}),
})
/* every currency the lists price this offer in, besides its own — each a `unit_amount` under its
   ISO code, represented here without provider-specific catalog fields */
function currencyOptionsOf(o: Offer): Record<string, number> {
  const out: Record<string, number> = {}
  for (const list of LISTS || []) {
    for (const x of list.prices || []) {
      if (x.sku !== o.sku) continue
      const cur = String(x.currency || 'usd').toLowerCase()
      if (cur === String(o.currency).toLowerCase()) continue
      /* the offer-level price, not a variant’s: a variant is charged inline where it differs */
      if ((x.variant || '') !== '') continue
      out[cur] = x.amount
    }
  }
  return out
}

function catalogOffer(o: Offer): PaymentCatalogOffer {
  const usage = o.usage
  if (usage && (!usage.meter || !Number.isSafeInteger(usage.overage_price_micros) || usage.overage_price_micros <= 0)) {
    throw new Error(`metered offer "${o.sku}" requires a meter and positive overage price`)
  }
  if (usage?.incremental_charge_minor !== undefined &&
      (!Number.isSafeInteger(usage.incremental_charge_minor) || usage.incremental_charge_minor <= 0)) {
    throw new Error(`metered offer "${o.sku}" has an invalid incremental-charge threshold`)
  }
  return {
    offerKey: o.key,
    sku: o.sku,
    name: o.title,
    kind: o.billing === 'subscription' ? 'subscription' : 'one-time',
    currency: o.currency,
    unitAmountMinor: o.unit_amount,
    ...(o.period ? { interval: o.period === 'weekly' ? 'week' : 'month', intervalCount: 1 } : {}),
    currencyOptions: currencyOptionsOf(o),
    ...(usage ? {
      usage: {
        meter: usage.meter,
        unit: usage.unit,
        rateMicros: usage.rate_micros,
        ...(usage.included_micros === undefined ? {} : { includedMicros: usage.included_micros }),
        overagePriceMicros: usage.overage_price_micros,
        ...(usage.incremental_charge_minor === undefined ? {} : { incrementalChargeMinor: usage.incremental_charge_minor }),
        ...(usage.speech_cost_per_second_micros === undefined
          ? {}
          : { speechCostPerSecondMicros: usage.speech_cost_per_second_micros }),
      },
    } : {}),
    metadata: offerMetadata(o),
  }
}

async function syncCatalog(offers: readonly PaymentCatalogOffer[]) {
  const provider = await getPaymentProvider()
  assertPaymentCapabilities(provider, ['catalog.sync'])
  if (!provider.syncCatalog) {
    throw new PaymentProviderError('catalog_sync_unavailable', `Payment provider "${provider.id}" declares no catalog synchronizer.`, 500)
  }
  const result = await provider.syncCatalog(offers)
  if (result.provider !== provider.id) {
    throw new PaymentProviderError('catalog_provider_mismatch', `Payment provider "${provider.id}" returned a catalog result for "${result.provider}".`, 502)
  }
  for (const requested of offers) {
    if (!result.offers[requested.offerKey]?.productId || !result.offers[requested.offerKey]?.priceId) {
      throw new PaymentProviderError('catalog_offer_missing', `Payment provider "${provider.id}" did not return synchronized ids for "${requested.offerKey}".`, 502)
    }
  }
  return result
}

export async function ensureOffer(sku: string): Promise<{ product: string; price: string; made: boolean; usage_price?: string }> {
  const o = offer(sku)
  if (!o) throw new Error(`unknown offer ${sku}`)
  const result = await syncCatalog([catalogOffer(o)])
  const synced = result.offers[o.key]
  return {
    product: synced.productId,
    price: synced.priceId,
    made: synced.made ?? false,
    ...(synced.usagePriceId ? { usage_price: synced.usagePriceId } : {}),
  }
}

/* every offer, for the deploy's push */
export async function ensureAll() {
  const catalogOffers = Object.values(OFFERS).map(catalogOffer)
  const result = await syncCatalog(catalogOffers)
  const out: Record<string, { product: string; price: string; made: boolean; usage_price?: string }> = {}
  for (const o of Object.values(OFFERS)) {
    const synced = result.offers[o.key]
    out[o.sku] = {
      product: synced.productId,
      price: synced.priceId,
      made: synced.made ?? false,
      ...(synced.usagePriceId ? { usage_price: synced.usagePriceId } : {}),
    }
  }
  return out
}
