/* everything social-publishing is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'social-publishing', what: 'drafts and scheduled posts for social accounts', needs: 'accounts, media and delivery records live in the backend',
  static: false, git: true, cloud: true,
  fills: {
    /* the accounts, the drafts, the calendar and the automations, in a group of its own after People; the admin's
       social gate (who may enter for Social alone) still decides who sees it */
    'core:admin-screen': [{ key: 'social', component: './ui/admin/SocialAdmin.vue' }],
    'core:admin-rail': [{ key: 'social', sec: 'social', after: 'people', needs: 'social', live: true, icon: '<circle cx="6" cy="10" r="2"/><circle cx="14" cy="5" r="2"/><circle cx="14" cy="15" r="2"/><path d="m7.8 9.1 4.4-3.2M7.8 10.9l4.4 3.2"/>' }],
  },
  owns: {
    cron: [
      { name: 'social-publishing', schedule: '* * * * *', command: 'select public.run_social_publishing()' },
      { name: 'social-metrics', schedule: '*/10 * * * *', command: 'select public.run_social_metrics()' },
      { name: 'social-automation-recovery', schedule: '* * * * *', command: 'select public.run_social_automation()' },
    ],
  },
} satisfies ModuleDeclaration
