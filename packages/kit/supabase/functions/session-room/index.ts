/*
 * The way into a booking's video room, behind the JWT: `admit { uid }` — the booking read through the
 * caller's own client (its policy says who may), the window checked (425 early, 410 over), the caller's
 * side (the host by host_id / provider_id, else the attendee), and the provider's credentials for that
 * person and that booking alone — the host's with the room's controls; `record { uid }` and `end { uid }`
 * for the host (or an administrator) alone. Never a forwardable link: the token is minted here, per call.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { json, preflight, getUser, admin } from '../_shared/lib.ts'
import { rolesOf, isProvider } from '../_shared/roles.ts'
import { deliverSchedulingEvent } from '../_shared/scheduling-events.ts'
import { typeFor, videoOf, videoIdOf } from '../_shared/cal.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in first' }, 401)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const uid = String(body?.uid ?? ''), action = String(body?.action ?? 'admit')
  /* the booking through the caller's own client: its policy (the people on it, an administrator) is the check */
  const mine = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: b } = await mine.from('bookings').select('uid, user_id, host_id, provider_id, event, type, status, start_at, end_at, room, seat_of, where, title, name').eq('uid', uid).maybeSingle()
  if (!b) return json({ error: 'not your booking', code: 'not-yours' }, 403)
  const s = await typeFor(b.event, { any: true })
  const v = s ? (videoOf(s) as any) : null
  if (!v || videoIdOf(s) !== 'livekit') return json({ error: 'this session has no room on the site', code: 'no-room' }, 404)
  if (!['accepted', 'pending', 'ended'].includes(b.status)) return json({ error: 'this session is cancelled', code: 'over' }, 410)
  const { data: prof } = await admin.from('profiles').select('role, display_name, email').eq('id', user.id).maybeSingle()
  const callerRoles = await rolesOf(user.id)
  const role: 'host' | 'attendee' = b.host_id === user.id || b.provider_id === user.id || (isProvider(callerRoles) && b.user_id !== user.id) ? 'host' : 'attendee'
  if (action === 'record' || action === 'end') {
    if (role !== 'host') return json({ error: 'the host\'s alone', code: 'not-host' }, 403)
    if (action === 'record') { try { return json({ ok: true, ...(await v.record(b)) }) } catch (e) { return json({ error: String((e as any)?.message ?? e), code: 'record' }, 502) } }
    await v.end(b).catch(() => {})
    /* the room ended by the host: the row says so now; the provider's own notification lands over it */
    await admin.from('bookings').update({ status: 'ended', followup_at: new Date(Date.now() + 5 * 6e4).toISOString(), updated_at: new Date().toISOString() }).eq('uid', uid)
    await deliverSchedulingEvent('MEETING_ENDED', uid).catch((e) => console.warn('scheduling webhook', String(e)))
    return json({ ok: true })
  }
  const r = await v.admit(b, { id: user.id, name: prof?.display_name || b.name || '', email: prof?.email || user.email || '' }, role)
  if (!r) return json({ error: 'no room', code: 'no-room' }, 404)
  if (r.early) return json({ error: 'the room opens fifteen minutes before', code: 'early', opens: r.opens }, 425)
  if (r.over) return json({ error: 'this session has ended', code: 'over' }, 410)
  return json({ url: r.url, token: r.token, ttl: r.ttl, room: r.room, role, start_at: b.start_at, end_at: b.end_at, title: b.title, record: !!s?.record, mock: !!v.mock() })
})
