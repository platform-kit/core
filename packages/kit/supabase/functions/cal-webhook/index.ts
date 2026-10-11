/*
 * cal.com → bookings. cal.com calls this on every trigger it has (set the webhook
 * up in cal.com → Settings → Developer → Webhooks, subscriber URL this function,
 * secret CAL_WEBHOOK_SECRET): a booking's life (requested, created, paid,
 * rescheduled, cancelled, rejected), the meeting (started, ended, no-show) and what
 * it left (recording, transcript) are applied; the rest is acknowledged. No user JWT (verify_jwt is off): trust is the signature —
 * cal.com signs the raw body with HMAC-SHA256 under X-Cal-Signature-256. Each
 * event is projected onto one row keyed by the booking uid, so retries and
 * reorderings are harmless. Both sides are recorded — the attendee (the reader)
 * and the organiser (the coach) — each linked to an account by email when one
 * exists; otherwise the row waits, and the select policy matches by email.
 *
 * A booking the attendee's membership does not allow is REFUSED on creation: the
 * event type is looked up in the catalog's sessions (catalog.json — who it is
 * for, how many a week or a month), the attendee's live tiers are read, and a
 * booking that is not theirs, or over the allowance, is cancelled on cal.com
 * through its API (CAL_API_KEY; without one it is only marked and logged), the
 * row marked with why, and the coach's line sent to the attendee's chat
 * (refuse_booking, migration 20260915110000; the lines are strings.json's
 * refusal group, from content/app/ui/chat.md ## refusal). The count is the
 * app's own rule (src/lib/booking.js): other counted bookings of that event
 * type starting within the last week or thirty days.
 *
 * When a meeting ends, a follow-up is put on the booking: five minutes later
 * pg_cron (send_booking_followups, migration 20260914130000) sends the line
 * from the host to each attendee in their chat. The line is one of several,
 * drawn here at random so it does not read as the same line every time; they
 * live in content/app/ui/chat.md (## followup) and arrive as strings.json.
 */
const FOLLOWUP_MS = 5 * 60 * 1000
const LINES: string[] = Object.values(((strings as any).lines ?? {}) as Record<string, string>).filter((l) => typeof l === 'string' && l.trim())
const followupLine = () => (LINES.length ? LINES[Math.floor(Math.random() * LINES.length)] : null)
import { admin, json } from '../_shared/lib.ts'
import strings from './strings.json' with { type: 'json' }
import { judge, cancel as cancelOnCalApi } from '../_shared/cal.ts'
import { pull } from '../_shared/recordings.ts'
import { deliverSchedulingEvent } from '../_shared/scheduling-events.ts'

const SECRET = Deno.env.get('CAL_WEBHOOK_SECRET') ?? ''
const REFUSAL: Record<string, string> = ((strings as any).refusal ?? {}) as Record<string, string>
/* the time as the attendee sees it (their cal.com time zone, else the host's) */
const when = (iso: string | null, tz?: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) } catch { return new Date(iso).toLocaleString('en-US') } }
/* "Your weekly 1-on-1" reads as "the weekly 1-on-1" inside the line */
const said = (title: string) => title.replace(/^Your\s+/i, '')
const fill = (line: string, vars: Record<string, string>) => line.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')

/* why a new booking must be refused, or null; the words to say. A booking the app
   made itself was judged before it was made and carries user_id in its metadata,
   so it passes; one made on cal.com's own page is judged here. */
async function refusalFor(uid: string, event: string | null, user_id: string | null, email: string | null, start: string | null, tz: string | null) {
  const v = await judge(event, user_id, email, uid)
  if (v.ok || v.reason === 'unknown') return null
  const title = said(v.session?.title ?? '')
  if (v.reason === 'over') return { reason: 'over', body: fill(REFUSAL.over ?? '', { title, when: when(start, tz), allowance: v.allowance ?? '', next: when(v.next ?? null, tz) }) }
  if (v.reason === 'unpaid') return { reason: 'unpaid', body: fill(REFUSAL.unpaid ?? REFUSAL['not-included'] ?? '', { title, when: when(start, tz) }) }
  return { reason: v.reason, body: fill(REFUSAL[v.reason] ?? '', { title, when: when(start, tz) }) }
}

