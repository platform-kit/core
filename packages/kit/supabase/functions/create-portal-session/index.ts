/*
 * POST → { url } to the Stripe Billing Portal for the signed-in customer.
 * This is the whole subscription-management surface: upgrade, cancel, cards,
 * invoices all live there. A user with no Stripe customer yet has nothing to
 * manage (they subscribe through Checkout first).
 */
import { stripeConfigured, stripeMock, isMockId, stripeUnconfigured, admin, json, preflight, getUser, appUrl, getPaymentProvider } from '../_shared/lib.ts'
import { subscriptionDeleted } from '../_shared/ledger.ts'
import { assertPaymentCapabilities, PaymentProviderError } from '../_shared/payment-provider.mjs'
import type { PaymentProviderAdapter } from '../_shared/payment-provider.d.ts'
import { findProviderExternalIds, linkProviderEntity } from '../_shared/payment-provider-refs.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const user = await getUser(req)
  if (!user) return json({ error: 'sign in first' }, 401)
  const body = await req.json().catch(() => ({}))
  const action = typeof body?.action === 'string' ? body.action : 'manage'
  if (action === 'read') {
    const { data: subscription, error: subscriptionError } = await admin.from('subscriptions')
      .select('id, sku, key, status, current_period_end, cancel_at_period_end, next_sku, next_key, next_at')
      .eq('user_id', user.id)
      .in('status', ['active', 'trialing', 'past_due'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (subscriptionError) {
      return json({ error: `billing subscription could not be loaded: ${subscriptionError.message}` }, 500)
    }
    if (!subscription) return json({ subscription: null, has_payment_method: false, provider: null })
    const { data: refs, error: refsError } = await admin.from('payment_provider_refs')
      .select('provider, object_type')
      .eq('entity_type', 'subscriptions')
      .eq('entity_id', subscription.id)
      .in('object_type', ['subscription', 'payment_method'])
    if (refsError) return json({ error: `billing provider details could not be loaded: ${refsError.message}` }, 500)
    const providers = [...new Set((refs ?? [])
      .filter((ref) => ref.object_type === 'subscription')
      .map((ref) => ref.provider))]
    if (providers.length > 1) {
      return json({ error: 'multiple payment providers are linked to this membership' }, 409)
    }
    const providerId = providers[0] ?? null
    return json({
      subscription: {
        sku: subscription.sku,
        key: subscription.key,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
        next_sku: subscription.next_sku,
        next_key: subscription.next_key,
        next_at: subscription.next_at,
        provider: providerId,
      },
      has_payment_method: providerId != null
        && (refs ?? []).some((ref) => ref.provider === providerId && ref.object_type === 'payment_method'),
      provider: providerId,
    })
  }

  let provider: PaymentProviderAdapter
  try {
    provider = await getPaymentProvider()
  } catch (error) {
    if (error instanceof PaymentProviderError) return json({ error: error.message, code: error.code }, error.status)
    throw error
  }
  if (provider.id === 'hyperswitch' && ['cancel', 'resume'].includes(action)) {
    const { data: refs, error: refsError } = await admin.from('payment_provider_refs')
      .select('entity_id')
      .eq('provider', 'hyperswitch')
      .eq('object_type', 'subscription')
      .eq('entity_type', 'subscriptions')
    if (refsError) return json({ error: `billing subscriptions could not be loaded: ${refsError.message}` }, 500)
    const ids = [...new Set((refs ?? []).map((ref) => ref.entity_id))]
    if (!ids.length) return json({ subscription: null, has_payment_method: false })
    let query = admin.from('subscriptions')
      .select('id, sku, key, status, current_period_end, cancel_at_period_end, next_sku, next_key, next_at')
      .eq('user_id', user.id)
      .in('id', ids)
      .in('status', ['active', 'trialing', 'past_due'])
      .order('updated_at', { ascending: false })
      .limit(1)
    const { data: subscription, error: subscriptionError } = await query.maybeSingle()
    if (subscriptionError) return json({ error: `billing subscription could not be loaded: ${subscriptionError.message}` }, 500)
    if (!subscription) return json({ subscription: null, has_payment_method: false })
    if (action === 'cancel' || action === 'resume') {
      const { error } = await admin.from('subscriptions').update({
        cancel_at_period_end: action === 'cancel',
        ...(action === 'cancel' ? { next_sku: null, next_key: null, next_at: null } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', subscription.id).eq('user_id', user.id)
      if (error) return json({ error: `billing preference could not be saved: ${error.message}` }, 500)
      subscription.cancel_at_period_end = action === 'cancel'
      if (action === 'cancel') {
        subscription.next_sku = null
        subscription.next_key = null
        subscription.next_at = null
      }
    }
    const { data: methods, error: methodsError } = await admin.from('payment_provider_refs')
      .select('external_id')
      .eq('provider', 'hyperswitch')
      .eq('object_type', 'payment_method')
      .eq('entity_type', 'subscriptions')
      .eq('entity_id', subscription.id)
    if (methodsError) return json({ error: `saved payment method could not be checked: ${methodsError.message}` }, 500)
    if ((methods ?? []).length > 1) return json({ error: 'multiple Hyperswitch saved payment methods are linked to this membership' }, 409)
    return json({
      subscription: {
        sku: subscription.sku,
        key: subscription.key,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
        next_sku: subscription.next_sku,
        next_key: subscription.next_key,
        next_at: subscription.next_at,
      },
      has_payment_method: (methods ?? []).length === 1,
    })
  }
  if (action !== 'manage') return json({ error: 'unsupported billing action' }, 400)
  try {
    assertPaymentCapabilities(provider, ['customer.portal'])
  } catch (error) {
    if (error instanceof PaymentProviderError) return json({ error: error.message, code: error.code }, error.status)
    throw error
  }
  if (provider.id === 'stripe' && !stripeConfigured) return stripeUnconfigured()
  /* the mock has no portal: "manage" cancels the mock subscriptions at once and comes back */
  if (provider.id === 'stripe' && stripeMock) {
    const { data: subs } = await admin.from('subscriptions').select('id').eq('user_id', user.id).like('id', 'sub_mock_%').neq('status', 'canceled')
    for (const s of subs ?? []) await subscriptionDeleted(s.id, 'stripe')
    return json({ url: `${appUrl()}/app?portal=mock`, mock: true, cancelled: (subs ?? []).length })
  }

  const { data: prof, error: profileError } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle()
  if (profileError) return json({ error: `could not load billing account: ${profileError.message}` }, 500)
  const linkedCustomers = await findProviderExternalIds(provider.id, 'customer', 'profiles', user.id)
  if (linkedCustomers.length > 1) {
    return json({ error: `Payment provider "${provider.id}" has multiple customer accounts for this user.` }, 409)
  }
  const customerId = linkedCustomers[0] ?? (provider.id === 'stripe' ? prof?.stripe_customer_id : null)
  if (!customerId || (provider.id === 'stripe' && isMockId(customerId))) return json({ error: 'no billing account yet' }, 404)

  try {
    if (!provider.createPortalSession) {
      throw new PaymentProviderError('portal_unavailable', `Payment provider "${provider.id}" does not implement customer portal sessions.`, 500)
    }
    if (!linkedCustomers.length) await linkProviderEntity(provider.id, 'customer', customerId, 'profiles', user.id)
    const session = await provider.createPortalSession({
      customerId,
      returnUrl: `${appUrl()}${provider.id === 'hyperswitch' ? '/billing' : '/store'}`,
    })
    return json({ url: session.url })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const status = e instanceof PaymentProviderError ? e.status : 502
    return json({ error: `${provider.id}: ${message}` }, status)
  }
})
