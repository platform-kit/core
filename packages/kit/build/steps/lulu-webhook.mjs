/* The printer's webhook, registered at this project's lulu-webhook function — once; a listing after (build/print/webhook.mjs) */
export default {
  key: 'lulu-webhook', title: "The printer's webhook", phase: 'functions', module: 'print', after: ['catalog'],
  when: (env) => !!(env.LULU_CLIENT_KEY && env.LULU_CLIENT_SECRET), whenText: "Lulu's keys are not set",
  needs: { env: ['VITE_SUPABASE_URL'] },
  run: ({ script, env }) => script('print/webhook.mjs', ['--url', `${String(env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/lulu-webhook`]),
}
