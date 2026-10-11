/*
 * A row of `bookings` as cal.com's booking (API v2, 2024-08-13) — what the Bookings routes answer and what a webhook's
 * payload is built from. Plain JavaScript, no imports, pinned under Node.
 */
import { eventTypeId } from './event-type.js'

const STATUS = { pending: 'pending', accepted: 'accepted', rescheduled: 'rescheduled', cancelled: 'cancelled', rejected: 'rejected', ended: 'accepted' }
const iso = (v) => (v ? new Date(v).toISOString() : null)
const minutes = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : 0)
const nameOf = (email, name) => name || (email ? String(email).split('@')[0] : '')

/**
 * @param {object} row   bookings
 * @param {object} o     { session, hosts: [{ id, name, email, timeZone }] }
 */
export function bookingOf(row, o = {}) {
  const s = o.session || null
  const host = (o.hosts || [])[0] || (row.provider_email ? { id: row.provider_id || row.host_id, name: '', email: row.provider_email } : null)
  const attendees = [{ name: nameOf(row.email, row.name), email: row.email || '', timeZone: (row.payload && row.payload.attendees && row.payload.attendees[0] && row.payload.attendees[0].timeZone) || 'UTC', language: 'en', absent: !!row.no_show, phoneNumber: (row.payload && row.payload.phone) || undefined }]
  for (const e of row.attendee_emails || []) if (e && e !== row.email) attendees.push({ name: nameOf(e, ''), email: e, timeZone: 'UTC', language: 'en', absent: false })
  const location = s ? ((s.where || {}).kind === 'video' ? (row.join_url || 'integrations:daily') : (s.where || {}).kind === 'link' ? (s.where.url || '') : (s.where || {}).kind === 'place' ? [s.where.name, s.where.address].filter(Boolean).join(', ') : (s.where || {}).kind === 'phone' ? (s.where.number || (row.payload && row.payload.phone) || 'phone') : '') : (row.join_url || '')
  return {
    id: eventTypeId('booking:' + row.uid), uid: row.uid, title: row.title || (s ? s.title : ''), description: (row.payload && row.payload.notes) || '',
    hosts: host ? [{ id: eventTypeId('user:' + (host.email || host.id)), name: host.name || nameOf(host.email, ''), email: host.email || '', username: String(host.email || '').split('@')[0], timeZone: host.timeZone || 'UTC' }] : [],
    status: STATUS[row.status] || row.status, cancellationReason: row.status === 'cancelled' ? (row.refused || (row.payload && row.payload.cancellationReason) || '') : undefined, reschedulingReason: undefined, rescheduledFromUid: (row.payload && row.payload.rescheduleUid) || undefined,
    start: iso(row.start_at), end: iso(row.end_at), duration: minutes(row.start_at, row.end_at), eventTypeId: s ? eventTypeId(s.slug) : null, eventType: s ? { id: eventTypeId(s.slug), slug: s.slug } : null,
    meetingUrl: row.join_url || null, location, absentHost: false, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), metadata: { ...((row.payload && row.payload.metadata) || {}), provider: row.provider || 'native', event: row.event, ...(row.seat_of ? { seatOf: row.seat_of } : {}) }, rating: null, icsUid: row.uid + '@site',
    attendees, guests: [], bookingFieldsResponses: { name: attendees[0].name, email: attendees[0].email, ...(row.payload && row.payload.notes ? { notes: row.payload.notes } : {}), ...(row.payload && row.payload.phone ? { attendeePhoneNumber: row.payload.phone } : {}) },
  }
}

/* cal.com's list filter `status` → which rows */
export function statusFilter(status, now = new Date()) {
  const t = now.toISOString()
  switch (status) {
    case 'upcoming': return (q) => q.in('status', ['accepted', 'pending']).gte('start_at', t)
    case 'past': return (q) => q.in('status', ['accepted', 'ended']).lt('end_at', t)
    case 'cancelled': return (q) => q.in('status', ['cancelled', 'rejected'])
    case 'unconfirmed': return (q) => q.eq('status', 'pending')
    /* one of a run the reader booked at once; every session of one carries the first's uid */
    case 'recurring': return (q) => q.not('run_of', 'is', null)
    default: return (q) => q
  }
}
