/*
 * WHAT THE SHOP REFUSES, AND WHAT IT PROMISES — the decisions over plain data, checked without a
 * stack, a browser or a Stripe account.
 *
 * These were the five thinnest scenarios in `store` and `print-editions`, and they were thin for
 * a reason worth saying: each of them is a REFUSAL. Nothing renders when a refusal works. A cloth
 * the book does not offer, a country we do not ship to, a spine title too long for the foil — the
 * evidence that any of them held was that nobody had complained, and the cost of one quietly
 * ceasing to hold is money: a copy bound in a cloth we cannot buy, a parcel to a country the
 * printer will not send to, a spine stamped with text that runs off the end of it.
 *
 * Run alone:  node packages/kit/build/sell-rules.test.mjs
 */
import assert from 'node:assert/strict'
import { printVariant, ships, carriesFiles, opensOnline } from '../supabase/functions/_shared/ledger-rules.js'
import { shippingRules, ratesFor, shipsTo, STRIPE_COUNTRIES } from '../src/lib/shipping.js'
import { spineWords, proofState, SPINE_MAX } from '../src/lib/print-offers.js'

let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 5).join('\n    ')) } }

/* ─── a cart line's variant: the choices the buyer made, checked against what the book sells ─── */

/* the hardcover of a book that offers two cloths and two foils, in both contents */
const HARDCOVER = { sku: 'x-hardcover', kind: 'print', contents: ['parts', 'full'], cloth: ['black', 'navy'], foil: ['gold', 'silver'] }

t('a variant the offer sells is filled in as written', () => {
  assert.deepEqual(printVariant(HARDCOVER, 'full.navy.silver'), { contents: 'full', cloth: 'navy', foil: 'silver' })
})
t('an empty variant takes each choice\'s first option', () => {
  assert.deepEqual(printVariant(HARDCOVER, ''), { contents: 'parts', cloth: 'black', foil: 'gold' })
})
t('a cloth the block does not offer is refused', () => {
  assert.equal(printVariant(HARDCOVER, 'parts.crimson.gold'), null)
})
t('a foil the block does not offer is refused', () => {
  assert.equal(printVariant(HARDCOVER, 'parts.black.copper'), null)
})
t('contents the book does not print is refused', () => {
  assert.equal(printVariant(HARDCOVER, 'summary.black.gold'), null)
})
/* the paperback has no cloth and no foil at all, so a line that names one is a line about a
   different book — and filling in a default here would sell a paperback as though it had a
   linen wrap */
t('a paperback is given no cloth or foil', () => {
  const paperback = { sku: 'x-softcover', kind: 'print', contents: ['parts'] }
  assert.deepEqual(printVariant(paperback, 'parts'), { contents: 'parts', cloth: '', foil: '' })
})
/*
 * AND A KEY WITH MORE PARTS THAN THE BOOK HAS OPTIONS IS REFUSED, which this said the opposite
 * of until the variant grammar was generalised.
 *
 * It used to be accepted and silently truncated: "parts.black.gold" against a paperback with no
 * cloth list returned { contents: "parts" }, the "black.gold" was dropped, and the ledger wrote
 * whatever the session metadata said. So a garbage variant could land on a real purchase and
 * nothing anywhere would say so. Nothing the store itself writes is shaped like that; a
 * hand-made request is, which is the case worth refusing.
 */
t('a key naming choices the book does not offer is refused, not truncated', () => {
  const paperback = { sku: 'x-softcover', kind: 'print', contents: ['parts'] }
  assert.equal(printVariant(paperback, 'parts.black.gold'), null)
})
t('no offer at all is refused rather than defaulted', () => {
  assert.equal(printVariant(null, 'parts.black.gold'), null)
})

/* ─── what a line is, once it is paid for ─── */

t('a printed book and a good ship; a file and an unlock do not', () => {
  assert.equal(ships({ kind: 'print' }), true)
  assert.equal(ships({ kind: 'good' }), true)
  assert.equal(ships({ kind: 'download' }), false)
  assert.equal(ships({ kind: 'book' }), false)
})
t('a printed copy opens nothing online; only a book unlock does', () => {
  assert.equal(opensOnline({ kind: 'print' }), false)
  assert.equal(opensOnline({ kind: 'download' }), false)
  assert.equal(opensOnline({ kind: 'book' }), true)
})
t('a printed copy carries files only where its format says it includes them', () => {
  assert.equal(carriesFiles({ kind: 'print', includes: ['pdf'] }), true)
  assert.equal(carriesFiles({ kind: 'print', includes: [] }), false)
  assert.equal(carriesFiles({ kind: 'print' }), false)
  assert.equal(carriesFiles({ kind: 'download' }), true)
})

/* ─── where the store ships, and what it costs ─── */

