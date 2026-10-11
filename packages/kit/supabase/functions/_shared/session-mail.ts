/*
 * The site's own emails around a session it scheduled — booked, moved, cancelled, the reminder — each
 * a design under Engagement → Emails, filled from the booking and sent to the reader and to the host
 * alike (each addressed by their own first name, `with` the other side) with a calendar invitation
 * attached: METHOD:REQUEST for a booking and a move (SEQUENCE counting the moves), CANCEL for a
 * cancellation; the place in the invitation's own LOCATION. Time is said in each person's zone —
 * the reader's as the booker gave it (kept on the row), the host's from their hours. The reminder
 * goes to the reader alone. Never a cal.com link: a cal.com booking has cal.com's own emails.
 */
import { admin } from './lib.ts'
import { sendEmail } from './email.ts'
import { ics } from './ics.js'
import { formsNow } from './forms-live.ts'
import { typeFor } from './sessions.ts'
import strings from './emails/strings.json' with { type: 'json' }

export type SessionMailKind = 'session-booked' | 'session-moved' | 'session-cancelled' | 'session-reminder'
const APP = () => (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
const W = ((strings as any).session ?? {}) as Record<string, string>
const fill = (t: string, m: Record<string, unknown>) => String(t || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])))
/* THE ANSWERS A BOOKING COLLECTED, as { label, value } for the letter — the question as it was
   asked, not the field's key, because a key is not a question. */
async function answersOf(responseId: string): Promise<Array<{ label: string; value: string }>> {
  const { data: resp } = await admin.from('form_responses').select('id, form').eq('id', responseId).maybeSingle()
  if (!resp) return []
  const { data: rows } = await admin.from('form_answers').select('field, value, file_name').eq('response_id', responseId)
  if (!rows?.length) return []
  /* the forms as the functions read them — the compiled file in git mode, the rows in cloud mode */
  const doc = (await formsNow())[resp.form]
  const fields = (doc?.fields ?? doc?.model?.fields ?? []) as any[]
  const labelOf = (key: string) => { const q = fields.find((y) => y.name === key)?.question; return q && q !== '...' ? q : key }
  const order = fields.map((y) => y.name)
  rows.sort((a: any, b: any) => (order.indexOf(a.field) + 1 || 99) - (order.indexOf(b.field) + 1 || 99))
  return rows.map((r: any) => ({
    label: labelOf(r.field),
    value: r.file_name ? String(r.file_name) : Array.isArray(r.value) ? r.value.join(', ') : r.value && typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value ?? ''),
  }))
}
const first = (name: string | null, email: string | null) => (name || '').trim().split(/\s+/)[0] || (email || '').split('@')[0] || ''
const when = (iso: string, tz: string) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) + ` (${tz.replace(/_/g, ' ')})` } catch { return iso } }
/* the place, as a sentence and as the invitation's location */
export function placeOf(where: any, join: string | null) {
  const w = where || {}
  if (w.kind === 'video') return { line: W['where-video'] || 'A video call on the site', location: join || '' }
  if (w.kind === 'link') return { line: fill(W['where-link'] || 'Online: {url}', { url: w.url }), location: w.url || '' }
  if (w.kind === 'place') return { line: fill(W['where-place'] || 'In person at {name}, {address}', { name: w.name || '', address: w.address || '' }).replace(/^In person at , /, 'In person at '), location: [w.name, w.address].filter(Boolean).join(', ') }
  if (w.kind === 'phone') return { line: w.number ? fill(W['where-phone'] || 'By phone: {number}', { number: w.number }) : (W['where-phone-theirs'] || 'By phone — the host calls you'), location: w.number ? `Phone: ${w.number}` : '' }
  return { line: '', location: '' }
}

