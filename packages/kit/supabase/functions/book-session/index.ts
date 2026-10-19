/*
 * POST { event, start, timeZone, notes?, phone?, reschedule? } → { booking }
 * — books a session for the signed-in reader, or moves one (`reschedule`: the uid
 * of theirs), on whoever schedules the type. The judge decides first: the type is
 * theirs (tier), the week's or month's allowance has room (the one being moved is
 * not counted), and a paid session has a credit — bought as it was booked through
 * checkout (the Stripe webhook books it the moment payment lands, and leaves the
 * credit if that failed, so a "your session is paid — pick a time" comes here). A
 * refusal names why; a time that went in the meantime comes back as 409 `taken`,
 * and nothing is spent. A native move by the reader must respect the type's
 * minimum notice (403 `too-soon`); a host or an administrator may move at any time.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isProvider, isAdmin } from '../_shared/roles.ts'
import { judge, schedulerIdOf, typeFor, forRank, videoOf } from '../_shared/cal.ts'
import { sessionMail } from '../_shared/session-mail.ts'
import { deliverSchedulingEvent } from '../_shared/scheduling-events.ts'
import { mayReader, pageOf, lengthChosen } from '../_shared/sessions/page.js'
import { guestEmail, mayBookAsGuest } from '../_shared/sessions/guest-booking.js'
import { makeBooking, moveBooking } from '../_shared/booking.ts'
import { coaching as siteCoaching } from '../_shared/pipe/site.js'
import { fresh } from '../_shared/compiled.ts'   /* the compiled artefacts, re-read within a few seconds of a publish */

/* whether this account is one of a type's hosts: named by its address, or a member of its team */
async function hostsType(s: any, userId: string): Promise<boolean> {
  const emails = (s.hosts || []).map((e: unknown) => String(e).toLowerCase()).filter(Boolean)
  if (emails.length) {
    const { data } = await admin.from('profiles').select('id').eq('id', userId).in('email', emails).maybeSingle()
    return !!data
  }
  if (s.team) { const { data } = await admin.from('team_members').select('user_id').eq('team', s.team).eq('user_id', userId).maybeSingle(); return !!data }
  return false
}

