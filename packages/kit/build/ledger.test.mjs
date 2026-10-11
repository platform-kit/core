#!/usr/bin/env node
/*
 * WHAT A PAYMENT MEANS — the decisions, pinned.
 *
 * `ledger.ts` decides what somebody owns after they have paid, and it had no test of its own: every
 * decision sat between two database writes, so checking one meant a stack, a Stripe mock and a
 * served function, and nobody ever did. The decisions live in `_shared/ledger-rules.js` now, which
 * is plain arithmetic over plain objects, and this is what they must answer.
 *
 * Every case here is one somebody can lose money or access by.
 *
 *   node packages/kit/build/ledger.test.mjs
 */
import assert from 'node:assert/strict'
import { buyerOf, emailOf, offerOfLine, grantsOf, ships, carriesFiles, opensOnline, lineSnapshot, offerOptions } from '../supabase/functions/_shared/ledger-rules.js'

let pass = 0, fail = 0
const ok = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + String(e && e.message || e).split('\n').slice(0, 3).join('\n    ')) } }

console.log('\nWHAT A PAYMENT MEANS\n')

/* ---- who paid ---- */
ok('the buyer is what the checkout carried, then Stripe\'s reference, then the customer', () => {
  assert.equal(buyerOf({ metadata: { user_id: 'u1' }, client_reference_id: 'u2' }, 'u3'), 'u1', 'the metadata wins')
  assert.equal(buyerOf({ client_reference_id: 'u2' }, 'u3'), 'u2', 'then the reference')
  assert.equal(buyerOf({}, 'u3'), 'u3', 'then the customer')
  assert.equal(buyerOf({}, null), null, 'a guest is nobody, and that is a case rather than a fault')
  assert.equal(buyerOf(null, null), null)
})
ok('the Checkout email is preferred, trimmed, lowercased, and empty values fall back', () => {
  assert.equal(emailOf({ customer_details: { email: '  Reader@Example.COM ' }, customer_email: 'fallback@example.com' }), 'reader@example.com')
  assert.equal(emailOf({ customer_details: { email: '' }, customer_email: ' Fallback@Example.com ' }), 'fallback@example.com')
  assert.equal(emailOf({}), null)
})

/* ---- which offer ---- */
const byKey = (k) => (k === 'k-book' ? { key: 'k-book', sku: 'the-kybalion', kind: 'book', book: 'the-kybalion' } : null)
const bySku = (s) => (s === 'old-sku' ? { key: 'k-old', sku: 'old-sku', kind: 'book', book: 'old-book' } : null)

ok('a line is its price\'s lookup key, which is the offer\'s identity', () => {
  const r = offerOfLine({ price: { lookup_key: 'k-book' } }, byKey, bySku)
  assert.equal(r.offer.kind, 'book')
  assert.equal(r.sku, 'the-kybalion')
})
ok('a price from before keys is found by its sku', () => {
  const r = offerOfLine({ price: { metadata: { sku: 'old-sku' } } }, byKey, bySku)
  assert.equal(r.offer.book, 'old-book')
})
ok('the key wins over the sku, because a sku may be reused and a key never is', () => {
  const r = offerOfLine({ price: { lookup_key: 'k-book', metadata: { sku: 'old-sku' } } }, byKey, bySku)
  assert.equal(r.offer.book, 'the-kybalion')
})
ok('a line naming nothing the files declare is nobody\'s offer', () => {
  const r = offerOfLine({ price: { lookup_key: 'gone', metadata: { sku: 'also-gone' } } }, byKey, bySku)
  assert.equal(r.offer, null)
  assert.equal(r.sku, 'also-gone', 'and the sku is still recorded, so the row says what was paid for')
})

/* ---- what it grants ---- */
const S = 'cs_test_1'
const keys = (g) => g.map((x) => x.kind + ':' + x.key)

