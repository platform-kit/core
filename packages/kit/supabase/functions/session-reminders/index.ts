/*
 * The reminders before a session the site scheduled: at each of the policy's hours
 * (`session-reminders`, largest first — 24 and 1 by default), once per booking and hour, to the
 * reader alone, never for a cancelled session. pg_cron asks every five minutes with the service
 * bearer (`{ action: 'send' }`; `dry: true` lists what would go); a reminder whose hour has already
 * passed by more than the run's own cadence is not sent late — a booking made 20 hours ahead gets
 * the 1-hour reminder and not the 24-hour one. It also declines a booking still WAITING for the
 * host at its own start time: nobody said yes and the hour has come, so the time goes back. The row in session_reminders is written before the
 * send, so a rerun never repeats one.
 */
import { admin, json, preflight } from '../_shared/lib.ts'
import { POLICY } from '../_shared/marketing.ts'
import { sessionMail } from '../_shared/session-mail.ts'
import strings from '../_shared/emails/strings.json' with { type: 'json' }

const W = ((strings as any).session ?? {}) as Record<string, string>
const fill = (t: string, m: Record<string, unknown>) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
const soon = (h: number) => (h >= 2 ? fill(W['in-hours'] || 'in {n} hours', { n: h }) : h === 1 ? (W['in-hour'] || 'in an hour') : fill(W['in-minutes'] || 'in {n} minutes', { n: Math.round(h * 60) }))
const LATE = 15 * 6e4   /* the run's cadence plus a little: an hour crossed longer ago than this is skipped, not sent late */

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!bearer || bearer !== (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) return json({ error: 'the service bearer' }, 401)
  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const hours: number[] = Array.isArray(body.hours) ? body.hours : ((POLICY as any)['session-reminders'] ?? [24, 1])
  if (!hours.length) return json({ sent: 0, reminders: [] })
  const now = Date.now(), maxH = Math.max(...hours)
  const { data: rows } = await admin.from('bookings').select('uid, start_at').eq('provider', 'native').eq('status', 'accepted').gte('start_at', new Date(now - LATE).toISOString()).lte('start_at', new Date(now + maxH * 36e5 + LATE).toISOString())
  const { data: done } = await admin.from('session_reminders').select('booking_uid, hours').in('booking_uid', (rows ?? []).map((r: any) => r.uid))
  const had = new Set((done ?? []).map((d: any) => `${d.booking_uid}:${d.hours}`))
  const due: { uid: string; hours: number }[] = []
  for (const r of rows ?? []) for (const h of hours) {
    const at = Date.parse(r.start_at) - h * 36e5
    if (at <= now && now - at <= LATE && !had.has(`${r.uid}:${h}`)) due.push({ uid: r.uid, hours: h })
  }
  /*
   * A BOOKING STILL WAITING AT ITS OWN START TIME IS DECLINED. Nobody said yes and the hour has
   * arrived: leaving it pending would hold that time for ever and leave the reader waiting on an
   * answer that is never coming. Declining it frees the hour, tells them, and leaves a paid credit
   * unspent — which is the same thing the host clicking No does, so it goes the same way.
   *
   * It runs here because this is the thing that already wakes up every few minutes knowing which
   * sessions are about to start.
   */
  const { data: stale } = await admin.from('bookings').select('uid').eq('provider', 'native').eq('status', 'pending')
    .lte('start_at', new Date(now).toISOString()).gte('start_at', new Date(now - 30 * 864e5).toISOString())
  const lapsed = (stale ?? []).map((r: any) => r.uid)
  if (body.dry) return json({ sent: 0, reminders: due, declined: lapsed })
  for (const uid of lapsed) {
    const { data: still } = await admin.from('bookings').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('uid', uid).eq('status', 'pending').select('uid')
    if (!still?.length) continue   /* another run, or the host, got there first */
    await admin.rpc('booking_release', { p_uid: uid })
    await sessionMail('session-declined', uid).catch((e) => console.warn('session-declined', uid, String(e)))
  }
  let sent = 0
  for (const d of due) {
    const { error } = await admin.from('session_reminders').insert({ booking_uid: d.uid, hours: d.hours })
    if (error) continue   /* another run has it */
    const r = await sessionMail('session-reminder', d.uid, { in: soon(d.hours) }).catch((e) => { console.warn('session-reminder', d.uid, String(e)); return { sent: false } })
    if (r.sent) sent++
  }
  return json({ sent, reminders: due, declined: lapsed })
})
