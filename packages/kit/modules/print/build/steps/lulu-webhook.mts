import { fileURLToPath } from 'node:url'
/* The printer's webhook, registered at this project's lulu-webhook function — once; a listing after (modules/print/build/webhook.mjs) */
export default {
  key: 'lulu-webhook', title: "The printer's webhook", phase: 'functions', module: 'print', after: ['catalog'],
  when: (env: { LULU_CLIENT_KEY: any; LULU_CLIENT_SECRET: any; }) => !!(env.LULU_CLIENT_KEY && env.LULU_CLIENT_SECRET), whenText: "Lulu's keys are not set",
  needs: { env: ['VITE_SUPABASE_URL'] },
  run: ({ script, env }: any) => script(fileURLToPath(new URL('../webhook.mjs', import.meta.url)), ['--url', `${String(env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/lulu-webhook`]),
}
