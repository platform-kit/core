/*
 * BUYING A PLAN OR A TERM, through the real checkout function on the test stack (openspec: payment-plans).
 *
 * The demo's Patron membership is sold in terms. What this proves at the door, before anybody pays:
 * a term is bought only once the buyer has agreed to it, on its own, at the catalogue's price for that
 * term whatever the request says, and in subscription mode where it is paid monthly; and a membership
 * sold in terms alone is never bought as itself. It needs Stripe test mode, as the tamper test does.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack } from './supabase-env.mjs'
import { leave, notHere } from './test-stack.mjs'
import { STRIPE_API_VERSION } from './stripe-version.mjs'
import type { Database } from '../supabase/functions/_shared/database.types.js'

const note = (m: string) => console.log('payment-plans-checkout: ' + m)
const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const sk = process.env.STRIPE_SECRET_KEY || ''
if (!url || !anonKey || !localStack()) { note('skipped — no local stack in the environment'); leave(0) }
if (!/^sk_test_/.test(sk) || /^(1|true|yes|on)$/i.test(process.env.STRIPE_MOCK || '')) { note('skipped — Stripe test mode is not this stack\'s provider'); leave(0) }
{
  let offers: any = {}
  try { offers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'supabase/functions/_shared/catalog.json'), 'utf8')).offers || {} } catch { /* none */ }
  if (!offers['patron-monthly--3m-monthly']) { notHere('payment-plans-checkout', 'the site sells no Patron terms, which these checks buy'); process.exit(0) }
}
let pass = 0, fail = 0
const ok = (msg: string, cond: unknown, detail: unknown = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const as = async (email: string) => { const c = createClient<Database>(url, anonKey, O); const { data, error } = await c.auth.signInWithPassword({ email, password: 'password123' }); return error ? null : data.session.access_token }
const checkout = async (body: any, token: string | null) => {
  const r = await fetch(`${url}/functions/v1/create-checkout-session`, { method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  const id = data.checkoutId || /\/(cs_test_[A-Za-z0-9]+)/.exec(String(data.url || ''))?.[1]
  return { status: r.status, data, id }
}
const stripe = async (p: string) => (await fetch('https://api.stripe.com/v1/' + p, { headers: { authorization: 'Bearer ' + sk, 'stripe-version': STRIPE_API_VERSION } })).json()

console.log('\nBUYING A PLAN OR A TERM\n')
const free = await as('free@example.com')
if (!free) { note('skipped — the seed has no free@'); leave(0) }

const unagreed = await checkout({ items: [{ sku: 'patron-monthly--3m-monthly' }] }, free)
ok('a term is not bought until the buyer agrees to it', unagreed.status === 400 && unagreed.data.code === 'accept', JSON.stringify(unagreed))

const withOther = await checkout({ items: [{ sku: 'patron-monthly--3m-full' }, { sku: 'plain-words' }], accept: true }, free)
ok('a term is bought on its own', withOther.status === 400 && withOther.data.code === 'plan_alone', JSON.stringify(withOther))

const monthly = await checkout({ items: [{ sku: 'patron-monthly--3m-monthly', unit_amount: 1 }], accept: true, amount: 1 }, free)
ok('an agreed monthly term opens a checkout', monthly.status === 200 && !!monthly.id, JSON.stringify(monthly))
if (monthly.id) {
  const s = await stripe(`checkout/sessions/${monthly.id}?expand[]=line_items`)
  ok('…as a subscription', s.mode === 'subscription', s.mode)
  ok('…at the term\'s own monthly price, whatever the request said', s.line_items?.data?.[0]?.price?.unit_amount === 4000, JSON.stringify(s.line_items?.data?.[0]?.price?.unit_amount))
  await fetch(`https://api.stripe.com/v1/checkout/sessions/${monthly.id}/expire`, { method: 'POST', headers: { authorization: 'Bearer ' + sk, 'stripe-version': STRIPE_API_VERSION } })
}
const full = await checkout({ items: [{ sku: 'patron-monthly--6m-full' }], accept: true }, free)
ok('an agreed term paid in full opens a checkout', full.status === 200 && !!full.id, JSON.stringify(full))
if (full.id) {
  const s = await stripe(`checkout/sessions/${full.id}?expand[]=line_items`)
  ok('…as one payment', s.mode === 'payment', s.mode)
  ok('…of the term\'s full price', s.line_items?.data?.[0]?.price?.unit_amount === 20000, JSON.stringify(s.line_items?.data?.[0]?.price?.unit_amount))
  await fetch(`https://api.stripe.com/v1/checkout/sessions/${full.id}/expire`, { method: 'POST', headers: { authorization: 'Bearer ' + sk, 'stripe-version': STRIPE_API_VERSION } })
}
const open = await checkout({ items: [{ sku: 'patron-monthly' }] }, free)
ok('the open-ended membership still sells as before, with nothing to agree to', open.status === 200 && !!open.id, JSON.stringify(open))
if (open.id) await fetch(`https://api.stripe.com/v1/checkout/sessions/${open.id}/expire`, { method: 'POST', headers: { authorization: 'Bearer ' + sk, 'stripe-version': STRIPE_API_VERSION } })

console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
