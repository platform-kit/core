/* The funnels' runner told where it lives: one authorised (dry) call writes app_settings with the project's own functions url and key, which the hourly pg_cron job then uses */
export default {
  key: 'funnels-run', title: "The funnels' runner", phase: 'after', module: 'funnels', after: ['push-catalog'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'] },
  run: async ({ env, log }) => {
    const res = await fetch(`${String(env.VITE_SUPABASE_URL).replace(/\/+$/, '')}/functions/v1/funnels-run`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: '{"dry":true}' })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`funnels-run: ${out.error || res.status}`)
    log(`  funnels: ${Object.keys(out.funnels || {}).length} published, the runner's url recorded`)
  },
}
