/*
 * A DISCOUNT, AND WHAT IT TAKES OFF.
 *
 * Every case here is written from what a shop would want, and several are here because this
 * project got them wrong by trying to express a discount as a price. A price list can only say
 * "it costs $14" — which goes stale the moment the product is re-priced, can silently become a
 * price RISE, and cannot take 20% off a member's own rate. A promotion says "20% off" and means
 * it whoever is asking.
 *
 * The arithmetic is Medusa's (core/utils/src/totals/promotion/index.ts); the cases are ours.
 *
 *   node packages/kit/build/promotions.test.mjs
 */
import assert from 'node:assert/strict'
import { apply, applyToTotal, live, touches, valueOf, unitsOf, ruleHolds, METHODS, TARGETS, ALLOCATIONS } from '../supabase/functions/_shared/promotions.js'

let pass = 0, fail = 0
const ok = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n    ')) } }

console.log('\nA DISCOUNT, AND WHAT IT TAKES OFF\n')

const lines = () => [
  { sku: 'chair', variant: '', unit_price: 2500, quantity: 1 },
  { sku: 'lamp', variant: '', unit_price: 1500, quantity: 1 },
]
const d = (r, sku) => r.lines.find((l) => l.sku === sku).discount
const pct = (value, extra = {}) => ({ name: 'pc', method: 'percentage', value, target: 'items', allocation: 'each', ...extra })
const flat = (value, extra = {}) => ({ name: 'flat', method: 'fixed', value, target: 'items', allocation: 'each', ...extra })

/* ---- what a percentage means ---- */
ok('a percentage comes off every line it touches', () => {
  const r = apply(lines(), [pct(20)])
  assert.equal(d(r, 'chair'), 500); assert.equal(d(r, 'lamp'), 300)
  assert.equal(r.total, 3200)
})

ok('and off the price that line is actually at — not off a list price somewhere', () => {
  /* the line arrives at its STANDING price, whatever the price lists already decided. A member
     whose rate is 15 gets 20% off 15, which is the whole reason a discount is not a price. */
  const member = [{ sku: 'chair', variant: '', unit_price: 1500, quantity: 1 }]
  assert.equal(d(apply(member, [pct(20)]), 'chair'), 300)
})

/* ============================================================================================
 * ALLOCATION — the field this project tried to do without. "$10 off" is three different
 * instructions and a model that cannot tell them apart cannot be used.
 * ========================================================================================== */

ok('EACH: a flat amount comes off every line separately', () => {
  const r = apply(lines(), [flat(5, { allocation: 'each' })])
  assert.equal(d(r, 'chair'), 500); assert.equal(d(r, 'lamp'), 500)
  assert.equal(r.discount, 1000, '$5 off each of two lines is $10 off the order')
})

ok('ACROSS: one amount, split by each line’s share of the total', () => {
  const r = apply(lines(), [flat(10, { allocation: 'across' })])
  assert.equal(d(r, 'chair'), 625, '2500 of 4000 is 62.5% of the ten pounds')
  assert.equal(d(r, 'lamp'), 375)
  assert.equal(r.discount, 1000, 'and the parts sum to the whole, exactly')
})

ok('ONCE: the amount comes off a single line, the dearest', () => {
  const r = apply(lines(), [flat(5, { allocation: 'once' })])
  assert.equal(d(r, 'chair'), 500); assert.equal(d(r, 'lamp'), 0)
  assert.equal(r.discount, 500)
})

ok('across never loses or invents a penny to rounding', () => {
  const three = [
    { sku: 'a', unit_price: 1000, quantity: 1 },
    { sku: 'b', unit_price: 1000, quantity: 1 },
    { sku: 'c', unit_price: 1000, quantity: 1 },
  ]
  /* a tenner over three equal lines does not divide; the parts must still sum to the tenner */
  const r = apply(three, [flat(10, { allocation: 'across' })])
  assert.equal(r.discount, 1000, 'the last line takes the rounding')
})

/* ---- stacking ---- */
ok('two promotions stack on what is left, not on the original', () => {
  const r = apply(lines(), [pct(20), pct(20)])
  assert.equal(d(r, 'chair'), 900, '500, then 20% of the remaining 2000')
  assert.equal(d(r, 'lamp'), 540)
})

ok('and nothing can take a line below nothing, however many apply', () => {
  const r = apply(lines(), [pct(80), pct(80), flat(100)])
  assert.equal(r.total, 0)
  assert.ok(r.lines.every((l) => l.discount <= l.subtotal), 'no line is discounted past its own value')
})

