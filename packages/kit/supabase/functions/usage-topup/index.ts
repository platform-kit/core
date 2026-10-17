import { admin, appUrl, getPaymentProvider, getUser, json, preflight, stripeConfigured, stripeMock, stripeUnconfigured } from '../_shared/lib.ts'
import { of, fresh } from '../_shared/compiled.ts'
import { assertPaymentCapabilities } from '../_shared/payment-provider.mjs'
import { hyperswitchClientUrl } from '../_shared/hyperswitch-api.mjs'
import { findProviderExternalIds, linkProviderEntity } from '../_shared/payment-provider-refs.ts'
import { settleIncrementalUsage } from '../_shared/usage-incremental.ts'
import { loadOwnedIncrementalSettlement } from '../_shared/usage-incremental-recovery.mjs'

type AutoTopUpConfig = { enabled: boolean; currency: string | null; packs: Array<Record<string, any>> }

const fail = (message: string, status = 400) => json({ error: message }, status)
const isStripeMock = (provider: Awaited<ReturnType<typeof getPaymentProvider>>) =>
  provider.id === 'stripe' && stripeMock
const query = async (builder: any, label: string) => {
  const { data, error } = await builder
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function customerFor(provider: Awaited<ReturnType<typeof getPaymentProvider>>, user: any) {
  const profile = await query(
    admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle(),
    'billing profile could not be loaded',
  )
  const linkedCustomers = await findProviderExternalIds(provider.id, 'customer', 'profiles', user.id)
  const customerId = linkedCustomers[0] ?? (provider.id === 'stripe' ? profile?.stripe_customer_id : null)
  if (customerId && !isStripeMock(provider)) {
    if (!linkedCustomers.length) await linkProviderEntity(provider.id, 'customer', customerId, 'profiles', user.id)
    return { id: customerId, email: user.email || undefined }
  }
  if (isStripeMock(provider)) return { id: profile?.stripe_customer_id || `cus_mock_${user.id}`, email: user.email || undefined }
  assertPaymentCapabilities(provider, ['customer.create'])
  if (!provider.createCustomer) throw new Error(`payment provider "${provider.id}" cannot create a billing customer`)
  const customer = await provider.createCustomer({ userId: user.id, email: user.email || undefined })
  await linkProviderEntity(provider.id, 'customer', customer.customerId, 'profiles', user.id)
  if (provider.id === 'stripe') {
    const { error } = await admin.from('profiles').update({ stripe_customer_id: customer.customerId }).eq('id', user.id)
    if (error) throw new Error(`billing customer could not be saved: ${error.message}`)
  }
  return { id: customer.customerId, email: user.email || undefined }
}

async function savedPaymentMethod(provider: Awaited<ReturnType<typeof getPaymentProvider>>, customerId: string) {
  if (isStripeMock(provider)) return { customer: customerId, paymentMethod: 'pm_mock_usage' }
  assertPaymentCapabilities(provider, ['usage.prepaid-top-up'])
  if (!provider.getDefaultPaymentMethod) {
    throw new Error(`payment provider "${provider.id}" cannot load a saved payment method`)
  }
  const method = await provider.getDefaultPaymentMethod(customerId)
  return method.paymentMethodId ? { customer: customerId, paymentMethod: method.paymentMethodId } : null
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return fail('method not allowed', 405)
  const user = await getUser(req)
  if (!user) return fail('sign in first', 401)

  try {
    await fresh()
    const provider = await getPaymentProvider()
    const body = await req.json().catch(() => ({}))
    /* the site-wide banner's question (UsagePaymentAlert.vue): does a usage payment need this customer?
       Answered from their own subscriptions alone, before any catalog or payment-method work, with one
       status word — the settlement records never reach the browser */
    if (body.action === 'attention') {
      const owned = await query(
        admin.from('subscriptions').select('id').eq('user_id', user.id),
        'usage subscriptions could not be loaded',
      )
      const ids = (owned ?? []).map((subscription: any) => subscription.id)
      const open = ids.length
        ? await query(
          admin.from('usage_incremental_settlements').select('status')
            .eq('provider', provider.id).in('subscription_id', ids)
            .in('status', ['requires_action', 'failed']),
          'usage payments could not be loaded',
        )
        : []
      const statuses = new Set((open ?? []).map((settlement: any) => settlement.status))
      return json({ attention: statuses.has('requires_action') ? 'requires_action' : statuses.has('failed') ? 'failed' : null })
    }
    if (provider.id === 'stripe' && !stripeConfigured) return stripeUnconfigured()
    const config = of<AutoTopUpConfig>('catalog').usage_auto_topup || { enabled: false, currency: null, packs: [] }

    if (body.action === 'read') {
      const prefs = await query(
        admin.from('usage_topup_preferences').select('*').eq('user_id', user.id).maybeSingle(),
        'automatic top-up preference could not be loaded',
      )
      if (config.enabled) assertPaymentCapabilities(provider, ['usage.prepaid-top-up'])
      const customers = await findProviderExternalIds(provider.id, 'customer', 'profiles', user.id)
      const profile = provider.id === 'stripe' && !customers.length
        ? await query(
          admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle(),
          'billing profile could not be loaded',
        )
        : null
      const customerId = customers[0] ?? profile?.stripe_customer_id
      const method = config.enabled && customerId ? await savedPaymentMethod(provider, customerId) : null
      const subscriptions = await query(
        admin.from('subscriptions').select('id, key').eq('user_id', user.id),
        'incremental usage subscriptions could not be loaded',
      )
      const subscriptionKeys = new Map((subscriptions ?? []).map((subscription: any) => [subscription.id, subscription.key]))
      const subscriptionIds = [...subscriptionKeys.keys()]
      const settlements = subscriptionIds.length
        ? await query(
          admin.from('usage_incremental_settlements')
            .select('subscription_id, period_start, settlement_key, amount_minor, currency, status')
            .eq('provider', provider.id)
            .in('subscription_id', subscriptionIds)
            .in('status', ['pending', 'failed', 'requires_action']),
          'incremental usage settlements could not be loaded',
        )
        : []
      return json({
        config,
        preferences: prefs,
        has_payment_method: !!method,
        can_manage_payment_method: provider.id === 'stripe' || typeof provider.createPaymentMethodSession === 'function',
        incremental_attention: (settlements ?? []).map((settlement: any) => ({
          subscription_id: settlement.subscription_id,
          period_start: settlement.period_start,
          settlement_key: settlement.settlement_key,
          amount_minor: Number(settlement.amount_minor),
          currency: settlement.currency,
          status: settlement.status,
          offer_key: subscriptionKeys.get(settlement.subscription_id) ?? null,
        })),
      })
    }

    if (['prepare_incremental', 'complete_incremental', 'retry_incremental', 'check_incremental'].includes(body.action)) {
      assertPaymentCapabilities(provider, ['checkout.subscription'])
      const subscriptionId = typeof body.subscription_id === 'string' ? body.subscription_id : ''
      const settlementKey = typeof body.settlement_key === 'string' ? body.settlement_key : ''
      const periodStart = typeof body.period_start === 'string' ? body.period_start : ''
      const parsedPeriodStart = new Date(periodStart)
      if (!subscriptionId || !settlementKey || !Number.isFinite(parsedPeriodStart.getTime())) {
        return fail('incremental usage payment reference is invalid')
      }
      const periodStartIso = parsedPeriodStart.toISOString()
      const { subscription, settlement } = await loadOwnedIncrementalSettlement({
        admin,
        providerId: provider.id,
        userId: user.id,
        subscriptionId,
        periodStart: periodStartIso,
        settlementKey,
      })
      if (!subscription) return fail('incremental usage payment was not found', 404)
      if (!settlement) return fail('incremental usage payment was not found', 404)
      const retry = body.action === 'retry_incremental'
      const check = body.action === 'check_incremental'
      if (retry && settlement.status !== 'failed') {
        return fail('this incremental usage payment is not ready for a new attempt', 409)
      }
      if (check && !['pending', 'requires_action'].includes(settlement.status)) {
        return fail('this incremental usage payment is not pending', 409)
      }
      if (!retry && !check && (settlement.status !== 'requires_action' || !settlement.payment_intent_id)) {
        return fail('this incremental usage payment does not need customer verification', 409)
      }
      if (check && settlement.payment_intent_id && provider.retrievePaymentIntent) {
        const intent = await provider.retrievePaymentIntent(settlement.payment_intent_id)
        if (intent.status.toLowerCase() === 'succeeded') {
          const result = await settleIncrementalUsage(provider, {
            subscriptionId,
            periodStart: periodStartIso,
            finalize: settlementKey === 'period-close',
          })
          return json({ settled: true, charged_minor: result.chargedMinor })
        }
        const currentStatus = intent.status.toLowerCase()
        const status = currentStatus.includes('action') || currentStatus.includes('authentication') ||
            currentStatus.includes('confirm')
          ? 'requires_action'
          : currentStatus === 'processing' ? 'pending' : 'failed'
        const { error: statusError } = await admin.from('usage_incremental_settlements')
          .update({
            status,
            last_error: `payment status is "${intent.status}"`,
            updated_at: new Date().toISOString(),
          })
          .eq('provider', provider.id)
          .eq('subscription_id', subscriptionId)
          .eq('period_start', periodStartIso)
          .eq('settlement_key', settlementKey)
          .eq('status', settlement.status)
        if (statusError) throw new Error(`incremental usage payment status could not be refreshed: ${statusError.message}`)
        return json({ status })
      }
      if (retry || (check && settlement.status === 'pending')) {
        const result = await settleIncrementalUsage(provider, {
          subscriptionId,
          periodStart: periodStartIso,
          finalize: settlementKey === 'period-close',
        })
        return json({ settled: true, charged_minor: result.chargedMinor })
      }
      if (body.action === 'complete_incremental') {
        const result = await settleIncrementalUsage(provider, {
          subscriptionId,
          periodStart: periodStartIso,
          finalize: settlementKey === 'period-close',
        })
        return json({ settled: true, charged_minor: result.chargedMinor })
      }
      if (!provider.retrievePaymentIntent) {
        throw new Error(`payment provider "${provider.id}" cannot retrieve an action-required payment`)
      }
      const intent = await provider.retrievePaymentIntent(settlement.payment_intent_id)
      if (intent.status.toLowerCase() === 'succeeded') {
        const result = await settleIncrementalUsage(provider, {
          subscriptionId,
          periodStart: periodStartIso,
          finalize: settlementKey === 'period-close',
        })
        return json({ settled: true, charged_minor: result.chargedMinor })
      }
      const intentStatus = intent.status.toLowerCase()
      if (!intentStatus.includes('action') && !intentStatus.includes('authentication') &&
          !intentStatus.includes('confirm')) {
        const status = intentStatus === 'processing' ? 'pending' : 'failed'
        const { error: statusError } = await admin.from('usage_incremental_settlements')
          .update({
            status,
            last_error: `payment status changed to "${intent.status}"`,
            updated_at: new Date().toISOString(),
          })
          .eq('provider', provider.id)
          .eq('subscription_id', subscriptionId)
          .eq('period_start', periodStartIso)
          .eq('settlement_key', settlementKey)
          .eq('status', 'requires_action')
        if (statusError) throw new Error(`incremental usage payment status could not be refreshed: ${statusError.message}`)
        return json({ status })
      }
      if (!intent.clientSecret) {
        throw new Error(`payment provider "${provider.id}" did not return a client secret for customer authentication`)
      }
      const publishableKey = provider.id === 'hyperswitch'
        ? Deno.env.get('HYPERSWITCH_PUBLISHABLE_KEY')
        : provider.id === 'stripe'
          ? Deno.env.get('STRIPE_PUBLISHABLE_KEY')
          : undefined
      if (!publishableKey) throw new Error(`payment provider "${provider.id}" is missing its customer authentication publishable key`)
      return json({
        action: {
          provider: provider.id,
          client_secret: intent.clientSecret,
          publishable_key: publishableKey,
          ...(provider.id === 'hyperswitch'
            ? {
              api_base_url: Deno.env.get('HYPERSWITCH_BASE_URL'),
              client_url: hyperswitchClientUrl(Deno.env.get('HYPERSWITCH_CLIENT_URL')),
            }
            : {}),
        },
      })
    }

    if (body.action === 'save') {
      if (body.enabled === true && !config.enabled) {
        return json({ error: 'automatic top-up is not enabled by this site', code: 'topup_site_disabled' }, 409)
      }
      if (body.enabled === true) assertPaymentCapabilities(provider, ['usage.prepaid-top-up'])
      const pack = config.packs?.find((item) => item.key === body.offer_key)
      if (!pack || pack.currency !== config.currency) return fail('choose an eligible usage pack')
      const enabled = body.enabled === true
      let consentAt = null
      if (enabled && body.consent === true) {
        if (!isStripeMock(provider)) {
          const customers = await findProviderExternalIds(provider.id, 'customer', 'profiles', user.id)
          const customerId = customers[0] ?? (provider.id === 'stripe'
            ? (await query(
              admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle(),
              'billing profile could not be loaded',
            ))?.stripe_customer_id
            : null)
          if (!customerId || !await savedPaymentMethod(provider, customerId)) {
            return json({ error: 'add a saved payment method before enabling automatic top-up', code: 'payment_method_required' }, 409)
          }
        }
        consentAt = new Date().toISOString()
      }
      const { data, error } = await admin.rpc('usage_topup_save', {
        p_user_id: user.id,
        p_enabled: enabled,
        p_offer_key: pack.key,
        p_threshold_micros: Number(body.threshold_micros),
        p_monthly_cap_minor: Number(body.monthly_cap_minor),
        p_currency: pack.currency,
        p_consent_at: consentAt,
      })
      if (error) return fail(`automatic top-up preference could not be saved: ${error.message}`)
      if (data !== true) return fail('automatic top-up preference was not saved', 500)
      return json({ saved: true })
    }

    if (body.action === 'portal') {
      if (isStripeMock(provider)) return json({ url: `${appUrl()}/billing?billing=mock#usage`, mock: true })
      assertPaymentCapabilities(provider, ['customer.portal'])
      const customer = await customerFor(provider, user)
      if (provider.id === 'hyperswitch') {
        if (!provider.createPaymentMethodSession) {
          throw new Error('Hyperswitch does not support customer payment-method management')
        }
        const session = await provider.createPaymentMethodSession({
          customerId: customer.id,
          returnUrl: `${appUrl()}/billing#usage`,
        })
        const publishableKey = Deno.env.get('HYPERSWITCH_PUBLISHABLE_KEY')
        const apiBaseUrl = Deno.env.get('HYPERSWITCH_BASE_URL')
        if (!publishableKey || !apiBaseUrl) {
          throw new Error('Hyperswitch payment-method management is missing its public SDK configuration')
        }
        return json({
          payment_method_management: {
            provider: provider.id,
            sdk_authorization: session.sdkAuthorization,
            profile_id: session.profileId,
            publishable_key: publishableKey,
            api_base_url: apiBaseUrl,
            client_url: hyperswitchClientUrl(Deno.env.get('HYPERSWITCH_CLIENT_URL')),
          },
        })
      }
      if (!provider.createPortalSession) throw new Error(`payment provider "${provider.id}" cannot open a billing portal`)
      const portal = await provider.createPortalSession({
        customerId: customer.id,
        returnUrl: `${appUrl()}/billing#usage`,
      })
      return json({ url: portal.url })
    }

    return fail('unknown automatic top-up action')
  } catch (error) {
    console.error('usage-topup failed', error)
    return fail(String((error as Error)?.message ?? error), 500)
  }
})
