/* Synchronize the compiled offers with the selected provider when it declares catalog support. */
import { paymentProviderIdOf } from '../payment-provider-registry.mjs'

export default {
  key: 'push-catalog', title: 'The offers synchronized with the selected payment provider', phase: 'after', after: ['auth-config'],
  when: (env, site) => {
    const providerId = paymentProviderIdOf(site)
    if (providerId === 'stripe') return !!env.STRIPE_SECRET_KEY
    return site._paymentProviderRegistrations
      ?.find((provider) => provider.id === providerId)
      ?.capabilities.includes('catalog.sync') === true
  },
  whenText: 'the selected payment provider does not require catalog synchronization, or its payment configuration is incomplete',
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'] },
  run: async ({ env, site, log }) => {
    const res = await fetch(`${String(env.VITE_SUPABASE_URL).replace(/\/+$/, '')}/functions/v1/push-catalog`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: '{}' })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`push-catalog: ${out.error || res.status}`)
    log(`  offers synchronized with ${paymentProviderIdOf(site)}: ${out.offers} offers`)
  },
}
