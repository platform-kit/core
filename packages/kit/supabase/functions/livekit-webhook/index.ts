/*
 * LiveKit's notifications, for the site's own video rooms: the room started (the first person in) →
 * started_at; the room finished → ended and the follow-up five minutes on; a recording landed →
 * the row's path and time, exactly as a pulled one, or the failure's reason. Trust is the SDK's
 * check of the Authorization header (a JWT over the body's sha256, keyed by the API secret) — the
 * body is never believed on its own. A retry is harmless: every write is idempotent on the row.
 */
import { json, admin } from '../_shared/lib.ts'
import { deliverSchedulingEvent } from '../_shared/scheduling-events.ts'
import { video } from '../_shared/cal.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const ev = await (video('livekit') as any).event(req)
  if (!ev) return json({ ok: true, ignored: true })
  if (ev.refused) return json({ error: ev.refused }, 400)
  if (!ev.ref) return json({ ok: true, ignored: true })
  /* a room is named by a booking: a name that is not one is not put into a filter */
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(ev.ref))) return json({ ok: true, ignored: true })
  /* the room is the booking's uid, or a group's seat: every booking of that room moves together */
  const { data: rows } = await admin.from('bookings').select('uid, status, started_at, end_at, event, seat_of, followup_at').or(`uid.eq.${ev.ref},seat_of.eq.${ev.ref},room.eq.${ev.ref}`)
  if (!rows?.length) return json({ ok: true, ignored: true })
  const now = new Date().toISOString()
  for (const b of rows) {
    if (ev.kind === 'started' && !b.started_at) { await admin.from('bookings').update({ started_at: now, updated_at: now }).eq('uid', b.uid); await deliverSchedulingEvent('MEETING_STARTED', b.uid).catch((e) => console.warn('scheduling webhook', String(e))) }
    if (ev.kind === 'ended' && b.status !== 'cancelled') await admin.from('bookings').update({ status: 'ended', ...(b.followup_at ? {} : { followup_at: new Date(Date.now() + 5 * 6e4).toISOString() }), updated_at: now }).eq('uid', b.uid)
    if (ev.kind === 'ended' && b.status !== 'cancelled') await deliverSchedulingEvent('MEETING_ENDED', b.uid).catch((e) => console.warn('scheduling webhook', String(e)))
    if (ev.kind === 'recording') {
      /* under the room's own folder or the booking's, never a path the event names elsewhere */
      const named = typeof ev.path === 'string' && !ev.path.includes('..') && (ev.path.startsWith(ev.ref + '/') || ev.path.startsWith(b.uid + '/')) ? ev.path : null
      const path = named || `${b.uid}/recording.mp4`
      if (ev.failure) await admin.from('bookings').update({ recording_state: 'failed', recording_error: ev.failure, updated_at: now }).eq('uid', b.uid)
      else { const { error } = await admin.from('bookings').update({ recording_path: path, recording_at: now, recording_state: null, recording_error: null, updated_at: now }).eq('uid', b.uid); if (error) console.warn('livekit-webhook: the recording row', error.message) }
    }
  }
  return json({ ok: true, kind: ev.kind, rows: rows.length })
})