export async function sessionMail(kind: SessionMailKind, uid: string, extra: Record<string, unknown> = {}) {
  const { data: b } = await admin.from('bookings').select('*').eq('uid', uid).maybeSingle()
  if (!b || b.provider !== 'native') return { sent: false }
  const s = await typeFor(b.event, { any: true })
  const { data: host } = b.host_id ? await admin.from('profiles').select('id, email, display_name').eq('id', b.host_id).maybeSingle() : { data: null }
  const { data: hh } = b.host_id ? await admin.from('provider_schedules').select('timezone').eq('user_id', b.host_id).eq('is_default', true).maybeSingle() : { data: null }
  const readerTz = String(b.payload?.tz || 'UTC'), hostTz = String(hh?.timezone || 'UTC')
  const join = b.join_url || null
  const place = placeOf(b.where, join)
  const method = kind === 'session-cancelled' || kind === 'session-declined' ? 'CANCEL' : 'REQUEST'
  /* NOTHING IS PUT IN ANYBODY'S CALENDAR UNTIL IT IS CONFIRMED. An invitation for an hour the host
     may yet decline is an hour somebody blocks out and then has to take back. */
  const held = kind === 'session-held' || kind === 'session-to-confirm'
  const sequence = Number(b.payload?.sequence ?? 0) + (kind === 'session-moved' ? 1 : 0) + (kind === 'session-cancelled' ? 1 : 0)
  const invite = ics({ uid: `${b.uid}@platformkit`, start: b.start_at, end: b.end_at, summary: b.title || s?.title || 'Session', description: [place.line, join].filter(Boolean).join('\n'), location: place.location, url: join || undefined, organizer: host?.email ? { name: host.display_name || '', email: host.email } : undefined, attendees: [...new Set([b.email, ...(b.attendee_emails || [])].filter(Boolean))].map((e: string) => ({ name: e === b.email ? (b.name || '') : '', email: e })), method, sequence })
  if (kind === 'session-moved' || kind === 'session-cancelled') await admin.from('bookings').update({ payload: { ...(b.payload || {}), sequence } }).eq('uid', uid)
  const manage = APP() + '/app/coaching'
  const base = { title: b.title || s?.title || '', where: place.line, join: join || '', manage, ...extra }
  const out: boolean[] = []
  /* every address on the booking — the row's own and the rest of the invitees (a host's booking for several) — each by their own name */
  const addresses = [...new Set([b.email, ...(b.attendee_emails || [])].filter(Boolean).map((e: string) => String(e).toLowerCase()))]
  const { data: people } = addresses.length ? await admin.from('profiles').select('email, display_name').in('email', addresses) : { data: [] }
  for (const to of addresses) {
    const who = (people ?? []).find((p: any) => String(p.email).toLowerCase() === to)
    if (kind === 'session-to-confirm') continue   /* that one is the host's */
    out.push(await sendEmail(to, kind, { ...base, name: first(who?.display_name || (to === String(b.email || '').toLowerCase() ? b.name : ''), to), with: host?.display_name || '', when: when(b.start_at, readerTz) }, held ? {} : { ical: { method, content: invite } }))
  }
  /* WHAT THEY ANSWERED ON THE WAY IN goes to the HOST and to nobody else: the reader wrote it and
     does not need it read back, and an invitee on somebody else's booking never wrote it at all. */
  const answers = (kind === 'session-booked' || kind === 'session-to-confirm') && b.response_id ? await answersOf(b.response_id) : []
  /* THE HOST IS NOT TOLD EVERYTHING. A reminder is the reader's; "the time is held" is the
     reader's and its counterpart is the host's own letter; a decline is the reader's, because the
     host is the one who declined it. */
  const forHost = kind !== 'session-reminder' && kind !== 'session-held' && kind !== 'session-declined'
  if (forHost && host?.email) out.push(await sendEmail(host.email, kind, { ...base, name: first(host.display_name, host.email), with: b.name || b.email || '', when: when(b.start_at, hostTz), answers }, held ? {} : { ical: { method, content: invite } }))
  return { sent: out.some(Boolean) }
}