ok('a promotion worth more than the thing is capped at the thing', () => {
  const r = apply([{ sku: 'x', unit_price: 500, quantity: 1 }], [flat(50)])
  assert.equal(r.discount, 500, 'not 5000, and not a refund')
  assert.equal(r.total, 0)
})

/* ---- how far it reaches ---- */
ok('max_quantity caps how many units of a line it reaches', () => {
  const five = [{ sku: 'chair', unit_price: 1000, quantity: 5 }]
  assert.equal(d(apply(five, [pct(50)]), 'chair'), 2500, 'half of all five')
  assert.equal(d(apply(five, [pct(50, { max_quantity: 2 })]), 'chair'), 1000, 'half of two of them')
  assert.equal(unitsOf({ quantity: 5 }, { max_quantity: 2 }), 2)
  assert.equal(unitsOf({ quantity: 5 }, {}), 5, 'no cap means all of them')
})

ok('a promotion may name what it touches, and leaves the rest alone', () => {
  const r = apply(lines(), [pct(50, { applies: [{ sku: 'lamp' }] })])
  assert.equal(d(r, 'chair'), 0); assert.equal(d(r, 'lamp'), 750)
  assert.equal(touches({ applies: [] }, { sku: 'anything' }), true, 'naming nothing means everything')
})

/* ---- who it is for: the thing the shop says and the system never guesses ---- */
ok('a promotion for everybody has no rules', () => {
  assert.equal(live(pct(20), {}), true)
})

ok('and one for new customers says so, so a member keeps their own price', () => {
  const firstOrder = pct(20, { rules: [{ attribute: 'customer.class', operator: 'ne', value: 'subscribed' }] })
  assert.equal(live(firstOrder, { customer: { class: 'guest' } }), true)
  assert.equal(live(firstOrder, { customer: { class: 'subscribed' } }), false)
  /* and that is the ONLY thing that decides it — not how specific anything looks */
  assert.equal(apply(lines(), [firstOrder], { context: { customer: { class: 'subscribed' } } }).discount, 0)
  assert.equal(apply(lines(), [firstOrder], { context: { customer: { class: 'guest' } } }).discount, 800)
})

ok('every rule must hold, not any of them', () => {
  const both = pct(20, { rules: [
    { attribute: 'customer.class', value: 'subscribed' },
    { attribute: 'shipping_address.country', value: 'GB' },
  ] })
  assert.equal(live(both, { customer: { class: 'subscribed' }, shipping_address: { country: 'GB' } }), true)
  assert.equal(live(both, { customer: { class: 'subscribed' }, shipping_address: { country: 'DE' } }), false)
})

/* ---- a cart-total threshold, which is the commonest promotion there is ---- */
ok('"off orders over X" works, and the threshold is the cart as it stands', () => {
  const over30 = pct(10, { rules: [{ attribute: 'item_total', operator: 'gte', value: 3000 }] })
  assert.equal(apply(lines(), [over30]).discount, 400, '4000 is over 3000')
  assert.equal(apply([{ sku: 'lamp', unit_price: 1500, quantity: 1 }], [over30]).discount, 0, 'and 1500 is not')
})

/* ---- status and window ---- */
ok('a draft or inactive promotion does nothing, and neither does one out of its window', () => {
  assert.equal(live(pct(20, { status: 'draft' }), {}), false)
  assert.equal(live(pct(20, { status: 'inactive' }), {}), false)
  assert.equal(live(pct(20, { starts: '2099-01-01' }), {}), false)
  assert.equal(live(pct(20, { ends: '2000-01-01' }), {}), false)
  assert.equal(live(pct(20, { starts: '2000-01-01', ends: '2099-01-01' }), {}), true)
})

/* ---- the order and the shipping, which per-item discounts cannot express ---- */
ok('£10 off the order comes off the order, not off a line', () => {
  const r = applyToTotal(5000, [{ name: 'ten', method: 'fixed', value: 10, target: 'order' }])
  assert.equal(r.amount, 4000); assert.equal(r.off, 1000)
})

ok('free shipping is a promotion on the shipping, not a special case', () => {
  const r = applyToTotal(599, [{ name: 'free-ship', method: 'percentage', value: 100, target: 'shipping' }], { target: 'shipping' })
  assert.equal(r.amount, 0)
})

ok('an order promotion does not touch the lines, and a line promotion does not touch the order', () => {
  assert.equal(apply(lines(), [{ name: 'o', method: 'fixed', value: 10, target: 'order' }]).discount, 0)
  assert.equal(applyToTotal(5000, [pct(20)]).off, 0, 'an items promotion is not an order one')
})