ok('anything paid for makes the buyer paid', () => {
  assert.deepEqual(keys(grantsOf({ offer: { kind: 'good' }, sku: 'cap', sessionId: S, userId: 'u1' })), ['class:paid'])
})
ok('a guest is granted nothing, and the purchase still stands', () => {
  assert.deepEqual(grantsOf({ offer: { kind: 'book', book: 'x' }, sku: 'x', sessionId: S, userId: null }), [])
})
ok('a price that names the book the offer does not still opens it', () => {
  /* a price written before the offer carried one, or by hand: dropping this fallback would leave a
     reader who paid for an unlock without the book, and nothing would say why */
  const r = offerOfLine({ price: { lookup_key: 'k-x', metadata: { book: 'from-the-price' } } }, () => ({ key: 'k-x', sku: 'x', kind: 'book' }), () => null)
  assert.equal(r.book, 'from-the-price')
  assert.deepEqual(keys(grantsOf({ offer: r.offer, sku: r.sku, book: r.book, sessionId: S, userId: 'u1' })), ['class:paid', 'product:from-the-price'])
})
ok('a book unlock opens that book', () => {
  assert.deepEqual(keys(grantsOf({ offer: { kind: 'book', book: 'the-kybalion' }, sku: 'the-kybalion', sessionId: S, userId: 'u1' })),
    ['class:paid', 'product:the-kybalion'])
})
ok('A PRINTED COPY OPENS NOTHING ONLINE', () => {
  /* the reader bought a paperback; they have not bought the right to read it here */
  assert.deepEqual(keys(grantsOf({ offer: { kind: 'print', book: 'the-kybalion' }, sku: 'the-kybalion-print', sessionId: S, userId: 'u1' })), ['class:paid'])
})
ok('nor does a file', () => {
  assert.deepEqual(keys(grantsOf({ offer: { kind: 'download', book: 'the-kybalion' }, sku: 'the-kybalion-pdf', sessionId: S, userId: 'u1' })), ['class:paid'])
})
ok('a session is ONE CREDIT PER UNIT, each its own row', () => {
  /* three bought is three owed. Sharing a source_id would collide on the upsert and quietly
     turn three into one — which is somebody paying for three calls and getting one. */
  const g = grantsOf({ offer: { kind: 'session', key: 'k-1on1' }, sku: 'one-on-one', quantity: 3, sessionId: S, userId: 'u1' })
  assert.equal(g.filter((x) => x.key === 'session:k-1on1').length, 3)
  assert.equal(new Set(g.map((x) => x.source_id)).size, g.length, 'every grant has its own source_id')
})
ok('a form is a credit per unit too: paying twice means answering twice', () => {
  const g = grantsOf({ offer: { kind: 'form', key: 'k-reading' }, sku: 'reading', quantity: 2, sessionId: S, userId: 'u1' })
  assert.equal(g.filter((x) => x.key === 'form:k-reading').length, 2)
})
ok('a provider\'s own offering has no catalog entry and still grants its credit', () => {
  const g = grantsOf({ offer: null, sku: 'offering:9f1c', quantity: 2, sessionId: S, userId: 'u1' })
  assert.equal(g.filter((x) => x.key === 'session:offering:9f1c').length, 2)
})
ok('a sku that merely looks like one grants nothing extra', () => {
  assert.deepEqual(keys(grantsOf({ offer: null, sku: 'offerings-weekly', sessionId: S, userId: 'u1' })), ['class:paid'])
})
ok('quantity is never less than one, whatever Stripe sends', () => {
  for (const q of [undefined, null, 0, -3, 'x'])
    assert.equal(grantsOf({ offer: { kind: 'session', key: 'k' }, quantity: q, sessionId: S, userId: 'u1' }).length, 2, 'one credit for ' + JSON.stringify(q))
})

/* ---- a replay writes the same rows ---- */
ok('THE SAME PAYMENT DECIDES THE SAME THING, every time it is seen', () => {
  /*
   * The webhook and the client's confirm-checkout both write this, and Stripe retries events. If a
   * replay produced different source_ids it would grant twice — two classes, six credits for three
   * sessions — so the decision has to be a function of the payment and nothing else.
   */
  const once = grantsOf({ offer: { kind: 'session', key: 'k' }, quantity: 3, sessionId: S, userId: 'u1' })
  const again = grantsOf({ offer: { kind: 'session', key: 'k' }, quantity: 3, sessionId: S, userId: 'u1' })
  assert.deepEqual(once, again)
  const other = grantsOf({ offer: { kind: 'session', key: 'k' }, quantity: 3, sessionId: 'cs_test_2', userId: 'u1' })
  assert.notDeepEqual(once.map((g) => g.source_id), other.map((g) => g.source_id), 'and a different payment is a different grant')
})

/* ---- what the confirmation says of a line ---- */
ok('what ships, what carries files, what opens online', () => {
  assert.ok(ships({ kind: 'print' }) && ships({ kind: 'good' }))
  assert.ok(!ships({ kind: 'book' }) && !ships({ kind: 'download' }) && !ships(null))
  assert.ok(carriesFiles({ kind: 'download' }))
  assert.ok(carriesFiles({ kind: 'print', includes: ['pdf'] }), 'a printed copy that includes files')
  assert.ok(!carriesFiles({ kind: 'print', includes: [] }), 'and one that does not')
  assert.ok(opensOnline({ kind: 'book' }))
  assert.ok(!opensOnline({ kind: 'print' }), 'the paperback again')
})

