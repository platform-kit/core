/*
 * A PRICE CHANGE AND THE PEOPLE ALREADY PAYING IT — the memberships module's repricings job on the test stack,
 * against Stripe test mode (openspec: payment-plans).
 *
 * The demo's Member offer says `existing: move`. A member subscribed at an older price is told once, with the
 * renewal the new price starts at (at least the notice away), and nothing else happens. When that renewal is the
 * next one, the job moves the Stripe subscription to the new price from then, through the ordinary scheduled
 * change. A member already on the new price is left alone, and one whose subscription is ending has a notice
 * already sent withdrawn. Run again, the job tells and moves nobody twice. Everything made is removed afterwards.
 */
import pg from 'pg'
import { requireStack, skip, notHere } from './test-stack.mjs'
const S = requireStack('payment-plans-repricing') as any
const sk = process.env.STRIPE_SECRET_KEY || ''
if (!/^sk_test_/.test(sk) || /^(1|true|yes|on)$/i.test(process.env.STRIPE_MOCK || '')) skip('payment-plans-repricing', 'Stripe test mode is not this stack\'s provider')

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: string | undefined) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
console.log('\nA PRICE CHANGE AND THE PEOPLE ALREADY PAYING IT\n')
const client = new pg.Client({ connectionString: S.db })
try { await client.connect() } catch (e: any) { skip('payment-plans-repricing', 'the stack\'s database does not answer (' + e.message.slice(0, 60) + ')') }
const q = (sql: string, args: any[] = []) => client.query(sql, args).then((r: { rows: any }) => r.rows)
if (!(await q(`select 1 from pg_proc where proname = 'run_repricings'`)).length) { notHere('payment-plans-repricing', 'the memberships module is off'); await client.end(); process.exit(0) }
const fnUrl = (S.functions || `${S.api}/functions/v1`).replace(/\/$/, '')
const run = async () => { const r = await fetch(`${fnUrl}/repricings`, { method: 'POST', headers: { authorization: 'Bearer ' + S.service, 'content-type': 'application/json' }, body: '{}' }); return { status: r.status, body: await r.json().catch(() => ({})) } }
const stripe = async (method: string, p: string, form: Record<string, string> = {}) => (await fetch('https://api.stripe.com/v1/' + p, {
  method, headers: { authorization: 'Bearer ' + sk, 'content-type': 'application/x-www-form-urlencoded' },
  body: method === 'GET' ? undefined : new URLSearchParams(form).toString(),
})).json()