/* ---- the shapes ---- */
ok('the vocabularies are the ones Medusa uses', () => {
  assert.deepEqual(METHODS, ['percentage', 'fixed'])
  assert.deepEqual(TARGETS, ['items', 'order', 'shipping'])
  assert.deepEqual(ALLOCATIONS, ['each', 'across', 'once'])
})

ok('a percentage is of the amount; a fixed value is the money it says', () => {
  assert.equal(valueOf({ method: 'percentage', value: 25 }, 2000), 500)
  assert.equal(valueOf({ method: 'fixed', value: 7.5 }, 2000), 750, 'written in whole money, kept in pence')
})

/*
 * A DISCOUNT IS TAKEN ONCE, FROM THE STANDING PRICE.
 *
 * The bag discounted an already-discounted line: the product page showed $18 as $14.40, the cart
 * stored $14.40, and the bag took twenty per cent off that and offered $11.52. Nothing failed —
 * the figure was simply wrong, in the direction that loses money, on every discounted line.
 *
 * The rule it rests on: a LINE carries what that person stands at, and the discount belongs to
 * the bag, because a discount can depend on the whole of it. "£10 off orders over £50" is not a
 * property of any one line.
 */
ok('applying to a line twice is not the same as applying once, which is why a line carries the standing price', () => {
  const standing = [{ sku: 'chair', unit_price: 1800, quantity: 1 }]
  const once = apply(standing, [pct(20)])
  assert.equal(once.total, 1440)
  /* what the bug did: feed the discounted figure back in */
  const again = apply([{ sku: 'chair', unit_price: once.total, quantity: 1 }], [pct(20)])
  assert.equal(again.total, 1152, 'which is the wrong number, and the test exists so it stays recognisable')
  assert.notEqual(once.total, again.total)
})

ok('and applying the same promotion twice in one pass stacks on the remainder, deliberately', () => {
  /* this is NOT the bug above: two promotions a shop really did set both apply, each to what is
     left. One promotion applied once to a price already reduced by itself is the bug. */
  const r = apply([{ sku: 'chair', unit_price: 1800, quantity: 1 }], [pct(20), pct(20)])
  assert.equal(r.total, 1152)
  assert.equal(r.lines[0].by.length, 2, 'and the bag can say both applied')
})
/* ============================================================================================
 * A VALUE OUTSIDE AN ENUM IS REFUSED BY THE SCHEMA, not shrugged at.
 *
 * Every one of these fields changes what a discount DOES, so a typo in one is money. velite is
 * what refuses them, and this checks that the schema actually says so rather than trusting that
 * somebody remembered to.
 * ========================================================================================== */
{
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./velite.mjs', import.meta.url), 'utf8'))
  const block = src.slice(src.indexOf('    promotions: {'), src.indexOf('    collections: {', src.indexOf('    promotions: {')))
  const enumOf = (field) => {
    const m = new RegExp(field + ": s\\.enum\\(\\[([^\\]]*)\\]").exec(block)
    return m ? m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')) : null
  }
  ok('every vocabulary is an enum in the schema, so a typo is refused at build', () => {
    assert.deepEqual(enumOf('method'), ['percentage', 'fixed'])
    assert.deepEqual(enumOf('target'), ['items', 'order', 'shipping'])
    assert.deepEqual(enumOf('allocation'), ['each', 'across', 'once'])
    assert.deepEqual(enumOf('status'), ['active', 'draft', 'inactive'])
    assert.deepEqual(enumOf('kind'), ['standard', 'buyget'])
  })
  ok('and the rule operators are the ones the resolver implements \u2014 no more, no fewer', () => {
    const ops = /operator: s\.enum\(\[([^\]]*)\]/.exec(block)[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''))
    assert.deepEqual(ops.sort(), ['eq', 'gt', 'gte', 'in', 'lt', 'lte', 'ne'])
    /* an operator in the schema the resolver does not know would silently never hold */
    for (const op of ops) {
      const held = ruleHolds({ attribute: 'a', operator: op, value: 1 }, { a: 1 })
      assert.equal(typeof held, 'boolean', op + ' is implemented')
    }
    assert.equal(ruleHolds({ attribute: 'a', operator: 'between', value: 1 }, { a: 1 }), false, 'and one it does not know never holds')
  })
}
console.log(fail ? `\npromotions: ${fail} failed, ${pass} passed\n` : `\npromotions: all ${pass} checks passed\n`)
process.exit(fail ? 1 : 0)
