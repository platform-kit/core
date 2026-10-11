/* Stripe made to match the offers — products and prices found or created by key, a changed price replaced — through the push-catalog function, called as the deploy with the service-role key */
export default {
  key: 'push-catalog', title: 'The offers pushed to Stripe', phase: 'after', after: ['auth-config'],
  when: (env) => !!env.STRIPE_SECRET_KEY, whenText: 'STRIPE_SECRET_KEY is not set (nothing for sale)',
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'] },
  run: async ({ env, log }) => {
    const res = await fetch(`${String(env.VITE_SUPABASE_URL).replace(/\/+$/, '')}/functions/v1/push-catalog`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: '{}' })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`push-catalog: ${out.error || res.status}`)
    log(`  offers pushed to Stripe: ${out.offers} offers, ${out.made} price${out.made === 1 ? '' : 's'} made`)
  },
}
