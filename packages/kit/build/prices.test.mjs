/*
 * WHICH PRICE, FOR THIS PERSON, TODAY.
 *
 * A price list is a CONTEXTUAL ABSOLUTE PRICE — "for these people, in this market, it costs X."
 * It is not a discount. A percentage or a flat amount off is a promotion, and lives in
 * promotions.js; conflating the two was this module's first design and it could express neither
 * properly.
 *
 * The model and the ordering are Medusa's, read off its source rather than recalled:
 *
 *   pricing/src/repositories/pricing.ts:310-312   a list price beats a plain one; then the most
 *                                                 rules; then the CHEAPEST
 *   pricing/src/services/pricing-module.ts:429    override always wins and is its own reference;
 *                                                 a sale is min(sale, default)
 *
 * Two of these cases pin things this project's own design notes previously denied.
 *
 *   node packages/kit/build/prices.test.mjs
 */
import assert from 'node:assert/strict'
import { priceOf, ruleHolds, openAt, currenciesOf } from '../supabase/functions/_shared/prices.js'

let pass = 0, fail = 0
const ok = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n    ')) } }

console.log('\nWHICH PRICE\n')

const SKU = 'notebook', V = 'linen.lined'
const P = (amount, extra = {}) => ({ sku: SKU, variant: V, amount, currency: 'usd', ...extra })
const base = { name: 'base', kind: 'base', rules: [], prices: [P(1800)] }
const sale = { name: 'winter', kind: 'sale', rules: [], prices: [P(1400)] }
const members = { name: 'members', kind: 'override', rules: [{ attribute: 'customer.class', value: 'subscribed' }], prices: [P(1500)] }
const germany = { name: 'de', kind: 'override', rules: [{ attribute: 'shipping_address.country', value: 'DE' }], prices: [P(2900)] }

const guest = { customer: { class: 'guest' } }
const member = { customer: { class: 'subscribed' } }
const german = { customer: { class: 'guest' }, shipping_address: { country: 'DE' } }
const ask = (lists, context = {}, extra = {}) => priceOf(lists, { sku: SKU, variant: V, context, ...extra })

/* ---- the simple shop, which must never meet any of this ---- */
ok('a shop with one list charges its own price and shows no saving', () => {
  const r = ask([base], guest)
  assert.equal(r.amount, 1800); assert.equal(r.original, null); assert.equal(r.kind, 'base')
})

ok('a thing with no price has no answer, rather than a wrong one', () => {
  assert.equal(priceOf([base], { sku: SKU, variant: 'nope' }), null)
  assert.equal(priceOf([], { sku: SKU, variant: V }), null)
})

/*
 * A PRICE BELONGS TO A PRODUCT. This had to be found by reading the code: the guard skipped
 * itself whenever either side was empty, and the page passed no sku — so every product sold one
 * way matched every other and the shop showed the first product's price. Nothing threw.
 */
ok('a price belongs to its own product, and never leaks to another', () => {
  const shop = { name: 'base', kind: 'base', rules: [], prices: [
    { sku: 'tote', variant: '', amount: 900, currency: 'usd' },
    { sku: 'poster', variant: '', amount: 2400, currency: 'usd' },
  ] }
  assert.equal(priceOf([shop], { sku: 'tote', variant: '', currency: 'usd' }).amount, 900)
  assert.equal(priceOf([shop], { sku: 'poster', variant: '', currency: 'usd' }).amount, 2400)
  assert.equal(priceOf([shop], { variant: '', currency: 'usd' }), null, 'and naming no product gets nothing')
})

/* ============================================================================================
 * MEDUSA'S RESOLUTION, verbatim: "If the price list is of type OVERRIDE, we always use the price
 * list price... If the price list is of type SALE, we use the lowest price between the price list
 * price and the default price."
 * ========================================================================================== */

ok('a SALE is taken only where it is lower than the shop’s own price', () => {
  assert.equal(ask([base, sale], guest).amount, 1400)
  const dearer = { ...sale, prices: [P(1900)] }
  assert.equal(ask([base, dearer], guest).amount, 1800, 'min(sale, default) — a "sale" above the price is not one')
})

ok('and shows the shop’s price struck through beside it', () => {
  assert.equal(ask([base, sale], guest).original, 1800)
  assert.equal(ask([base, { ...sale, prices: [P(1900)] }], guest).original, null, 'nobody is shown "was 18, now 19"')
})

ok('an OVERRIDE always wins, and is its own reference — nothing struck through', () => {
  const r = ask([base, members], member)
  assert.equal(r.amount, 1500); assert.equal(r.original, null)
})

ok('an override may be DEARER than the shop’s price — a market that costs more costs more', () => {
  assert.equal(ask([base, germany], german).amount, 2900)
})

ok('the cheapest of several overrides wins', () => {
  const trade = { name: 'trade', kind: 'override', rules: [{ attribute: 'customer.class', value: 'subscribed' }], prices: [P(1200)] }
  assert.equal(ask([base, members, trade], member).amount, 1200)
})

