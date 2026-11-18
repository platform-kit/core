/*
 * POST (the service bearer; run_term_reminders hourly) → { sent, continued, ended }
 *
 * THE WEEK BEFORE A FIXED TERM ENDS the member is told once, so a term never just stops and never
 * just renews (openspec: payment-plans): `term-ending` where nothing follows it, `term-continues`
 * where it continues monthly or renews, saying what will be charged and that renewal can be turned
 * off on the billing page.
 *
 * AS A TERM PAID IN FULL CLOSES, what follows it starts on the card it was paid with, which the
 * checkout kept for this: another term charged and granted from the day this one ends, or the
 * open-ended monthly membership begun as a subscription. A declined card, or a member who has since
 * taken another membership, and the term just ends, the member told. Every charge carries an
 * idempotency key of the commitment's own, so an hour's run repeated charges nothing twice.
 */
import { admin, json, preflight, isServiceBearer, appUrl, getPaymentProvider } from '@pk/core/lib.ts'
import { offer, ensureOffer, offerMetadata } from '@pk/core/offers.ts'
import { sendEmail } from '@pk/core/email.ts'
import { fresh } from '@pk/core/compiled.ts'
import { termPaid, subscriptionChanged } from '@pk/core/ledger.ts'
import { findProviderExternalIds, linkProviderEntity } from '@pk/core/payment-provider-refs.ts'
import { PaymentProviderError } from '@pk/core/payment-provider.mts'

const day = (iso: string) => new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(iso))
const money = (minor: number, currency: string) => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((Number(minor) || 0) / 100) }
  catch { return `${((Number(minor) || 0) / 100).toFixed(2)} ${String(currency || '').toUpperCase()}` }
}
async function member(userId: string) {
  const { data } = await admin.from('profiles').select('email, display_name').eq('id', userId).maybeSingle()
  return data?.email ? { email: data.email, name: (data.display_name ?? '').split(' ')[0] ?? '' } : null
}

/* THE WEEK BEFORE: one email per term, claimed first so two runs never send it twice */
async function remind(now: Date) {
  const week = new Date(now.getTime() + 7 * 86400_000)
  const { data: due, error } = await admin.from('commitments')
    .select('id, user_id, sku, of_sku, ends_at, then, plan, amount_minor, currency, term_months')
    .eq('membership', true).is('reminded_at', null).is('change_to_sku', null)
    .in('status', ['active', 'ended']).gt('ends_at', now.toISOString()).lte('ends_at', week.toISOString())
  if (error) throw new Error(`terms could not be read: ${error.message}`)
  let sent = 0
  for (const c of due ?? []) {
    const { data: claimed } = await admin.from('commitments').update({ reminded_at: new Date().toISOString() }).eq('id', c.id).is('reminded_at', null).select('id')
    if (!claimed?.length) continue
    const who = await member(c.user_id)
    if (!who) continue
    const parent = offer(c.of_sku)
    const what = parent?.title ?? c.of_sku
    const ends = day(c.ends_at!)
    if (c.then === 'end') {
      if (await sendEmail(who.email, 'term-ending', { name: who.name, what, ends, url: `${appUrl()}/store/products/${c.of_sku}` })) sent++
      continue
    }
    /* what follows, and what it costs: the same term again, or the open-ended monthly price */
    const renew = c.then === 'renew'
    const amount = renew ? money(c.amount_minor, c.currency) : money(parent?.unit_amount ?? 0, parent?.currency ?? c.currency)
    if (await sendEmail(who.email, 'term-continues', {
      name: who.name, what, ends, amount, months: String(c.term_months ?? ''),
      renew: renew ? 'yes' : '', monthly: renew && c.plan === 'full' ? '' : 'yes', full: c.plan === 'full' ? 'yes' : '',
      url: `${appUrl()}/billing`,
    })) sent++
  }
  return sent
}

/* the card a term paid in full was paid with: the provider's own record of that payment, or the
   customer's saved default where the provider keeps one */
async function savedMethod(provider: any, c: any) {
  const [customerId] = await findProviderExternalIds(provider.id, 'customer', 'profiles', c.user_id)
  if (!customerId) return null
  const [paymentId] = c.purchase_id ? await findProviderExternalIds(provider.id, 'payment', 'purchases', c.purchase_id) : []
  let method = paymentId && provider.retrievePaymentIntent ? (await provider.retrievePaymentIntent(paymentId)).paymentMethodId : undefined
  if (!method && provider.getDefaultPaymentMethod) method = (await provider.getDefaultPaymentMethod(customerId)).paymentMethodId ?? undefined
  return method ? { customerId, method } : null
}

/* a membership the member holds apart from this term: then nothing is started over it */
async function otherMembership(userId: string) {
  const { data: subs } = await admin.from('subscriptions').select('id').eq('user_id', userId).in('status', ['active', 'trialing', 'past_due'])
  const ids = (subs ?? []).map((s) => s.id)
  if (!ids.length) return false
  const { data: plans } = await admin.from('commitments').select('subscription_id').in('subscription_id', ids).eq('membership', false)
  const apart = new Set((plans ?? []).map((p: any) => p.subscription_id))
  return ids.some((id) => !apart.has(id))
}

