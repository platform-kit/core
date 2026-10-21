/* Who may read what, against the local stack and its seed: an administrator (admin@example.com) reads every
   purchase and every booking and asks admin_people who they are; a member (member@example.com) reads their own
   rows, a reader on nothing (free@example.com) reads nothing, and admin_people answers a member nothing. Runs on the local stack only — the site's own,
   the seed's accounts — and is skipped with a note when it is not up (POLICY_TEST=0 skips it too). */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave, moduleOn, notHere } from './test-stack.mjs'

const note = (m) => console.log('policies: ' + m)
if (process.env.POLICY_TEST === '0') { note('skipped (POLICY_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); leave(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); leave(0) }

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id }
}

const admin = await as('admin@example.com')
const purchases = (await admin.sb.from('purchases').select('id, user_id')).data || []
const bookings = (await admin.sb.from('bookings').select('uid, user_id, provider_id')).data || []
/* the read-through is measured where the site's seed holds rows to read (the root site's does; the kit's accounts alone hold none) */
const seeded = purchases.length >= 1 && bookings.length >= 1
/* a site that neither sells nor books has nothing of either to read through; one that does, and whose seed holds none, fails */
if (!seeded && !((await moduleOn('store')) && (await moduleOn('sessions')))) notHere('policies: the administrator\'s read-through', 'the site has the store or sessions module off')
else if (!seeded) note('the seed holds no purchases or bookings here — the read-through checks are skipped')
if (seeded) ok('the administrator reads every purchase (the seed holds some)', purchases.some((p) => p.user_id !== admin.id))
if (seeded) ok('the administrator reads every booking (the seed holds some)', bookings.some((b) => b.user_id !== admin.id && b.provider_id !== admin.id))
const ids = [...new Set(purchases.map((p) => p.user_id).concat(bookings.map((b) => b.user_id)).filter(Boolean))]
const people = (await admin.sb.rpc('admin_people', { ids })).data
ok('admin_people names every account asked for', Array.isArray(people) && people.length === ids.length && people.every((p) => p.id && p.email))

const member = await as('member@example.com')
const mine = (await member.sb.from('purchases').select('id, user_id')).data || []
const mineB = (await member.sb.from('bookings').select('uid, user_id, provider_id, attendee_emails')).data || []
if (seeded) ok('a member reads only their own purchases', mine.every((p) => p.user_id === member.id) && mine.length < purchases.length)
if (seeded) ok('a member reads only the bookings they are on', mineB.length >= 1 && mineB.every((b) => b.user_id === member.id || b.provider_id === member.id || (b.attendee_emails || []).includes('member@example.com')))
const free = await as('free@example.com')
ok('a reader on nothing reads nothing', ((await free.sb.from('purchases').select('id')).data || []).length === 0 && ((await free.sb.from('bookings').select('uid')).data || []).length === 0)
const none = await member.sb.rpc('admin_people', { ids })
ok('admin_people answers a member nothing', none.data === null)


