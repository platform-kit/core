/* What comes before an offer's checkout (openspec: applications-and-intro-calls): the catalogue reads an offer's
   `before` block and refuses one that names a booking type or a form it does not have, a paid call, a qualifier with
   nothing to qualify, a deadline on an offer nothing gates, and a gate on a thing that ships; and the funnel grammar
   reads `admission`. No stack: the database half is 47-admissions.sql, applied by schema.test.mts. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asStore } from './store/index.mjs'
import { compileCatalog } from './catalog.mjs'
import { normalizeRules, describeRules } from '../supabase/functions/_shared/emails/rules.js'

let pass = 0
const ok = async (name: string, fn: () => Promise<void> | void) => { await fn(); pass++; console.log('  ✔ ' + name) }

const OFFER = `sku: mentorship\nkey: 0a1b2c3d\ntitle: Mentorship\nkind: membership\nbilling: subscription\nperiod: monthly\nprice: 100\ntier: t1\nrank: 1`
async function catalogOf(offer: string, { sessions = {} as Record<string, string>, forms = [] as string[], site = null as any } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pk-admissions-'))
  for (const d of ['content/store/products', 'content/sessions', 'content/forms']) await mkdir(join(root, d), { recursive: true })
  await writeFile(join(root, 'content/store/products/mentorship.md'), `---\n${offer.trim()}\n---\nBody\n`)
  for (const [slug, body] of Object.entries(sessions)) await writeFile(join(root, `content/sessions/${slug}.md`), `---\n${body.trim()}\n---\n`)
  for (const f of forms) await writeFile(join(root, `content/forms/${f}.md`), `#! title = ${f}\n\nq* = TextInput(| question = Why?)\n`)
  try { return await compileCatalog({ store: asStore(root), root, site }) } finally { await rm(root, { recursive: true, force: true }) }
}
const refused = (offer: string, re: RegExp, extra: any = {}) => assert.rejects(() => catalogOf(offer, extra), (e: any) => { assert.match(e.message, re); return true })
const CALL = { 'intro-call': `title: Intro\nduration: 20\nrequires: anyone\nurl: https://cal.com/someone/intro-call` }

await ok('no before block: the offer has no gate', async () => {
  const c = await catalogOf(OFFER)
  assert.equal(c.offers.mentorship.before, undefined)
})
await ok('an application with review, and an optional call, compiles to a gate', async () => {
  const c = await catalogOf(OFFER + `\nbefore:\n  apply: application\n  review: person\n  call: intro-call`, { sessions: CALL, forms: ['application'] })
  assert.deepEqual(c.offers.mentorship.before, { call: 'intro-call', callRequired: false, apply: 'application', review: 'person', openDays: 0, gated: true })
})
await ok('an optional call alone does not gate checkout', async () => {
  const c = await catalogOf(OFFER + `\nbefore:\n  call: intro-call`, { sessions: CALL })
  assert.equal(c.offers.mentorship.before.gated, false)
})
await ok('a required call gates it, and open-for sets a deadline', async () => {
  const c = await catalogOf(OFFER + `\nbefore:\n  call: intro-call\n  call-required: true\n  open-for: 14d`, { sessions: CALL })
  assert.equal(c.offers.mentorship.before.gated, true)
  assert.equal(c.offers.mentorship.before.openDays, 14)
})
await ok('refused: a call that names no booking type', () => refused(OFFER + `\nbefore:\n  call: nothing`, /no published booking type has that slug/))
await ok('refused: a paid call', () => refused(OFFER + `\nbefore:\n  call: paid-call`, /is a paid booking type/, { sessions: { 'paid-call': `title: Paid\nduration: 60\nrequires: anyone\nurl: https://cal.com/someone/paid\nsku: mentorship` } }))
await ok('refused: an application that names no form', () => refused(OFFER + `\nbefore:\n  apply: missing`, /there is no content\/forms\/missing\.md/))
await ok('refused: review with no application', () => refused(OFFER + `\nbefore:\n  call: intro-call\n  review: person`, /no application is named/, { sessions: CALL }))
await ok('refused: call-required with no call', () => refused(OFFER + `\nbefore:\n  apply: application\n  call-required: true`, /no call is named/, { forms: ['application'] }))
await ok('refused: a deadline on an offer nothing gates', () => refused(OFFER + `\nbefore:\n  call: intro-call\n  open-for: 7d`, /nothing gates this offer/, { sessions: CALL }))
await ok('refused: a deadline that is not a number of days', () => refused(OFFER + `\nbefore:\n  apply: application\n  open-for: two weeks`, /a number of days/, { forms: ['application'] }))
await ok('refused: an unknown key', () => refused(OFFER + `\nbefore:\n  apply: application\n  deposit: 100`, /before\.deposit is not one of/, { forms: ['application'] }))
await ok('refused: an application on a site with forms off', () => refused(OFFER + `\nbefore:\n  apply: application`, /needs the forms module/, { forms: ['application'], site: { modules: { forms: false } } }))
await ok('the funnel grammar reads admission and says it in words', () => {
  const r = normalizeRules({ admission: 'open', 'abandoned-offer': 'mentorship' })
  assert.deepEqual(r.admission, ['open'])
  assert.match(describeRules(r).join(' '), /approved, not yet paid/)
})
console.log(`all ${pass} checks passed`)
