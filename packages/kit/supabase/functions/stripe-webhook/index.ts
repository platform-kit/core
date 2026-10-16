/*
 * The reconciliation engine. The selected provider's verified events are
 * projected into our tables — purchases, subscriptions — and, from
 * them, the entitlements ledger the app actually reads. What was bought is read
 * by sku (the price's lookup key) from our own catalog (offers.ts), never from
 * provider product objects; a membership's tier comes from the normalized
 * subscription snapshot, so a subscriber on a retired price still
 * holds it.
 *
 * No user JWT (verify_jwt is off for this function); trust comes only from the
 * adapter's verification. Idempotent on the provider-scoped event id, so retries are
 * acknowledged without being re-applied. Every grant carries the provider id that
 * caused it as source_id, which is how a cancellation or refund revokes exactly
 * what it granted and nothing else.
 */
import { admin, getPaymentProvider, json } from '../_shared/lib.ts'
import { checkoutCompleted, subscriptionChanged, subscriptionDeleted, grantUsage, iso } from '../_shared/ledger.ts'
import { includedGrantForInvoice } from '../_shared/usage-stripe.mjs'
import { findProviderEntity, findProviderEntities, findProviderExternalIds } from '../_shared/payment-provider-refs.ts'
import { assertPaymentCapabilities, normalizePaymentEvent, normalizePaymentCheckout, PaymentProviderError, providerScopedId } from '../_shared/payment-provider.mjs'
import type { PaymentProviderAdapter, PaymentProviderEvent } from '../_shared/payment-provider.d.ts'

