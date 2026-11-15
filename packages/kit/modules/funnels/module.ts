/* everything funnels is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'funnels', what: 'funnels, blasts, audiences, the runner', needs: 'there is nobody to send to and nowhere to record it',
  static: false, git: true, cloud: true,
  fills: {
    /* the campaigns and the one-off sends, each its own editor over the whole admin; what they did, under the figures */
    'core:admin-screen': [
      { key: 'funnels', component: './ui/admin/FunnelsScreen.vue', path: true, bare: true },
      { key: 'blasts', component: './ui/admin/BlastsScreen.vue', path: true, bare: true },
      { key: 'funnel-analytics', component: './ui/admin/FunnelAnalyticsScreen.vue', path: true },
    ],
    /* Funnels in Marketing before the ads, its numbers a tab of it, and a blast a tab of Emails */
    'core:admin-rail': [
      { key: 'funnels', sec: 'marketing', beforeItem: 'ads', icon: '<path d="M3 4.5h14l-5.5 6.5v4l-3 1.5v-5.5Z"/>' },
      { key: 'funnel-analytics', tabOf: 'funnels', needs: 'figures', live: true, icon: '<path d="M3.5 4.5h13"/><path d="M5 8.5h10"/><path d="M6.5 12.5h7"/><path d="M8 16.5h4"/>' },
      { key: 'blasts', tabOf: 'emails', icon: '<path d="M3 10l14-6-4 13-3-5.5Z"/><path d="M10 11.5 17 4"/>' },
    ],
  },
  owns: {
    steps: ['funnels-run', 'funnels'],
    cron: [{ name: 'email-funnels', schedule: '7 * * * *', command: 'select public.run_email_funnels()' }],
    env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
  },
} satisfies ModuleDeclaration
