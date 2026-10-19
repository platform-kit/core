/*
 * One way to make, move and cancel a booking whoever schedules the type: the scheduler is picked
 * by the type (`schedulerOf`), a cal.com booking is mirrored onto the row from cal.com's answer,
 * a native one is the row already — and what comes after (a paid session's credit spent, its week
 * of chat, the site's own emails for a native session) happens here, once, for book-session and
 * for the ledger (a paid session booked the moment its payment lands) alike.
 */
import { admin } from './lib.ts'
import { schedulerOf, schedulerIdOf, videoOf } from './cal.ts'
import { mirror, spendCredit, returnCredit, typeFor, type Session } from './sessions.ts'
import { sessionMail } from './session-mail.ts'
import { deliverSchedulingEvent } from './scheduling-events.ts'
const tell = (trigger: string, uid: string) => deliverSchedulingEvent(trigger, uid).catch((e) => console.warn('scheduling webhook', trigger, String(e)))

/* `status` because a booking that WAITS for the host's word is made as `pending`, and what happens
   next — which letter, what the page says — follows from it */
export type Made = { uid: string; start_at: string; end_at: string; title: string; join_url: string | null; where: any; host_id: string | null; status: string }
const ofCal = (b: any): Made => ({ uid: b.uid, start_at: b.start, end_at: b.end, title: b.title, join_url: b.meetingUrl ?? null, where: null, host_id: null, status: b.status === 'pending' ? 'pending' : 'accepted' })
const ofNative = (b: any): Made => ({ uid: b.uid, start_at: b.start_at, end_at: b.end_at, title: b.title, join_url: b.join_url ?? null, where: b.where, host_id: b.host_id, status: b.status || 'accepted' })

export type Attendee = { email: string; name: string; timeZone: string; user_id?: string | null }
/* a host's booking for others: `for` names the invitees (the first is the row's own), made_by the host, and nothing is judged, spent or charged */
export type ForOthers = { attendees: Attendee[]; made_by: string; made_by_name: string; host?: string | null }
export async function makeBooking(s: Session, o: { start: string; attendee: Attendee; user_id: string | null; notes: string; phone?: string; credit: string | null; forOthers?: ForOthers; response?: string | null; minutes?: number; count?: number; checkoutIdentity?: string; stripeCheckoutSessionId?: string }): Promise<Made> {
  const sch = schedulerOf(s) as any
  let made: Made
  const f = o.forOthers
  if (schedulerIdOf(s) === 'cal') {
    const b = await sch.book(s, {
      start: o.start, attendee: o.attendee, user_id: o.user_id, notes: o.notes,
      checkout_identity: o.checkoutIdentity, stripe_checkout_session_id: o.stripeCheckoutSessionId,
    })
    if (o.credit) await spendCredit(o.credit)
    await mirror(b, o.user_id, s, o.credit, o.checkoutIdentity, o.stripeCheckoutSessionId)
    if (f) await admin.from('bookings').update({ attendee_emails: [...new Set(f.attendees.map((a) => a.email.toLowerCase()))], made_by: f.made_by, made_by_name: f.made_by_name }).eq('uid', b.uid)
    made = ofCal(b)
  } else {
    const b = await sch.book(s, {
      start: o.start, attendee: o.attendee, attendees: f?.attendees, user_id: o.user_id, notes: o.notes,
      phone: o.phone, credit_id: o.credit, made_by: f?.made_by, made_by_name: f?.made_by_name,
      host: f?.host, minutes: o.minutes, count: o.count, checkout_identity: o.checkoutIdentity,
      stripe_checkout_session_id: o.stripeCheckoutSessionId,
    })
    if (o.credit) await spendCredit(o.credit)
    /* a video room on this site: the provider names the room and the row's Join opens the call page; every other kind of place asks nothing */
    const v = videoOf(s) as any
    if (v) { const r = v.room(b); await admin.from('bookings').update({ join_url: r.join_url, room: r.ref }).eq('uid', b.uid); b.join_url = r.join_url; b.room = r.ref }
    made = ofNative(b)
    /* A BOOKING THAT WAITS SENDS TWO DIFFERENT LETTERS: the reader is told the time is held, the
       host that somebody is waiting on them. Telling the reader "you're booked" and then declining
       is the worst version of this feature, so the word "booked" is never used until it is. */
    await sessionMail(made.status === 'pending' ? 'session-held' : 'session-booked', made.uid).catch((e) => console.warn('session mail', String(e)))
    await tell('BOOKING_CREATED', made.uid)
  }
  /* WHAT THEY ANSWERED ON THE WAY IN. Checked here rather than taken on trust: a booking carrying
     somebody else's answers would show the host the wrong person's, and a response id is a thing
     anybody can type. It must be theirs, and of the form this type actually asks. */
  if (o.response && (s as any).form) {
    const { data: resp } = await admin.from('form_responses').select('id, form, user_id').eq('id', o.response).maybeSingle()
    /* the same account on both, or a guest on both: a signed-in reader's answers never ride on a guest booking, nor a guest's on an account's */
    const theirs = resp && resp.form === (s as any).form && (resp.user_id ?? null) === (o.user_id ?? null)
    if (theirs) await admin.from('bookings').update({ response_id: resp.id }).eq('uid', made.uid)
    else console.warn('booking: a response that is not this booking\'s was offered and ignored')
  }
  return made
}

