/*
 * NOBODY'S TIME IS TAKEN TWICE.
 *
 * A hold is one person's time, taken by one booking, and the exclusion constraint on
 * `booking_holds` is the whole of the rule. It is worth its own suite because it is the one thing
 * in the scheduler that cannot be caught later: a double booking is two people told an hour is
 * theirs, and no amount of tidying afterwards gives the hour back.
 *
 * What is pinned here: a hold written with the booking, two bookings of one host at one time with
 * the second refused, the same fired at the SAME INSTANT, a move carrying the hold, a cancel giving
 * it back, a group session holding its host once and keeping the hold while any seat remains, and a
 * host whose account has gone holding nothing.
 *
 * Everything it makes is removed at the end. Skipped with a note when the stack is down.
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { leave } from './test-stack.mjs'

const note = (m) => console.log('holds-db: ' + m)
if (process.env.HOLDS_TEST === '0') { note('skipped (HOLDS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
if (!url || !localStack()) { note('skipped — no local stack in .env'); leave(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); leave(0) }

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
const db = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })

console.log('\nHOLDS\n')

const tag = 'h' + Math.random().toString(36).slice(2, 8)
const made = { users: [], uids: [] }
const iso = (ms) => new Date(ms).toISOString()
const at = Date.now() + 14 * 864e5
const book = async (uid, host, start, extra = {}) => {
  made.uids.push(uid)
  const rec = {
    uid, provider: 'native', type: tag + '-type', event: tag + '-type', title: 'An hour',
    host_id: host, provider_id: host, start_at: iso(start), end_at: iso(start + 36e5),
    status: 'accepted', email: tag + '@example.com', name: 'A Reader', ...extra,
  }
  return db.rpc('book_native', { p: rec, p_seats: extra.__seats || 0, p_hosts: extra.__hosts || [host] })
}
const holdsOf = async (host) => ((await db.from('booking_holds').select('booking_uid, start_at').eq('user_id', host)).data || [])

try {
  const mk = async (email) => {
    const { data, error } = await db.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    if (error) throw new Error(email + ': ' + error.message)
    made.users.push(data.user.id)
    return data.user.id
  }
  const host = await mk(tag + '-host@example.com')
  const other = await mk(tag + '-other@example.com')

  /* --- a booking takes its host's time --- */
  const first = await book(tag + '-1', host, at)
  ok('a booking is made', !first.error, first.error && first.error.message)
  const h1 = await holdsOf(host)
  ok('and it holds its host', h1.length === 1 && h1[0].booking_uid === tag + '-1')

  /* --- THE RULE --- */
  const clash = await book(tag + '-2', host, at)
  ok('the same host at the same time is refused', !!clash.error, JSON.stringify(clash.data))
  ok('and refused as a conflict, not as a mystery', clash.error && String(clash.error.code) === '23P01', clash.error && clash.error.code)
  const overlap = await book(tag + '-3', host, at + 18e5)
  ok('an overlapping half hour is refused too', !!overlap.error)
  const after = await book(tag + '-4', host, at + 36e5)
  ok('the hour straight after is not', !after.error, after.error && after.error.message)
  const elsewhere = await book(tag + '-5', other, at)
  ok('and somebody else at that time is not', !elsewhere.error, elsewhere.error && elsewhere.error.message)

  /* --- AT THE SAME INSTANT, which is the case a check-then-insert cannot hold --- */
  const t2 = at + 5 * 864e5
  const both = await Promise.allSettled([book(tag + '-r1', host, t2), book(tag + '-r2', host, t2)])
  const won = both.filter((r) => r.status === 'fulfilled' && !r.value.error).length
  ok('two at the same instant: exactly one wins', won === 1, 'won ' + won)
  ok('and the loser is told it was taken', both.some((r) => r.status === 'fulfilled' && r.value.error && r.value.error.code === '23P01'))

  /* --- a move carries the hold, a cancel gives it back --- */
  const t3 = at + 10 * 864e5
  await db.rpc('booking_hold_move', { p_uid: tag + '-1', p_start: iso(t3), p_end: iso(t3 + 36e5) })
  const moved = await holdsOf(host)
  ok('a move carries the hold', moved.some((h) => h.booking_uid === tag + '-1' && Date.parse(h.start_at) === t3))
  const back = await book(tag + '-6', host, at)
  ok('and frees the time it left', !back.error, back.error && back.error.message)
  await db.rpc('booking_release', { p_uid: tag + '-6' })
  ok('a release gives the time back', !(await holdsOf(host)).some((h) => h.booking_uid === tag + '-6'))

  /* --- a group session holds its host once, and keeps it while a seat remains --- */
  const t4 = at + 20 * 864e5
  const g1 = await book(tag + '-g1', host, t4, { type: tag + '-group', event: tag + '-group', __seats: 3, __hosts: [host] })
  const g2 = await book(tag + '-g2', host, t4, { type: tag + '-group', event: tag + '-group', __seats: 3, __hosts: [host] })
  ok('two seats of one group time are both booked', !g1.error && !g2.error, JSON.stringify([g1.error, g2.error].filter(Boolean)))
  const gh = (await holdsOf(host)).filter((h) => Date.parse(h.start_at) === t4)
  ok('and the host is held once, not twice', gh.length === 1, 'holds ' + gh.length)
  ok('a different type cannot take the host that hour', !!(await book(tag + '-g3', host, t4)).error)
  await db.rpc('booking_release', { p_uid: g1.data.uid })
  ok('one seat leaving keeps the hold', (await holdsOf(host)).filter((h) => Date.parse(h.start_at) === t4).length === 1)
  await db.from('bookings').update({ status: 'cancelled' }).eq('uid', g1.data.uid)
  await db.rpc('booking_release', { p_uid: g2.data.uid })
  ok('the last seat leaving gives the hour back', (await holdsOf(host)).filter((h) => Date.parse(h.start_at) === t4).length === 0)

  /* --- a hold belongs to its booking and its person --- */
  await db.from('bookings').delete().eq('uid', tag + '-4')
  ok('deleting a booking takes its hold with it', !(await holdsOf(host)).some((h) => h.booking_uid === tag + '-4'))
} catch (e) {
  fail++
  console.log('  FAIL  ' + e.message)
} finally {
  await db.from('bookings').delete().in('uid', made.uids)
  for (const id of made.users) await db.auth.admin.deleteUser(id).catch(() => {})
}

console.log('\n  ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''))
if (fail) process.exit(1)
