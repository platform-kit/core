/* everything support is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'support', what: 'the widget, the desk, the prompts', needs: 'there is nowhere to keep a conversation',
  static: false, git: true, cloud: true,
  fills: {
    /* the desk's conversations, one at its own address, first in Community; the support role's own */
    'core:admin-screen': [{ key: 'support', component: './ui/admin/SupportScreen.vue', path: true }],
    'core:admin-rail': [{ key: 'support', sec: 'community', beforeItem: 'comments', needs: 'support', live: true, icon: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3h-.5A2.5 2.5 0 0 1 2.5 11.5v-5Z"/><path d="M7 8.5h6M7 11h4"/>' }],
  },
  pages: [
    { name: 'SupportPage', order: 180, page: './ui/SupportPage.vue', test: 'platformkit/lib/page-routes.js#support' },
  ],
  owns: {
    steps: ['support-sdk'],
    cron: [
      { name: 'support-escalate', schedule: '*/5 * * * *', command: 'select public.run_support_escalation()' },
      { name: 'support-retain', schedule: '20 4 * * *', command: 'select public.run_support_retention()' },
    ],
    env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
  },
} satisfies ModuleDeclaration