async function handle(event: PaymentProviderEvent, provider: PaymentProviderAdapter) {
  switch (event.type) {
    case 'checkout.completed': {
      if (!event.checkoutId || !provider.retrieveCheckout) {
        throw new Error(`payment provider "${provider.id}" cannot retrieve a completed checkout`)
      }
      const checkout = normalizePaymentCheckout(provider.id, await provider.retrieveCheckout(event.checkoutId))
      await checkoutCompleted(checkout, provider.id)
      if (checkout.mode === 'subscription' && checkout.subscription) {
        await subscriptionChanged(checkout.subscription, provider.id)
      }
      break
    }
    case 'subscription.created':
    case 'subscription.updated':
      if (!event.subscription) throw new Error(`payment provider "${provider.id}" returned no subscription snapshot`)
      await subscriptionChanged(event.subscription, provider.id)
      break
    case 'subscription.deleted':
      if (event.subscriptionId) await subscriptionDeleted(event.subscriptionId, provider.id)
      break
    case 'invoice.paid': {
      const invoice = event.invoice
      const subscriptionId = event.subscriptionId ?? invoice?.subscriptionId
      if (!invoice || !subscriptionId) throw new Error(`payment provider "${provider.id}" returned an incomplete paid invoice`)
      const invoiceHasUsage = invoice.lines.some((line) =>
        line.metadata?.usage === 'metered' || String(line.offerKey ?? '').endsWith('_usage'))
      const subscriptionHasUsage = event.subscription?.items.some((item) =>
        item.metadata.usage === 'metered' || String(item.offerKey ?? '').endsWith('_usage')) ?? false
      if (invoiceHasUsage || subscriptionHasUsage) {
        assertPaymentCapabilities(provider, ['usage.metered'])
      }
      const subscriptionIdLocal = await findProviderEntity(provider.id, 'subscription', subscriptionId, 'subscriptions')
        ?? providerScopedId(provider.id, subscriptionId)
      const selectSubscription = () => admin.from('subscriptions')
        .select('user_id, key, usage_price_id, usage_meter, usage_unit, usage_rate_micros, usage_included_micros, usage_overage_price_micros, usage_speech_cost_per_second_micros, current_period_start, current_period_end')
        .eq('id', subscriptionIdLocal).maybeSingle()
      let { data: subscription, error: subscriptionError } = await selectSubscription()
      if (subscriptionError) throw new Error(`subscription invoice lookup failed: ${subscriptionError.message}`)
      if (!subscription && event.subscription) {
        if (event.subscription.items.some((item) =>
          item.metadata.usage === 'metered' || String(item.offerKey ?? '').endsWith('_usage'))) {
          assertPaymentCapabilities(provider, ['usage.metered'])
        }
        await subscriptionChanged(event.subscription, provider.id)
        ;({ data: subscription, error: subscriptionError } = await selectSubscription())
        if (subscriptionError) throw new Error(`subscription invoice lookup failed: ${subscriptionError.message}`)
      }
      if (!subscription) throw new Error(`payment provider "${provider.id}" invoice refers to an unknown subscription`)
      if (subscription.usage_meter) assertPaymentCapabilities(provider, ['usage.metered'])
      const meteredLine = invoice.lines.find((line) =>
        line.metadata?.usage === 'metered' ||
        String(line.offerKey ?? '').endsWith('_usage') ||
        line.priceId === subscription.usage_price_id)
      const periodLine = meteredLine ?? invoice.lines.find((line) => line.periodStart != null && line.periodEnd != null)
      const start = iso(periodLine?.periodStart) ?? subscription.current_period_start ?? null
      const end = iso(periodLine?.periodEnd) ?? subscription.current_period_end ?? null
      if (start || end) {
        const { error } = await admin.from('subscriptions').update({
          ...(start ? { current_period_start: start } : {}),
          ...(end ? { current_period_end: end } : {}),
          status: 'active', updated_at: new Date().toISOString(),
        }).eq('id', subscriptionIdLocal)
        if (error) throw new Error(`subscription invoice period was not recorded: ${error.message}`)
        if (end) {
          const { error: entitlementError } = await admin.from('entitlements').update({ expires_at: end, active: true })
            .eq('source_id', providerScopedId(provider.id, subscriptionId))
          if (entitlementError) throw new Error(`subscription invoice entitlement was not updated: ${entitlementError.message}`)
        }
      }
      const usageGrant = includedGrantForInvoice(
        subscription,
        { id: invoice.invoiceId, billing_reason: invoice.billingReason },
        start,
        end,
        meteredLine?.metadata ?? {},
      )
      if (usageGrant) await grantUsage(
        usageGrant.user_id, usageGrant.offer_key, usageGrant.source, usageGrant.source_id,
        usageGrant.units_micros, usageGrant.period_start, usageGrant.expires_at,
        usageGrant, provider.id,
      )
      break
    }
    case 'invoice.payment-failed':
    case 'payment.failed': {
      if (!event.subscriptionId) break
      const subscriptionId = await findProviderEntity(provider.id, 'subscription', event.subscriptionId, 'subscriptions')
        ?? providerScopedId(provider.id, event.subscriptionId)
      const { error } = await admin.from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('id', subscriptionId)
      if (error) throw new Error(`subscription payment failure was not recorded: ${error.message}`)
      break
    }
    case 'checkout.expired':
      if (event.checkoutId) await releaseHolds(providerScopedId(provider.id, event.checkoutId))
      if (event.metadata) await releaseBudgets({ metadata: event.metadata })
      break
    case 'payment.refunded': {
      if (!event.paymentId) break
      const purchaseIds = await findProviderEntities(provider.id, 'payment', event.paymentId, 'purchases')
      if (!purchaseIds.length && provider.id !== 'stripe') break
      let query = admin.from('purchases').update({ status: 'refunded' })
      if (purchaseIds.length) query = query.in('id', purchaseIds)
      else query = query.eq('stripe_payment_intent_id', event.paymentId)
      const { data: rows, error } = await query.select('id, stripe_checkout_session_id')
      if (error) throw new Error(`refunded ${provider.id} purchases were not reconciled: ${error.message}`)
      for (const row of rows ?? []) {
        let checkoutIds = await findProviderExternalIds(provider.id, 'checkout', 'purchases', row.id)
        if (!checkoutIds.length && provider.id === 'stripe' && row.stripe_checkout_session_id) {
          checkoutIds = [row.stripe_checkout_session_id]
        }
        for (const checkoutId of checkoutIds) {
          const { error: entitlementError } = await admin.from('entitlements').update({ active: false })
            .eq('source_id', providerScopedId(provider.id, checkoutId))
          if (entitlementError) throw new Error(`refunded ${provider.id} purchase entitlement was not revoked: ${entitlementError.message}`)
        }
      }
      break
    }
  }
}

