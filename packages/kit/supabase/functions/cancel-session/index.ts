/*
 * POST { uid, reason? } → { ok } — cancels one of the reader's sessions on whoever
 * schedules it; POST { uid, action: 'no-show' } — the host marks the reader a
 * no-show after the time. A cancellation frees an included session's allowance by
 * the row's status; a paid session's credit comes back, so the hour can be booked
 * again (a refund, if one is owed, is a person's decision in Stripe). A native
 * session is cancelled by its reader up to the type's minimum notice (403
 * `too-soon`), by its host or an administrator at any time.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { typeFor, schedulerIdOf } from '../_shared/cal.ts'
import { mayReader } from '../_shared/sessions/page.js'
import { cancelBooking } from '../_shared/booking.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in first' }, 401)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const uid = String(body?.uid ?? '')
  const { data: row } = await admin.from('bookings').select('uid, user_id, host_id, provider_id, event, status, credit_id, start_at, end_at, run_of').eq('uid', uid).maybeSingle()
  const callerRoles = await rolesOf(user.id)
  const role: 'reader' | 'host' | 'admin' | null = !row ? null : row.user_id === user.id ? 'reader' : row.host_id === user.id || row.provider_id === user.id ? 'host' : isAdmin(callerRoles) ? 'admin' : null
  if (!row || !role) return json({ error: 'not your booking' }, 403)
  const s = await typeFor(row.event, { any: true })
  if (body?.action === 'no-show') {
    if (role === 'reader') return json({ error: 'the host marks a no-show' }, 403)
    if (!row.end_at || Date.parse(row.end_at) > Date.now()) return json({ error: 'not until the time has passed', code: 'early' }, 400)
    await admin.from('bookings').update({ no_show: true, no_show_by: user.id, status: 'ended', updated_at: new Date().toISOString() }).eq('uid', uid)
    return json({ ok: true })
  }
  if (!['accepted', 'pending'].includes(row.status)) return json({ error: 'that booking is not open', code: 'over-with' }, 400)
  /* ONE RULE, shared with the row that draws the button (_shared/sessions/page.js): a button that
     refuses when pressed is worse than no button. A host is not asked — they cancel a session they
     are giving whenever they need to. */
  if (s && schedulerIdOf(s) === 'native' && role === 'reader') {
    const may = mayReader(s, 'cancel', row.start_at, Date.now(), row.status)
    if (!may.ok) return json({ error: may.why === 'never' ? 'this one cannot be cancelled here' : may.why === 'past' ? 'that session has been and gone' : 'too soon to cancel', code: may.why === 'too-soon' ? 'too-soon' : may.why, hours: may.hours }, 403)
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : 'cancelled from the app'
  try { await cancelBooking(row, { email: user.email ?? '', role }, reason) } catch (e) { return json({ error: `${s ? schedulerIdOf(s) : 'cal'}: ${(e as any)?.message ?? e}` }, 502) }
  /*
   * THE REST OF THE RUN, where they asked for it. Cancelling one of six and being left with five is
   * sometimes exactly what somebody means and sometimes the opposite, so the page ASKS and this does
   * what was asked — never guessing from the fact that the booking belongs to a run. Only the ones
   * still to come: a run half attended is half attended.
   */
  let also = 0
  if (body?.run === true && row.run_of) {
    const { data: rest } = await admin.from('bookings').select('uid').eq('run_of', row.run_of).neq('uid', row.uid).in('status', ['accepted', 'pending']).gte('start_at', new Date().toISOString())
    for (const b2 of rest ?? []) {
      const { data: one } = await admin.from('bookings').select('*').eq('uid', b2.uid).maybeSingle()
      if (!one) continue
      try { await cancelBooking(one, { email: user.email ?? '', role }, reason); also++ } catch (e) { console.warn('the rest of the run', b2.uid, String(e)) }
    }
  }
  return json({ ok: true, ...(also ? { also } : {}) })
})
