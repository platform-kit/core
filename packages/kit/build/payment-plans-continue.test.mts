/*
 * A TERM PAID IN FULL, AS IT CLOSES — the memberships module's term job on the test stack, against Stripe test mode
 * (openspec: payment-plans).
 *
 * Three members whose prepaid Patron term closes within the hour, each with a card the checkout kept: one whose term
 * continues monthly, one whose term renews, and one whose card is declined. The job starts the first one's monthly
 * membership as a Stripe subscription, charges and grants the second a new term from the day the first ends, and lets
 * the third one's term end. A fourth turns renewal off on the billing page first, and nothing follows their term. A fifth,
 * whose term continues in three days, is reminded once. Run again, the job charges
 * nobody twice. Everything it made, here and in Stripe, is removed afterwards.
 */
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { requireStack, skip, notHere } from './test-stack.mjs'
const S = requireStack('payment-plans-continue') as any
const sk = process.env.STRIPE_SECRET_KEY || ''
if (!/^sk_test_/.test(sk) || /^(1|true|yes|on)$/i.test(process.env.STRIPE_MOCK || '')) skip('payment-plans-continue', 'Stripe test mode is not this stack\'s provider')

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: string | undefined) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
console.log('\nA TERM PAID IN FULL, AS IT CLOSES\n')
const client = new pg.Client({ connectionString: S.db })
try { await client.connect() } catch (e: any) { skip('payment-plans-continue', 'the stack\'s database does not answer (' + e.message.slice(0, 60) + ')') }
const q = (sql: string, args: any[] = []) => client.query(sql, args).then((r: { rows: any }) => r.rows)
if (!(await q(`select 1 from pg_proc where proname = 'run_term_reminders'`)).length) { notHere('payment-plans-continue', 'the memberships module is off'); await client.end(); process.exit(0) }
const fnUrl = (S.functions || `${S.api}/functions/v1`).replace(/\/$/, '')
const run = async () => { const r = await fetch(`${fnUrl}/term-reminders`, { method: 'POST', headers: { authorization: 'Bearer ' + S.service, 'content-type': 'application/json' }, body: '{}' }); return { status: r.status, body: await r.json().catch(() => ({})) } }
const stripe = async (method: string, p: string, form: Record<string, string> = {}) => (await fetch('https://api.stripe.com/v1/' + p, {
  method, headers: { authorization: 'Bearer ' + sk, 'content-type': 'application/x-www-form-urlencoded' },
  body: method === 'GET' ? undefined : new URLSearchParams(form).toString(),
})).json()

