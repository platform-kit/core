/*
 * POST → synchronizes every compiled offer with the selected provider
 * (offers.ts ensureAll). The Stripe adapter finds or creates products and
 * prices by stable offer identity and retires replaced prices. Idempotent —
 * a second call with nothing changed touches nothing. Run by build/deploy.mjs
 * after the functions are deployed, and from the admin.
 *
 * Who may call it: an admin (their JWT), or the deploy, which has no user and
 * sends the service-role key as the bearer instead.
 */
import { stripeConfigured, stripeMock, stripeUnconfigured, admin, json, preflight, getUser, isServiceBearer, getPaymentProvider } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { ensureAll, OFFERS } from '../_shared/offers.ts'
import { assertPaymentCapabilities, PaymentProviderError } from '../_shared/payment-provider.mjs'
import type { PaymentProviderAdapter } from '../_shared/payment-provider.d.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  /* the deploy sends the service key (in whichever form it holds it — lib.ts checks it against the admin API, never by string) */
  let allowed = await isServiceBearer(req)
  if (!allowed) {
    const user = await getUser(req)
    if (!user) return json({ error: 'sign in first' }, 401)
    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    allowed = isAdmin(await rolesOf(user.id))
  }
  if (!allowed) return json({ error: 'admin only' }, 403)
  let provider: PaymentProviderAdapter
  try {
    provider = await getPaymentProvider()
    assertPaymentCapabilities(provider, ['catalog.sync'])
  } catch (error) {
    if (error instanceof PaymentProviderError) return json({ error: error.message, code: error.code }, error.status)
    throw error
  }
  if (provider.id === 'stripe' && !stripeConfigured) return stripeUnconfigured()
  if (provider.id === 'stripe' && stripeMock) return json({ offers: Object.keys(OFFERS).length, made: 0, mock: true })
  try {
    const result = await ensureAll()
    const made = Object.values(result).filter((r) => r.made).length
    return json({ offers: Object.keys(OFFERS).length, made, result })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const status = e instanceof PaymentProviderError ? e.status : 502
    return json({ error: `${provider.id}: ${message}` }, status)
  }
})
