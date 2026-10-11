/*
 * The Scheduling API's webhooks (scheduling-api): every booking the site knows delivered to each active subscription
 * as cal.com delivers one — BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED, BOOKING_REJECTED, MEETING_STARTED,
 * MEETING_ENDED, BOOKING_NO_SHOW_UPDATED — signed X-Cal-Signature-256 (HMAC-SHA256 hex of the raw body, the row's
 * secret). Called where a native booking is made, moved or cancelled (booking.ts), where a room starts and ends
 * (session-room, livekit-webhook) and by cal-webhook for every event it accepts, so a cal.com-scheduled type's events
 * reach the site's subscribers too. A failure is kept on the subscription and tried again on the next event.
 */
import { admin } from './lib.ts'
import { typeFor } from './sessions.ts'
import { bookingOf } from './api/cal/booking.js'
import { payloadOf } from './api/cal/webhook.js'

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/* the booking as cal.com shapes it, from the row and its hosts */
export async function calBookingOf(uid: string) {
  const { data: row } = await admin.from('bookings').select('*').eq('uid', uid).maybeSingle()
  if (!row) return null
  const s = await typeFor(row.event, { any: true })
  const hostIds = [row.host_id, row.provider_id].filter(Boolean)
  const { data: hosts } = hostIds.length ? await admin.from('profiles').select('id, email, display_name').in('id', hostIds) : { data: [] }
  let hostList = (hosts ?? []).map((h: any) => ({ id: h.id, email: h.email, name: h.display_name || '' }))
  if (!hostList.length && s && s.hosts?.length) { const { data: hs } = await admin.from('profiles').select('id, email, display_name').in('email', s.hosts); hostList = (hs ?? []).map((h: any) => ({ id: h.id, email: h.email, name: h.display_name || '' })) }
  for (const h of hostList) { const { data: hr } = await admin.from('provider_schedules').select('timezone').eq('user_id', h.id).eq('is_default', true).maybeSingle(); (h as any).timeZone = hr?.timezone || 'UTC' }
  return bookingOf(row, { session: s, hosts: hostList })
}
export async function deliverSchedulingEvent(trigger: string, uid: string, extra: Record<string, unknown> = {}) {
  const { data: subs } = await admin.from('scheduling_webhooks').select('id, subscriber_url, triggers, secret, event_type_slug').eq('active', true).contains('triggers', [trigger])
  if (!subs?.length) return
  const booking = await calBookingOf(uid)
  if (!booking) return
  const body = JSON.stringify(payloadOf(trigger, booking, extra))
  for (const w of subs) {
    if (w.event_type_slug && booking.eventType?.slug !== w.event_type_slug) continue
    try {
      const sig = await hmacHex(w.secret || '', body)
      const r = await fetch(w.subscriber_url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cal-signature-256': sig }, body })
      if (!r.ok) throw new Error('the subscriber answered ' + r.status)
      await admin.from('scheduling_webhooks').update({ last_at: new Date().toISOString(), last_error: null }).eq('id', w.id)
    } catch (e) {
      await admin.from('scheduling_webhooks').update({ last_error: String((e as Error)?.message ?? e).slice(0, 300) }).eq('id', w.id)
    }
  }
}