/*
 * GIVING BACK WHAT A DEAD SESSION WAS HOLDING.
 *
 * The movements are the record of what was held, so there is no second table to keep in step:
 * every `reserved` movement for this session, less anything already released or sold against
 * it, is what is still out. A session whose payment landed has a `sold` movement that already
 * released the hold in the same statement, so there is nothing left to give back and this
 * writes nothing — which is what makes it safe to run on a retry of the event.
 */
async function releaseHolds(sessionId: string): Promise<void> {
  if (!sessionId) return
  const { data } = await admin.from('inventory_movements').select('sku, variant, delta, reason').eq('about', sessionId)
  if (!data || !data.length) return
  const held = new Map<string, number>()
  for (const m of data) {
    const k = m.sku + '\u0000' + (m.variant ?? '')
    if (m.reason === 'reserved') held.set(k, (held.get(k) ?? 0) + Number(m.delta))
    if (m.reason === 'released' || m.reason === 'sold') held.set(k, (held.get(k) ?? 0) - Math.abs(Number(m.delta)))
  }
  for (const [k, qty] of held) {
    if (qty <= 0) continue
    const [sku, variant] = k.split('\u0000')
    await admin.rpc('inventory_give', { p_sku: sku, p_variant: variant, p_qty: qty, p_reason: 'released', p_about: sessionId })
  }
}

/*
 * AND THE DISCOUNT BUDGET A DEAD CHECKOUT WAS HOLDING.
 *
 * The budget is taken before the session exists — it has to be, or two people could both be
 * the last one under the limit while Stripe was still thinking — so an abandoned checkout has
 * spent budget on a sale that never happened. Without this a campaign with a hundred uses is
 * exhausted by a hundred people who changed their minds.
 *
 * What was taken rides on the session’s own metadata, so this needs no second table and a
 * retry of the event is harmless: `promotion_give` floors at nothing.
 */
async function releaseBudgets(session: { metadata?: Readonly<Record<string, string>> }): Promise<void> {
  const promos = String(session?.metadata?.promos ?? "")
  if (!promos) return
  for (const part of promos.split(',').filter(Boolean)) {
    const [name, kind, amount] = part.split(':')
    if (!name) continue
    await admin.rpc('promotion_give', { p_promotion: name, p_kind: kind || 'usage', p_amount: Number(amount) || 0 })
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let provider: PaymentProviderAdapter
  let events: readonly PaymentProviderEvent[]
  try {
    provider = await getPaymentProvider()
    events = (await provider.verifyWebhook(req)).map((event) => normalizePaymentEvent(provider.id, event))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = error instanceof PaymentProviderError ? error.status : 502
    return json({ error: message, ...(error instanceof PaymentProviderError ? { code: error.code } : {}) }, status)
  }
  let duplicates = 0
  let applied = 0
  for (const event of events) {
    const { data: seen, error: lookupError } = await admin.from('payment_events').select('event_id')
      .eq('provider', provider.id).eq('event_id', event.eventId).maybeSingle()
    if (lookupError) return json({ error: `Payment event lookup failed: ${lookupError.message}` }, 500)
    if (seen) { duplicates++; continue }
    const { error: insertError } = await admin.from('payment_events').insert({
      provider: provider.id, event_id: event.eventId, type: event.type,
    })
    if (insertError?.code === '23505') { duplicates++; continue }
    if (insertError) return json({ error: `Payment event was not recorded: ${insertError.message}` }, 500)
    try {
      await handle(event, provider)
      applied++
    } catch (error) {
      /* let the provider retry: forget the id so the retry isn't treated as a duplicate */
      const { error: deleteError } = await admin.from('payment_events').delete()
        .eq('provider', provider.id).eq('event_id', event.eventId)
      if (deleteError) {
        console.error('payment-provider-webhook: failed to clear retryable event', event.eventId, deleteError.message)
        return json({ error: `event failed and its retry marker could not be cleared: ${deleteError.message}` }, 500)
      }
      return json({ error: error instanceof Error ? error.message : String(error) }, 500)
    }
  }
  return json({ ok: true, ...(events.length > 0 && duplicates === events.length && applied === 0 ? { duplicate: true } : {}) })
})
