/*
 * POST → { url } to the Stripe Billing Portal for the signed-in customer.
 * This is the whole subscription-management surface: upgrade, cancel, cards,
 * invoices all live there. A user with no Stripe customer yet has nothing to
 * manage (they subscribe through Checkout first).
 */
import { stripe, stripeConfigured, stripeMock, isMockId, stripeUnconfigured, admin, json, preflight, getUser, appUrl } from '../_shared/lib.ts'
import { subscriptionDeleted } from '../_shared/ledger.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const user = await getUser(req)
  if (!user) return json({ error: 'sign in first' }, 401)
  if (!stripeConfigured) return stripeUnconfigured()
  /* the mock has no portal: "manage" cancels the mock subscriptions at once and comes back */
  if (stripeMock) {
    const { data: subs } = await admin.from('subscriptions').select('id').eq('user_id', user.id).like('id', 'sub_mock_%').neq('status', 'canceled')
    for (const s of subs ?? []) await subscriptionDeleted(s.id)
    return json({ url: `${appUrl()}/app?portal=mock`, mock: true, cancelled: (subs ?? []).length })
  }

  const { data: prof } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle()
  if (!prof?.stripe_customer_id || isMockId(prof.stripe_customer_id)) return json({ error: 'no billing account yet' }, 404)

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: prof.stripe_customer_id,
      return_url: `${appUrl()}/store`,
    })
    return json({ url: session.url })
  } catch (e) {
    return json({ error: `Stripe: ${(e as any)?.message ?? e}` }, 502)
  }
})
