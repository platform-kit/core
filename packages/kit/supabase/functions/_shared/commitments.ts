/*
 * COMMITMENTS, from the payment reports every provider already gives (openspec: payment-plans).
 *
 * A plan or a term is sold as an offer of its own (build/commitments.mts), so the provider charges it
 * like any other. What this adds is what a commitment means: each payment counted once, a missed one
 * holding access back as the offer says, a default recorded when the provider stops retrying, and,
 * at the last payment, what follows. The counting and the holding back are in the database
 * (44-commitments.sql), where every report — the Stripe webhook, the Hyperswitch renewal run, the
 * buyer's own confirmation on landing — meets the same rule however often it arrives.
 *
 * It charges nothing. Ending a subscription after its last payment, or moving it to the open-ended
 * price, is the provider's ordinary subscription change.
 */
import { admin, appUrl, getPaymentProvider } from './lib.ts'
import { offer, offerMetadata } from './offers.ts'
import { sendEmail } from './email.ts'
import { findProviderEntity, findProviderExternalIds } from './payment-provider-refs.ts'
import { providerScopedId, normalizePaymentSubscriptionChange } from './payment-provider.mts'

export type Commitment = { of: string; plan: 'full' | 'monthly'; payments: number; months: number | null; then: 'end' | 'monthly' | 'renew'; missed: { restrict: string; cancel_bookings_after_minutes: number | null } }
export const commitmentOf = (o: any): Commitment | null => (o && o.commitment) || null

const addMonths = (from: Date, months: number) => { const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString() }

/* the kit's own id for a provider's subscription, as the ledger wrote it */
export async function localSubscriptionId(provider: string, external: string): Promise<string> {
  return (await findProviderEntity(provider, 'subscription', external, 'subscriptions'))
    ?? (provider === 'stripe' ? external : providerScopedId(provider, external))
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name as any, args as any)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data as any
}

/* OPENING ONE. Idempotent on `opened_by`: the confirmation and the provider's report both arrive. */
export async function openCommitment(p: {
  userId: string; bought: any; openedBy: string; subscriptionId?: string | null; purchaseId?: string | null; entitlementSourceId: string; paidRefs?: string[]; startsAt?: Date
}) {
  const c = commitmentOf(p.bought)
  if (!c) return null
  const parent = offer(c.of)
  const now = p.startsAt ?? new Date()
  return rpc('commitment_open', { p: {
    user_id: p.userId, sku: p.bought.sku, of_sku: c.of, plan: c.plan, term_months: c.months,
    payments_total: c.payments, payments_made: (p.paidRefs ?? []).length, paid_refs: p.paidRefs ?? [],
    amount_minor: p.bought.unit_amount, currency: p.bought.currency,
    starts_at: now.toISOString(), ends_at: c.months ? addMonths(now, c.months) : null,
    then: c.then, restrict: c.missed?.restrict ?? 'immediately', cancel_bookings_after_minutes: c.missed?.cancel_bookings_after_minutes ?? null,
    subscription_id: p.subscriptionId ?? null, purchase_id: p.purchaseId ?? null, entitlement_source_id: p.entitlementSourceId,
    opened_by: p.openedBy, membership: parent?.kind === 'membership',
  } })
}

/* whether access from this source is being held back, so a later "past due" report keeps it held */
export async function holds(userId: string, entitlementSourceId: string): Promise<boolean> {
  return (await rpc('commitment_holds', { p_user: userId, p_source_id: entitlementSourceId })) === true
}

/* A PAYMENT MADE: counted once; a held commitment restored; the last one decides what follows */
export async function commitmentPaid(subscriptionId: string, ref: string) {
  const r = await rpc('commitment_paid', { p_subscription: subscriptionId, p_ref: ref })
  if (r?.counted && r.finished) await afterLastPayment(subscriptionId, r.id)
  return r
}

/* A PAYMENT MISSED: access held back as the offer says, and the buyer and the administrators told once */
export async function commitmentMissed(subscriptionId: string) {
  const r = await rpc('commitment_missed', { p_subscription: subscriptionId })
  if (r?.newly) {
    const what = offer(r.of_sku)?.title ?? r.of_sku
    const amount = money(r.amount_minor, r.currency)
    const buyer = await emailOf(r.user_id)
    const data = { what, amount, restricted: r.restricted ? 'yes' : '', url: `${appUrl()}/billing` }
    if (buyer) await sendEmail(buyer.email, 'payment-missed', { ...data, name: buyer.name })
    for (const a of await administrators()) await sendEmail(a, 'payment-missed-notice', { ...data, who: buyer?.email ?? r.user_id })
  }
  return r
}

/* IN DEFAULT: the provider stopped retrying, or the subscription ended before the last payment */
export async function commitmentDefaulted(subscriptionId: string) {
  const r = await rpc('commitment_default', { p_subscription: subscriptionId })
  if (r?.newly) {
    const buyer = await emailOf(r.user_id)
    const data = { what: offer(r.of_sku)?.title ?? r.of_sku, owed: money(r.owed_minor, r.currency), who: buyer?.email ?? r.user_id, url: `${appUrl()}/admin` }
    for (const a of await administrators()) await sendEmail(a, 'payment-default-notice', data)
  }
  return r
}

