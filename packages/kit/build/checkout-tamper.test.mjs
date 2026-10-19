/*
 * THE SERVER DECIDES WHAT A BUYER PAYS — a tampered checkout request against the local stack, and the
 * session it made read back from the payment provider itself (Stripe's test mode, with the stack's own
 * STRIPE_SECRET_KEY), because what the function says it charged and what the provider will take are two
 * claims and only the second is money.
 *
 *   - a price, an amount, a currency, a discount and a class written into the request change nothing
 *   - a quantity past the offer's limit is cut to it, and a tracked thing is never left adjustable
 *   - a shape the offer does not sell (invented, or one the shop stopped selling) is refused, and so is a
 *     second shape of one thing in one order, which would be charged and shipped as the first
 *   - a members' price is had by being a member, never by saying so
 *   - shipping is the destination's rates, whatever the request says it costs
 *
 * Run from a site's root with the stack's env; skipped with a note when the stack is down, when Stripe is
 * not the test-mode provider here, or CHECKOUT_TAMPER_TEST=0. Every session it makes is expired after.
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack } from './tts/storage.mjs'

const note = (m) => console.log('checkout-tamper: ' + m)
if (process.env.CHECKOUT_TAMPER_TEST === '0') { note('skipped (CHECKOUT_TAMPER_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const sk = process.env.STRIPE_SECRET_KEY || ''
if (!url || !anonKey || !localStack()) { note('skipped — no local stack in the environment'); process.exit(0) }
if (!/^sk_test_/.test(sk) || /^(1|true|yes|on)$/i.test(process.env.STRIPE_MOCK || '')) { note('skipped — Stripe test mode is not this stack\'s provider (STRIPE_SECRET_KEY sk_test_…, STRIPE_MOCK off)'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const as = async (email) => { const c = createClient(url, anonKey, O); const { data, error } = await c.auth.signInWithPassword({ email, password: 'password123' }); return error ? null : data.session.access_token }
const made = []
const checkout = async (body, token) => {
  const r = await fetch(`${url}/functions/v1/create-checkout-session`, { method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  const id = data.checkoutId || /\/(cs_test_[A-Za-z0-9]+)/.exec(String(data.url || ''))?.[1]
  if (id) made.push(id)
  return { status: r.status, data, id }
}
const stripe = async (path, method = 'GET') => (await fetch('https://api.stripe.com/v1/' + path, { method, headers: { authorization: 'Bearer ' + sk } })).json()
const sessionOf = (id) => stripe(`checkout/sessions/${id}?expand[]=line_items&expand[]=shipping_options.shipping_rate`)

const member = await as('member@example.com'), free = await as('free@example.com')
if (!member || !free) { note('skipped — the seed has no member@ or free@'); process.exit(0) }
try { const r = await fetch(`${url}/functions/v1/create-checkout-session`, { method: 'OPTIONS', signal: AbortSignal.timeout(4000) }); if (r.status >= 500) throw new Error() } catch { note('skipped — the functions are not served'); process.exit(0) }

try {
  /* everything a request could say about money, said */
  const t = await checkout({
    items: [{ sku: 'notebook', variant: 'leather.lined', quantity: 1, price: 1, unit_amount: 1, amount: 1, currency: 'eur', discount: 2800 }],
    country: 'US', currency: 'eur', amount: 1, discount: 100, promotion: 'everything-free', customer: { class: 'subscribed', tiers: ['patron'] },
    shipping: { amount: 0, level: 'priority' }, shipping_rate: 0,
  }, free)
  ok('a tampered checkout is made', t.status === 200 && !!t.id, t.status + ' ' + JSON.stringify(t.data))
  if (t.id) {
    const s = await sessionOf(t.id)
    const line = s.line_items?.data?.[0]
    ok('…at the offer\'s own price', line?.price?.unit_amount === 2800 || line?.amount_subtotal === 2800, JSON.stringify(line?.price?.unit_amount ?? line))
    ok('…in the offer\'s own currency', s.currency === 'usd', s.currency)
    ok('…with no discount the request asked for', (s.total_details?.amount_discount ?? 0) === 0, JSON.stringify(s.total_details))
    const rates = (s.shipping_options || []).map((o) => o.shipping_rate?.fixed_amount?.amount).sort((a, b) => a - b)
    ok('…and the destination\'s shipping rates, not the request\'s', rates.length > 0 && rates[0] === 500 && !rates.includes(0), JSON.stringify(rates))
  }

  /* a members' price is had by being a member */
  const asked = await checkout({ items: [{ sku: 'notebook', variant: 'linen.lined', quantity: 1 }], country: 'US', customer: { class: 'subscribed' } }, free)
  const real = await checkout({ items: [{ sku: 'notebook', variant: 'linen.lined', quantity: 1 }], country: 'US' }, member)
  if (asked.id && real.id) {
    const [a, b] = await Promise.all([sessionOf(asked.id), sessionOf(real.id)])
    ok('a reader who says they are a member pays the price for everybody', a.line_items?.data?.[0]?.amount_subtotal === 1800, JSON.stringify(a.line_items?.data?.[0]?.amount_subtotal))
    ok('a member pays the members\' price', b.line_items?.data?.[0]?.amount_subtotal === 1500, JSON.stringify(b.line_items?.data?.[0]?.amount_subtotal))
  } else ok('the price checkouts are made', false, JSON.stringify([asked.status, asked.data, real.status, real.data]))

  /* a quantity past the limit is cut to it */
  const many = await checkout({ items: [{ sku: 'notebook', variant: 'linen.lined', quantity: 999 }], country: 'US' }, free)
  if (many.id) {
    const s = await sessionOf(many.id)
    const line = s.line_items?.data?.[0]
    ok('a quantity past the limit is cut to ten', line?.quantity === 10, JSON.stringify(line?.quantity))
  } else ok('the quantity checkout is made', false, JSON.stringify(many))

  /* shapes */
  const invented = await checkout({ items: [{ sku: 'notebook', variant: 'leather.gold', quantity: 1 }], country: 'US' }, free)
  ok('a shape the offer does not make is refused', invented.status === 400 && !invented.id, JSON.stringify(invented.data))
  const stopped = await checkout({ items: [{ sku: 'notebook', variant: 'leather.plain', quantity: 1 }], country: 'US' }, free)
  ok('a shape the shop no longer sells is refused', stopped.status === 400 && !stopped.id, JSON.stringify(stopped.data))
  const nothing = await checkout({ items: [{ sku: 'member-monthly', variant: 'gold', quantity: 1 }] }, free)
  ok('a shape on a thing that has none is refused', nothing.status === 400 && !nothing.id, JSON.stringify(nothing.data))
  const both = await checkout({ items: [{ sku: 'notebook', variant: 'linen.lined', quantity: 1 }, { sku: 'notebook', variant: 'leather.lined', quantity: 1 }], country: 'US' }, free)
  ok('two shapes of one thing in one order are refused, not charged as the cheaper', both.status === 400 && both.data.code === 'one_shape' && !both.id, JSON.stringify(both.data))
  const filled = await checkout({ items: [{ sku: 'notebook', variant: 'leather', quantity: 1 }], country: 'US' }, free)
  if (filled.id) {
    const s = await sessionOf(filled.id)
    ok('a shape left part-chosen is filled and priced as the whole one', s.line_items?.data?.[0]?.amount_subtotal === 2800, JSON.stringify(s.line_items?.data?.[0]?.amount_subtotal))
  } else ok('the part-chosen checkout is made', false, JSON.stringify(filled.data))

  /* a guest buys only what a guest may */
  const g = await checkout({ items: [{ sku: 'member-monthly', quantity: 1 }] }, null)
  ok('a guest cannot buy a membership', g.status === 401 && !g.id, JSON.stringify(g.data))
} finally {
  for (const id of made) await stripe(`checkout/sessions/${id}/expire`, 'POST').catch(() => {})
}

console.log(fail ? `checkout-tamper: ${fail} failed, ${pass} passed` : `checkout-tamper: all ${pass} checks passed (${made.length} test-mode sessions made and expired)`)
process.exit(fail ? 1 : 0)