/* ============================================================================================
 * WHAT THE LINE SAYS IT WAS, a year later
 *
 * The catalog is the CURRENT truth. A purchase is a historical fact, and the two drift the
 * moment anybody edits an offer — so every one of these asks the same question: having written
 * the row, can the sale still be read correctly once the offer behind it has moved on?
 * ========================================================================================== */

const NOTEBOOK = {
  sku: 'notebook', key: 'd4e5f6a7', kind: 'good', title: 'The first-hour notebook', price: 18,
  options: [{ name: 'Cover', values: [{ value: 'linen', label: 'Linen' }, { value: 'leather', label: 'Leather' }] },
             { name: 'Ruling', values: [{ value: 'lined', label: 'Lined' }, { value: 'plain', label: 'Plain' }] }],
}
const line = (unit, qty = 1, extra = {}) => ({ quantity: qty, price: { unit_amount: unit, currency: 'usd' }, ...extra })

ok('the row keeps the title, the shape and the values as they read at the time', () => {
  const s = lineSnapshot(NOTEBOOK, line(2800), 'leather.lined', { amount_total: 2800, currency: 'usd' })
  assert.equal(s.title, 'The first-hour notebook')
  assert.equal(s.variant_title, 'Leather · Lined', 'the WORDS, not the key — nobody read "leather.lined"')
  assert.deepEqual(s.options.map((o) => [o.option, o.value, o.label]), [['Cover', 'leather', 'Leather'], ['Ruling', 'lined', 'Lined']])
})

ok('and reads back unchanged after the offer is renamed, reworded and re-priced', () => {
  const then = lineSnapshot(NOTEBOOK, line(2800), 'leather.lined', {})
  /* a year passes: the shop renames the product, rewords a value, drops the other and doubles the price */
  const now = { ...NOTEBOOK, sku: 'notebook-mk2', title: 'The Daybook', price: 36,
    options: [{ name: 'Cover', values: [{ value: 'leather', label: 'Full-grain leather' }] },
               { name: 'Ruling', values: [{ value: 'lined', label: 'Ruled' }] }] }
  const fresh = lineSnapshot(now, line(3600), 'leather.lined', {})
  assert.equal(fresh.variant_title, 'Full-grain leather · Ruled', 'a new sale reads the new words')
  assert.equal(then.variant_title, 'Leather · Lined', 'and the old row is untouched by any of it')
  assert.equal(then.title, 'The first-hour notebook')
  assert.equal(then.unit_price, 2800, "what was charged, not what it costs today")
})

ok('the price is the one Stripe charged, never the one the offer says now', () => {
  /* the offer says 18; the line was charged 25 because the price changed between the two. The
     row must say 25, which is the whole reason it is not resolved from the catalog later. */
  const s = lineSnapshot(NOTEBOOK, line(2500), '', {})
  assert.equal(s.unit_price, 2500)
})

ok('the total on a row is the LINE\'s, never the session\'s', () => {
  const s = lineSnapshot(NOTEBOOK, line(2800, 2), 'linen.lined', { amount_total: 9999 })
  assert.equal(s.amount_total, 5600, 'unit × quantity, not the basket')
  assert.equal(s.quantity, 2)
  const expanded = lineSnapshot(NOTEBOOK, line(2800, 2, { amount_total: 5000 }), 'linen.lined', { amount_total: 9999 })
  assert.equal(expanded.amount_total, 5000, 'and Stripe\'s own line total wins where it gave one — a discount lives there')
})

ok('an offer with no options snapshots no shape rather than an empty one', () => {
  const s = lineSnapshot({ sku: 'membership', key: 'aaaa0000', title: 'Inner circle' }, line(1000), '', {})
  assert.equal(s.variant_title, null)
  assert.equal(s.options, null)
})

ok('a value the offer has since dropped still reads as itself', () => {
  /* Plain was withdrawn and removed from the file; the sale that bought it must not go blank */
  const dropped = { ...NOTEBOOK, options: [NOTEBOOK.options[0], { name: 'Ruling', values: [{ value: 'lined', label: 'Lined' }] }] }
  const s = lineSnapshot(dropped, line(1800), 'linen.plain', {})
  assert.equal(s.variant_title, 'Linen · plain', 'the slug stands in for the label it no longer has')
})