Deno.serve(async (req) => {
  await fresh()
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await getUser(req)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const action = typeof body?.action === 'string' ? body.action : ''
  if (!user && (action === 'accept' || action === 'decline' || Array.isArray(body?.for) || body?.reschedule)) return json({ error: 'sign in first' }, 401)
  if (!user && siteCoaching.requireAuthToBook !== false) return json({ error: 'sign in first' }, 401)
  /*
   * THE HOST'S WORD ON A BOOKING THAT WAS WAITING FOR IT. It is here rather than in a function of
   * its own because saying yes IS the booking being made — the invitation, the room, the week of
   * chat all follow from it, and they are all written here.
   *
   * Only the host of that booking, or an administrator. A decline frees the time (the hold goes),
   * tells the reader, and leaves a paid credit UNSPENT — they did not get the session, so they have
   * not used their credit, and nobody should have to ask for it back.
   */
  if (action === 'accept' || action === 'decline') {
    const uid = String(body?.uid ?? '')
    if (!uid) return json({ error: 'which booking', code: 'unknown' }, 400)
    const { data: row } = await admin.from('bookings').select('uid, host_id, status, event, credit_id').eq('uid', uid).maybeSingle()
    if (!row) return json({ error: 'no such booking', code: 'unknown' }, 404)
    const staff = row.host_id === user.id || (await rolesOf(user.id)).includes('admin')
    if (!staff) return json({ error: 'the host says', code: 'not-host' }, 403)
    /* a booking already settled is not settled again: two taps on Accept must not send two letters */
    if (row.status !== 'pending') return json({ error: 'that one has been answered', code: 'settled', booking: { uid, status: row.status } }, 409)
    if (action === 'accept') {
      await admin.from('bookings').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('uid', uid)
      const s = await typeFor(row.event, { any: true })
      /* everything a booking gets the moment it is real: the room, the invitation, the week of chat */
      if (s) {
        const v = videoOf(s) as any
        if (v) { const { data: b2 } = await admin.from('bookings').select('*').eq('uid', uid).maybeSingle(); if (b2 && !b2.join_url) { const r = v.room(b2); await admin.from('bookings').update({ join_url: r.join_url, room: r.ref }).eq('uid', uid) } }
      }
      await sessionMail('session-booked', uid).catch((e) => console.warn('session-booked mail', String(e)))
      await deliverSchedulingEvent('BOOKING_CREATED', uid).catch(() => {})
      return json({ ok: true, booking: { uid, status: 'accepted' } })
    }
    /* THE TIME GOES BACK the moment it is declined: the hold is what kept anybody else off it */
    await admin.from('bookings').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('uid', uid)
    await admin.rpc('booking_release', { p_uid: uid })
    await sessionMail('session-declined', uid).catch((e) => console.warn('session-declined mail', String(e)))
    await deliverSchedulingEvent('BOOKING_CANCELLED', uid).catch(() => {})
    return json({ ok: true, booking: { uid, status: 'rejected' } })
  }
  const event = String(body?.event ?? ''), start = String(body?.start ?? '')
  if (!event || Number.isNaN(Date.parse(start))) return json({ error: 'an event and a start time' }, 400)
  if (Date.parse(start) < Date.now()) return json({ error: 'that time has passed', code: 'past' }, 400)
  const timeZone = typeof body.timeZone === 'string' && body.timeZone ? body.timeZone : 'UTC'
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) : ''
  const responseIn = typeof body.response === 'string' && /^[0-9a-f-]{36}$/i.test(body.response) ? body.response : null
  const moving = typeof body.reschedule === 'string' && body.reschedule ? body.reschedule : null
  /* the length they chose, where the type offers several; one it does not offer falls back to its default */
  const minutesIn = Number(body.minutes) > 0 ? Math.round(Number(body.minutes)) : 0
  /* how many sessions of a run, where the type offers one */
  const countIn = Number(body.count) > 0 ? Math.round(Number(body.count)) : 0
  if (!user) {
    const email = guestEmail(body.email)
    if (!email) return json({ error: 'a valid email address is required', code: 'email' }, 400)
    const v = await judge(event, null, email, null)
    if (!v.ok) return json({ error: v.reason, code: v.reason, next: (v as any).next ?? null, allowance: (v as any).allowance ?? null, sku: v.session?.sku ?? null }, v.reason === 'unpaid' ? 402 : 403)
    const s = v.session
    if (!mayBookAsGuest(siteCoaching.requireAuthToBook, s.requires)) return json({ error: 'this session is not available to guests', code: 'guest' }, 403)
    const priced = lengthChosen(s, minutesIn).sku || s.sku
    if (priced) return json({ error: 'a paid session is booked through checkout', code: 'checkout', sku: priced }, 402)
    if (schedulerIdOf(s) === 'native') {
      if ((!s.hosts?.length && !s.team) || !(s.duration > 0)) return json({ error: 'this type has no host or no length yet', code: 'no-host' }, 503)
      if (s.where?.kind === 'phone' && !s.where.number && !phone) return json({ error: 'a phone number', code: 'phone' }, 400)
    }
    try {
      const made = await makeBooking(s, { start, attendee: { email, name: '', timeZone }, user_id: null, notes, phone, credit: null, response: responseIn, minutes: minutesIn, count: countIn })
      return json({ booking: { uid: made.uid, start: made.start_at, end: made.end_at, title: made.title, join_url: made.join_url, where: made.where } })
    } catch (e) {
      const msg = String((e as any)?.message ?? e), code = String((e as any)?.code ?? '')
      if (code === 'full') return json({ error: 'this is as many as fit', code: 'full', span: (e as any).span, limit: (e as any).limit }, 409)
      const taken = code === 'taken' || /slot|available|already|booked|conflict/i.test(msg) || (e as any)?.status === 409
      return json({ error: `${schedulerIdOf(s)}: ${msg}`, code: taken ? 'taken' : code || schedulerIdOf(s) }, taken ? 409 : 502)
    }
  }
  /* WHAT THEY ANSWERED ON THE WAY IN, if the type asked. Checked to be THEIRS and of THIS type's
     form before it is written down: a response id is a thing somebody can type, and a booking
     carrying somebody else's answers would show the host the wrong person's. */
  const { data: prof } = await admin.from('profiles').select('email, display_name, role').eq('id', user.id).maybeSingle()
  const email = user.email ?? prof?.email ?? ''
  const name = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? prof?.display_name ?? '') as string
  /* a host books for people: the invitees by email, no judge, no credit, nothing charged; the row says who made it */
  const forList: string[] = Array.isArray(body?.for) ? body.for.map((e: unknown) => String(e || '').trim().toLowerCase()).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) : []
  if (Array.isArray(body?.for)) {
    const callerRoles = await rolesOf(user.id)
    if (!isProvider(callerRoles)) return json({ error: 'a host books for people', code: 'not-host' }, 403)
    if (moving) return json({ error: 'a move is the booking\'s own', code: 'for' }, 400)
    const s = await typeFor(event)
    if (!s) return json({ error: 'unknown session', code: 'unknown' }, 404)
    /* A HOST BOOKS FOR PEOPLE ON THEIR OWN TYPES: no judge and no credit is a host's gift of their own
       time, not a way for any provider to hand out another host's paid sessions */
    if (!isAdmin(callerRoles) && !(await hostsType(s, user.id))) return json({ error: 'a host books for people', code: 'not-host' }, 403)
    const invitees = [...new Set(forList)]
    if (!invitees.length) return json({ error: 'someone to book for', code: 'for' }, 400)
    if (s.seats > 0 && invitees.length > s.seats) return json({ error: 'more than the seats', code: 'seats', seats: s.seats }, 400)
    if (schedulerIdOf(s) === 'native' && ((!s.hosts?.length && !s.team) || !(s.duration > 0))) return json({ error: 'this type has no host or no length yet', code: 'no-host' }, 503)
    const { data: accounts } = await admin.from('profiles').select('id, email, display_name').in('email', invitees)
    const attendees = invitees.map((e) => { const a = (accounts ?? []).find((p: any) => String(p.email).toLowerCase() === e); return { email: e, name: a?.display_name || '', user_id: a?.id || null, timeZone } })
    const first = attendees[0]
    try {
      const made = await makeBooking(s, { start, attendee: first, user_id: first.user_id, notes, phone, credit: null, forOthers: { attendees, made_by: user.id, made_by_name: name || email, host: typeof body.host === 'string' && body.host ? body.host : (s.hosts || []).includes(email.toLowerCase()) ? user.id : null } })   /* the caller takes it when they are among the type's hosts */
      return json({ booking: { uid: made.uid, start: made.start_at, end: made.end_at, title: made.title, join_url: made.join_url, where: made.where, attendees: invitees } })
    } catch (e) {
      const msg = String((e as any)?.message ?? e), code = String((e as any)?.code ?? '')
      /* a cap reached is its own answer: the reader is told WHICH, because "that time has gone" and
         "the week is full" lead to opposite next moves */
      if (code === 'full') return json({ error: 'this is as many as fit', code: 'full', span: (e as any).span, limit: (e as any).limit }, 409)
      const taken = code === 'taken' || /slot|available|already|booked|conflict/i.test(msg) || (e as any)?.status === 409
      return json({ error: `${schedulerIdOf(s)}: ${msg}`, code: taken ? 'taken' : code || schedulerIdOf(s) }, taken ? 409 : 502)
    }
  }
  let role: 'reader' | 'host' | 'admin' = 'reader', owner = user.id
  if (moving) {
    const { data: row } = await admin.from('bookings').select('uid, user_id, host_id, provider_id, event, status, start_at').eq('uid', moving).maybeSingle()
    if (!row) return json({ error: 'not your booking' }, 403)
    if (row.user_id === user.id) role = 'reader'
    else if (row.host_id === user.id || row.provider_id === user.id) role = 'host'
    else if (isAdmin(await rolesOf(user.id))) role = 'admin'
    else return json({ error: 'not your booking' }, 403)
    if (row.event !== event) return json({ error: 'a booking is moved, not changed' }, 400)
    if (!['accepted', 'pending'].includes(row.status)) return json({ error: 'that booking is over', code: 'over-with' }, 400)
    owner = row.user_id ?? user.id
  }
  const v = await judge(event, owner, email, moving, minutesIn)
  if (!v.ok) return json({ error: v.reason, code: v.reason, next: (v as any).next ?? null, allowance: (v as any).allowance ?? null, sku: v.session?.sku ?? null }, v.reason === 'unpaid' ? 402 : 403)
  const s = v.session
  if (schedulerIdOf(s) === 'native') {
    if ((!s.hosts?.length && !s.team) || !(s.duration > 0)) return json({ error: 'this type has no host or no length yet', code: 'no-host' }, 503)
    if (s.where?.kind === 'phone' && !s.where.number && !phone) return json({ error: 'a phone number', code: 'phone' }, 400)
    if (moving && role === 'reader') {
      /* ONE RULE, shared with the row that draws the button (_shared/sessions/page.js) */
      const { data: row } = await admin.from('bookings').select('start_at, status').eq('uid', moving).maybeSingle()
      const may = mayReader(s, 'reschedule', row?.start_at, Date.now(), row?.status)
      if (!may.ok) return json({ error: may.why === 'never' ? 'this one cannot be moved here' : may.why === 'past' ? 'that session has been and gone' : 'too soon to move', code: may.why === 'too-soon' ? 'too-soon' : may.why, hours: may.hours }, 403)
    }
  }
  try {
    /* a move spends nothing: the credit that made the booking stays spent */
    const made = moving ? await moveBooking(s, moving, start, { email, role }, owner) : await makeBooking(s, { start, attendee: { email, name, timeZone }, user_id: user.id, notes, phone, credit: v.credit, response: responseIn, minutes: minutesIn, count: v.credit ? 0 : countIn })
    return json({ booking: { uid: made.uid, start: made.start_at, end: made.end_at, title: made.title, join_url: made.join_url, where: made.where } })
  } catch (e) {
    /* a time that went while they chose: the scheduler's own word says so; anything else is its failure */
    const msg = String((e as any)?.message ?? e), code = String((e as any)?.code ?? '')
    if (code === 'full') return json({ error: 'this is as many as fit', code: 'full', span: (e as any).span, limit: (e as any).limit }, 409)
    const taken = code === 'taken' || /slot|available|already|booked|conflict/i.test(msg) || (e as any)?.status === 409
    return json({ error: `${schedulerIdOf(s)}: ${msg}`, code: taken ? 'taken' : code || schedulerIdOf(s) }, taken ? 409 : 502)
  }
})