const users: string[] = [], customers: string[] = []
const user = async (email: string) => { const [{ id }] = await q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now()) returning id`, [email]); users.push(id); return id }
const link = (object: string, external: string, entity: string, id: string) => q(`insert into public.payment_provider_refs (provider, object_type, external_id, entity_type, entity_id) values ('stripe', $1, $2, $3, $4) on conflict do nothing`, [object, external, entity, id])

/* what the ledger holds after a checkout that kept its card: the customer, the purchase and its payment, the term */
async function paidTerm(email: string, card: string, then: string, endsIn: number) {
  const uid = await user(email)
  const cus = await stripe('POST', 'customers', { email, 'metadata[platformkit_test]': 'payment-plans-continue' })
  customers.push(cus.id)
  await link('customer', cus.id, 'profiles', uid)
  let paymentId: string | null = null
  if (card === 'pm_card_visa') {
    const pi = await stripe('POST', 'payment_intents', { amount: '10800', currency: 'usd', customer: cus.id, payment_method: card, confirm: 'true', setup_future_usage: 'off_session', 'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never' })
    paymentId = pi.id
  } else {
    /* a card that attaches but declines every charge: kept as the customer's default, as a provider portal would */
    const pm = await stripe('POST', `payment_methods/${card}/attach`, { customer: cus.id })
    await stripe('POST', `customers/${cus.id}`, { 'invoice_settings[default_payment_method]': pm.id })
  }
  const [{ purchase_write: purchase }] = await q(`select public.purchase_write($1::jsonb)`, [{ user_id: uid, checkout_identity: `stripe:cs_pp_${uid}`, price_id: 'price_pp_test', sku: 'patron-monthly--3m-full', key: 'pp', kind: 'membership', title: 'Patron · 3 months', unit_price: 10800, quantity: 1, amount_total: 10800, currency: 'usd', status: 'paid' }])
  if (paymentId) await link('payment', paymentId, 'purchases', purchase)
  const ends = new Date(Date.now() + endsIn).toISOString()
  await q(`select public.commitment_open($1::jsonb)`, [{ user_id: uid, sku: 'patron-monthly--3m-full', of_sku: 'patron-monthly', plan: 'full', term_months: 3,
    payments_total: 1, payments_made: 1, paid_refs: ['full'], amount_minor: 10800, currency: 'usd', starts_at: new Date(Date.parse(ends) - 90 * 86400_000).toISOString(), ends_at: ends,
    then, restrict: 'immediately', purchase_id: purchase, entitlement_source_id: `stripe:cs_pp_${uid}`, opened_by: `pp-${uid}`, membership: true }])
  /* the week's reminder already went for the three closing now */
  if (endsIn < 86400_000) await q(`update public.commitments set reminded_at = now() where user_id = $1`, [uid])
  return uid
}

try {
  const monthly = await paidTerm('pp-continue-monthly@example.com', 'pm_card_visa', 'monthly', 10 * 60_000)
  const renew = await paidTerm('pp-continue-renew@example.com', 'pm_card_visa', 'renew', 10 * 60_000)
  const declined = await paidTerm('pp-continue-declined@example.com', 'pm_card_chargeCustomerFail', 'monthly', 10 * 60_000)
  /* a member who turns renewal off first, through the billing page's own call */
  const stopped = await paidTerm('pp-continue-stopped@example.com', 'pm_card_visa', 'monthly', 10 * 60_000)
  {
    const c = createClient(S.api, S.anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: signed, error } = await c.auth.signInWithPassword({ email: 'pp-continue-stopped@example.com', password: 'password123' })
    const [row] = await q(`select id from public.commitments where user_id = $1`, [stopped])
    const r = signed?.session ? await fetch(`${fnUrl}/create-portal-session`, { method: 'POST', headers: { apikey: S.anon, authorization: 'Bearer ' + signed.session.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'end-after-term', commitment: row?.id }) }) : null
    ok('a member turns renewal off on the billing page', r?.status === 200, error?.message ?? String(r?.status))
    const someone = await fetch(`${fnUrl}/create-portal-session`, { method: 'POST', headers: { apikey: S.anon, authorization: 'Bearer ' + signed?.session?.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'end-after-term', commitment: row?.id }) })
    ok('…once: there is nothing left to turn off', someone.status === 404, String(someone.status))
  }
  const later = await paidTerm('pp-continue-later@example.com', 'pm_card_visa', 'monthly', 3 * 86400_000)

  const first = await run()
  ok('the job answers the service', first.status === 200, JSON.stringify(first))
  ok('…and says two terms were continued', first.body.continued === 2, JSON.stringify(first.body))

  const subs = await q(`select id, sku, status from public.subscriptions where user_id = $1`, [monthly])
  ok('continuing monthly: the open-ended membership begins as a subscription', subs.length === 1 && subs[0].sku === 'patron-monthly' && subs[0].status === 'active', JSON.stringify(subs))
  if (subs[0]) {
    const live = await stripe('GET', `subscriptions/${subs[0].id}`)
    ok('…which Stripe holds, paid, at the membership price', live.status === 'active' && live.items?.data?.[0]?.price?.unit_amount === 4000 && !!live.default_payment_method, JSON.stringify({ status: live.status, amount: live.items?.data?.[0]?.price?.unit_amount }))
  }
  const held = await q(`select tier, active from public.entitlements where user_id = $1 and key = 'subscribed' and source = 'subscription'`, [monthly])
  ok('…and grants the tier through it', held.length === 1 && held[0].active === true && held[0].tier === 'patron', JSON.stringify(held))

  const terms = await q(`select status, starts_at, ends_at, purchase_id from public.commitments where user_id = $1 order by starts_at`, [renew])
  ok('renewing: the closing term is ended and a new one opened', terms.length === 2 && terms[0].status === 'ended' && terms[1].status === 'active', JSON.stringify(terms))
  if (terms.length === 2) {
    ok('…starting the day the first one ends', new Date(terms[1].starts_at).getTime() === new Date(terms[0].ends_at).getTime())
    const grant = await q(`select expires_at from public.entitlements where user_id = $1 and key = 'subscribed' and source = 'purchase'`, [renew])
    ok('…with the tier held to its own end', grant.some((g: any) => new Date(g.expires_at).getTime() === new Date(terms[1].ends_at).getTime()), JSON.stringify(grant))
    const bought = await q(`select amount_total, status from public.purchases where id = $1`, [terms[1].purchase_id])
    ok('…and the charge recorded as a purchase', bought[0]?.amount_total === 10800 && bought[0]?.status === 'paid', JSON.stringify(bought))
  }

  const gone = await q(`select status from public.commitments where user_id = $1`, [declined])
  const none = await q(`select id from public.subscriptions where user_id = $1`, [declined])
  ok('a declined card: the term just ends, and nothing is started', gone.length === 1 && gone[0].status === 'ended' && none.length === 0, JSON.stringify({ gone, none }))

  const off = await q(`select status, then from public.commitments where user_id = $1`, [stopped])
  const offSubs = await q(`select id from public.subscriptions where user_id = $1`, [stopped])
  ok('renewal turned off: the term runs to its end and nothing follows it', off[0]?.status === 'active' && off[0]?.then === 'end' && offSubs.length === 0, JSON.stringify({ off, offSubs }))

  const told = await q(`select reminded_at, status from public.commitments where user_id = $1`, [later])
  ok('a term continuing in three days is reminded, and left running', !!told[0]?.reminded_at && told[0]?.status === 'active', JSON.stringify(told))

  const again = await run()
  ok('run again, it continues and reminds nobody twice', again.status === 200 && again.body.continued === 0 && again.body.sent === 0, JSON.stringify(again.body))
  ok('…and the renewing member holds two terms, not three', (await q(`select 1 from public.commitments where user_id = $1`, [renew])).length === 2)
} finally {
  for (const c of customers) {
    const subs = await stripe('GET', `subscriptions?customer=${c}&status=all`).catch(() => ({ data: [] }))
    for (const s of subs.data ?? []) if (s.status !== 'canceled') await stripe('DELETE', `subscriptions/${s.id}`).catch(() => {})
    await stripe('DELETE', `customers/${c}`).catch(() => {})
  }
  await q(`delete from public.entitlements where user_id = any($1)`, [users]).catch(() => {})
  await q(`delete from public.subscriptions where user_id = any($1)`, [users]).catch(() => {})
  await q(`delete from public.commitments where user_id = any($1)`, [users]).catch(() => {})
  await q(`delete from public.purchases where user_id = any($1)`, [users]).catch(() => {})
  await q(`delete from public.payment_provider_refs where entity_id = any($1::text[])`, [users]).catch(() => {})
  await q(`delete from auth.users where id = any($1)`, [users]).catch(() => {})
  await client.end()
}
console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
