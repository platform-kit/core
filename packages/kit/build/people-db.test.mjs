/*
 * THE ONE PAGE RESPONSIBLE FOR EVERY ACCOUNT, against the local stack.
 *
 * Two reads and one writer. The reads answer an administrator and nobody else — which is a policy
 * and not a page, so it is checked here rather than trusted to a rail that happens not to show a
 * link. The writer is set_roles, which already existed and already holds the rule worth holding:
 * never the last administrator away.
 *
 * Everything it makes is removed at the end. Skipped with a note when the stack is down
 * (PEOPLE_TEST=0 skips it too).
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('people-db: ' + m)
if (process.env.PEOPLE_TEST === '0') { note('skipped (PEOPLE_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const as = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return { sb, id: data.user.id }
}
const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })

console.log('\nPEOPLE\n')

let strangerId = null
try {
  const admin = await as('admin@example.com')
  const member = await as('member@example.com')

  /* somebody of our own, so a count can be asserted against something we put there */
  const email = 'nobody-' + Math.random().toString(36).slice(2, 8) + '@example.com'
  const { data: made, error: me } = await service.auth.admin.createUser({ email, password: 'password123', email_confirm: false })
  if (me) throw new Error('could not make an account: ' + me.message)
  strangerId = made.user.id

  /* ---- every account, not only the ones holding a role ---- */
  const all = (await admin.sb.rpc('admin_everybody', { p_q: null, p_narrow: 'all', p_limit: 5, p_offset: 0 })).data
  ok('an administrator sees every account', all && Number(all.total) > 0)
  ok('including somebody holding no role and having bought nothing',
    !!(await admin.sb.rpc('admin_everybody', { p_q: email, p_narrow: 'all', p_limit: 5, p_offset: 0 })).data.people.length)

  const staff = (await admin.sb.rpc('admin_everybody', { p_q: null, p_narrow: 'staff', p_limit: 100, p_offset: 0 })).data
  ok('narrowed to the staff, everybody listed holds a role', staff.people.every((p) => (p.roles || []).length))
  ok('and there are fewer of them than of everybody', Number(staff.total) < Number(all.total))

  const unconfirmed = (await admin.sb.rpc('admin_everybody', { p_q: null, p_narrow: 'unconfirmed', p_limit: 100, p_offset: 0 })).data
  ok('the one narrowing that is about something being wrong finds our unconfirmed account',
    unconfirmed.people.some((p) => p.id === strangerId))
  ok('and says so on the row', unconfirmed.people.find((p) => p.id === strangerId).verified === false)

  /* paging, because a site with twenty thousand readers must not be one page */
  const first = (await admin.sb.rpc('admin_everybody', { p_q: null, p_narrow: 'all', p_limit: 2, p_offset: 0 })).data
  const second = (await admin.sb.rpc('admin_everybody', { p_q: null, p_narrow: 'all', p_limit: 2, p_offset: 2 })).data
  ok('it pages', first.people.length === 2 && second.people.length === 2
    && !first.people.some((p) => second.people.some((q) => q.id === p.id)))
  ok('and the total is the whole answer, not the page', Number(first.total) === Number(all.total))

  /* ---- one person, everything the site already knows ---- */
  const buyer = (await admin.sb.rpc('admin_everybody', { p_q: 'buyer@example.com', p_limit: 1, p_offset: 0 })).data.people[0]
  ok('a customer is found by address', !!buyer)
  const one = (await admin.sb.rpc('admin_person', { p_user: buyer.id })).data
  ok('their purchases are there', Array.isArray(one.purchases) && one.purchases.length > 0)
  ok('with what each cost', one.purchases.every((p) => p.amount != null && p.sku))
  ok('their live entitlements are there', Array.isArray(one.entitlements))
  ok('their bookings are there', Array.isArray(one.bookings))
  ok('and their roles', Array.isArray(one.roles))
  /* NEVER A CARD, NEVER A BANK. Only the processor's own id, for the link out. */
  ok('nothing about a card or a bank is returned',
    !JSON.stringify(one).match(/card|iban|account_number|last4/i))

  /* ---- and nobody but an administrator reads either ---- */
  ok('a member reads nothing from the list', (await member.sb.rpc('admin_everybody', {})).data === null)
  ok('nor from one person', (await member.sb.rpc('admin_person', { p_user: buyer.id })).data === null)

  /* ---- the one write, and the rule it holds ---- */
  const gave = (await admin.sb.rpc('set_roles', { p_user: strangerId, p_roles: ['provider'] })).data
  ok('an administrator makes somebody a provider', gave && gave.ok === true, JSON.stringify(gave))
  ok('and the page sees it', ((await admin.sb.rpc('admin_person', { p_user: strangerId })).data.roles || []).includes('provider'))
  const providers = (await admin.sb.rpc('admin_everybody', { p_narrow: 'provider', p_limit: 100 })).data
  ok('the providers narrowing finds them', providers.people.some((p) => p.id === strangerId))

  /*
   * THE LAST ADMINISTRATOR CANNOT BE REMOVED — and the test has to MAKE that situation rather
   * than assume it, and put everything back whether or not the assertion holds.
   *
   * It assumed it. DEV_ACCOUNT quietly creates a second administrator on every reset, so on any
   * machine with one the removal was ALLOWED: the assertion failed and the seeded admin was left
   * demoted, which made the next run fail somewhere else entirely for a reason that had nothing
   * to do with the code. A test that changes shared state and does not restore it has broken the
   * next run before it starts — and the restore belongs in a finally, because the run that most
   * needs it is the one that threw.
   */
  const everybody = (await admin.sb.rpc('admin_everybody', { p_narrow: 'staff', p_limit: 200 })).data
  const others = (((everybody && everybody.people) || [])).filter((p) => p.id !== admin.id && (p.roles || []).includes('admin'))
  const mine = ((await admin.sb.rpc('admin_person', { p_user: admin.id })).data || {}).roles || ['admin']
  const held = others.map((p) => ({ id: p.id, roles: p.roles || [] }))
  try {
    /* stand the others down, so the one under test really is the last */
    for (const w of held) await admin.sb.rpc('set_roles', { p_user: w.id, p_roles: w.roles.filter((r) => r !== 'admin') })
    const last = (await admin.sb.rpc('set_roles', { p_user: admin.id, p_roles: [] })).data
    ok('somebody has to be an administrator', last && last.ok === false && last.why === 'last-admin',
      JSON.stringify(last) + (held.length ? ` (${held.length} other admin(s) stood down first)` : ''))
    ok('and the administrator still holds it', ((await admin.sb.rpc('admin_person', { p_user: admin.id })).data.roles || []).includes('admin'))
  } finally {
    /* the target first: if the assertion's premise was wrong it has just been demoted, and it is
       the account every other lane signs in as */
    await admin.sb.rpc('set_roles', { p_user: admin.id, p_roles: mine })
    for (const w of held) await admin.sb.rpc('set_roles', { p_user: w.id, p_roles: w.roles })
  }
  ok('a member cannot give themselves a role',
    ((await member.sb.rpc('set_roles', { p_user: member.id, p_roles: ['admin'] })).data || {}).ok === false)
} catch (e) {
  fail++
  console.log('  FAIL  ' + (e && e.message))
} finally {
  if (strangerId) await service.auth.admin.deleteUser(strangerId).catch(() => {})
}

console.log('\npeople-db: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