ok('a book in print has options too, derived from its block and never named twice', () => {
  const book = { sku: 'the-kybalion-hardcover', key: 'bbbb1111', kind: 'print', title: 'The Kybalion — hardcover',
    contents: ['parts', 'full'], cloth: ['black', 'navy'], foil: ['gold'] }
  assert.deepEqual(offerOptions(book).map((o) => o.name), ['Contents', 'Cloth', 'Foil'])
  const s = lineSnapshot(book, line(4500), 'parts.navy.gold', {})
  assert.equal(s.variant_title, 'parts · navy · gold')
  assert.equal(s.options.length, 3)
})

ok('a line with no price at all falls back to the session rather than writing nothing', () => {
  const s = lineSnapshot(NOTEBOOK, { quantity: 1, price: {} }, '', { amount_total: 1800, currency: 'usd' })
  assert.equal(s.unit_price, null)
  assert.equal(s.amount_total, 1800)
})

/* ============================================================================================
 * A LINE PRICED INLINE IS STILL ATTRIBUTED
 *
 * Two real paths build a line with no catalog price behind it: a paid offering, which has no
 * catalog entry to make one from, and a line a price list re-priced. Both put the offer’s marks
 * on `price_data.product_data.metadata` — the PRODUCT’s metadata, not the price’s.
 *
 * `offerOfLine` read only the price. So a line built that way came back with no offer, no sku
 * and no book: nothing throws, nothing is logged, the buyer is charged and granted NOTHING — no
 * unlock, no credit, no print order, and a purchase row that does not say what it was for.
 *
 * There was no test here at all, which is how it got written and shipped in the same hour. This
 * is that test.
 * ========================================================================================== */

const OFFER = { sku: 'the-book', key: 'abcd1234', kind: 'book', book: 'a-quiet-room', title: 'A Quiet Room' }
const findByKey = (k) => (k === OFFER.key ? OFFER : null)
const findBySku = (k) => (k === OFFER.sku ? OFFER : null)

ok('a line from a catalog price is attributed by its lookup key, as it always was', () => {
  const line = { price: { lookup_key: 'abcd1234', metadata: { key: 'abcd1234', sku: 'the-book' } } }
  const r = offerOfLine(line, findByKey, findBySku)
  assert.equal(r.offer, OFFER); assert.equal(r.sku, 'the-book'); assert.equal(r.book, 'a-quiet-room')
})

ok('a line priced INLINE is attributed from the product\'s metadata, which is where it lands', () => {
  /* exactly the shape Stripe returns for a `price_data` line with the product expanded */
  const line = { price: { lookup_key: null, metadata: {}, product: { id: 'prod_x', metadata: { key: 'abcd1234', sku: 'the-book', kind: 'book', book: 'a-quiet-room' } } } }
  const r = offerOfLine(line, findByKey, findBySku)
  assert.equal(r.offer, OFFER, 'without this the buyer pays and is granted nothing')
  assert.equal(r.sku, 'the-book'); assert.equal(r.book, 'a-quiet-room')
})

ok('and it grants what it should — the unlock, not silence', () => {
  const line = { price: { product: { metadata: { key: 'abcd1234', sku: 'the-book' } } } }
  const { offer, sku, book } = offerOfLine(line, findByKey, findBySku)
  const grants = grantsOf({ offer, sku, book, quantity: 1, sessionId: 'cs_1', userId: 'u1' })
  assert.ok(grants.some((g) => g.kind === 'product' && g.key === 'a-quiet-room'), 'the book is opened')
})

ok('an offering, which has no catalog entry at all, still buys its credit', () => {
  /* the path that existed before any of this: no offer to find, the sku carries the meaning */
  const line = { price: { product: { metadata: { sku: 'offering:ada:60', kind: 'session' } } } }
  const { offer, sku } = offerOfLine(line, () => null, () => null)
  assert.equal(sku, 'offering:ada:60')
  const grants = grantsOf({ offer, sku, quantity: 2, sessionId: 'cs_2', userId: 'u1' })
  const credits = grants.filter((g) => g.key === 'session:offering:ada:60')
  assert.equal(credits.length, 2, 'two bought is two credits, each its own row')
})

ok('the price\'s own marks win over the product\'s where both are there', () => {
  const line = { price: { metadata: { sku: 'the-book' }, product: { metadata: { sku: 'something-else' } } } }
  assert.equal(offerOfLine(line, () => null, findBySku).sku, 'the-book')
})

ok('a line with nothing on it anywhere is null rather than a wrong guess', () => {
  const r = offerOfLine({ price: { product: 'prod_unexpanded' } }, () => null, () => null)
  assert.equal(r.offer, null); assert.equal(r.sku, null); assert.equal(r.key, null)
})
console.log(`\nledger: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