const KEY = 'b2c3d4e5', NEW = 1200   /* the demo's Member: $12 a month */
const users: string[] = [], customers: string[] = [], products: string[] = []
const user = async (email: string) => { const [{ id }] = await q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, '', now(), now(), now()) returning id`, [email]); users.push(id); return id }
const local = (id: string, uid: string, amount: number, end: number, cancelling = false) => q(`insert into public.subscriptions (id, user_id, status, sku, key, plan_amount, current_period_start, current_period_end, cancel_at_period_end)
  values ($1, $2, 'active', 'member-monthly', $3, $4, now(), to_timestamp($5), $6)`, [id, uid, KEY, amount, end, cancelling])

try {
  /* a member paying $9 a month at Stripe, from before the price went up */
  const old = await user('pp-reprice-old@example.com')
  const cus = await stripe('POST', 'customers', { email: 'pp-reprice-old@example.com', 'metadata[platformkit_test]': 'payment-plans-repricing' })
  customers.push(cus.id)
  await stripe('POST', `payment_methods/pm_card_visa/attach`, { customer: cus.id }).then((pm: any) => stripe('POST', `customers/${cus.id}`, { 'invoice_settings[default_payment_method]': pm.id }))
  const product = await stripe('POST', 'products', { name: 'Member (old price, test)' }); products.push(product.id)
  const sub = await stripe('POST', 'subscriptions', { customer: cus.id, 'items[0][price_data][currency]': 'usd', 'items[0][price_data][unit_amount]': '900', 'items[0][price_data][recurring][interval]': 'month', 'items[0][price_data][product]': product.id })
  ok('the old-price subscription starts at Stripe', sub.status === 'active', JSON.stringify(sub.error ?? sub.status))
  await local(sub.id, old, 900, sub.current_period_end)
  /* one already on the new price, and one whose subscription is ending */
  const current = await user('pp-reprice-current@example.com'); await local('sub_pp_current', current, NEW, sub.current_period_end)
  const leaving = await user('pp-reprice-leaving@example.com'); await local('sub_pp_leaving', leaving, 900, sub.current_period_end)

  const first = await run()
  ok('the job answers the service', first.status === 200, JSON.stringify(first))
  const told = await q(`select subscription_id, status, from_amount, to_amount, effective_at from public.repricings where user_id = any($1)`, [users])
  const of = (id: string) => told.find((r: any) => r.subscription_id === id)
  ok('a member on the old price is told once, of the change from $9 to $12', !!of(sub.id) && of(sub.id).status === 'notified' && of(sub.id).from_amount === 900 && of(sub.id).to_amount === NEW, JSON.stringify(told))
  ok('…at a renewal at least the notice away', of(sub.id) && new Date(of(sub.id).effective_at).getTime() >= Date.now() + 30 * 86400_000 - 60_000, of(sub.id)?.effective_at)
  ok('a member already on the new price is left alone', !of('sub_pp_current'))
  const untouched = await stripe('GET', `subscriptions/${sub.id}`)
  ok('nothing changes at Stripe before the date', !untouched.schedule && untouched.items?.data?.[0]?.price?.unit_amount === 900)

  /* the leaving member had been told; then they cancelled */
  await q(`update public.subscriptions set cancel_at_period_end = true where id = 'sub_pp_leaving'`)
  const again = await run()
  ok('run again, nobody is told twice', again.status === 200 && again.body.told === 0 && again.body.moved === 0, JSON.stringify(again.body))
  ok('a notice to somebody now leaving is withdrawn', of('sub_pp_leaving') ? (await q(`select status from public.repricings where subscription_id = 'sub_pp_leaving'`))[0]?.status === 'dropped' : true)

  /* the date comes round: the renewal the notice named is the next one */
  await q(`update public.repricings set effective_at = to_timestamp($1) where subscription_id = $2`, [sub.current_period_end, sub.id])
  const due = await run()
  ok('when the named renewal is next, the member is moved', due.status === 200 && due.body.moved === 1, JSON.stringify(due.body))
  const live = await stripe('GET', `subscriptions/${sub.id}?expand[]=schedule`)
  const phases = live.schedule?.phases ?? []
  ok('…at Stripe, the new price from the next renewal', phases.length === 2 && phases[1]?.items?.[0]?.price && phases[0]?.end_date === sub.current_period_end, JSON.stringify(phases.map((p: any) => ({ end: p.end_date, price: p.items?.[0]?.price }))))
  if (phases[1]?.items?.[0]?.price) {
    const price = await stripe('GET', `prices/${typeof phases[1].items[0].price === 'string' ? phases[1].items[0].price : phases[1].items[0].price.id}`)
    ok('…which is the $12 price', price.unit_amount === NEW, String(price.unit_amount))
  }
  ok('…and the move is recorded', (await q(`select status from public.repricings where subscription_id = $1`, [sub.id]))[0]?.status === 'applied')
  const last = await run()
  ok('run again, nobody is moved twice', last.status === 200 && last.body.moved === 0, JSON.stringify(last.body))
} finally {
  for (const c of customers) {
    const subs = await stripe('GET', `subscriptions?customer=${c}&status=all`).catch(() => ({ data: [] }))
    for (const s of subs.data ?? []) {
      if (s.schedule) await stripe('POST', `subscription_schedules/${typeof s.schedule === 'string' ? s.schedule : s.schedule.id}/release`).catch(() => {})
      if (s.status !== 'canceled') await stripe('DELETE', `subscriptions/${s.id}`).catch(() => {})
    }
    await stripe('DELETE', `customers/${c}`).catch(() => {})
  }
  for (const p of products) await stripe('POST', `products/${p}`, { active: 'false' }).catch(() => {})
  await q(`delete from public.repricings where user_id = any($1)`, [users]).catch(() => {})
  await q(`delete from public.subscriptions where user_id = any($1)`, [users]).catch(() => {})
  await q(`delete from auth.users where id = any($1)`, [users]).catch(() => {})
  await client.end()
}
console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
