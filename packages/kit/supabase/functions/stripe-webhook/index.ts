/*
 * The reconciliation engine. Stripe is the ledger of record for money; this
 * projects its events into our tables — purchases, subscriptions — and, from
 * them, the entitlements ledger the app actually reads. What was bought is read
 * by sku (the price's lookup key) from our own catalog (offers.ts), never from
 * Stripe's product objects; a membership's tier is the price's metadata.tier,
 * which every price of a tier carries, so a subscriber on a retired price still
 * holds it.
 *
 * No user JWT (verify_jwt is off for this function); trust comes only from the
 * Stripe signature. Idempotent on the event id (stripe_events), so retries are
 * acknowledged without being re-applied. Every grant carries the Stripe id that
 * caused it as source_id, which is how a cancellation or refund revokes exactly
 * what it granted and nothing else.
 */
import { stripe, admin, json } from '../_shared/lib.ts'
import { checkoutCompleted, subscriptionChanged, subscriptionDeleted, iso, idOf } from '../_shared/ledger.ts'

const SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

async function handle(event: any) {
  const o = event.data.object
  switch (event.type) {
    case 'checkout.session.completed': await checkoutCompleted(o); break
    case 'customer.subscription.created':
    case 'customer.subscription.updated': await subscriptionChanged(o); break
    case 'customer.subscription.deleted': await subscriptionDeleted(o.id); break
    case 'invoice.paid': {
      const subId = idOf(o.subscription); if (!subId) break
      const end = iso(o.lines?.data?.[0]?.period?.end)
      if (end) {
        await admin.from('subscriptions').update({ current_period_end: end, status: 'active', updated_at: new Date().toISOString() }).eq('id', subId)
        await admin.from('entitlements').update({ expires_at: end, active: true }).eq('source_id', subId)
      }
      break
    }
    case 'invoice.payment_failed': {
      const subId = idOf(o.subscription); if (!subId) break
      await admin.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('id', subId)
      break
    }
    /*
     * THE BASKET THAT WAS ABANDONED. Stripe expires a session (30 minutes to 24 hours, 24 by
     * default) and says so, and that event is the only thing that can tell us a hold is dead.
     * Without this one case a single abandoned checkout holds the last unit all day.
     */
    case 'checkout.session.expired': {
      await releaseHolds(String(o.id ?? ""))
      await releaseBudgets(o)
      break
    }
    case 'charge.refunded': {
      const pi = idOf(o.payment_intent); if (!pi) break
      /* a payment is one row PER LINE, so a refund marks them all and the session is read off
         the first — maybeSingle here threw the moment anybody bought two things at once */
      const { data: rows } = await admin.from('purchases').update({ status: 'refunded' })
        .eq('stripe_payment_intent_id', pi).select('stripe_checkout_session_id')
      const sess = rows?.[0]?.stripe_checkout_session_id
      if (sess) await admin.from('entitlements').update({ active: false }).eq('source_id', sess)
      break
    }
  }
}

/*
 * GIVING BACK WHAT A DEAD SESSION WAS HOLDING.
 *
 * The movements are the record of what was held, so there is no second table to keep in step:
 * every `reserved` movement for this session, less anything already released or sold against
 * it, is what is still out. A session whose payment landed has a `sold` movement that already
 * released the hold in the same statement, so there is nothing left to give back and this
 * writes nothing — which is what makes it safe to run on a retry of the event.
 */
async function releaseHolds(sessionId: string): Promise<void> {
  if (!sessionId) return
  const { data } = await admin.from('inventory_movements').select('sku, variant, delta, reason').eq('about', sessionId)
  if (!data || !data.length) return
  const held = new Map<string, number>()
  for (const m of data) {
    const k = m.sku + '\u0000' + (m.variant ?? '')
    if (m.reason === 'reserved') held.set(k, (held.get(k) ?? 0) + Number(m.delta))
    if (m.reason === 'released' || m.reason === 'sold') held.set(k, (held.get(k) ?? 0) - Math.abs(Number(m.delta)))
  }
  for (const [k, qty] of held) {
    if (qty <= 0) continue
    const [sku, variant] = k.split('\u0000')
    await admin.rpc('inventory_give', { p_sku: sku, p_variant: variant, p_qty: qty, p_reason: 'released', p_about: sessionId })
  }
}

/*
 * AND THE DISCOUNT BUDGET A DEAD CHECKOUT WAS HOLDING.
 *
 * The budget is taken before the session exists — it has to be, or two people could both be
 * the last one under the limit while Stripe was still thinking — so an abandoned checkout has
 * spent budget on a sale that never happened. Without this a campaign with a hundred uses is
 * exhausted by a hundred people who changed their minds.
 *
 * What was taken rides on the session’s own metadata, so this needs no second table and a
 * retry of the event is harmless: `promotion_give` floors at nothing.
 */
async function releaseBudgets(session: any): Promise<void> {
  const promos = String(session?.metadata?.promos ?? "")
  if (!promos) return
  for (const part of promos.split(',').filter(Boolean)) {
    const [name, kind, amount] = part.split(':')
    if (!name) continue
    await admin.rpc('promotion_give', { p_promotion: name, p_kind: kind || 'usage', p_amount: Number(amount) || 0 })
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  /* no signing secret → nothing can be trusted; say so rather than guess */
  if (!SECRET) return json({ error: 'Webhook not configured in this environment (no STRIPE_WEBHOOK_SECRET).', code: 'stripe_unconfigured' }, 503)
  const raw = await req.text()
  let event: any
  try {
    event = await stripe.webhooks.constructEventAsync(raw, req.headers.get('stripe-signature') ?? '', SECRET)
  } catch (e) {
    return json({ error: 'bad signature' }, 400)
  }
  const { data: seen } = await admin.from('stripe_events').select('id').eq('id', event.id).maybeSingle()
  if (seen) return json({ ok: true, duplicate: true })
  await admin.from('stripe_events').insert({ id: event.id, type: event.type })
  try {
    await handle(event)
  } catch (e) {
    /* let Stripe retry: forget the id so the retry isn't treated as a duplicate */
    await admin.from('stripe_events').delete().eq('id', event.id)
    return json({ error: String((e as any)?.message ?? e) }, 500)
  }
  return json({ ok: true })
})