/* a move: a cal.com booking gets a new uid from cal.com (the old row marked rescheduled); a native one keeps its uid */
export async function moveBooking(s: Session, uid: string, start: string, by: { email: string; role: 'reader' | 'host' | 'admin' }, user_id: string): Promise<Made> {
  const sch = schedulerOf(s) as any
  if (schedulerIdOf(s) === 'cal') {
    const b = await sch.reschedule(uid, start, by.email, 'moved from the app')
    const { data: was } = await admin.from('bookings').select('credit_id').eq('uid', uid).maybeSingle()
    await admin.from('bookings').update({ status: 'rescheduled', updated_at: new Date().toISOString() }).eq('uid', uid)
    await mirror(b, user_id, s, null)
    const made = ofCal(b)
    /* cal.com gives a moved booking a new uid: the credit that paid for it moves with it, so a cancel
       still gives it back and the week of chat (read from the booking) is still there */
    if (was && was.credit_id) await admin.from('bookings').update({ credit_id: was.credit_id }).eq('uid', made.uid)
    return made
  }
  const b = await sch.reschedule(uid, start, by.role)
  const made = ofNative(b)
  await sessionMail('session-moved', made.uid).catch((e) => console.warn('session-moved mail', String(e)))
  await tell('BOOKING_RESCHEDULED', made.uid)
  return made
}

export async function cancelBooking(row: { uid: string; user_id: string | null; event: string | null; credit_id: string | null }, by: { email: string; role: 'reader' | 'host' | 'admin' }, reason: string) {
  const s = await typeFor(row.event, { any: true })
  const sch = s ? (schedulerOf(s) as any) : null
  if (!s || schedulerIdOf(s) === 'cal') {
    if (sch) await sch.cancel(row.uid, by.role, reason)
    await admin.from('bookings').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('uid', row.uid)
  } else {
    await sch.cancel(row.uid, by.role, reason)
    const v = videoOf(s) as any
    if (v) { const { data: b } = await admin.from('bookings').select('uid, room, seat_of').eq('uid', row.uid).maybeSingle(); if (b && !b.seat_of) await v.end(b).catch(() => {}) }
    await sessionMail('session-cancelled', row.uid).catch((e) => console.warn('session-cancelled mail', String(e)))
    await tell('BOOKING_CANCELLED', row.uid)
  }
  if (row.credit_id && s?.sku) await returnCredit(row.credit_id)
}
