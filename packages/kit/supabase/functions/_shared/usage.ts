import { admin, stripe, stripeMock } from './lib.ts'
import { of, fresh } from './compiled.ts'
import { sendUsageMeterEvent } from './usage-stripe.mjs'
import { createUsageTopUp } from './usage-topup.mjs'
import { createUsageGate } from './usage-gate.mjs'

type UsageOffer = {
  key: string
  sku: string
  usage?: {
    unit: string
    rate_micros: number
    speech_cost_per_second_micros?: number
    meter?: string
    overage_price_micros?: number
  }
}

const checked = <T>(data: T, error: { message: string } | null, context: string): T => {
  if (error) throw new Error(`${context}: ${error.message}`)
  return data
}

async function paymentMethodFor(userId: string) {
  const { data, error } = await admin.from('profiles').select('stripe_customer_id').eq('id', userId).maybeSingle()
  const profile = checked(data, error, 'billing profile could not be loaded')
  if (!profile?.stripe_customer_id) return null
  if (stripeMock) return { customer: profile.stripe_customer_id, paymentMethod: 'pm_mock_usage' }
  const customer = await stripe.customers.retrieve(profile.stripe_customer_id, {
    expand: ['invoice_settings.default_payment_method'],
  }) as any
  if (customer.deleted) return null
  const method = customer.invoice_settings?.default_payment_method
  return method ? {
    customer: customer.id,
    paymentMethod: typeof method === 'string' ? method : method.id,
  } : null
}

async function autoTopUp({ userId, invocationRef }: { userId: string; invocationRef: string }) {
  const catalog = of<Record<string, any>>('catalog')
  const config = catalog.usage_auto_topup || { enabled: false, packs: [] }
  const runner = createUsageTopUp({
    config,
    preference: async (id: string) => {
      const { data, error } = await admin.from('usage_topup_preferences').select('*').eq('user_id', id).maybeSingle()
      return checked(data, error, 'automatic top-up preference could not be loaded')
    },
    paymentMethod: paymentMethodFor,
    begin: async (input: Record<string, any>) => {
      const { data, error } = await admin.rpc('usage_topup_begin', {
        p_user_id: input.userId,
        p_attempt_ref: input.attemptRef,
        p_offer_key: input.offerKey,
        p_currency: input.currency,
        p_amount_minor: input.amountMinor,
        p_units_micros: input.unitsMicros,
        p_site_enabled: input.siteEnabled,
        p_usage_unit: input.usageUnit,
        p_rate_micros: input.rateMicros,
        p_speech_cost_per_second_micros: input.speechCostPerSecondMicros,
      })
      return checked(data, error, 'automatic top-up could not be reserved')
    },
    finish: async ({ attemptRef, status, paymentIntentId, error: reason }: Record<string, any>) => {
      const { data, error } = await admin.rpc('usage_topup_finish', {
        p_attempt_ref: attemptRef,
        p_status: status,
        p_payment_intent_id: paymentIntentId || null,
        p_error: reason || null,
      })
      return checked(data, error, 'automatic top-up result could not be saved') === true
    },
    grant: async ({ userId: id, offerKey, sourceId, unitsMicros, usageUnit, rateMicros, speechCostPerSecondMicros }: Record<string, any>) => {
      const { data, error } = await admin.rpc('usage_grant', {
        p_user_id: id,
        p_offer_key: offerKey,
        p_source: 'purchase',
        p_source_id: sourceId,
        p_units_micros: unitsMicros,
        p_usage_unit: usageUnit,
        p_rate_micros: rateMicros,
        p_speech_cost_per_second_micros: speechCostPerSecondMicros,
      })
      if (error) throw new Error(`confirmed top-up grant could not be saved: ${error.message}`)
      if (data === true) return true
      const { data: existingRow, error: readError } = await admin.from('usage_grants')
        .select('units_micros,usage_unit,rate_micros,speech_cost_per_second_micros')
        .eq('user_id', id).eq('offer_key', offerKey).eq('source', 'purchase').eq('source_id', sourceId).maybeSingle()
      const existing = checked(existingRow, readError, 'confirmed top-up grant could not be verified')
      return Number(existing?.units_micros) === unitsMicros
        && existing?.usage_unit === usageUnit
        && Number(existing?.rate_micros) === rateMicros
        && Number(existing?.speech_cost_per_second_micros || 0) === speechCostPerSecondMicros
    },
    stripe,
    mock: stripeMock,
  })
  return runner({ userId, invocationRef })
}

