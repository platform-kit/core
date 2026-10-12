import { admin, appUrl, getUser, json, preflight, stripe, stripeConfigured, stripeMock, stripeUnconfigured } from '../_shared/lib.ts'
import { of, fresh } from '../_shared/compiled.ts'

type AutoTopUpConfig = { enabled: boolean; currency: string | null; packs: Array<Record<string, any>> }

const fail = (message: string, status = 400) => json({ error: message }, status)
const query = async (builder: any, label: string) => {
  const { data, error } = await builder
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function customerFor(user: any) {
  const profile = await query(
    admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle(),
    'billing profile could not be loaded',
  )
  if (profile?.stripe_customer_id && !stripeMock) {
    return { id: profile.stripe_customer_id, email: user.email || undefined }
  }
  if (stripeMock) return { id: profile?.stripe_customer_id || `cus_mock_${user.id}`, email: user.email || undefined }
  const customer = await stripe.customers.create(
    { email: user.email || undefined, metadata: { user_id: user.id } },
    { idempotencyKey: `usage-customer:${user.id}` },
  )
  const { error } = await admin.from('profiles').update({ stripe_customer_id: customer.id }).eq('id', user.id)
  if (error) throw new Error(`billing customer could not be saved: ${error.message}`)
  return customer
}

async function savedPaymentMethod(customerId: string) {
  if (stripeMock) return { customer: customerId, paymentMethod: 'pm_mock_usage' }
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ['invoice_settings.default_payment_method'],
  }) as any
  if (customer.deleted) return null
  const method = customer.invoice_settings?.default_payment_method
  return method ? { customer: customer.id, paymentMethod: typeof method === 'string' ? method : method.id } : null
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return fail('method not allowed', 405)
  const user = await getUser(req)
  if (!user) return fail('sign in first', 401)
  if (!stripeConfigured) return stripeUnconfigured()

  try {
    await fresh()
    const config = of<AutoTopUpConfig>('catalog').usage_auto_topup || { enabled: false, currency: null, packs: [] }
    const body = await req.json().catch(() => ({}))

    if (body.action === 'read') {
      const prefs = await query(
        admin.from('usage_topup_preferences').select('*').eq('user_id', user.id).maybeSingle(),
        'automatic top-up preference could not be loaded',
      )
      const profile = await query(
        admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle(),
        'billing profile could not be loaded',
      )
      const method = profile?.stripe_customer_id ? await savedPaymentMethod(profile.stripe_customer_id) : null
      return json({ config, preferences: prefs, has_payment_method: !!method })
    }

    if (body.action === 'save') {
      if (body.enabled === true && !config.enabled) {
        return json({ error: 'automatic top-up is not enabled by this site', code: 'topup_site_disabled' }, 409)
      }
      const pack = config.packs?.find((item) => item.key === body.offer_key)
      if (!pack || pack.currency !== config.currency) return fail('choose an eligible usage pack')
      const enabled = body.enabled === true
      let consentAt = null
      if (enabled && body.consent === true) {
        if (!stripeMock) {
          const profile = await query(
            admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle(),
            'billing profile could not be loaded',
          )
          if (!profile?.stripe_customer_id || !await savedPaymentMethod(profile.stripe_customer_id)) {
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
      if (stripeMock) return json({ url: `${appUrl()}/app/usage?billing=mock`, mock: true })
      const customer = await customerFor(user)
      const portal = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: `${appUrl()}/app/usage`,
      })
      return json({ url: portal.url })
    }

    return fail('unknown automatic top-up action')
  } catch (error) {
    console.error('usage-topup failed', error)
    return fail(String((error as Error)?.message ?? error), 500)
  }
})