/*
 * WHAT FOLLOWS THE LAST PAYMENT. A change the plan-change policy deferred to the end of the term
 * comes first; then the term's own `then`: another term on the same subscription, the open-ended
 * monthly price, or the subscription ending at the end of the period just paid for.
 */
async function afterLastPayment(subscriptionId: string, commitmentId: string) {
  const { data: c, error } = await admin.from('commitments').select('*').eq('id', commitmentId).maybeSingle()
  if (error || !c) throw new Error(`commitment ${commitmentId} could not be read: ${error?.message ?? 'missing'}`)
  const bought = offer(c.sku)
  if (c.then === 'renew' && !c.change_to_sku && bought) {
    await openCommitment({ userId: c.user_id, bought, openedBy: `${subscriptionId}:after:${c.id}`, subscriptionId, purchaseId: c.purchase_id, entitlementSourceId: c.entitlement_source_id ?? '' })
    return
  }
  const target = c.change_to_sku ? offer(c.change_to_sku) : c.then === 'monthly' ? offer(c.of_sku) : null
  if (target && target.billing === 'subscription') await moveAtPeriodEnd(subscriptionId, target)
  else await endAtPeriodEnd(subscriptionId)
}

async function externalId(provider: string, subscriptionId: string) {
  const ids = await findProviderExternalIds(provider, 'subscription', 'subscriptions', subscriptionId)
  if (ids.length > 1) throw new Error(`subscription ${subscriptionId} has ${ids.length} ${provider} references`)
  return ids[0] ?? (provider === 'stripe' ? subscriptionId : null)
}

/* no further charge after the period just paid for. Hyperswitch's renewals are the kit's own, so the
   kit's row is the subscription; elsewhere the provider is told, and its report updates the row. */
export async function endAtPeriodEnd(subscriptionId: string) {
  const provider: any = await getPaymentProvider()
  if (provider.id === 'hyperswitch') {
    const { error } = await admin.from('subscriptions').update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq('id', subscriptionId)
    if (error) throw new Error(`subscription ${subscriptionId} could not be set to end: ${error.message}`)
    return
  }
  if (!provider.endSubscription) throw new Error(`payment provider "${provider.id}" cannot end a subscription at the end of its period`)
  const ext = await externalId(provider.id, subscriptionId)
  if (!ext) throw new Error(`subscription ${subscriptionId} has no ${provider.id} reference`)
  await provider.endSubscription({ subscriptionId: ext, idempotencyKey: `commitment-end:${subscriptionId}` })
  await admin.from('subscriptions').update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq('id', subscriptionId)
}

/* the same subscription at another offer's price from the next period, through the ordinary change */
export async function moveAtPeriodEnd(subscriptionId: string, target: any) {
  const provider: any = await getPaymentProvider()
  if (!provider.changeSubscription) throw new Error(`payment provider "${provider.id}" cannot change a subscription`)
  const ext = await externalId(provider.id, subscriptionId)
  if (!ext) throw new Error(`subscription ${subscriptionId} has no ${provider.id} reference`)
  const { data: live } = await admin.from('subscriptions').select('plan_amount, current_period_start, current_period_end').eq('id', subscriptionId).maybeSingle()
  const changed = normalizePaymentSubscriptionChange(provider.id, await provider.changeSubscription({
    subscriptionId: ext, offerKey: target.key,
    offer: { offerKey: target.key, sku: target.sku, name: target.title, kind: 'subscription', currency: target.currency, unitAmountMinor: target.unit_amount,
      interval: target.period === 'weekly' ? 'week' : 'month', metadata: offerMetadata(target) },
    ...(live?.plan_amount != null ? { currentAmountMinor: Number(live.plan_amount) } : {}),
    ...(live?.current_period_start ? { currentPeriodStart: Math.floor(new Date(live.current_period_start).getTime() / 1000) } : {}),
    ...(live?.current_period_end ? { currentPeriodEnd: Math.floor(new Date(live.current_period_end).getTime() / 1000) } : {}),
    proration: 'next-cycle',
    idempotencyKey: `commitment-move:${subscriptionId}:${target.key}`,
  }))
  const at = changed.nextAt ? new Date(changed.nextAt * 1000).toISOString() : live?.current_period_end ?? null
  await admin.from('subscriptions').update({ next_sku: target.sku, next_key: target.key, next_at: at }).eq('id', subscriptionId)
}

/* the commitment a cancellation would break: one still owing payments on this subscription */
export async function binding(subscriptionId: string) {
  const r = await rpc('commitment_binding', { p_subscription: subscriptionId })
  return r && r.id ? r : null
}

const money = (minor: number, currency: string) => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((Number(minor) || 0) / 100) }
  catch { return `${((Number(minor) || 0) / 100).toFixed(2)} ${String(currency || '').toUpperCase()}` }
}
async function emailOf(userId: string): Promise<{ email: string; name: string } | null> {
  const { data } = await admin.from('profiles').select('email, display_name').eq('id', userId).maybeSingle()
  return data?.email ? { email: data.email, name: (data.display_name ?? '').split(' ')[0] ?? '' } : null
}
async function administrators(): Promise<string[]> {
  const { data } = await admin.from('profiles').select('email').eq('role', 'admin')
  return (data ?? []).map((r: any) => r.email).filter(Boolean)
}
