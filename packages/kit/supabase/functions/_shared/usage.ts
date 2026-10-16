import { admin, getPaymentProvider, stripeMock } from './lib.ts'
import { of, fresh } from './compiled.ts'
import { createUsageTopUp } from './usage-topup.mjs'
import { createUsageGate } from './usage-gate.mjs'
import { findProviderExternalIds } from './payment-provider-refs.ts'
import { assertPaymentCapabilities } from './payment-provider.mjs'
import { settleIncrementalUsage } from './usage-incremental.ts'

type UsageOffer = {
  key: string
  sku: string
  usage?: {
    unit: string
    rate_micros: number
    speech_cost_per_second_micros?: number
    meter?: string
    overage_price_micros?: number
    incremental_charge_minor?: number
  }
}

const checked = <T>(data: T, error: { message: string } | null, context: string): T => {
  if (error) throw new Error(`${context}: ${error.message}`)
  return data
}

async function autoTopUp({ userId, invocationRef }: { userId: string; invocationRef: string }) {
  const provider = await getPaymentProvider()
  const mock = provider.id === 'stripe' && stripeMock
  const catalog = of<Record<string, any>>('catalog')
  const config = catalog.usage_auto_topup || { enabled: false, packs: [] }
  if (config.enabled) assertPaymentCapabilities(provider, ['usage.prepaid-top-up'])
  const runner = createUsageTopUp({
    config,
    preference: async (id: string) => {
      const { data, error } = await admin.from('usage_topup_preferences').select('*').eq('user_id', id).maybeSingle()
      return checked(data, error, 'automatic top-up preference could not be loaded')
    },
    paymentMethod: async (id: string) => {
      if (mock) {
        const { data, error } = await admin.from('profiles').select('stripe_customer_id').eq('id', id).maybeSingle()
        const profile = checked(data, error, 'billing profile could not be loaded')
        return profile?.stripe_customer_id
          ? { customerId: profile.stripe_customer_id, paymentMethodId: 'pm_mock_usage' }
          : null
      }
      const customers = await findProviderExternalIds(provider.id, 'customer', 'profiles', id)
      let customerId = customers[0]
      if (!customerId && provider.id === 'stripe') {
        const { data, error } = await admin.from('profiles').select('stripe_customer_id').eq('id', id).maybeSingle()
        const profile = checked(data, error, 'billing profile could not be loaded')
        customerId = profile?.stripe_customer_id ?? null
        if (customerId) await linkProviderEntity(provider.id, 'customer', customerId, 'profiles', id)
      }
      if (!customerId) return null
      if (!provider.getDefaultPaymentMethod) {
        throw new Error(`payment provider "${provider.id}" cannot load a saved payment method`)
      }
      const method = await provider.getDefaultPaymentMethod(customerId)
      return method.paymentMethodId ? { customerId, paymentMethodId: method.paymentMethodId } : null
    },
    begin: async (input: Record<string, any>) => {
      const { data, error } = await admin.rpc('usage_topup_begin', {
        p_provider_id: provider.id,
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
        p_provider_id: provider.id,
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
    provider,
    mock,
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

async function settleClosedIncrementalUsage(provider: Awaited<ReturnType<typeof getPaymentProvider>>) {
  if (provider.id === 'hyperswitch') return 0
  const periodStartsBySubscription = new Map<string, Set<string>>()
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data: events, error } = await admin.from('usage_events')
      .select('subscription_id, period_start')
      .gt('usage_incremental_charge_minor', 0)
      .not('subscription_id', 'is', null)
      .not('period_start', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`incremental usage periods could not be loaded: ${error.message}`)
    for (const event of events ?? []) {
      if (!event.subscription_id || !event.period_start) continue
      const periods = periodStartsBySubscription.get(event.subscription_id) ?? new Set<string>()
      periods.add(new Date(event.period_start).toISOString())
      periodStartsBySubscription.set(event.subscription_id, periods)
    }
    if ((events ?? []).length < pageSize) break
  }
  const subscriptionIds = [...periodStartsBySubscription.keys()]
  const subscriptions = []
  for (let offset = 0; offset < subscriptionIds.length; offset += pageSize) {
    const { data, error } = await admin.from('subscriptions')
      .select('id, current_period_start, current_period_end')
      .in('id', subscriptionIds.slice(offset, offset + pageSize))
    if (error) throw new Error(`incremental usage subscriptions could not be loaded: ${error.message}`)
    subscriptions.push(...(data ?? []))
  }
  let finalized = 0
  const now = Date.now()
  for (const subscription of subscriptions ?? []) {
    const currentStart = subscription.current_period_start
      ? new Date(subscription.current_period_start).getTime()
      : Number.NaN
    const currentEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end).getTime()
      : Number.NaN
    for (const periodStart of periodStartsBySubscription.get(subscription.id) ?? []) {
      const start = new Date(periodStart).getTime()
      const closed = Number.isFinite(currentStart)
        ? start < currentStart || (start === currentStart && Number.isFinite(currentEnd) && currentEnd <= now)
        : Number.isFinite(currentEnd) && currentEnd <= now
      if (!closed) continue
      const periodEnd = Number.isFinite(currentStart) && start < currentStart
        ? subscription.current_period_start
        : subscription.current_period_end
      await settleIncrementalUsage(provider, {
        subscriptionId: subscription.id,
        periodStart,
        periodEnd,
        finalize: true,
      })
      finalized++
    }
  }
  return finalized
}

export async function reportPendingUsage(limit = 100) {
  const provider = await getPaymentProvider()
  const isHyperswitch = provider.id === 'hyperswitch'
  let reported = 0
  let unresolved = 0
  const { data: incrementalReports, error: incrementalError } = await admin.rpc(
    'usage_incremental_meter_claim',
    { p_limit: limit },
  )
  if (incrementalError) throw new Error(`incremental usage events could not be claimed: ${incrementalError.message}`)
  const incrementalRows = incrementalReports ?? []
  const { data: incrementalEvents, error: incrementalEventsError } = incrementalRows.length
    ? await admin.from('usage_events').select('id, subscription_id, period_start')
      .in('id', incrementalRows.map((report) => report.usage_event_id))
    : { data: [], error: null }
  if (incrementalEventsError) throw new Error(`incremental usage periods could not be loaded: ${incrementalEventsError.message}`)
  const incrementalEventsById = new Map((incrementalEvents ?? []).map((event) => [event.id, event]))
  for (const report of incrementalRows) {
    try {
      const event = incrementalEventsById.get(report.usage_event_id)
      if (!event?.subscription_id || !event.period_start) {
        throw new Error(`incremental usage report ${report.identifier} has no subscription period`)
      }
      await settleIncrementalUsage(provider, {
        subscriptionId: event.subscription_id,
        periodStart: event.period_start,
      })
      const { data, error: completeError } = await admin.rpc('usage_meter_complete', {
        p_usage_event_id: report.usage_event_id,
        p_reported: true,
      })
      if (completeError || data !== true) {
        throw new Error(completeError?.message ?? 'incremental usage acknowledgement was not recorded')
      }
      reported++
    } catch (cause) {
      const reason = String((cause as Error)?.message ?? cause)
      const { error: failureError } = await admin.rpc('usage_meter_complete', {
        p_usage_event_id: report.usage_event_id,
        p_reported: false,
        p_error: reason,
      })
      if (failureError) throw new Error(`incremental usage event ${report.identifier} failed and its retry state could not be saved: ${failureError.message}`)
      unresolved++
    }
  }

  if (isHyperswitch) {
    return {
      reported,
      unresolved,
      deferred: true,
      reason: 'Non-incremental Hyperswitch metered usage is settled with the subscription renewal.',
    }
  }

  const { data: reports, error } = await admin.rpc('usage_meter_claim', { p_limit: limit })
  if (error) throw new Error(`pending usage meter events could not be claimed: ${error.message}`)
  const reportRows = reports ?? []
  if (reportRows.length) {
    assertPaymentCapabilities(provider, ['usage.metered'])
    if (!provider.reportUsage) {
      throw new Error(`payment provider "${provider.id}" declares usage metering without a report operation`)
    }
  }
  for (const report of reportRows) {
    try {
      const linkedCustomers = report.user_id
        ? await findProviderExternalIds(provider.id, 'customer', 'profiles', report.user_id)
        : []
      const customerId = linkedCustomers[0] ??
        (provider.id === 'stripe' ? report.stripe_customer_id : null)
      if (!customerId) {
        throw new Error(`usage report ${report.identifier} has no customer reference for provider "${provider.id}"`)
      }
      await provider.reportUsage!({
        idempotencyKey: report.identifier,
        customerId,
        meterId: report.event_name,
        value: Number(report.value_micros),
        occurredAt: Math.floor(new Date(report.created_at).getTime() / 1000),
      })
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
  const finalized = await settleClosedIncrementalUsage(provider)
  return {
    reported,
    unresolved,
    finalized,
    ...(isHyperswitch ? {
      deferred: true,
      reason: 'Non-incremental Hyperswitch metered usage is settled with the subscription renewal.',
    } : {}),
  }
}
