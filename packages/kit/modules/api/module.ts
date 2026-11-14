/* everything api is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'api', what: 'the content API', needs: 'the API is Edge Functions',
  static: false, git: true, cloud: true,
  pages: [
    { name: 'ApiReferencePage', order: 130, page: './ui/ApiReferencePage.vue', test: './lib/routes.ts#apiReference' },
  ],
  fills: {
    /* the keys and the subscriptions, in the admin's settings before the payments */
    'core:admin-screen': [{ key: 'api', component: './ui/admin/ApiAdmin.vue' }],
    'core:admin-rail': [{ key: 'api', sec: 'settings', beforeItem: 'payments', live: true, icon: '<circle cx="7" cy="10" r="3"/><path d="M10 10h7M14 10v3M17 10v2"/>' }],
  },
  owns: {
    cron: [
      { name: 'content-push', schedule: '* * * * *', command: 'select public.run_content_push()' },
      { name: 'sweep-uploads', schedule: '50 4 * * *', command: 'select public.sweep_uploads()' },
    ],
  },
} satisfies ModuleDeclaration
