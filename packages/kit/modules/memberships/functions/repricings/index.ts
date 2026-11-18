/*
 * POST (the service bearer; run_repricings daily) → { told, moved, dropped }
 *
 * EXISTING SUBSCRIBERS AND A PRICE CHANGE (openspec: payment-plans). An offer keeps whoever already pays it on
 * the price they signed up at, unless its file says `existing: move`. Then each subscriber still paying an old
 * price is told once, `notice_days` ahead, of the new price and the renewal it starts at — the first one at
 * least that far away — and when that renewal is the next one, the subscription is moved to the new price from
 * then, through the ordinary change a member's own switch of plan uses. Nothing is charged here.
 *
 * Somebody partway through a term is left alone until it is over: their price is the term's. A subscription
 * that is ending, or has ended, before its move is made has its notice dropped.
 */
import { admin, json, preflight, isServiceBearer, appUrl, getPaymentProvider } from '@pk/core/lib.ts'
import { OFFERS, ensureOffer } from '@pk/core/offers.ts'
import { sendEmail } from '@pk/core/email.ts'
import { fresh } from '@pk/core/compiled.ts'
import { binding, moveAtPeriodEnd } from '@pk/core/commitments.ts'

const money = (minor: number, currency: string) => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((Number(minor) || 0) / 100) }
  catch { return `${((Number(minor) || 0) / 100).toFixed(2)} ${String(currency || '').toUpperCase()}` }
}
const day = (iso: string) => new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(iso))

/* the first renewal at least `days` from now: the period's end, stepped a period at a time */
export function effectiveFrom(periodEnd: string, period: string | null, days: number, now = new Date()): Date {
  const due = now.getTime() + days * 86400_000
  const at = new Date(periodEnd)
  while (at.getTime() < due) {
    if (period === 'weekly') at.setUTCDate(at.getUTCDate() + 7)
    else at.setUTCMonth(at.getUTCMonth() + 1)
  }
  return at
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!await isServiceBearer(req)) return json({ error: 'the service bearer' }, 401)
  await fresh()
  const now = new Date()
  let told = 0, moved = 0, dropped = 0
  try {
    for (const o of Object.values(OFFERS)) {
      if (o.existing !== 'move' || o.billing !== 'subscription') continue
      const { data: subs, error } = await admin.from('subscriptions')
        .select('id, user_id, key, plan_amount, current_period_end, cancel_at_period_end, status, next_key')
        .eq('key', o.key).in('status', ['active', 'trialing', 'past_due']).neq('plan_amount', o.unit_amount)
      if (error) throw new Error(`subscriptions could not be read: ${error.message}`)
      for (const s of subs ?? []) {
        if (!s.current_period_end || s.plan_amount == null) continue
        const { data: was } = await admin.from('repricings').select('id, status, effective_at')
          .eq('subscription_id', s.id).eq('offer_key', o.key).eq('to_amount', o.unit_amount).maybeSingle()
        /* ending, partway through a term, or already changing plan at its renewal: not moved, and a notice
           already sent is withdrawn */
        if (s.cancel_at_period_end || (s.next_key && s.next_key !== o.key) || await binding(s.id)) {
          if (was?.status === 'notified') { await admin.from('repricings').update({ status: 'dropped' }).eq('id', was.id); dropped++ }
          continue
        }
        if (!was) {
          /* TOLD ONCE: the row is written first, so two runs never send it twice */
          const at = effectiveFrom(s.current_period_end, o.period ?? 'monthly', o.notice_days ?? 30, now)
          const { data: made, error: madeError } = await admin.from('repricings').insert({
            subscription_id: s.id, user_id: s.user_id, offer_key: o.key, from_amount: s.plan_amount, to_amount: o.unit_amount,
            currency: o.currency, effective_at: at.toISOString(),
          }).select('id').maybeSingle()
          if (madeError?.code === '23505') continue
          if (madeError || !made) throw new Error(`a price change could not be recorded: ${madeError?.message ?? 'no row'}`)
          const { data: who } = await admin.from('profiles').select('email, display_name').eq('id', s.user_id).maybeSingle()
          if (who?.email && await sendEmail(who.email, 'price-change', {
            name: (who.display_name ?? '').split(' ')[0] ?? '', what: o.title, from: money(s.plan_amount, o.currency), to: money(o.unit_amount, o.currency),
            period: o.period === 'weekly' ? 'week' : 'month', date: day(at.toISOString()), url: `${appUrl()}/billing`,
          })) told++
          continue
        }
        /* MOVED when the renewal the notice named is the next one: the new price from then */
        if (was.status === 'notified' && new Date(s.current_period_end).getTime() >= new Date(was.effective_at).getTime() - 60_000) {
          /* the new price made at the provider first, as a checkout would, so the change has one to name */
          if ((await getPaymentProvider() as any).capabilities?.includes('catalog.sync')) await ensureOffer(o.sku)
          await moveAtPeriodEnd(s.id, o)
          await admin.from('repricings').update({ status: 'applied', applied_at: new Date().toISOString() }).eq('id', was.id).eq('status', 'notified')
          moved++
        }
      }
    }
    return json({ told, moved, dropped })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