const RULES = shippingRules({ countries: ['US', 'GB', 'CA'], default: 15, overrides: { US: 5 }, methods: [
  { level: 'standard', label: 'Standard', days: '5-8' },
  { level: 'express', label: 'Express', plus: 12, days: '1-3' },
] })

t('the declared countries are the ones it ships to', () => {
  assert.deepEqual(RULES.countries, ['US', 'GB', 'CA'])
  assert.equal(shipsTo(RULES, 'US'), true)
  assert.equal(shipsTo(RULES, 'gb'), true)          /* a code is a code whatever its case */
})
t('a country outside the list is refused, and quotes no rate', () => {
  assert.equal(shipsTo(RULES, 'FR'), false)
  assert.deepEqual(ratesFor(RULES, 'FR'), [])
})
t('a country override beats the default, and a method adds to it', () => {
  const us = ratesFor(RULES, 'US')
  assert.deepEqual(us.map((r) => r.amount), [500, 1700])      /* $5, then $5 + $12 */
  const gb = ratesFor(RULES, 'GB')
  assert.deepEqual(gb.map((r) => r.amount), [1500, 2700])     /* the default, then the default + $12 */
})
/* a blacklist is the other way of saying it, and must land on the same kind of answer */
t('an exclude list ships everywhere else', () => {
  const r = shippingRules({ exclude: ['RU', 'BY'], default: 10 })
  assert.equal(shipsTo(r, 'RU'), false)
  assert.equal(shipsTo(r, 'FR'), true)
  assert.equal(r.countries.includes('ZZ'), false)             /* Stripe's placeholder is never a destination */
})
t('a country code Checkout does not know is reported, not silently dropped', () => {
  const r = shippingRules({ countries: ['US', 'XX'], default: 10 })
  assert.equal(r.countries.includes('XX'), false)
  assert.equal(r.issues.some((i) => i.includes('XX')), true)
})
t('a rule with no default price says so', () => {
  assert.equal(shippingRules({ countries: ['US'] }).issues.some((i) => /default price/.test(i)), true)
})
t('every country the rules allow is one Stripe will ship to', () => {
  assert.equal(RULES.countries.every((c) => STRIPE_COUNTRIES.includes(c)), true)
})

/* ─── the spine: two lines of foil, and a hard limit between them ─── */

t('a title and edition that fit say so', () => {
  const s = spineWords('The Kybalion', '', 'Modern Edition')
  assert.equal(s.fits, true)
  assert.equal(s.edition, 'MODERN EDITION')
})
t('a spine title past the foil\'s room does not fit', () => {
  const s = spineWords('A Title Considerably Longer Than The Foil Allows', '', 'Modern Edition')
  assert.equal(s.fits, false)
  assert.equal(s.title.length + s.edition.length > SPINE_MAX, true)
})
t('the block\'s shorter spine title is used in place of a long one', () => {
  const s = spineWords('A Title Considerably Longer Than The Foil Allows', 'Short Title', 'Modern Edition')
  assert.equal(s.title, 'Short Title')
  assert.equal(s.fits, true)
})
/* `room` is what the admin's field counts against, so it has to be the edition's cost subtracted
   from the limit and not the limit itself */
t('the room left is the limit less the edition line', () => {
  const s = spineWords('X', '', 'Modern Edition')
  assert.equal(s.room, SPINE_MAX - 'MODERN EDITION'.length)
})
t('middots and underscores are not spine characters', () => {
  assert.equal(spineWords('The_Kybalion · Revised', '', 'Ed').title, 'The Kybalion Revised')
})

/* ─── a proof is a note beside the sale, never a condition of it ─── */

const EDITIONS = { editions: { parts: { edition: 'abc123def456' }, full: { edition: '0f0f0f0f0f0f' } } }

t('an edition never proofed reads "never"', () => {
  assert.equal(proofState({ proofed: {} }, EDITIONS, 'parts'), 'never')
})
t('an edition proofed at the edition that is set reads "proofed"', () => {
  assert.equal(proofState({ proofed: { parts: 'abc123def456' } }, EDITIONS, 'parts'), 'proofed')
})
/* the one that matters: a changed word makes a NEW edition id, and the old proof no longer
   describes what would be printed — but the book stays on sale, which is why this is a word and
   not a boolean */
t('a word changed after the proof reads "stale", and nothing about it is a refusal', () => {
  assert.equal(proofState({ proofed: { parts: 'anolderedition' } }, EDITIONS, 'parts'), 'stale')
})
t('contents with no edition set at all reads "unset"', () => {
  assert.equal(proofState({ proofed: { summary: 'whatever' } }, EDITIONS, 'summary'), 'unset')
})

console.log(bad ? `sell-rules: ${n - bad} passed, ${bad} failed` : `sell-rules: ${n} passed, 0 failed`)
process.exit(bad ? 1 : 0)