/* AS A TERM PAID IN FULL CLOSES: what follows started, or the record marked ended */
async function close(now: Date) {
  const soon = new Date(now.getTime() + 3600_000)
  const { data: closing, error } = await admin.from('commitments').select('*')
    .eq('plan', 'full').eq('status', 'active').lte('ends_at', soon.toISOString())
  if (error) throw new Error(`terms could not be read: ${error.message}`)
  let continued = 0, ended = 0
  const provider: any = closing?.some((c) => c.then !== 'end') ? await getPaymentProvider() : null
  for (const c of closing ?? []) {
    let declined = false
    if (c.then !== 'end' && !c.change_to_sku) {
      try {
        /* a member who has since taken another membership keeps that one, and nothing is started over it */
        if (!await otherMembership(c.user_id)) {
          if (await continueTerm(provider, c)) continued++
          else declined = true
        }
      } catch (e) {
        if (e instanceof PaymentProviderError && e.code === 'payment_failed') declined = true
        else { console.error('term-reminders: a term could not be continued —', c.id, e); continue }   /* tried again next hour */
      }
    }
    /* a term that hasn't closed yet stays active for the continuation's hour, unless nothing follows */
    if (c.then !== 'end' || new Date(c.ends_at!) <= now) {
      await admin.from('commitments').update({ status: 'ended', updated_at: new Date().toISOString() }).eq('id', c.id).eq('status', 'active')
      ended++
    }
    if (declined) {
      const who = await member(c.user_id)
      if (who) await sendEmail(who.email, 'term-ending', { name: who.name, what: offer(c.of_sku)?.title ?? c.of_sku, ends: day(c.ends_at!), declined: 'yes', url: `${appUrl()}/store/products/${c.of_sku}` })
    }
  }
  return { continued, ended }
}

/* true once what follows is paid for; false when no card was kept or the charge didn't go through */
async function continueTerm(provider: any, c: any): Promise<boolean> {
  const saved = await savedMethod(provider, c)
  if (!saved) return false
  if (c.then === 'renew') {
    const bought = offer(c.sku)
    if (!bought || !provider.createPaymentIntent) return false
    const paid = await provider.createPaymentIntent({
      amountMinor: c.amount_minor, currency: c.currency, customerId: saved.customerId, paymentMethodId: saved.method,
      description: bought.title,
      metadata: { platformkit_commitment_continue: '1', platformkit_commitment: c.id, user_id: c.user_id },
      idempotencyKey: `commitment-continue:${c.id}`,
    })
    if (String(paid.status).toLowerCase() !== 'succeeded') return false
    /* the price the term is sold at, as the provider knows it: one row per renewal however often this runs */
    const priceId = provider.capabilities.includes('catalog.sync') ? (await ensureOffer(bought.sku)).price : `platformkit:${encodeURIComponent(bought.key)}`
    const { data: purchaseId, error } = await admin.rpc('purchase_write', { p: {
      user_id: c.user_id, checkout_identity: `commitment:${c.id}:renew`, price_id: priceId, product_id: null,
      sku: bought.sku, key: bought.key, kind: bought.kind, title: bought.title, unit_price: c.amount_minor, quantity: 1,
      amount_total: c.amount_minor, currency: c.currency, status: 'paid',
    } })
    if (error || !purchaseId) throw new Error(`the renewed term's purchase was not recorded: ${error?.message ?? 'no purchase id'}`)
    await linkProviderEntity(provider.id, 'payment', paid.paymentIntentId, 'purchases', purchaseId)
    await termPaid({ userId: c.user_id, bought, sourceId: paid.paymentIntentId, from: new Date(c.ends_at), openedBy: `${c.id}:renew`, purchaseId, provider: provider.id })
    return true
  }
  /* continuing monthly: the open-ended membership, begun as any subscription is and recorded by the
     same ledger rule a checkout's is */
  const parent = offer(c.of_sku)
  if (!parent || parent.billing !== 'subscription' || !provider.startSubscription) return false
  const synced = provider.capabilities.includes('catalog.sync') ? await ensureOffer(parent.sku) : null
  const snapshot = await provider.startSubscription({
    customerId: saved.customerId, paymentMethodId: saved.method,
    line: {
      offerKey: parent.key, sku: parent.sku, name: parent.title, currency: parent.currency, billing: 'subscription',
      interval: parent.period === 'weekly' ? 'week' : 'month', unitAmountMinor: parent.unit_amount, quantity: 1,
      ...(synced ? { providerPriceId: synced.price } : {}), metadata: offerMetadata(parent),
    },
    metadata: { user_id: c.user_id, platformkit_commitment: c.id },
    idempotencyKey: `commitment-continue:${c.id}`,
  })
  await subscriptionChanged(snapshot, provider.id)
  return true
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!await isServiceBearer(req)) return json({ error: 'the service bearer' }, 401)
  await fresh()
  const now = new Date()
  try {
    const sent = await remind(now)
    const { continued, ended } = await close(now)
    return json({ sent, continued, ended })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
