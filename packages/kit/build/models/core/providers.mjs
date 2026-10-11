/*
 * THE PROVIDER POLICY — one record, `content/providers.md`: who may sell their own time here, on
 * what footing, and how they are paid, with the TERMS as its body.
 *
 * It is a file because it is a declaration: if the database were deleted and the repository
 * redeployed, the site's policy and its terms should come back exactly as they were. What hangs off
 * it — who signed which version, what anybody offers, what they are owed — is rows, and none of it
 * is edited here.
 *
 * The four settings are fields, never the yaml: `payout-delay` is a number and a unit, `connect` is
 * a choice between two named things, and the two switches are switches. The version is the one
 * free-text field, because it is a name the site gives a wording.
 */
import { z } from 'zod/v4'
import matter from 'gray-matter'
import { POLICY, POLICY_AT, CONNECT, readPolicy, projectProviders } from '../../providers-io.mjs'
import { spanMinutes } from '../../../src/lib/payouts.js'

/* minutes → the span as somebody writes it, so the form shows 30d rather than 43200 */
const spanOf = (mins) => {
  const m = Number(mins) || 0
  if (m % 1440 === 0) return (m / 1440) + 'd'
  if (m % 60 === 0) return (m / 60) + 'h'
  return m + 'm'
}

/* over a checkout a write IS the file, so the script projects then; over rows a write is a draft
   and nothing is projected until it is published — see `projected` below */
async function onWrite(ctx) {
  if (ctx.store && ctx.store.kind === 'rows') return
  await ctx.script('providers-push.mjs').catch((e) => console.warn('providers: not projected — ' + e.message))
}

export default {
  key: 'providers', name: 'Providers', dir: 'content', single: 'providers', title: 'terms', module: 'sessions',
  body: true, bodyLabel: 'The terms somebody agrees to before they may sell',
  grammar: {
    parse: (text) => {
      const f = matter(String(text || ''))
      const d = { ...POLICY, ...(f.data || {}) }
      return { data: { offerings: d.offerings === 'on' || d.offerings === true, approve: d.approve === 'on' || d.approve === true, terms: String(d.terms || ''), 'payout-delay': String(d['payout-delay'] || POLICY['payout-delay']), connect: String(d.connect || POLICY.connect) }, content: String(f.content || '').trim() }
    },
    serialise: (rec) => {
      const d = rec.data || {}
      const y = [
        `offerings: ${d.offerings ? 'on' : 'off'}`,
        `approve: ${d.approve ? 'on' : 'off'}`,
        `terms: ${String(d.terms || '').trim()}`,
        `payout-delay: ${String(d['payout-delay'] || POLICY['payout-delay']).trim()}`,
        `connect: ${String(d.connect || POLICY.connect).trim()}`,
      ].join('\n')
      return `---\n${y}\n---\n\n${String(rec.content || '').trim()}\n`
    },
  },
  fields: z.object({
    offerings: z.boolean().meta({ label: 'Providers may offer their own sessions', help: 'off: only the site\'s own booking types are sold here' }).optional(),
    approve: z.boolean().meta({ label: 'A new offering waits for a person', help: 'off: what a provider makes live is live' }).optional(),
    terms: z.string().meta({ label: 'The version of these terms', help: 'a version anybody has signed is frozen: change the wording and the version together' }).optional(),
    'payout-delay': z.string().meta({ label: 'Held before it is payable', widget: 'span', help: 'so a refund inside the window reverses a line instead of chasing money already sent' }).optional(),
    connect: z.enum(CONNECT).meta({ label: 'How they connect an account', widget: 'select', options: 'connect-ways', help: 'managed: the processor onboards them and holds the identity checks. own: they bring an account they already have' }).optional(),
  }),
  checks: [
    (rec) => {
      const out = [], d = rec.data || {}
      if (String(d.terms || '').trim() && !String(rec.content || '').trim()) out.push({ path: 'terms', message: 'a version with no words is a version nobody can read — write the terms below, or clear the version' })
      if (spanMinutes(d['payout-delay']) == null) out.push({ path: 'payout-delay', message: 'a number and a unit: 30d, 12h, 90m' })
      return out
    },
  ],
  after: async (rec, ctx) => { await onWrite(ctx) },
  /* the policy as it now stands, made real: the four settings and the terms row. Database writes,
     so the Edge Function does them itself rather than waiting for a deploy. */
  projected: async (ctx) => {
    const db = ctx.store && ctx.store.kind === 'rows' ? ctx.store.client : null
    if (!db) return
    const { data, body } = await readPolicy(ctx.store)
    if (data) await projectProviders({ data, body, db })
  },
  options: {
    'connect-ways': () => [
      { value: 'managed', label: 'The processor onboards them' },
      { value: 'own', label: 'They bring their own account' },
    ],
  },
}
