/* The hosted project's auth settings: where the site is, addresses confirmed at sign-up, the mail relay, the magic-link email's words (build/auth-config.mjs) */
export default {
  key: 'auth-config', title: 'The auth settings', phase: 'after',
  needs: { env: ['VITE_APP_URL'] },
  /* said outright, because the inference cannot see it: this writes to the hosted project's auth
     settings, and its only declared need is the site's own address. A site with no backend has no
     auth to configure. */
  backend: true,
  run: ({ script, env }) => { if (!env.APP_URL && env.VITE_APP_URL) env.APP_URL = env.VITE_APP_URL; return script('auth-config.mjs') },
}
