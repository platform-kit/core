const USAGE_SCALE = 1_000_000n
const STRIPE_DECIMAL_SCALE = 1_000_000_000_000n

function decimal(numerator, denominator) {
  const scaled = numerator * STRIPE_DECIMAL_SCALE / denominator
  const whole = scaled / STRIPE_DECIMAL_SCALE
  const fraction = (scaled % STRIPE_DECIMAL_SCALE).toString().padStart(12, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function meterUnitAmountDecimal(overagePriceMicros, currency) {
  if (!Number.isSafeInteger(overagePriceMicros) || overagePriceMicros <= 0) {
    throw new Error('metered overage price must be a positive safe integer in micro-units')
  }
  let minorUnitsPerMajor
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits
    minorUnitsPerMajor = 10n ** BigInt(digits)
  } catch {
    throw new Error(`cannot determine the minor-unit scale for currency ${currency}`)
  }
  return decimal(BigInt(overagePriceMicros) * minorUnitsPerMajor, USAGE_SCALE * USAGE_SCALE)
}

export function meteredCheckoutLine(offer, usagePrice) {
  if (!offer.usage?.meter) return null
  if (!usagePrice) throw new Error(`metered offer ${offer.sku} has no reconciled Stripe usage price`)
  return { price: usagePrice, quantity: 1 }
}

export function includedGrantForInvoice(subscription, invoice, periodStart, periodEnd, priceMetadata = {}) {
  const hasIncludedSnapshot = Object.prototype.hasOwnProperty.call(priceMetadata, 'usage_included_micros')
  const included = Number(hasIncludedSnapshot ? priceMetadata.usage_included_micros : subscription?.usage_included_micros)
  const offerKey = String(priceMetadata.usage_offer_key ?? subscription?.key ?? '')
  const meter = String(priceMetadata.usage_meter ?? subscription?.usage_meter ?? '')
  const sourceId = invoice?.id ? `invoice:${invoice.id}` : ''
  if (!['subscription_create', 'subscription_cycle'].includes(invoice?.billing_reason) ||
      !subscription?.user_id || !offerKey || !meter ||
      !Number.isSafeInteger(included) || included <= 0 || !sourceId || !periodStart || !periodEnd) return null
  return {
    user_id: subscription.user_id,
    offer_key: offerKey,
    source: 'subscription',
    source_id: sourceId,
    units_micros: included,
    period_start: periodStart,
    expires_at: periodEnd,
    usage_unit: priceMetadata.usage_unit ?? subscription.usage_unit ?? null,
    rate_micros: Number(priceMetadata.usage_rate_micros ?? subscription.usage_rate_micros) || null,
    speech_cost_per_second_micros: Number(
      priceMetadata.usage_speech_cost_per_second_micros ?? subscription.usage_speech_cost_per_second_micros,
    ) || 0,
    meter,
    overage_price_micros: Number(priceMetadata.usage_overage_price_micros ?? subscription.usage_overage_price_micros) || null,
  }
}

export function unitsForCost(costMicros, rateMicros) {
  if (!Number.isSafeInteger(costMicros) || costMicros < 0 ||
      !Number.isSafeInteger(rateMicros) || rateMicros <= 0) {
    throw new Error('usage cost and rate must be non-negative/positive safe integers in micro-dollars')
  }
  if (!costMicros) return 0
  const cost = BigInt(costMicros) * 1_000_000n
  const rate = BigInt(rateMicros)
  const units = (cost + rate - 1n) / rate
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('calculated usage exceeds the safe integer range')
  return Number(units)
}

export function boundedModelUsage({ messages, tools = [], prices, remainingCostMicros, maxOutputTokens = 4096 }) {
  if (!Array.isArray(messages) || !Array.isArray(tools) || !Array.isArray(prices) || !prices.length ||
      !Number.isSafeInteger(remainingCostMicros) || remainingCostMicros <= 0 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error('model usage needs a request, priced providers, and a positive remaining spend limit')
  }
  const rates = prices.map((price) => ({
    input: Number(price?.in),
    output: Number(price?.out),
  }))
  if (rates.some((rate) => !Number.isFinite(rate.input) || rate.input <= 0 ||
      !Number.isFinite(rate.output) || rate.output <= 0)) {
    throw new Error('a billed model provider has no known input and output price')
  }

  const requestBytes = new TextEncoder().encode(JSON.stringify({ messages, tools })).length
  const inputTokens = requestBytes + messages.length * 32 + tools.length * 64 + 128
  const inputCostMicros = Math.ceil(inputTokens * Math.max(...rates.map((rate) => rate.input)))
  const outputRate = Math.max(...rates.map((rate) => rate.output))
  const outputTokens = Math.min(maxOutputTokens, Math.floor((remainingCostMicros - inputCostMicros - 100) / outputRate))
  if (outputTokens < 1) throw new Error('model call exceeds the remaining run spend limit')

  const maxCostMicros = Math.ceil(inputCostMicros + outputTokens * outputRate + 100)
  if (!Number.isSafeInteger(maxCostMicros)) throw new Error('model usage reservation exceeds the ledger range')
  return { inputTokens, maxOutputTokens: outputTokens, maxCostMicros }
}

export async function sendUsageMeterEvent(stripe, report) {
  if (!report?.identifier || !report?.event_name || !report?.stripe_customer_id ||
      !Number.isSafeInteger(Number(report.value_micros)) || Number(report.value_micros) <= 0) {
    throw new Error('usage meter report is missing its stable identifier, meter, customer, or positive value')
  }
  const timestamp = Math.floor(new Date(report.created_at).getTime() / 1000)
  if (!Number.isFinite(timestamp)) throw new Error('usage meter report has an invalid creation time')
  return stripe.billing.meterEvents.create({
    event_name: report.event_name,
    identifier: report.identifier,
    payload: { stripe_customer_id: report.stripe_customer_id, value: String(report.value_micros) },
    timestamp,
  }, { idempotencyKey: `usage-meter-event:${report.identifier}` })
}

function sameMeterConfiguration(meter) {
  return meter.default_aggregation?.formula === 'sum' &&
    meter.customer_mapping?.type === 'by_id' &&
    (meter.customer_mapping?.event_payload_key ?? 'stripe_customer_id') === 'stripe_customer_id' &&
    (meter.value_settings?.event_payload_key ?? 'value') === 'value'
}

async function findMeter(stripe, eventName) {
  let params = { status: 'active', limit: 100 }
  while (true) {
    const page = await stripe.billing.meters.list(params)
    const matches = page.data.filter((meter) => meter.event_name === eventName)
    if (matches.length > 1) throw new Error(`multiple active Stripe meters use event ${eventName}`)
    if (matches.length) return matches[0]
    if (!page.has_more) return null
    const last = page.data.at(-1)
    if (!last) throw new Error(`Stripe returned an empty meter page while listing event ${eventName}`)
    params = { ...params, starting_after: last.id }
  }
}

async function ensureMeter(stripe, offer) {
  const usage = offer.usage
  const existing = await findMeter(stripe, usage.meter)
  if (existing) {
    if (!sameMeterConfiguration(existing)) {
      throw new Error(`Stripe meter ${usage.meter} exists with incompatible aggregation or payload mapping`)
    }
    return existing
  }
  return stripe.billing.meters.create({
    display_name: `${offer.title} usage`.slice(0, 250),
    event_name: usage.meter,
    default_aggregation: { formula: 'sum' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    value_settings: { event_payload_key: 'value' },
  }, { idempotencyKey: `usage-meter:${usage.meter}` })
}

export function usageStripeMetadata(offer, metadata) {
  const usage = offer.usage
  return {
    ...metadata,
    usage: 'metered',
    usage_offer_key: metadata.key ?? offer.key,
    usage_meter: usage.meter,
    usage_unit: usage.unit,
    usage_rate_micros: String(usage.rate_micros),
    usage_included_micros: String(usage.included_micros ?? 0),
    usage_overage_price_micros: String(usage.overage_price_micros),
    usage_speech_cost_per_second_micros: String(usage.speech_cost_per_second_micros ?? 0),
  }
}

function meterPriceMatches(price, offer, productId, meterId, amount, metadata) {
  return price.active &&
    String(price.product?.id ?? price.product) === productId &&
    price.type === 'recurring' &&
    price.billing_scheme === 'per_unit' &&
    price.currency === offer.currency.toLowerCase() &&
    price.unit_amount_decimal === amount &&
    price.recurring?.interval === (offer.period === 'weekly' ? 'week' : 'month') &&
    (price.recurring?.interval_count ?? 1) === 1 &&
    String(price.recurring?.meter?.id ?? price.recurring?.meter) === meterId &&
    Object.entries(metadata).every(([key, value]) => price.metadata?.[key] === value)
}

export async function ensureUsageBilling(stripe, offer, productId, metadata) {
  if (!offer.usage || offer.billing !== 'subscription') return null
  const meter = await ensureMeter(stripe, offer)
  const lookupKey = `${offer.key}_usage`
  const amount = meterUnitAmountDecimal(offer.usage.overage_price_micros, offer.currency)
  const snapshot = usageStripeMetadata(offer, metadata)
  const live = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 2 })
  const current = live.data.find((price) => price.lookup_key === lookupKey)
  if (current && String(current.product?.id ?? current.product) !== productId) {
    throw new Error(`Stripe lookup key ${lookupKey} belongs to a different product`)
  }
  if (current && meterPriceMatches(current, offer, productId, meter.id, amount, snapshot)) {
    return { price: current.id, meter: meter.id, made: false }
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: offer.currency.toLowerCase(),
    unit_amount_decimal: amount,
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: snapshot,
    recurring: {
      interval: offer.period === 'weekly' ? 'week' : 'month',
      meter: meter.id,
    },
  }, {
    idempotencyKey: `usage-price:${offer.key}:${meter.id}:${offer.currency}:${amount}:${offer.period}:${offer.usage.unit}:${offer.usage.rate_micros}:${offer.usage.included_micros ?? 0}:${offer.usage.speech_cost_per_second_micros ?? 0}`,
  })
  if (current) await stripe.prices.update(current.id, { active: false })
  return { price: price.id, meter: meter.id, made: true }
}
