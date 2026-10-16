import { admin, getPaymentProvider, getUser, isServiceBearer, json, preflight } from '../_shared/lib.ts'
import { fresh } from '../_shared/compiled.ts'
import { offerByKey } from '../_shared/offers.ts'
import { subscriptionDeleted } from '../_shared/ledger.ts'
import { assertPaymentCapabilities, PaymentProviderError } from '../_shared/payment-provider.mjs'
import { findProviderExternalIds, linkProviderEntity } from '../_shared/payment-provider-refs.ts'
import { meteredUsageAmountMinor, paymentPeriodEnd } from '../_shared/hyperswitch-billing.mjs'
import { settleIncrementalUsage } from '../_shared/usage-incremental.ts'

async function settleMeteredUsage(provider: Awaited<ReturnType<typeof getPaymentProvider>>, row: {
  subscription_id: string
  user_id: string
  period_start: string
  period_end: string
  plan_key: string
}) {
  const { data: events, error: eventsError } = await admin.from('usage_events')
    .select('id, metered_micros, overage_price_micros, usage_incremental_charge_minor')
    .eq('subscription_id', row.subscription_id)
    .eq('period_start', row.period_start)
    .gt('metered_micros', 0)
  if (eventsError) throw new Error(`metered usage could not be loaded for ${row.subscription_id}: ${eventsError.message}`)
  if (!events?.length) return 0

  const incrementalEvents = events.filter((event) => Number(event.usage_incremental_charge_minor) > 0)
  let incrementalAmountMinor = 0
  if (incrementalEvents.length) {
    const result = await settleIncrementalUsage(provider, {
      subscriptionId: row.subscription_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      finalize: true,
    })
    const { error: markError } = await admin.from('usage_meter_reports')
      .update({
        status: 'reported',
        reported_at: new Date().toISOString(),
        claimed_until: null,
        last_error: null,
      })
      .in('usage_event_id', incrementalEvents.map((event) => event.id))
      .in('status', ['pending', 'expired'])
    if (markError) throw new Error(`incremental usage settlement could not be recorded for ${row.subscription_id}: ${markError.message}`)
    incrementalAmountMinor = result.amountMinor
  }

  const regularEvents = events.filter((event) => Number(event.usage_incremental_charge_minor) <= 0)
  if (!regularEvents.length) return incrementalAmountMinor
  const { data: reports, error: reportsError } = await admin.from('usage_meter_reports')
    .select('usage_event_id')
    .in('usage_event_id', regularEvents.map((event) => event.id))
    .in('status', ['pending', 'expired'])
  if (reportsError) throw new Error(`metered usage reports could not be loaded for ${row.subscription_id}: ${reportsError.message}`)
  const pendingIds = new Set((reports ?? []).map((report) => report.usage_event_id))
  const pending = regularEvents.filter((event) => pendingIds.has(event.id))
  if (!pending.length) return incrementalAmountMinor

  const plan = row.plan_key ? offerByKey(row.plan_key) : null
  if (!plan?.currency) throw new Error(`subscription ${row.subscription_id} has metered usage but no current offer currency`)
  const numerator = pending.reduce((sum, event) => {
    const unitsValue = String(event.metered_micros)
    const priceValue = String(event.overage_price_micros)
    if (!/^[1-9]\d*$/.test(unitsValue) || !/^[1-9]\d*$/.test(priceValue)) {
      throw new Error(`metered usage event ${event.id} has invalid billing terms`)
    }
    return sum + BigInt(unitsValue) * BigInt(priceValue)
  }, 0n)
  const amountMinor = meteredUsageAmountMinor(numerator.toString(), plan.currency)
  if (amountMinor > 0) {
    const customerIds = await findProviderExternalIds('hyperswitch', 'customer', 'profiles', row.user_id)
    const paymentMethodIds = await findProviderExternalIds('hyperswitch', 'payment_method', 'subscriptions', row.subscription_id)
    if (customerIds.length !== 1 || paymentMethodIds.length !== 1) {
      throw new Error(`subscription ${row.subscription_id} must have exactly one Hyperswitch customer and saved payment method to settle metered usage`)
    }
    const result = await provider.createPaymentIntent!({
      amountMinor,
      currency: plan.currency,
      customerId: customerIds[0]!,
      paymentMethodId: paymentMethodIds[0]!,
      description: `Metered usage for ${plan.title}`,
      metadata: {
        platformkit_subscription_renewal: '1',
        platformkit_subscription_local_id: row.subscription_id,
        platformkit_period_end: row.period_end,
        platformkit_usage_settlement: '1',
      },
      idempotencyKey: `subscription-usage:${row.subscription_id}:${Math.floor(new Date(row.period_end).getTime() / 1000)}`,
    })
    if (result.status.toLowerCase() !== 'succeeded') {
      throw new Error(`Hyperswitch metered usage payment ${result.paymentIntentId} returned status "${result.status}"`)
    }
    await linkProviderEntity('hyperswitch', 'payment', result.paymentIntentId, 'subscriptions', row.subscription_id)
  }

  const { error: markError } = await admin.from('usage_meter_reports')
    .update({
      status: 'reported',
      reported_at: new Date().toISOString(),
      claimed_until: null,
      last_error: null,
    })
    .in('usage_event_id', pending.map((event) => event.id))
    .in('status', ['pending', 'expired'])
  if (markError) throw new Error(`metered usage settlement could not be recorded for ${row.subscription_id}: ${markError.message}`)
  return incrementalAmountMinor + amountMinor
}

