/*
 * COMMITMENTS, against the real database (openspec: payment-plans).
 *
 * What it proves, each in the database where the rule lives:
 *   a payment is counted once, however many times it is reported;
 *   a missed payment holds access back at once where the offer says so — the entitlement goes
 *   inactive and a purchase is suspended — and paying gives both back;
 *   an offer that keeps access until retries end keeps it at the miss;
 *   a provider's later "past due" report cannot quietly give access back while it is held;
 *   in default, the rest is owed and recorded, and access stays off;
 *   the last payment ends the commitment and says what follows;
 *   a buyer reads only their own commitments, and cannot write one.
 * Everything is made inside a transaction and rolled back.
 */
import pg from 'pg'
import { requireStack, skip } from './test-stack.mjs'
const URL = (requireStack('payment-plans') as any).db

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: string|undefined) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nCOMMITMENTS\n')
const client = new pg.Client({ connectionString: URL })
try { await client.connect() } catch (e: any) { skip('payment-plans', 'the stack\'s database does not answer (' + e.message.slice(0, 60) + ')') }
const q = (sql: string, args: any[] = []) => client.query(sql, args).then((r: { rows: any }) => r.rows)
const one = async (sql: string, args: any[] = []) => (await q(sql, args))[0]
let sp = 0
const as = async (uid: any, sql: string, args: any[] = []) => {
  const name = 'as_' + (++sp)
  await q('savepoint ' + name)
  await q('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ sub: uid, role: 'authenticated' })])
  await q('set local role authenticated')
  try { const rows = await q(sql, args); await q('reset role'); await q('release savepoint ' + name); return rows }
  catch (e) { await q('rollback to savepoint ' + name).catch(() => {}); await q('reset role').catch(() => {}); throw e }
}
const user = async (email: string) => (await one(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, '', now(), now(), now()) returning id`, [email])).id

await q('begin')
try {
  const buyer = await user('plan-buyer@example.com')
  const other = await user('plan-other@example.com')

  /* A 6-MONTH MONTHLY TERM ON A MEMBERSHIP, access through the subscription's entitlement */
  await q(`insert into public.subscriptions (id, user_id, status, sku, key, plan_amount) values ('sub_plan_1', $1, 'active', 'coaching--6m-monthly', 'aaaa0001', 180000)`, [buyer])
  await q(`insert into public.entitlements (user_id, kind, key, source, source_id, tier, active) values ($1, 'class', 'subscribed', 'subscription', 'sub_plan_1', 'tier-3', true)`, [buyer])
  const open = { user_id: buyer, sku: 'coaching--6m-monthly', of_sku: 'coaching', plan: 'monthly', term_months: 6, payments_total: 6, amount_minor: 180000,
    currency: 'usd', then: 'monthly', restrict: 'immediately', cancel_bookings_after_minutes: 1440, subscription_id: 'sub_plan_1', entitlement_source_id: 'sub_plan_1', opened_by: 'sub_plan_1:1' }
  const id1 = (await one(`select public.commitment_open($1::jsonb) as id`, [open])).id
  const id2 = (await one(`select public.commitment_open($1::jsonb) as id`, [open])).id
  ok('opening twice is one commitment', id1 === id2)

  const p1 = (await one(`select public.commitment_paid('sub_plan_1', 'first') as r`)).r
  const p1again = (await one(`select public.commitment_paid('sub_plan_1', 'first') as r`)).r
  ok('a payment is counted', p1.counted === true && p1.payments_made === 1)
  ok('the same payment reported again is not counted twice', p1again.counted === false)
  ok('one payment of six is not finished', p1.finished === false)

  const m = (await one(`select public.commitment_missed('sub_plan_1') as r`)).r
  const m2 = (await one(`select public.commitment_missed('sub_plan_1') as r`)).r
  const ent = async () => (await one(`select active from public.entitlements where user_id = $1 and source_id = 'sub_plan_1'`, [buyer])).active
  ok('a missed payment is new once', m.newly === true && m.restricted === true && m2.newly === false)
  ok('access stops at once', (await ent()) === false)
  ok('while held, access is held', (await one(`select public.commitment_holds($1, 'sub_plan_1') as h`, [buyer])).h === true)
  ok('it is binding: payments are still to make', !!(await one(`select (public.commitment_binding('sub_plan_1')).id as id`)).id)

  const p2 = (await one(`select public.commitment_paid('sub_plan_1', 'in_2') as r`)).r
  ok('paying restores', p2.restored === true && (await ent()) === true)
  ok('and releases the hold', (await one(`select public.commitment_holds($1, 'sub_plan_1') as h`, [buyer])).h === false)
  const row = await one(`select status, missed_at, payments_made from public.commitments where id = $1`, [id1])
  ok('the commitment is active again with two made', row.status === 'active' && row.missed_at === null && row.payments_made === 2)

  for (const ref of ['in_3', 'in_4', 'in_5']) await q(`select public.commitment_paid('sub_plan_1', $1)`, [ref])
  const last = (await one(`select public.commitment_paid('sub_plan_1', 'in_6') as r`)).r
  ok('the last payment finishes it and says what follows', last.finished === true && last.then === 'monthly')
  ok('a finished commitment is no longer binding', !(await one(`select (public.commitment_binding('sub_plan_1')).id as id`)).id)
  ok('and is ended', (await one(`select status from public.commitments where id = $1`, [id1])).status === 'ended')

  /* A COURSE IN THREE PAYMENTS, access through a purchase — and a default */
  const [{ id: purchase }] = await q(`insert into public.purchases (user_id, sku, key, kind, status, amount_total, currency) values ($1, 'programme', 'bbbb0001', 'course', 'paid', 160000, 'usd') returning id`, [buyer])
  await q(`insert into public.subscriptions (id, user_id, status, sku, key, plan_amount) values ('sub_plan_2', $1, 'active', 'programme--plan-3', 'bbbb0002', 160000)`, [buyer])
  await q(`select public.commitment_open($1::jsonb)`, [{ user_id: buyer, sku: 'programme--plan-3', of_sku: 'programme', plan: 'monthly', payments_total: 3, amount_minor: 160000, currency: 'usd',
    restrict: 'immediately', subscription_id: 'sub_plan_2', purchase_id: purchase, entitlement_source_id: 'cs_plan_2', opened_by: 'sub_plan_2:1' }])
  await q(`insert into public.entitlements (user_id, kind, key, source, source_id, active) values ($1, 'class', 'paid', 'purchase', 'cs_plan_2', true)`, [buyer])
  await q(`select public.commitment_paid('sub_plan_2', 'first')`)
  await q(`select public.commitment_missed('sub_plan_2')`)
  const status = async () => (await one(`select status from public.purchases where id = $1`, [purchase])).status
  ok('a missed instalment suspends the purchase', (await status()) === 'suspended')
  const d = (await one(`select public.commitment_default('sub_plan_2') as r`)).r
  ok('in default, the rest is owed', d.newly === true && d.owed_minor === 320000)
  ok('and access stays off', (await status()) === 'suspended')
  await q(`select public.commitment_paid('sub_plan_2', 'in_2')`)
  ok('paying a defaulted commitment gives access back', (await status()) === 'paid')

  /* AN OFFER THAT KEEPS ACCESS UNTIL RETRIES END */
  await q(`insert into public.subscriptions (id, user_id, status, sku, key, plan_amount) values ('sub_plan_3', $1, 'active', 'p--plan-2', 'cccc0001', 5000)`, [buyer])
  await q(`insert into public.entitlements (user_id, kind, key, source, source_id, active) values ($1, 'class', 'paid', 'purchase', 'cs_plan_3', true)`, [buyer])
  await q(`select public.commitment_open($1::jsonb)`, [{ user_id: buyer, sku: 'p--plan-2', of_sku: 'p', plan: 'monthly', payments_total: 2, amount_minor: 5000, currency: 'usd',
    restrict: 'after-retries', subscription_id: 'sub_plan_3', entitlement_source_id: 'cs_plan_3', opened_by: 'sub_plan_3:1' }])
  await q(`select public.commitment_paid('sub_plan_3', 'first')`)
  const kept = (await one(`select public.commitment_missed('sub_plan_3') as r`)).r
  const active3 = (await one(`select active from public.entitlements where source_id = 'cs_plan_3'`)).active
  ok('access kept at the miss when the offer says after retries', kept.newly === true && kept.restricted === false && active3 === true)
  await q(`select public.commitment_default('sub_plan_3')`)
  ok('and stopped when retries end', (await one(`select active from public.entitlements where source_id = 'cs_plan_3'`)).active === false)

  /* WHO MAY READ AND WRITE */
  ok('a buyer reads their own', (await as(buyer, `select count(*)::int as n from public.commitments`))[0].n === 3)
  ok('another reads none of them', (await as(other, `select count(*)::int as n from public.commitments`))[0].n === 0)
  let refused = false
  try { await as(buyer, `update public.commitments set owed_minor = 0`) } catch { refused = true }
  ok('a buyer cannot clear what they owe', refused)
  let called = true
  try { await as(buyer, `select public.commitment_paid('sub_plan_2', 'forged')`) } catch { called = false }
  ok('a buyer cannot report their own payment', called === false)
} finally {
  await q('rollback').catch(() => {})
  await client.end()
}
console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