/* cancel it on cal.com; without a key, say so and leave the cancelling to a person */
async function cancelOnCal(uid: string, reason: string) {
  if (!Deno.env.get('CAL_API_KEY')) { console.warn('cal-webhook: CAL_API_KEY unset — booking', uid, 'refused but not cancelled on cal.com'); return false }
  try { await cancelOnCalApi(uid, reason); return true } catch (e) { console.error('cal-webhook: cancel failed', (e as any)?.message ?? e); return false }
}

async function verify(raw: string, sig: string | null) {
  if (!SECRET) return false
  if (!sig) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex === sig.trim().toLowerCase()
}

async function userByEmail(email: string | null): Promise<string | null> {
  if (!email) return null
  const { data } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle()
  return data?.id ?? null
}

/* the first attendee is the reader; the organiser is the coach; every email
   on the booking is kept, so anyone on it can see it */
function attendee(p: any) {
  const a = (p.attendees ?? [])[0] ?? {}
  return { email: a.email ?? p.responses?.email?.value ?? null, name: a.name ?? p.responses?.name?.value ?? null }
}
function organizer(p: any) {
  const o = p.organizer ?? p.booking?.user ?? {}
  return { email: o.email ?? null, name: o.name ?? null }
}
const lower = (e: unknown) => (typeof e === 'string' && e ? e.toLowerCase() : null)
function attendeeEmails(p: any): string[] {
  const list = (p.attendees ?? []).map((a: any) => lower(a?.email)).filter(Boolean)
  const first = lower(p.responses?.email?.value)
  if (first && !list.includes(first)) list.push(first)
  return list
}

/* cal.com's no-show update names who did not turn up; the guest's flag is the one
   a reader sees (a host no-show is the coach's own business) */
function noShowOf(p: any): boolean | null {
  if (typeof p.noShowHost === 'boolean' && p.attendees === undefined) return null
  const guests = (p.attendees ?? []).map((a: any) => a?.noShow)
  if (guests.some((v: unknown) => typeof v === 'boolean')) return guests.some((v: unknown) => v === true)
  return null
}