const usageGate = createUsageGate({
  resolveOffer: async (key: string) => {
    await fresh()
    const offers = Object.values(of<Record<string, any>>('catalog').offers || {}) as UsageOffer[]
    return offers.find((offer) => offer.key === key && offer.usage) || null
  },
  reserve: async ({ userId, offerKey, invocationRef, maxUnitsMicros, expiresAt, offer, operationId, markupMicros }: Record<string, any>) => {
    const { data, error } = await admin.rpc(operationId ? 'usage_authorize_inference' : 'usage_authorize', {
      p_user_id: userId,
      p_offer_key: offerKey,
      p_reservation_ref: invocationRef,
      p_max_units_micros: maxUnitsMicros,
      p_expires_at: expiresAt || new Date(Date.now() + 15 * 60_000).toISOString(),
      p_usage_unit: offer.usage.unit,
      p_rate_micros: offer.usage.rate_micros,
      p_speech_cost_per_second_micros: offer.usage.speech_cost_per_second_micros || 0,
      p_meter: offer.usage.meter || null,
      p_overage_price_micros: offer.usage.overage_price_micros || null,
      ...(operationId ? { p_operation_id: operationId, p_markup_micros: markupMicros } : {}),
    })
    return checked(data, error, 'usage authorization could not be recorded')
  },
  autoTopUp,
  settle: async ({ invocationRef, operationId, kind, costMicros, secondsMicros = 0, unitsMicros, botId = null,
    markupMicros, customerCostMicros, retailValueMicros, retailCurrency, measurementStatus }: Record<string, any>) => {
    const { data, error } = await admin.rpc(operationId ? 'usage_settle_inference' : 'usage_settle', {
      p_reservation_ref: invocationRef,
      ...(operationId ? {
        p_operation_id: operationId,
        p_provider_cost_micros: costMicros,
        p_markup_micros: markupMicros,
        p_customer_cost_micros: customerCostMicros,
        p_retail_value_micros: retailValueMicros,
        p_retail_currency: retailCurrency,
        p_measurement_status: measurementStatus,
      } : { p_cost_micros: costMicros }),
      p_kind: kind,
      p_seconds_micros: secondsMicros,
      p_units_micros: unitsMicros,
      p_bot_id: botId,
    })
    return checked(data, error, 'measured usage could not be settled')
  },
  release: async ({ invocationRef }: Record<string, any>) => {
    const { data, error } = await admin.rpc('usage_release', { p_reservation_ref: invocationRef })
    return checked(data, error, 'unused usage reservation could not be released')
  },
})

/* Server-only contract. The caller must derive userId from a verified JWT or trusted job context;
   clients must never be given this function or its service-role implementation. */
export async function authorizeUsage(input: {
  userId: string
  offerKey: string
  invocationRef: string
  maxUnitsMicros: number
  botId?: string | null
  expiresAt?: string | null
  operationId?: string
  markupMicros?: number
}) {
  await fresh()
  return usageGate(input)
}

export async function recordInferenceAttempt(input: {
  invocationRef: string
  attemptNo: number
  userId?: string | null
  operationId: string
  botId?: string | null
  offerKey?: string | null
  sponsor: 'site' | 'reader'
  providerId: string
  model: string
  protocol: 'openai-chat' | 'anthropic'
  outcome: 'succeeded' | 'failed' | 'not_sent'
  measurementStatus: 'measured' | 'estimated' | 'not_sent'
  usageDimensions: Record<string, number>
  providerCostMicros: number
  markupMicros?: number | null
  customerCostMicros: number
  customerUnitsMicros: number
  retailValueMicros?: number | null
  retailCurrency?: string | null
  httpStatus?: number | null
}) {
  await fresh()
  const { data, error } = await admin.rpc('usage_inference_attempt_record', {
    p_invocation_ref: input.invocationRef,
    p_attempt_no: input.attemptNo,
    p_user_id: input.userId || null,
    p_operation_id: input.operationId,
    p_bot_id: input.botId || null,
    p_offer_key: input.offerKey || null,
    p_sponsor: input.sponsor,
    p_provider_id: input.providerId,
    p_model: input.model,
    p_protocol: input.protocol,
    p_outcome: input.outcome,
    p_measurement_status: input.measurementStatus,
    p_usage_dimensions: input.usageDimensions,
    p_provider_cost_micros: input.providerCostMicros,
    p_markup_micros: input.markupMicros ?? null,
    p_customer_cost_micros: input.customerCostMicros,
    p_customer_units_micros: input.customerUnitsMicros,
    p_retail_value_micros: input.retailValueMicros ?? null,
    p_retail_currency: input.retailCurrency ?? null,
    p_http_status: input.httpStatus ?? null,
  })
  return checked(data, error, 'inference attempt could not be recorded')
}

export async function reportPendingUsage(limit = 100) {
  const { data: reports, error } = await admin.rpc('usage_meter_claim', { p_limit: limit })
  if (error) throw new Error(`pending usage meter events could not be claimed: ${error.message}`)

  let reported = 0
  let unresolved = 0
  for (const report of reports ?? []) {
    try {
      await sendUsageMeterEvent(stripe, report)
      const { data, error: completeError } = await admin.rpc('usage_meter_complete', {
        p_usage_event_id: report.usage_event_id,
        p_reported: true,
      })
      if (completeError || data !== true) throw new Error(completeError?.message ?? 'usage meter acknowledgement was not recorded')
      reported++
    } catch (cause) {
      const reason = String((cause as Error)?.message ?? cause)
      const { error: failureError } = await admin.rpc('usage_meter_complete', {
        p_usage_event_id: report.usage_event_id,
        p_reported: false,
        p_error: reason,
      })
      if (failureError) throw new Error(`usage event ${report.identifier} failed and its retry state could not be saved: ${failureError.message}`)
      unresolved++
    }
  }
  return { reported, unresolved }
}
