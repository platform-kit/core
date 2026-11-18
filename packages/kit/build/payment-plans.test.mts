/*
 * PAYMENT PLANS AND FIXED TERMS, AS THE CATALOGUE COMPILES THEM (openspec: payment-plans).
 *
 * Each way of paying is an offer of its own, at the price the file wrote, carrying its commitment;
 * every refusal names its file and field; and an offer that declares none of it compiles to the
 * record it had before any of this existed — which is the assertion that makes the change safe.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asStore } from './store/index.mjs'
import { compileCatalog } from './catalog.mjs'
import { graceMinutes } from './commitments.mjs'

let pass = 0
const t = async (name: string, fn: () => Promise<void> | void) => { await fn(); pass++; console.log('  ok  ' + name) }

async function catalogOf(files: Record<string, string>, site: any = null) {
  const root = await mkdtemp(join(tmpdir(), 'plans-'))
  const dir = join(root, 'content/store/products')
  await mkdir(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name + '.md'), `---\n${body.trim()}\n---\nBody\n`)
  try { return await compileCatalog({ store: asStore(root), root, site }) } finally { await rm(root, { recursive: true, force: true }) }
}
const refused = async (files: Record<string, string>, re: RegExp, site: any = null) =>
  assert.rejects(() => catalogOf(files, site), (e: any) => { assert.match(e.message, re); return true })

const MEMBERSHIP = `
title: Coaching
sku: coaching
key: c0ac0001
kind: membership
tier: tier-3
rank: 3
billing: subscription
period: monthly
price: 2000`

console.log('\nPAYMENT PLANS AND FIXED TERMS\n')

await t('three terms in one product file: five ways to buy, at the prices written', async () => {
  const { offers } = await catalogOf({ coaching: MEMBERSHIP + `
terms:
  - months: 3
    full: 5400
    monthly: 2000
  - months: 6
    full: 10000
    monthly: 1800
    then: monthly
  - months: 12
    full: 18000
changes:
  upgrade: anytime
  downgrade: term-end
missed:
  restrict: immediately
  cancelBookings: 24h` })
  const ways = Object.values(offers).filter((o: any) => o.commitment?.of === 'coaching')
  assert.equal(ways.length, 5)
  const by = (sku: string) => offers[sku] as any
  assert.equal(by('coaching--3m-full').unit_amount, 540000)
  assert.equal(by('coaching--3m-full').billing, 'once')
  assert.deepEqual(by('coaching--3m-full').commitment, { of: 'coaching', plan: 'full', payments: 1, months: 3, then: 'end', missed: { restrict: 'immediately', cancel_bookings_after_minutes: 1440 } })
  assert.equal(by('coaching--6m-monthly').unit_amount, 180000)
  assert.equal(by('coaching--6m-monthly').billing, 'subscription')
  assert.equal(by('coaching--6m-monthly').period, 'monthly')
  assert.equal(by('coaching--6m-monthly').commitment.payments, 6)
  assert.equal(by('coaching--6m-monthly').commitment.then, 'monthly')
  assert.equal(by('coaching--6m-monthly').tier, 'tier-3')
  assert.equal(by('coaching--12m-monthly'), undefined, 'the 12-month term has no monthly option')
  assert.deepEqual(by('coaching').terms.map((x: any) => [x.months, !!x.full, !!x.monthly, x.then]), [[3, true, true, 'end'], [6, true, true, 'monthly'], [12, true, false, 'end']])
  assert.deepEqual(by('coaching').changes, { upgrade: 'anytime', downgrade: 'term-end' })
  assert.match(by('coaching--3m-full').key, /^[0-9a-f]{8}$/)
  assert.notEqual(by('coaching--3m-full').key, by('coaching--3m-monthly').key)
})

await t('a course in three payments: a monthly subscription of three, granting the course', async () => {
  const { offers } = await catalogOf({ course: `
title: Programme
sku: programme
key: c0a5e001
kind: course
billing: once
price: 4500
plans:
  - payments: 3
    each: 1600` })
  const plan = offers['programme--plan-3'] as any
  assert.equal(plan.unit_amount, 160000)
  assert.equal(plan.billing, 'subscription')
  assert.equal(plan.kind, 'course')
  assert.deepEqual(plan.commitment, { of: 'programme', plan: 'monthly', payments: 3, months: null, then: 'end', missed: { restrict: 'immediately', cancel_bookings_after_minutes: null } })
  assert.deepEqual((offers.programme as any).plans, [{ payments: 3, each: 160000, sku: 'programme--plan-3' }])
  assert.equal((offers.programme as any).unit_amount, 450000)
})

await t('a membership sold in terms alone', async () => {
  const { offers } = await catalogOf({ c: `
title: Mentorship
sku: mentorship
key: c0ac0002
kind: membership
tier: tier-2
rank: 2
terms:
  - months: 3
    full: 3000` })
  assert.equal((offers.mentorship as any).terms_only, true)
  assert.equal((offers['mentorship--3m-full'] as any).unit_amount, 300000)
})

await t('an offer with none of it is unchanged', async () => {
  const { offers } = await catalogOf({ coaching: MEMBERSHIP })
  assert.deepEqual(Object.keys(offers), ['coaching'])
  const o = offers.coaching as any
  for (const k of ['plans', 'terms', 'changes', 'missed', 'commitment', 'terms_only']) assert.equal(k in o, false, k)
})

await t('the refusals', async () => {
  const course = (extra: string) => ({ c: `title: P\nsku: p\nkey: c0a5e002\nkind: course\nbilling: once\nprice: 100\n${extra}` })
  await refused(course('plans:\n  - payments: 1\n    each: 50'), /payments "1" — a whole number, two or more/)
  await refused(course('plans:\n  - payments: 3\n    each: 0'), /each "0"/)
  await refused(course('plans:\n  - payments: 3\n    each: 40\n  - payments: 3\n    each: 45'), /two plans of 3 payments/)
  await refused(course('terms:\n  - months: 3\n    full: 50'), /terms and changes are a membership's/)
  await refused(course('missed:\n  restrict: soon\nplans:\n  - payments: 2\n    each: 60'), /missed.restrict "soon"/)
  await refused(course('missed:\n  cancelBookings: tomorrow\nplans:\n  - payments: 2\n    each: 60'), /missed.cancelBookings "tomorrow"/)
  await refused(course('missed:\n  cancelBookings: 24h\nplans:\n  - payments: 2\n    each: 60'), /sessions module off/, { modules: { sessions: false } })
  await refused(course('missed:\n  restrict: never'), /has no plans or terms/)
  await refused({ g: `title: Mug\nsku: mug\nkey: c0a5e003\nkind: good\nbilling: once\nprice: 10\nplans:\n  - payments: 2\n    each: 6` }, /not offered on something that ships/)
  await refused({ s: MEMBERSHIP + `\nplans:\n  - payments: 2\n    each: 6` }, /plans are for something bought once/)
  await refused({ s: MEMBERSHIP + `\nterms:\n  - months: 3` }, /neither full nor monthly/)
  await refused({ s: MEMBERSHIP + `\nterms:\n  - months: 3\n    full: 10\n  - months: 3\n    full: 12` }, /two terms of 3 months/)
  await refused({ s: MEMBERSHIP + `\nterms:\n  - months: 1.5\n    full: 10` }, /months "1.5"/)
  await refused({ s: MEMBERSHIP + `\nterms:\n  - months: 3\n    full: 10\n    then: forever` }, /then "forever"/)
  await refused({ s: MEMBERSHIP + `\nchanges:\n  upgrade: sometimes` }, /changes.upgrade "sometimes"/)
  await refused({ s: `title: M\nsku: m\nkey: c0ac0003\nkind: membership\ntier: tier-1\nrank: 1\nterms:\n  - months: 3\n    full: 10\n    then: monthly` }, /no open-ended monthly price to continue at/)
})

await t('a minimum term that rolls on monthly: the monthly price is kept for the term to continue at, never sold alone', async () => {
  const { offers } = await catalogOf({ coaching: MEMBERSHIP + `
termsOnly: true
terms:
  - months: 3
    full: 6000
    monthly: 2400
    then: monthly` })
  const parent: any = Object.values(offers).find((o: any) => o.sku === 'coaching')
  assert.equal(parent.terms_only, true)
  assert.equal(parent.unit_amount, 200000, 'the price a term continues at is still in the catalogue')
  assert.equal(parent.billing, 'subscription')
  const { waysToPay } = await import('../src/lib/payment-plans.js')
  const ways = waysToPay({ sku: 'coaching', billing: 'subscription', price: 2000, termsOnly: true, terms: [{ months: 3, full: 6000, monthly: 2400, then: 'monthly' }] })
  assert.deepEqual(ways.map((w: any) => w.plan), ['full', 'monthly'], 'the page offers the term, not the open-ended price')
})

await t('termsOnly is refused where nothing could continue at its price, or there are no terms', async () => {
  await refused({ coaching: MEMBERSHIP + `\ntermsOnly: true\nterms:\n  - months: 3\n    full: 6000` }, /no term continues monthly/)
  await refused({ coaching: MEMBERSHIP + `\ntermsOnly: true` }, /it has none/)
})

await t('a grace period reads as minutes', () => {
  assert.equal(graceMinutes('24h'), 1440)
  assert.equal(graceMinutes('3d'), 4320)
  assert.equal(graceMinutes('off'), null)
  assert.equal(graceMinutes(undefined), null)
  assert.equal(graceMinutes('0h'), undefined)
})

console.log(`\n${pass} passed\n`)
