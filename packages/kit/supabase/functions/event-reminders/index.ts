/*
 * The reminders before something a space is running, to everybody who said they were coming.
 *
 * An RSVP with no consequence is a button, not an invitation: somebody presses "I'll be there" and
 * then forgets, which is the thing the press was for. So at each of the policy's hours
 * (`event-reminders`, largest first — 24 by default), once per occurrence and person and hour.
 *
 * The database decides what is owed (event_reminders_due): who is coming and who has already been
 * told are both its to know, and assembling that here would be a second opinion about both. The row
 * is written BEFORE the send, so a rerun never repeats one and a relay that refuses loses the
 * reminder rather than sending it twice — the same trade session-reminders makes.
 *
 * pg_cron asks every five minutes with the service bearer (`{ action: 'send' }`; `dry: true` lists
 * what would go without sending or writing anything).
 */
import { admin, json, preflight } from '../_shared/lib.ts'
import { POLICY } from '../_shared/marketing.ts'
import { sendEmail } from '../_shared/email.ts'
import strings from '../_shared/emails/strings.json' with { type: 'json' }

const W = ((strings as any).session ?? {}) as Record<string, string>
const APP = () => (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
const fill = (t: string, m: Record<string, unknown>) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
const soon = (h: number) => (h >= 2 ? fill(W['in-hours'] || 'in {n} hours', { n: h }) : h === 1 ? (W['in-hour'] || 'in an hour') : fill(W['in-minutes'] || 'in {n} minutes', { n: Math.round(h * 60) }))
const first = (name: string, email: string) => (name || '').trim().split(/\s+/)[0] || (email || '').split('@')[0] || ''
/* the run's own cadence plus a little: an hour crossed longer ago than this is skipped rather than
   sent late — somebody who RSVPs twenty hours ahead gets no "in 24 hours" */
const LATE = 15

const when = (iso: string, tz: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) + (tz ? ` (${tz.replace(/_/g, ' ')})` : '')
  } catch { return iso }
}
/* where it is, in a sentence: online is a link, a place is an address and how to find it */
function placeWord(place: any) {
  const p = place || {}
  if (p.kind === 'place') return [p.address, p.details].filter(Boolean).join(' — ')
  if (p.kind === 'link') return p.url || 'Online'
  return 'Online'
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!bearer || bearer !== (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) return json({ error: 'the service bearer' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* none */ }
  const hours: number[] = Array.isArray(body.hours) ? body.hours : ((POLICY as any)['event-reminders'] ?? [24])
  if (!hours.length) return json({ sent: 0, reminders: [] })

  const { data: due, error } = await admin.rpc('event_reminders_due', { p_hours: hours, p_late_minutes: LATE })
  if (error) return json({ error: error.message }, 500)
  const rows = (due ?? []) as any[]
  if (body.dry) return json({ due: rows.length, reminders: rows.map((r) => ({ to: r.email, title: r.title, hours: r.hours, starts_at: r.starts_at })) })

  let sent = 0
  const failed: string[] = []
  for (const r of rows) {
    /* written first: a relay that refuses loses this one rather than sending it twice */
    const { error: e1 } = await admin.from('event_reminders')
      .insert({ occurrence_id: r.occurrence, user_id: r.user_id, hours: r.hours })
    if (e1) continue                                   /* somebody else's run got there */
    const link = r.space ? `${APP()}/spaces/${r.space}` : APP()
    try {
      await sendEmail(r.email, 'event-reminder', {
        name: first(r.name, r.email), title: r.title, what: r.sub || r.title,
        when: when(r.starts_at, r.zone), where: placeWord(r.place),
        join: link, manage: link, in: soon(Number(r.hours)), with: '',
      })
      sent++
    } catch (e) { failed.push(String((e as Error).message || e).slice(0, 120)) }
  }
  return json({ sent, due: rows.length, failed })
})
