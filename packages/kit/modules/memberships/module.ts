/* everything memberships is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'memberships', what: 'tiers, the billing portal', needs: 'there is nowhere to keep a membership',
  static: false, git: true, cloud: true,
  owns: {
    cron: [
      { name: 'hyperswitch-subscription-renewal', schedule: '*/15 * * * *', command: 'select public.run_hyperswitch_subscription_renewal()' },
      /* a week before a fixed term that simply ends, the member is told (openspec: payment-plans) */
      { name: 'term-reminders', schedule: '20 * * * *', command: 'select public.run_term_reminders()' },
      /* an offer that moves existing subscribers to a new price: told ahead, moved at a renewal (openspec: payment-plans) */
      { name: 'repricings', schedule: '40 9 * * *', command: 'select public.run_repricings()' },
    ],
    env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
} satisfies ModuleDeclaration
