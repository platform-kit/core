/*
 * A MISSED PLAN PAYMENT, AS IT TOUCHES BOOKINGS — through the sessions module's function on the test stack
 * (openspec: payment-plans).
 *
 * Two buyers with an upcoming booking each, both with a payment outstanding: one whose offer names a 24-hour grace
 * period and whose payment was missed 25 hours ago, one whose offer names none. The function tells the hosts once,
 * cancels the first buyer's booking with nothing given back and leaves the second's alone; run again, it does
 * nothing more. Everything it made is removed afterwards.
 */
import pg from 'pg'
import { requireStack, skip } from './test-stack.mjs'
const S = requireStack('payment-plans-bookings') as any

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: string|undefined) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
console.log('\nA MISSED PLAN PAYMENT AND BOOKINGS\n')
const client = new pg.Client({ connectionString: S.db })
try { await client.connect() } catch (e: any) { skip('payment-plans-bookings', 'the stack\'s database does not answer (' + e.message.slice(0, 60) + ')') }
const q = (sql: string, args: any[] = []) => client.query(sql, args).then((r: { rows: any }) => r.rows)
const fnUrl = (S.functions || `${S.api}/functions/v1`).replace(/\/$/, '')
const run = async () => { const r = await fetch(`${fnUrl}/commitment-bookings`, { method: 'POST', headers: { authorization: 'Bearer ' + S.service, 'content-type': 'application/json' }, body: '{}' }); return { status: r.status, body: await r.json().catch(() => ({})) } }

const users: string[] = []
const user = async (email: string) => { const [{ id }] = await q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, '', now(), now(), now()) returning id`, [email]); users.push(id); return id }
try {
  const late = await user('plan-late@example.com')
  const kept = await user('plan-kept@example.com')
  const soon = new Date(Date.now() + 3 * 86400_000).toISOString(), soonEnd = new Date(Date.now() + 3 * 86400_000 + 3600_000).toISOString()
  for (const [uid, who] of [['pp-late-1', late], ['pp-kept-1', kept]]) {
    await q(`insert into public.bookings (uid, user_id, email, title, start_at, end_at, status, provider, event, provider_email)
      values ($1, $2, 'x@example.com', 'An hour', $3, $4, 'accepted', 'native', null, 'host-pp@example.com')`, [uid, who, soon, soonEnd])
  }
  const open = (who: string, grace: number | null, by: string) => q(`select public.commitment_open($1::jsonb)`, [{ user_id: who, sku: 'patron-monthly--3m-monthly', of_sku: 'patron-monthly', plan: 'monthly', term_months: 3,
    payments_total: 3, amount_minor: 4000, currency: 'usd', restrict: 'immediately', cancel_bookings_after_minutes: grace, subscription_id: by, entitlement_source_id: by, opened_by: by, membership: true }])
  await open(late, 1440, 'sub_pp_late'); await open(kept, null, 'sub_pp_kept')
  await q(`update public.commitments set status = 'restricted', missed_at = now() - interval '25 hours' where user_id = any($1)`, [users])

  const first = await run()
  ok('the function answers the service', first.status === 200, JSON.stringify(first))
  const status = async (uid: string) => (await q(`select status from public.bookings where uid = $1`, [uid]))[0]?.status
  ok('past its grace period, the booking is cancelled', (await status('pp-late-1')) === 'cancelled')
  ok('with no grace period named, it is left alone', (await status('pp-kept-1')) === 'accepted')
  const rows = await q(`select user_id, hosts_told_at, bookings_cancelled_at from public.commitments where user_id = any($1)`, [users])
  const of = (id: string) => rows.find((r: any) => r.user_id === id)
  ok('the hosts were told of both', !!of(late)?.hosts_told_at && !!of(kept)?.hosts_told_at)
  ok('the cancellation is recorded once', !!of(late)?.bookings_cancelled_at && !of(kept)?.bookings_cancelled_at)
  const again = await run()
  ok('run again, it does nothing more', again.status === 200 && again.body.told === 0 && again.body.cancelled === 0, JSON.stringify(again.body))
} finally {
  await q(`delete from public.bookings where uid in ('pp-late-1', 'pp-kept-1')`).catch(() => {})
  await q(`delete from public.commitments where user_id = any($1)`, [users]).catch(() => {})
  await q(`delete from auth.users where id = any($1)`, [users]).catch(() => {})
  await client.end()
}
console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
