/*
 * POST → { url } to the Stripe Billing Portal for the signed-in customer.
 * This is the whole subscription-management surface: upgrade, cancel, cards,
 * invoices all live there. A user with no Stripe customer yet has nothing to
 * manage (they subscribe through Checkout first).
 */
import { stripeConfigured, stripeMock, isMockId, stripeUnconfigured, admin, json, preflight, getUser, appUrl, getPaymentProvider } from '@pk/core/lib.ts'
import { subscriptionDeleted } from '@pk/core/ledger.ts'
import { assertPaymentCapabilities, PaymentProviderError } from '@pk/core/payment-provider.mts'
import type { PaymentProviderAdapter } from '@pk/core/payment-provider.d.ts'
import { findProviderExternalIds, linkProviderEntity } from '@pk/core/payment-provider-refs.ts'
import { binding } from '@pk/core/commitments.ts'

/* what the billing view shows of somebody's plans and terms: what is owed, made and left (openspec: payment-plans) */
async function commitmentsOf(userId: string) {
  const { data, error } = await admin.from('commitments')
    .select('id, membership, sku, of_sku, plan, term_months, payments_total, payments_made, amount_minor, currency, starts_at, ends_at, then, status, missed_at, owed_minor, subscription_id')
    .eq('user_id', userId).in('status', ['active', 'restricted', 'defaulted']).order('created_at', { ascending: false })
  if (error) throw new Error(`commitments could not be loaded: ${error.message}`)
  return data ?? []
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const user = await getUser(req)
  if (!user) return json({ error: 'sign in first' }, 401)
  const body = await req.json().catch(() => ({}))
  const action = typeof body?.action === 'string' ? body.action : 'manage'
  /* TURNING RENEWAL OFF: what follows a term is the member's to stop before it starts. The payments the
     term itself owes are untouched; only what comes after it becomes nothing. */
  if (action === 'end-after-term') {
    const id = typeof body?.commitment === 'string' ? body.commitment : ''
    const { data, error } = await admin.from('commitments').update({ then: 'end', updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', user.id).eq('membership', true).in('status', ['active', 'restricted']).neq('then', 'end').select('id')
    if (error) return json({ error: `renewal could not be turned off: ${error.message}` }, 500)
    if (!data?.length) return json({ error: 'no term of yours renews', code: 'not_found' }, 404)
    return json({ ended: true, commitments: await commitmentsOf(user.id) })
  }
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
    const commitments = await commitmentsOf(user.id)
    if (!subscription) return json({ subscription: null, has_payment_method: false, provider: null, commitments })
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
      commitments,
    })
  }

  let provider: PaymentProviderAdapter
  try {
    provider = await getPaymentProvider()
  } catch (error: any) {
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
    /* A PLAN OR A TERM CAN'T BE CANCELLED before its last payment: the buyer agreed to all of them */
    if (action === 'cancel') {
      const held = await binding(subscription.id)
      if (held) return json({ error: 'this plan has payments still to make', code: 'committed', payments_made: held.payments_made, payments_total: held.payments_total, ends_at: held.ends_at }, 409)
    }
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
  } catch (error: any) {
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
    /* somebody owing payments on a plan or a term gets the portal without cancel or switch */
    const committed = (await commitmentsOf(user.id)).some((c: any) => c.subscription_id && c.status !== 'defaulted' && c.payments_made < c.payments_total)
    const session = await provider.createPortalSession({
      customerId,
      returnUrl: `${appUrl()}${provider.id === 'hyperswitch' ? '/billing' : '/store'}`,
      ...(committed ? { committed: true } : {}),
    })
    return json({ url: session.url })
  } catch (e: any) {
    const message = e instanceof Error ? e.message : String(e)
    const status = e instanceof PaymentProviderError ? e.status : 502
    return json({ error: `${provider.id}: ${message}` }, status)
  }
})
