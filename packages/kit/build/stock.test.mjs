/*
 * SOLD OUT IS NOT THE SAME AS NOT SOLD, and the rule that keeps them apart.
 *
 * Pure, so it runs anywhere and the checkout function, the product page and the card all answer
 * with the same code. Every case here is one a shop loses money or trust by: a static site that
 * silently stops selling, a discontinued shape advertised as back soon, a shape back in stock that
 * nobody can buy.
 *
 *   node packages/kit/build/stock.test.mjs
 */
import assert from 'node:assert/strict'
import { availableOf, buyable, whyNot, offerOut, stockKey, madeOnDemand } from '../supabase/functions/_shared/stock.js'

let pass = 0, fail = 0
const ok = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String((e && e.message) || e).split('\n').slice(0, 3).join('\n    ')) } }

console.log('\nSOLD OUT IS NOT THE SAME AS NOT SOLD\n')

const TEE = { sku: 'tee', tracked: true, unsold: ['s.white'] }
const counts = {
  [stockKey('tee', 's.black')]: { stocked: 0, reserved: 0 },
  [stockKey('tee', 'm.black')]: { stocked: 5, reserved: 2 },
  [stockKey('tee', 'l.black')]: { stocked: 3, reserved: 3 },
}

ok('available is stocked less reserved, and floors at nothing', () => {
  assert.equal(availableOf(counts, 'tee', 'm.black'), 3)
  assert.equal(availableOf(counts, 'tee', 'l.black'), 0, 'all three are held')
  assert.equal(availableOf(counts, 'tee', 's.black'), 0)
})

ok('a count nobody has is null, which is NOT zero', () => {
  assert.equal(availableOf(counts, 'tee', 'xl.black'), null)
  assert.equal(availableOf(null, 'tee', 's.black'), null)
})

/*
 * THE FAILURE DIRECTION. Each of these is a deployment or a moment in which nothing is known, and
 * every one of them must sell. A shop that stops selling when it cannot reach its database fails
 * silently, totally, and in the one direction nobody notices until the takings are zero.
 */
ok('unknown is BUYABLE — a static site has nowhere to keep a count and so cannot have run out', () => {
  assert.equal(buyable(TEE, 's.black', null), true, 'no counts at all')
  assert.equal(buyable(TEE, 'xl.black', counts), true, 'a shape with no row')
  assert.equal(buyable(TEE, 's.black', {}), true, 'the counts loaded and held nothing')
})

ok('an offer that is not tracked is always buyable', () => {
  assert.equal(buyable({ sku: 'tee' }, 's.black', counts), true)
  assert.equal(buyable({ sku: 'tee', tracked: false }, 's.black', counts), true)
})

ok('backorder beats the count, because the shop has said the count is not a limit', () => {
  assert.equal(buyable({ ...TEE, backorder: true }, 's.black', counts), true)
})

ok('and a tracked offer with a known zero refuses', () => {
  assert.equal(buyable(TEE, 's.black', counts), false)
  assert.equal(buyable(TEE, 'l.black', counts), false, 'held by somebody else counts as gone')
  assert.equal(buyable(TEE, 'm.black', counts), true)
})

/*
 * THE TWO WORDS. "We do not make this" and "we have none today" are different promises, and a
 * shop that says the first about the second tells somebody a thing is discontinued while it is on
 * a lorry. They are kept apart here so no surface has to decide.
 */
ok('unsold is the file\'s answer and out is the database\'s, and they are never folded together', () => {
  assert.equal(whyNot(TEE, 's.white', counts), 'unsold', 'the shop does not make it')
  assert.equal(whyNot(TEE, 's.black', counts), 'out', 'the shop makes it and has none')
  assert.equal(whyNot(TEE, 'm.black', counts), null, 'and this one can be had')
})

ok('unsold wins where a shape is both — it is the more permanent fact', () => {
  const both = { ...TEE, unsold: ['s.black'] }
  assert.equal(whyNot(both, 's.black', counts), 'unsold')
})

/* ---- the whole product, which is what a card says ---- */
const shapes = [{ variant: 's.black', sold: true }, { variant: 'm.black', sold: true }, { variant: 'l.black', sold: true }]

ok('a product is sold out only when EVERY shape it sells is gone', () => {
  assert.equal(offerOut(TEE, shapes, counts), false, 'the medium is there')
  const none = { ...counts, [stockKey('tee', 'm.black')]: { stocked: 2, reserved: 2 } }
  assert.equal(offerOut(TEE, shapes, none), true)
})

ok('a shape the shop does not sell does not keep the product in stock', () => {
  const withdrawn = [...shapes, { variant: 's.white', sold: false }]
  const none = { ...counts, [stockKey('tee', 'm.black')]: { stocked: 0, reserved: 0 } }
  assert.equal(offerOut(TEE, withdrawn, none), true, 'the withdrawn one is not a shape anybody can have')
})

ok('and a product nothing is known about is never sold out', () => {
  assert.equal(offerOut(TEE, shapes, null), false)
  assert.equal(offerOut(TEE, shapes, {}), false)
  assert.equal(offerOut({ sku: 'tee' }, shapes, counts), false, 'untracked')
  assert.equal(offerOut({ ...TEE, backorder: true }, shapes, counts), false)
})

ok('an offer with no shapes at all is judged on its own count', () => {
  const book = { sku: 'a-book', tracked: true }
  assert.equal(offerOut(book, [], { [stockKey('a-book', '')]: { stocked: 0, reserved: 0 } }), true)
  assert.equal(offerOut(book, [], { [stockKey('a-book', '')]: { stocked: 1, reserved: 0 } }), false)
})

/*
 * A THING MADE ON DEMAND NEVER HOLDS STOCK AND IS NEVER REFUSED FOR WANT OF IT.
 *
 * There is no shelf and no last one: a printed book is printed when it is bought. This was true
 * by accident — a print offer simply never carried `tracked` — and one wrong save would have
 * stopped a shop selling a book it can print a thousand of.
 */
ok('a printed book and a download are always buyable, whatever any count says', () => {
  const counts = { [stockKey('a-book-print', '')]: { stocked: 0, reserved: 0 } }
  assert.equal(buyable({ sku: 'a-book-print', kind: 'print', tracked: true }, '', counts), true)
  assert.equal(buyable({ sku: 'a-book-print', kind: 'download', tracked: true }, '', counts), true)
  assert.equal(madeOnDemand({ kind: 'print' }), true)
  assert.equal(madeOnDemand({ kind: 'good' }), false, 'a thing on a shelf is counted')
})

ok('and such a product is never shown as sold out', () => {
  const counts = { [stockKey('a-book-print', '')]: { stocked: 0, reserved: 0 } }
  assert.equal(offerOut({ sku: 'a-book-print', kind: 'print', tracked: true }, [], counts), false)
  assert.equal(offerOut({ sku: 'tee', kind: 'good', tracked: true }, [], { [stockKey('tee', '')]: { stocked: 0, reserved: 0 } }), true, 'but a thing on a shelf is')
})
console.log(fail ? `\nstock: ${fail} failed, ${pass} passed\n` : `\nstock: all ${pass} checks passed\n`)
process.exit(fail ? 1 : 0)