async function handle(evt: any) {
  const p = evt.payload ?? {}
  const uid: string | undefined = p.uid ?? p.bookingUid ?? p.booking?.uid
  if (!uid) return
  const who = attendee(p)
  const host = organizer(p)
  const [user_id, provider_id] = await Promise.all([userByEmail(who.email), userByEmail(host.email)])
  const base = {
    uid, user_id, email: who.email, name: who.name,
    provider_id, provider_email: lower(host.email), attendee_emails: attendeeEmails(p),
    title: p.title ?? p.eventTitle ?? null,
    /* the event type's slug: what a session option is matched on for its weekly allowance */
    event: p.type ?? p.eventType?.slug ?? p.eventSlug ?? null,
    start_at: p.startTime ?? null, end_at: p.endTime ?? null,
    join_url: p.videoCallData?.url ?? p.metadata?.videoCallUrl ?? (p.location?.startsWith?.('http') ? p.location : null),
    reschedule_url: p.rescheduleLink ?? null, cancel_url: p.cancelLink ?? null,
    payload: p, updated_at: new Date().toISOString(),
  }
  const upsert = (extra: Record<string, unknown>) => admin.from('bookings').upsert({ ...base, ...extra }, { onConflict: 'uid' })
  /* a patch on a row that may not be here yet (an event for a booking made before the
     webhook was wired): the row is made, as ended, and patched */
  const patch = async (fields: Record<string, unknown>, fallbackStatus = 'ended') => {
    const { data } = await admin.from('bookings').select('uid').eq('uid', uid).maybeSingle()
    if (data) await admin.from('bookings').update({ ...fields, updated_at: base.updated_at }).eq('uid', uid)
    else await upsert({ status: fallbackStatus, ...fields })
  }
  /* the site's own subscribers hear of it too (the Scheduling API's webhooks), once the row is there */
  const reemit = ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'BOOKING_REJECTED', 'MEETING_STARTED', 'MEETING_ENDED', 'BOOKING_NO_SHOW_UPDATED'].includes(evt.triggerEvent) ? evt.triggerEvent : null
  try { await handle() } finally { if (reemit) await deliverSchedulingEvent(reemit, uid).catch((e) => console.warn('scheduling webhook', String(e))) }
  async function handle() {
  switch (evt.triggerEvent) {
    /* the booking's life */
    case 'BOOKING_REQUESTED':
    case 'BOOKING_PAYMENT_INITIATED':
      await upsert({ status: 'pending' }); break
    case 'BOOKING_CREATED':
    case 'BOOKING_PAID': {
      await upsert({ status: 'accepted' })
      /* not the attendee's to book? cancelled, marked, and said — once */
      const { data: row } = await admin.from('bookings').select('refused, status').eq('uid', uid).maybeSingle()
      if (row?.refused) break
      if (p.metadata?.app === 'platformkit') break   /* made by the app, judged before it was made */
      const tz = (p.attendees ?? [])[0]?.timeZone ?? p.organizer?.timeZone ?? null
      const refusal = await refusalFor(uid, base.event, user_id, who.email, base.start_at, tz)
      if (refusal) {
        await cancelOnCal(uid, refusal.body || refusal.reason)
        await admin.rpc('refuse_booking', { p_uid: uid, p_reason: refusal.reason, p_body: refusal.body })
      }
      break
    }
    case 'BOOKING_RESCHEDULED': {
      /* a reschedule makes a new uid; the old one is marked, the new one inserted */
      const old = p.rescheduleUid ?? p.rescheduleId
      if (old && String(old) !== uid) await admin.from('bookings').update({ status: 'rescheduled', updated_at: base.updated_at }).eq('uid', String(old))
      await upsert({ status: 'accepted' }); break
    }
    case 'BOOKING_CANCELLED':
      await upsert({ status: 'cancelled' }); break   /* a refusal's own cancel lands here too; `refused` stays */
    case 'BOOKING_REJECTED':
      await upsert({ status: 'rejected' }); break
    /* the meeting itself */
    case 'MEETING_STARTED':
      await patch({ started_at: p.startTime ?? base.updated_at }, 'accepted'); break
    case 'MEETING_ENDED': {
      await upsert({ status: 'ended' })
      /* the follow-up, once: a retry of this event neither reschedules nor resends */
      const line = followupLine()
      if (line) await admin.from('bookings')
        .update({ followup_at: new Date(Date.now() + FOLLOWUP_MS).toISOString(), followup_body: line })
        .eq('uid', uid).is('followup_at', null).is('followup_sent_at', null)
      break
    }
    case 'BOOKING_NO_SHOW_UPDATED': {
      const ns = noShowOf(p)
      if (ns !== null) await patch({ no_show: ns })
      break
    }
    case 'AFTER_GUESTS_CAL_VIDEO_NO_SHOW':
      await patch({ no_show: true }); break
    /* what the meeting left behind: cal.com's links kept for the record (they expire within the hour, never shown),
       and the recording pulled into our own bucket at once — a fresh link from the API, the file streamed
       (_shared/recordings.ts); a miss leaves the row pending for the ten-minute cron */
    case 'RECORDING_READY':
    case 'RECORDING_TRANSCRIPTION_GENERATED': {
      const fields: Record<string, unknown> = { recording_state: 'pending', recording_error: null }
      if (p.downloadLink ?? p.recordingUrl) fields.recording_url = p.downloadLink ?? p.recordingUrl
      /* RECORDING_TRANSCRIPTION_GENERATED carries downloadLinks: { transcription: [{ format, link }], recording } (apps/web/lib/daily-webhook/triggerWebhooks.ts) */
      const tr = p.downloadLinks?.transcription; const vtt = Array.isArray(tr) ? (tr.find((t: any) => /vtt/i.test(t?.format)) ?? tr[0]) : null
      if (vtt?.link) fields.transcript_url = vtt.link
      else if (p.transcriptUrl ?? p.transcriptionUrl) fields.transcript_url = p.transcriptUrl ?? p.transcriptionUrl
      if (!fields.recording_url && p.downloadLinks?.recording) fields.recording_url = p.downloadLinks.recording
      await patch(fields)
      /* the pull runs after cal.com has its 200 — the edge runtime keeps the promise alive past the response
         (EdgeRuntime.waitUntil); the ten-minute cron picks up anything a cut-off run left pending */
      const work = pull(uid).catch((e) => console.warn('recording pull', String(e)))
      const rt = (globalThis as any).EdgeRuntime
      if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(work); else await work
      break
    }
    default: /* PING, form responses, host no-shows, and anything else: acknowledged, not applied */
  }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const raw = await req.text()
  if (!(await verify(raw, req.headers.get('x-cal-signature-256')))) return json({ error: 'bad signature' }, 401)
  let evt: any
  try { evt = JSON.parse(raw) } catch { return json({ error: 'bad json' }, 400) }
  try { await handle(evt) } catch (e) { console.error('cal-webhook', e); return json({ error: 'failed' }, 500) }
  return json({ ok: true })
})