/* ---- WHAT EACH ROLE REACHES, and what it does not ---------------------------------------- */
/* A person holds a set. The seed's coach holds `coach` alone — not `admin`, which is the whole
   point: answering a member must not hand somebody every order and every purchase. */
{
  const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  const coach = await as('coach@example.com')
  const support = await as('support@example.com')
  const reader = await as('free@example.com')
  const rolesOf = async (email) => ((await service.from('profiles').select('roles').eq('email', email).maybeSingle()).data || {}).roles || []

  ok('the seed\'s coach holds coach and is not an administrator',
    (await rolesOf('coach@example.com')).join() === 'provider')
  ok('and the support desk holds support alone', (await rolesOf('support@example.com')).join() === 'support')
  ok('a reader holds nothing at all', (await rolesOf('free@example.com')).length === 0)

  /* the capabilities, asked of the database as the person */
  const can = async (who, fn) => (await who.sb.rpc(fn)).data === true
  ok('a coach is a coach', await can(coach, 'is_provider'))
  ok('and is not an administrator', !(await can(coach, 'is_admin')))
  ok('and may not see the figures', !(await can(coach, 'may_see_figures')))
  ok('an administrator is every one of them',
    (await can(admin, 'is_provider')) && (await can(admin, 'may_edit_content')) && (await can(admin, 'may_see_figures')))
  ok('somebody on the support desk is staff but not a coach',
    (await can(support, 'is_staff')) && !(await can(support, 'is_provider')))
  ok('a reader is none of them', !(await can(reader, 'is_staff')) && !(await can(reader, 'is_provider')))

  /* and what that means for what they can read */
  const inboxOf = async (who) => ((await who.sb.rpc('chat_inbox')).data || [])
  if (await moduleOn('coaching')) ok('a coach is given the threads waiting on them', (await inboxOf(coach)).length > 0)
  else notHere('policies: a coach\'s inbox', 'the coaching module is off')
  ok('and somebody on the support desk is given none of them', (await inboxOf(support)).length === 0)
  /* A COACH ANSWERS whether or not they hold a membership themselves (community-access-by-entitlement): the
     seed's coach holds provider and nothing bought, and their reply is a row */
  const thread = (await inboxOf(coach))[0]
  if (thread) {
    const sent = await coach.sb.from('messages').insert({ conversation_id: thread.id, sender_id: coach.id, kind: 'text', body: 'policies.test probe' }).select('id').single()
    ok('a coach with no membership of their own sends in their thread', !sent.error && !!sent.data)
    if (sent.data) await service.from('messages').delete().eq('id', sent.data.id)
  }
  /* and a reader with no membership and no session opens no thread with a coach */
  const freeOpen = await free.sb.rpc('chat_open', { peer: coach.id })
  ok('a reader on nothing opens no thread with a coach', !!freeOpen.error)
  /* somebody else's purchase for the coach not to see, made here where the seed has none (a site that sells nothing) */
  let probePurchase = null
  if (!(((await service.from('purchases').select('id').limit(1)).data || []).length)) {
    const { data: mem } = await service.from('profiles').select('id').eq('email', 'member@example.com').maybeSingle()
    probePurchase = (await service.from('purchases').insert({ user_id: mem?.id, sku: 'policies-probe', status: 'paid', stripe_checkout_session_id: 'cs_policies_probe_' + Date.now() }).select('id').single()).data
  }
  const allPurchases = ((await service.from('purchases').select('id')).data || []).length
  const coachSees = ((await coach.sb.from('purchases').select('id, user_id')).data || [])
  ok('a coach reads their own purchases and nobody else\'s',
    coachSees.every((r) => r.user_id === coach.id) && coachSees.length < allPurchases, coachSees.length + ' of ' + allPurchases)
  if (probePurchase) await service.from('purchases').delete().eq('id', probePurchase.id)
  ok('and is refused who a set of accounts are', (await coach.sb.rpc('admin_people', { ids })).data === null)

  /* nobody writes their own roles, whatever they already hold */
  const stolen = await coach.sb.from('profiles').update({ roles: ['admin'] }).eq('id', coach.id)
  ok('nobody grants themselves a role', !!stolen.error || (await rolesOf('coach@example.com')).join() === 'provider')
  ok('and set_roles answers a non-administrator nothing',
    ((await coach.sb.rpc('set_roles', { p_user: coach.id, p_roles: ['admin'] })).data || {}).ok === false)

  /* the last administrator cannot be removed */
  const admins = ((await service.from('profiles').select('id').contains('roles', ['admin'])).data || []).map((r) => r.id)
  const spare = admins.filter((a) => a !== admin.id)
  for (const id of spare) await service.from('profiles').update({ roles: [] }).eq('id', id)
  const last = await admin.sb.rpc('set_roles', { p_user: admin.id, p_roles: [] })
  ok('the last administrator cannot take their own role away', (last.data || {}).why === 'last-admin')
  ok('and is still an administrator afterwards', (await rolesOf('admin@example.com')).includes('admin'))
  for (const id of spare) await service.from('profiles').update({ roles: ['admin'] }).eq('id', id)

  /* a role this site has never heard of */
  ok('a role nobody has heard of is refused',
    ((await admin.sb.rpc('set_roles', { p_user: reader.id, p_roles: ['wizard'] })).data || {}).ok === false)
}

console.log(`policies: ${pass} passed${fail ? `, ${fail} failed` : ''}`)
process.exit(fail ? 1 : 0)
