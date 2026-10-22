/*
 * THE MEMBER CARD'S READINGS, AGAINST THE STACK (openspec: kit-extension-model). What somebody has read, has bought
 * and where they are working, each asked through may_see_member: the person and staff are answered, anybody else is
 * answered exactly as somebody with nothing to show. And a person's purchases are one source: the card's Bought and the
 * admin's person page list the same ones in the same order.
 */
import { createClient } from '@supabase/supabase-js'
import { requireStack, moduleOn, notHere } from './test-stack.mjs'

const S = requireStack('member-panels-db')
if (!(await moduleOn('spaces'))) { notHere('member-panels-db', 'the spaces module is off: there is no member card'); process.exit(0) }
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }
const O = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(S.api, S.service, O)
const as = async (email) => { const c = createClient(S.api, S.anon, O); const { error } = await c.auth.signInWithPassword({ email, password: 'password123' }); return error ? null : c }
const idOf = async (email) => (await service.from('profiles').select('id').eq('email', email).maybeSingle()).data?.id

const buyer = await as('buyer@example.com'), member = await as('member@example.com'), admin = await as('admin@example.com')
if (!buyer || !member || !admin) { console.log('member-panels-db: the seed\'s buyer@, member@ or admin@ does not sign in'); process.exit(1) }
const buyerId = await idOf('buyer@example.com')

/* a purchase of the buyer's own, so every site has one to read whatever its seed holds */
const { data: probe } = await service.from('purchases').insert({ user_id: buyerId, email: 'buyer@example.com', sku: 'member-panels-probe', status: 'paid', stripe_checkout_session_id: 'cs_member_panels_' + Date.now(), amount_total: 100, currency: 'usd' }).select('id').single()

try {
  for (const fn of ['member_read', 'member_bought']) {
    const own = await buyer.rpc(fn, { p_user: buyerId })
    ok(`${fn}: a person reads their own`, !own.error && Array.isArray(own.data), own.error?.message)
    const staff = await admin.rpc(fn, { p_user: buyerId })
    ok(`${fn}: staff read anybody's`, !staff.error && Array.isArray(staff.data), staff.error?.message)
    const other = await member.rpc(fn, { p_user: buyerId })
    ok(`${fn}: anybody else is answered as somebody with nothing to show`, !other.error && Array.isArray(other.data) && other.data.length === 0, JSON.stringify(other.data))
  }
  const bought = (await buyer.rpc('member_bought', { p_user: buyerId })).data || []
  ok('Bought holds the person\'s paid purchase', bought.some((p) => p.sku === 'member-panels-probe'), JSON.stringify(bought).slice(0, 200))
  ok('…with nothing of a payment provider\'s or a card\'s', !JSON.stringify(bought).match(/cs_|pi_|stripe|card/i))

  const working = await member.rpc('member_working', { p_user: buyerId })
  ok('member_working: anybody else is answered as nothing', !working.error && working.data === null, JSON.stringify(working.data))

  /* one source: the card's Bought is the admin's purchases, paid, newest first, the first eight */
  const person = (await admin.rpc('admin_person', { p_user: buyerId })).data
  const fromAdmin = (person?.purchases || []).filter((p) => p.status === 'paid').slice(0, 8).map((p) => p.id)
  ok('the card and the admin list the same purchases in the same order', JSON.stringify(bought.map((p) => p.id)) === JSON.stringify(fromAdmin), `${JSON.stringify(bought.map((p) => p.id))} vs ${JSON.stringify(fromAdmin)}`)

  const direct = await member.rpc('person_purchases', { p_user: buyerId })
  ok('the one source is no client\'s to call', !!direct.error, JSON.stringify(direct.data))
} finally {
  if (probe) await service.from('purchases').delete().eq('id', probe.id)
}

console.log(fail ? `member-panels-db: ${fail} failed, ${pass} passed` : `member-panels-db: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