async function run() {
  await fresh()
  const provider = await getPaymentProvider()
  if (provider.id !== 'hyperswitch') return { skipped: true, reason: 'Hyperswitch is not the selected payment provider.' }
  assertPaymentCapabilities(provider, ['checkout.subscription'])
  if (!provider.createPaymentIntent) {
    throw new PaymentProviderError('subscription_renewal_unavailable', 'Hyperswitch does not implement saved-payment renewals.', 500)
  }

  const { data: refs, error: refsError } = await admin.from('payment_provider_refs')
    .select('external_id, entity_id')
    .eq('provider', 'hyperswitch')
    .eq('object_type', 'subscription')
    .eq('entity_type', 'subscriptions')
  if (refsError) throw new Error(`Hyperswitch subscription references could not be loaded: ${refsError.message}`)
  const localIds = [...new Set((refs ?? []).map((ref) => ref.entity_id))]
  if (!localIds.length) return { cancelled: 0, renewed: 0, failed: 0 }

  const now = new Date().toISOString()
  const { data: ending, error: endingError } = await admin.from('subscriptions')
    .select('id, user_id, key, current_period_start, current_period_end')
    .in('id', localIds)
    .eq('cancel_at_period_end', true)
    .lte('current_period_end', now)
    .in('status', ['active', 'trialing', 'past_due'])
  if (endingError) throw new Error(`subscriptions ending could not be loaded: ${endingError.message}`)
  let cancelled = 0
  for (const row of ending ?? []) {
    const externalIds = await findProviderExternalIds('hyperswitch', 'subscription', 'subscriptions', row.id)
    if (externalIds.length !== 1) {
      throw new Error(`Hyperswitch subscription ${row.id} has ${externalIds.length} external subscription references`)
    }
    await settleMeteredUsage(provider, {
      subscription_id: row.id,
      user_id: row.user_id,
      period_start: row.current_period_start,
      period_end: row.current_period_end,
      plan_key: row.key,
    })
    await subscriptionDeleted(externalIds[0]!, 'hyperswitch')
    cancelled++
  }

  const { data: rows, error: claimError } = await admin.rpc('payment_subscription_renewal_claim', { p_limit: 50 })
  if (claimError) throw new Error(`due Hyperswitch subscriptions could not be claimed: ${claimError.message}`)
  let renewed = 0
  let failed = 0
  for (const row of rows ?? []) {
    try {
      const targetKey = row.next_key || row.plan_key
      const target = targetKey ? offerByKey(targetKey) : null
      if (!target || target.billing !== 'subscription') {
        throw new Error(`subscription ${row.subscription_id} has no current PlatformKit subscription offer`)
      }
      const customerIds = await findProviderExternalIds('hyperswitch', 'customer', 'profiles', row.user_id)
      const paymentMethodIds = await findProviderExternalIds('hyperswitch', 'payment_method', 'subscriptions', row.subscription_id)
      if (customerIds.length !== 1 || paymentMethodIds.length !== 1) {
        throw new Error(`subscription ${row.subscription_id} must have exactly one Hyperswitch customer and saved payment method`)
      }
      await settleMeteredUsage(provider, row)
      const periodEnd = Math.floor(new Date(row.period_end).getTime() / 1000)
      if (!Number.isSafeInteger(periodEnd) || periodEnd < 0) {
        throw new Error(`subscription ${row.subscription_id} has an invalid period end`)
      }
      const periodStart = periodEnd
      const nextEnd = paymentPeriodEnd(periodStart, target.period === 'weekly' ? 'week' : 'month')
      const amount = row.next_key ? target.unit_amount : Number(row.plan_amount)
      if (!Number.isSafeInteger(amount) || amount <= 0 || !target.currency) {
        throw new Error(`subscription ${row.subscription_id} has an invalid renewal price`)
      }
      const externalIds = await findProviderExternalIds('hyperswitch', 'subscription', 'subscriptions', row.subscription_id)
      if (externalIds.length !== 1) {
        throw new Error(`subscription ${row.subscription_id} has ${externalIds.length} Hyperswitch subscription references`)
      }
      const result = await provider.createPaymentIntent({
        amountMinor: amount,
        currency: target.currency,
        customerId: customerIds[0]!,
        paymentMethodId: paymentMethodIds[0]!,
        description: `Subscription renewal: ${target.title}`,
        metadata: {
          platformkit_subscription_renewal: '1',
          platformkit_subscription_id: externalIds[0]!,
          platformkit_subscription_local_id: row.subscription_id,
          platformkit_period_end: row.period_end,
          platformkit_offer_key: target.key,
        },
        idempotencyKey: `subscription-renewal:${row.subscription_id}:${periodEnd}`,
      })
      if (result.status.toLowerCase() !== 'succeeded') {
        throw new Error(`Hyperswitch renewal payment ${result.paymentIntentId} returned status "${result.status}"`)
      }
      const usage = target.usage
      const { data: completed, error: completeError } = await admin.rpc('payment_subscription_renewal_complete', {
        p_subscription_id: row.subscription_id,
        p_period_end: row.period_end,
        p_payment_id: result.paymentIntentId,
        p_period_start: new Date(periodStart * 1000).toISOString(),
        p_next_period_end: new Date(nextEnd * 1000).toISOString(),
        p_offer_key: target.key,
        p_sku: target.sku,
        p_amount: amount,
        p_price_id: `platformkit:${encodeURIComponent(target.key)}`,
        p_tier: target.tier,
        p_usage: usage ? {
          meter: usage.meter ?? null,
          unit: usage.unit,
          rate_micros: usage.rate_micros,
          included_micros: usage.included_micros ?? 0,
          overage_price_micros: usage.overage_price_micros ?? null,
          speech_cost_per_second_micros: usage.speech_cost_per_second_micros ?? 0,
        } : {},
      })
      if (completeError || completed !== true) {
        throw new Error(`subscription renewal was charged but its ledger transition failed: ${completeError?.message ?? 'claim no longer active'}`)
      }
      renewed++
    } catch (cause) {
      const message = String((cause as Error)?.message ?? cause)
      const { data: recorded, error: failureError } = await admin.rpc('payment_subscription_renewal_failed', {
        p_subscription_id: row.subscription_id,
        p_period_end: row.period_end,
        p_error: message,
      })
      if (failureError || recorded !== true) {
        throw new Error(`subscription renewal failed (${message}) and retry state could not be saved: ${failureError?.message ?? 'claim no longer active'}`)
      }
      console.error(`Hyperswitch subscription renewal failed for ${row.subscription_id}: ${message}`)
      failed++
    }
  }
  return { cancelled, renewed, failed }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await getUser(req)
  if (user) {
    const { data: profile, error } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (error) return json({ error: `could not verify administrator: ${error.message}` }, 500)
    if (profile?.role !== 'admin') return json({ error: 'not allowed' }, 403)
  } else if (!await isServiceBearer(req)) {
    return json({ error: 'not allowed' }, 401)
  }
  try {
    return json(await run())
  } catch (cause) {
    const status = cause instanceof PaymentProviderError ? cause.status : 500
    return json({ error: String((cause as Error)?.message ?? cause) }, status)
  }
})
