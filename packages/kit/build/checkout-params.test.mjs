/*
 * WHAT STRIPE ALREADY DOES, AND THIS STORE NEVER PASSED.
 *
 * A trial, tax, the payment methods accepted and a quantity the buyer may change: four things
 * Stripe has always offered, named in a proposal James approved, and built for none of them until
 * now. The resolution is pure (_shared/checkout-params.js) so the function and this read the same
 * arithmetic.
 *
 * THE ASSERTION THAT MATTERS MOST is the last group: an offer declaring none of them must resolve
 * to exactly what was resolved before any of this existed. A change to how everything is sold is
 * only safe if the things already being sold do not move.
 */
import { sessionParams, lineQuantity, trialDaysFor } from '../supabase/functions/_shared/checkout-params.js'
import { PAYMENT_METHODS } from './catalog.mjs'

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
console.log('\nWHAT STRIPE ALREADY DOES\n')

/* ---------------------------------------------------------------- the trial */
ok('a subscription takes its trial from its offer',
  sessionParams([{ trial: 14 }], 'subscription').trial === 14)
ok('a one-off takes none, whatever the record says',
  sessionParams([{ trial: 14 }], 'payment').trial === 0)
ok('no trial declared is no trial',
  sessionParams([{}], 'subscription').trial === 0)

/* ------------------------------------------------------------------ the tax */
ok('any offer asking for automatic tax turns it on',
  sessionParams([{}, { tax: { automatic: true } }]).automaticTax === true)
ok('…which is deliberate: a mixed cart must not quietly go untaxed',
  sessionParams([{ tax: { automatic: true } }, { tax: {} }]).automaticTax === true)
ok('a registration is asked for the same way',
  sessionParams([{ tax: { registration: true } }]).taxId === true)
ok('and the two are separate',
  eq(sessionParams([{ tax: { automatic: true } }]), { trial: 0, automaticTax: true, taxId: false, methods: [] }))
ok('neither is on by default',
  sessionParams([{}, {}]).automaticTax === false && sessionParams([{}, {}]).taxId === false)

/* ------------------------------------------------------- the payment methods */
ok('one offer\'s methods are the session\'s',
  eq(sessionParams([{ payments: ['card', 'link'] }]).methods, ['card', 'link']))
ok('a cart takes the INTERSECTION, so no method is offered an offer refuses',
  eq(sessionParams([{ payments: ['card', 'link', 'alipay'] }, { payments: ['card', 'link'] }]).methods, ['card', 'link']))
ok('an offer naming none accepts whatever the shop does',
  eq(sessionParams([{ payments: ['card', 'link'] }, {}]).methods, ['card', 'link']))
ok('an empty intersection is empty, which means Stripe\'s own default',
  eq(sessionParams([{ payments: ['alipay'] }, { payments: ['link'] }]).methods, []))
ok('nothing is accepted by default — the list is empty unless a file says otherwise',
  eq(sessionParams([{}, {}]).methods, []))
ok('and the methods a shop may name are one list, not a free-for-all',
  PAYMENT_METHODS.includes('card') && PAYMENT_METHODS.includes('link') && !PAYMENT_METHODS.includes('sepa_debit'),
  PAYMENT_METHODS.join(','))

/* ------------------------------------------------------------- the quantity */
ok('a line is adjustable where the offer says so',
  eq(lineQuantity({ adjustable: { min: 1, max: 10 } }), { enabled: true, minimum: 1, maximum: 10 }))
ok('its bounds default sensibly',
  eq(lineQuantity({ adjustable: {} }), { enabled: true, minimum: 1, maximum: 99 }))
ok('an offer that said nothing gets no adjustable quantity',
  lineQuantity({}) === null && lineQuantity(null) === null)
ok('bounds that make no sense are refused rather than sent',
  lineQuantity({ adjustable: { min: 5, max: 2 } }) === null && lineQuantity({ adjustable: { min: 0 } }) === null)

/* ---------------------------------------------- one trial per person per tier */
{
  const tiers = { k_week: 'inner', k_month: 'inner', k_outer: 'outer' }
  const tierOf = (k) => tiers[k] ?? null
  const weekly = { key: 'k_week', trial: 14 }
  const monthly = { key: 'k_month', trial: 14 }

  ok('a first trial is offered', trialDaysFor(weekly, [], tierOf) === 14)
  ok('having trialled, the same offer gives none', trialDaysFor(weekly, ['k_week'], tierOf) === 0)
  ok('THE POINT: a weekly and a monthly of ONE tier share one trial',
    trialDaysFor(monthly, ['k_week'], tierOf) === 0)
  ok('another tier still has its own', trialDaysFor({ key: 'k_outer', trial: 7 }, ['k_week'], tierOf) === 7)
  ok('cancel and rejoin grants nothing, which is what this is for',
    trialDaysFor(weekly, ['k_week', 'k_week'], tierOf) === 0)
  ok('an offer with no trial is unaffected', trialDaysFor({ key: 'k_week' }, [], tierOf) === 0)
  ok('a subscription with no tier is counted per offer instead',
    trialDaysFor({ key: 'solo', trial: 5 }, ['other'], () => null) === 5 &&
    trialDaysFor({ key: 'solo', trial: 5 }, ['solo'], () => null) === 0)
}

/* ------------------------- THE ONE THAT MATTERS: nothing moves for an existing offer ---------- */
{
  /* the record shape catalog.mjs wrote before any of this: no trial, tax, payments or quantity */
  const asItWas = { sku: 'a-book', key: 'deadbeef', kind: 'book', billing: 'once', period: null, unit_amount: 1900, currency: 'usd', tier: null, rank: null, book: 'a-book' }
  const sub = { ...asItWas, sku: 'inner-monthly', kind: 'membership', billing: 'subscription', period: 'monthly', tier: 'inner', rank: 2, book: null }

  ok('an existing one-off resolves to nothing at all',
    eq(sessionParams([asItWas], 'payment'), { trial: 0, automaticTax: false, taxId: false, methods: [] }))
  ok('an existing subscription resolves to nothing at all',
    eq(sessionParams([sub], 'subscription'), { trial: 0, automaticTax: false, taxId: false, methods: [] }))
  ok('and neither line becomes adjustable',
    lineQuantity(asItWas) === null && lineQuantity(sub) === null)
  ok('a whole cart of existing offers adds not one parameter',
    eq(sessionParams([asItWas, sub, { ...asItWas, sku: 'b' }], 'payment'), { trial: 0, automaticTax: false, taxId: false, methods: [] }))
}

console.log(`\ncheckout params: ${pass} passed${fail ? ', ' + fail + ' FAILED' : ''}\n`)
process.exit(fail ? 1 : 0)