/*
 * AND THE CASE THIS CHANGE GOT STUCK ON, recorded so nobody re-derives it and thinks it is a bug.
 *
 * In Medusa an override beats a cheaper public sale: it is found first by rules-count and the sale
 * is discarded. So a member can pay more than a stranger. That is Medusa's behaviour and it is
 * NOT a good default — which is why a public discount in this kit is a PROMOTION, applied on top
 * of whatever this returns. "20% off" then means 20% off the member's own rate, and who gets it is
 * said in the promotion's rules rather than inferred from how specific a price list looks.
 */
ok('an override beats a cheaper sale — Medusa’s behaviour, pinned so it is not mistaken for a bug', () => {
  assert.equal(ask([base, members, sale], member).amount, 1500)
  assert.equal(ask([base, members, sale], guest).amount, 1400, 'and a stranger still gets the sale')
})

ok('a rule that does not hold disqualifies its list — it is not a weaker match', () => {
  assert.equal(ask([base, members], guest).amount, 1800)
  assert.equal(ask([base, germany], guest).amount, 1800)
})

ok('more rules beats fewer, and the cheapest settles an equal pair', () => {
  const one = { name: 'one', kind: 'override', rules: [{ attribute: 'shipping_address.country', value: 'DE' }], prices: [P(2900)] }
  const two = { name: 'two', kind: 'override', rules: [{ attribute: 'shipping_address.country', value: 'DE' }, { attribute: 'customer.class', value: 'guest' }], prices: [P(3100)] }
  assert.equal(ask([base, one, two], german).amount, 3100, 'the more particular statement, dearer though it is')
  const alsoOne = { name: 'also', kind: 'override', rules: [{ attribute: 'shipping_address.country', value: 'DE' }], prices: [P(2700)] }
  assert.equal(ask([base, one, alsoOne], german).amount, 2700, 'equally particular: the cheaper')
})

/* ---- a draft list, a window, quantity, currency ---- */
ok('a draft list is not applied', () => {
  assert.equal(ask([base, { ...sale, status: 'draft' }], guest).amount, 1800)
  assert.equal(ask([base, { ...sale, status: 'active' }], guest).amount, 1400)
})

ok('a list that has not started, or has ended, is not consulted', () => {
  assert.equal(ask([base, { ...sale, starts: '2099-01-01' }], guest).amount, 1800)
  assert.equal(ask([base, { ...sale, ends: '2000-01-01' }], guest).amount, 1800)
  assert.equal(openAt({}, '2026-01-01'), true, 'an undated list is always open')
})

ok('a quantity band applies only within it, and is part of how particular a price is', () => {
  const bulk = { name: 'bulk', kind: 'override', rules: [], prices: [P(1200, { min_quantity: 10 })] }
  assert.equal(ask([base, bulk], guest, { quantity: 1 }).amount, 1800)
  assert.equal(ask([base, bulk], guest, { quantity: 10 }).amount, 1200)
})

ok('a currency the lists do not price has no answer, rather than the wrong money', () => {
  assert.equal(priceOf([base], { sku: SKU, variant: V, currency: 'gbp' }), null)
})

ok('and a currency they do price is just an entry on the same offer', () => {
  const gbp = { name: 'gbp', kind: 'override', rules: [], prices: [{ sku: SKU, variant: V, amount: 1500, currency: 'gbp' }] }
  assert.equal(priceOf([base, gbp], { sku: SKU, variant: V, currency: 'gbp' }).amount, 1500)
  assert.equal(priceOf([base, gbp], { sku: SKU, variant: V, currency: 'usd' }).amount, 1800, 'and does not leak across')
  assert.deepEqual(currenciesOf([base, gbp], V).sort(), ['gbp', 'usd'])
})

/* ---- what the caller needs to charge and to show ---- */
ok('`standing` is what this person pays before any promotion', () => {
  assert.equal(ask([base, members], member).standing, 1500)
  assert.equal(ask([base, members], member).shop, 1800, 'and `shop` is what anybody pays')
})

ok('every operator, and an unknown one never holds', () => {
  assert.equal(ruleHolds({ attribute: 'a', value: 1 }, { a: 1 }), true)
  assert.equal(ruleHolds({ attribute: 'a', operator: 'gte', value: 50 }, { a: 60 }), true)
  assert.equal(ruleHolds({ attribute: 'a', operator: 'in', value: ['x', 'y'] }, { a: 'y' }), true)
  assert.equal(ruleHolds({ attribute: 'a', operator: 'nonsense', value: 1 }, { a: 1 }), false)
  assert.equal(ruleHolds({ attribute: 'customer.tiers', operator: 'in', value: ['inner'] }, { customer: { tiers: ['inner'] } }), true)
  assert.equal(ruleHolds({ attribute: 'missing.thing', value: 1 }, {}), false)
})

console.log(fail ? `\nprices: ${fail} failed, ${pass} passed\n` : `\nprices: all ${pass} checks passed\n`)
process.exit(fail ? 1 : 0)
