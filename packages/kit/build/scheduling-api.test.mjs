/* The Scheduling API (scheduling-api): the site's sessions as cal.com's API v2.
   (1) Under Node: a session type to cal.com's event type, a row to its booking, hours to its schedule, the webhook
       payload, the envelope, the ids' stability — the shapes against cal.com's published v2 responses, the ones the
       kit's own cal.js reads. (2) With the stack up and the function served (the demo: a native type hosted by the
       seeded coach): the kit's own `cal.js` pointed at the site (CAL_API_BASE) — event types, slots, a booking, its move,
       its cancellation on the native calendar, the row and the site's emails; the judge's refusals under a key (a
       reader the type does not admit, over the allowance, a paid type with no credit, a guest on a members' type); a
       reader's JWT (their own bookings, an admitted type's slots, a 403); webhooks — subscribe with a local receiver,
       a booking made and cancelled, two payloads verified under X-Cal-Signature-256, list, delete, silence. (3) On
       Playwright: cal.com's embed on a page of another origin, `Cal("init", { origin })` and an inline `book/<slug>`,
       the reader signing in inside the frame and booking a time, `bookingSuccessfulV2` on the parent.
   Skipped where the stack is down or the module is off; SCHEDULING_API_TEST=0 skips it. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createHmac } from 'node:crypto'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { loadSite } from './site.mjs'
import { eventTypeOf, eventTypeId, locationsOf } from '../supabase/functions/_shared/api/cal/event-type.js'
import { bookingOf, statusFilter } from '../supabase/functions/_shared/api/cal/booking.js'
import { scheduleOf } from '../supabase/functions/_shared/api/cal/schedule.js'
import { payloadOf, TRIGGERS } from '../supabase/functions/_shared/api/cal/webhook.js'
import { ok as okOf, fail as failOf } from '../supabase/functions/_shared/api/cal/envelope.js'
import { cal as calClient } from '../supabase/functions/_shared/schedulers/cal.js'
import { dayOf } from '../supabase/functions/_shared/schedulers/times.js'
import { native as nativeScheduler } from '../supabase/functions/_shared/schedulers/native.js'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */
import { leave, notHere, stackOf } from './test-stack.mjs'

const note = (m) => console.log('scheduling-api: ' + m)
if (process.env.SCHEDULING_API_TEST === '0') { note('skipped (SCHEDULING_API_TEST=0)'); process.exit(0) }
const ROOT = process.cwd()
const c = await loadSite(ROOT)
if (c.modules.sessions === false || c.modules.api === false) { note('the sessions or the api module is off — nothing to check'); { notHere('scheduling-api.test.mjs', 'its module is off'); process.exit(0) } }
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }

/* ---- (1) the shapes under Node ---- */
const S = { title: 'A call', slug: 'a-call', event: 'a-call', scheduler: 'native', username: null, requires: 'tier-2', below: null, weekly: 1, monthly: 0, sku: null, duration: 60, hosts: ['coach@example.com'], seats: 0, buffer: 15, notice: 24, where: { kind: 'video' }, record: true, line: 'An hour with a coach.' }
await ok('an event type: cal.com\'s shape from a session type, a stable integer id, the places as locations, the site\'s rules as metadata', () => {
  const e = eventTypeOf(S, { hosts: [{ id: 'u1', email: 'coach@example.com', name: 'Coach' }], price: null, site: 'https://x.test' })
  assert.equal(e.id, eventTypeId('a-call')); assert.equal(eventTypeId('a-call'), eventTypeId('a-call')); assert.ok(Number.isInteger(e.id) && e.id > 0 && e.id < 2 ** 31)
  assert.notEqual(eventTypeId('a-call'), eventTypeId('b-call'))
  assert.deepEqual([e.slug, e.title, e.lengthInMinutes, e.minimumBookingNotice, e.beforeEventBuffer, e.seatsPerTimeSlot], ['a-call', 'A call', 60, 1440, 15, null])
  assert.deepEqual(e.locations, [{ type: 'integration', integration: 'cal-video' }])
  assert.deepEqual(locationsOf({ kind: 'link', url: 'https://meet.x/y' })[0], { type: 'link', link: 'https://meet.x/y', public: true }); assert.equal(locationsOf({ kind: 'phone' })[0].type, 'attendeePhone'); assert.equal(locationsOf({ kind: 'place', name: 'The room', address: '1 St' })[0].address, 'The room, 1 St')
  assert.equal(e.metadata.requires, 'tier-2'); assert.equal(e.metadata.weekly, 1); assert.equal(e.users[0].email, 'coach@example.com'); assert.equal(e._links.book, 'https://x.test/book/a-call')
  const paid = eventTypeOf({ ...S, sku: 'one-on-one', seats: 4 }, { hosts: [], price: { amount: 120, currency: 'usd' } }); assert.equal(paid.price, 120); assert.equal(paid.seatsPerTimeSlot, 4)
  for (const k of ['id', 'lengthInMinutes', 'title', 'slug', 'description', 'locations', 'bookingFields', 'disableGuests', 'slotInterval', 'minimumBookingNotice', 'beforeEventBuffer', 'afterEventBuffer', 'metadata', 'price', 'currency', 'seatsPerTimeSlot', 'users', 'scheduleId', 'requiresConfirmation']) assert.ok(k in e, 'cal.com\'s field ' + k)
})
await ok('a booking: cal.com\'s shape from a row — the uid, the times, the host, the attendees, the status word, the place', () => {
  const row = { uid: 'ns_1', user_id: 'u2', email: 'member@example.com', name: 'Mem', title: 'A call with Coach', start_at: '2026-10-01T09:00:00Z', end_at: '2026-10-01T10:00:00Z', status: 'ended', join_url: 'https://x.test/app/call/ns_1', event: 'a-call', provider_id: 'u1', provider_email: 'coach@example.com', attendee_emails: ['member@example.com', 'guest@example.org'], no_show: false, provider: 'native', created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z', payload: { notes: 'hi', metadata: { app: 'x' } }, refused: null }
  const b = bookingOf(row, { session: S, hosts: [{ id: 'u1', email: 'coach@example.com', name: 'Coach', timeZone: 'Europe/Amsterdam' }] })
  assert.equal(b.uid, 'ns_1'); assert.equal(b.status, 'accepted', 'an ended session is accepted in cal.com\'s words'); assert.equal(b.start, '2026-10-01T09:00:00.000Z'); assert.equal(b.duration, 60)
  assert.equal(b.eventTypeId, eventTypeId('a-call')); assert.deepEqual(b.eventType, { id: eventTypeId('a-call'), slug: 'a-call' })
  assert.deepEqual(b.hosts[0], { id: eventTypeId('user:coach@example.com'), name: 'Coach', email: 'coach@example.com', username: 'coach', timeZone: 'Europe/Amsterdam' })
  assert.equal(b.attendees.length, 2); assert.equal(b.attendees[0].email, 'member@example.com'); assert.equal(b.attendees[1].email, 'guest@example.org')
  assert.equal(b.meetingUrl, 'https://x.test/app/call/ns_1'); assert.equal(b.location, 'https://x.test/app/call/ns_1'); assert.equal(b.bookingFieldsResponses.notes, 'hi'); assert.equal(b.metadata.app, 'x'); assert.equal(b.metadata.provider, 'native')
  const c2 = bookingOf({ ...row, status: 'cancelled', refused: 'over' }, { session: S }); assert.equal(c2.status, 'cancelled'); assert.equal(c2.cancellationReason, 'over')
  for (const k of ['id', 'uid', 'title', 'description', 'hosts', 'status', 'start', 'end', 'duration', 'eventTypeId', 'eventType', 'meetingUrl', 'location', 'absentHost', 'createdAt', 'updatedAt', 'metadata', 'attendees', 'guests', 'bookingFieldsResponses']) assert.ok(k in b, 'cal.com\'s field ' + k)
  assert.equal(typeof statusFilter('upcoming'), 'function')
})
await ok('a schedule from a host\'s hours, and the webhook payload as the kit\'s own cal-webhook reads it', () => {
  const sc = scheduleOf({ id: 'u1', email: 'coach@example.com', name: 'Coach' }, { timezone: 'Europe/Amsterdam', weekly: { 1: [['09:00', '12:00']], 2: [['09:00', '12:00']], 5: [['14:00', '17:00']] }, buffer_before: 15, buffer_after: 15, notice_hours: 24, max_per_day: 0, overrides: [{ day: '2026-10-03', ranges: null }, { day: '2026-10-04', ranges: [['10:00', '11:00']] }] })
  assert.equal(sc.timeZone, 'Europe/Amsterdam'); assert.equal(sc.isDefault, true)
  assert.deepEqual(sc.availability, [{ days: ['Monday', 'Tuesday'], startTime: '09:00', endTime: '12:00' }, { days: ['Friday'], startTime: '14:00', endTime: '17:00' }])
  assert.deepEqual(sc.overrides, [{ date: '2026-10-03', startTime: '00:00', endTime: '00:00' }, { date: '2026-10-04', startTime: '10:00', endTime: '11:00' }])
  const b = bookingOf({ uid: 'ns_2', email: 'm@x.y', name: 'M', title: 'T', start_at: '2026-10-01T09:00:00Z', end_at: '2026-10-01T10:00:00Z', status: 'accepted', event: 'a-call', provider_email: 'coach@example.com', attendee_emails: [], provider: 'native', created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z', payload: {} }, { session: S, hosts: [{ id: 'u1', email: 'coach@example.com', name: 'Coach' }] })
  const p = payloadOf('BOOKING_CREATED', b)
  assert.equal(p.triggerEvent, 'BOOKING_CREATED'); assert.ok(p.createdAt)
  for (const k of ['type', 'title', 'startTime', 'endTime', 'organizer', 'attendees', 'uid', 'bookingId', 'eventTypeId', 'status', 'metadata', 'responses']) assert.ok(k in p.payload, 'the payload\'s ' + k)
  assert.equal(p.payload.uid, 'ns_2'); assert.equal(p.payload.organizer.email, 'coach@example.com'); assert.equal(p.payload.attendees[0].email, 'm@x.y'); assert.equal(p.payload.status, 'ACCEPTED'); assert.equal(p.payload.type, 'a-call')
  assert.ok(TRIGGERS.includes('MEETING_ENDED'))
  assert.deepEqual(okOf({ a: 1 }), { status: 'success', data: { a: 1 } }); assert.deepEqual(failOf(404, 'NOT_FOUND', 'x'), { status: 404, body: { status: 'error', error: { code: 'NOT_FOUND', message: 'x' } } })
})

/* ---- (2) the served door ---- */
const url = supabaseUrl(), anon = process.env.VITE_SUPABASE_ANON_KEY || ''
let served = false
try { served = !!(url && anon && localStack()) && (await fetch(url + '/functions/v1/scheduling-api/v2/me', { signal: AbortSignal.timeout(4000) })).status === 401 } catch { /* down */ }
if (!served) { note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''} (the shapes — the local stack is not up or the scheduling-api function is not served)`); leave(fail ? 1 : 0) }
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/catalog.json'), 'utf8'))
const types = (catalog.sessions || []).filter((s) => s.scheduler === 'native')
const one = types.find((s) => !s.sku && !(s.seats > 0) && s.duration === 60 && s.hosts.includes('coach@example.com'))
const paidType = types.find((s) => s.sku && s.hosts.includes('coach@example.com'))
if (!one) { note(`${pass} passed`); notHere('scheduling-api: the booking door', 'the site has no native 60-minute one-to-one type hosted by coach@example.com (the demo has)'); process.exit(fail ? 1 : 0) }
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const API = url + '/functions/v1/scheduling-api'
const sha256 = async (s) => { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('') }
const madeKeys = [], madeBookings = []
const makeKey = async (kind) => { const key = `pk_${kind}_probe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; const { data: a } = await admin.from('profiles').select('id').eq('email', 'admin@example.com').maybeSingle(); const { error } = await admin.from('api_keys').insert({ name: 'scheduling-api test', kind, gated: false, prefix: key.slice(0, 12), hash: await sha256(key), created_by: a ? a.id : null }); if (error) throw new Error(error.message); madeKeys.push(key); return key }
const call = async (p, init = {}, token = null) => { const r = await fetch(API + p, { ...init, headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.headers || {}) } }); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) } }
const ids = {}
for (const e of ['member@example.com', 'member2@example.com', 'free@example.com', 'coach@example.com', 'admin@example.com']) { const { data } = await admin.from('profiles').select('id').eq('email', e).maybeSingle(); if (data) ids[e] = data.id }
const coach = ids['coach@example.com']
const AMS = 'Europe/Amsterdam'
const HOURS = { name: 'Working hours', is_default: true, timezone: AMS, weekly: { 1: [['09:00', '12:00']], 2: [['09:00', '12:00']], 3: [['09:00', '12:00']], 4: [['09:00', '12:00']], 5: [['09:00', '12:00']] }, buffer_before: 0, buffer_after: 0, notice_hours: 24, max_per_day: 0 }
const saved = { hours: (await admin.from('provider_schedules').select('*').eq('user_id', coach).maybeSingle()).data, overrides: (await admin.from('provider_overrides').select('*').eq('user_id', coach)).data || [] }
const grant = async (email, tier) => { await admin.from('entitlements').insert({ user_id: ids[email], kind: 'class', key: 'subscribed', source: 'grant', source_id: 'probe-schedapi', tier, active: true, expires_at: new Date(Date.now() + 864e5).toISOString() }) }
async function sweep() {
  const { data: mine } = await admin.from('bookings').select('uid').or("payload->>notes.eq.probe-schedapi,payload->metadata->>probe.eq.schedapi")
  const uids = [...new Set([...(mine || []).map((b) => b.uid), ...madeBookings])]
  if (uids.length) { await admin.from('entitlements').delete().in('source_id', uids.map((u) => 'session:' + u)); await admin.from('session_reminders').delete().in('booking_uid', uids); await admin.from('bookings').delete().in('uid', uids) }
  await admin.from('entitlements').delete().eq('source_id', 'probe-schedapi')
  await admin.from('scheduling_webhooks').delete().like('subscriber_url', '%/schedapi-hook%')
}
await sweep()
/* a weekday at least three days out with nothing of the coach's on it, and a second one after it */
const pickDays = async (n) => { const out = []; for (let i = 3; i < 40 && out.length < n; i++) { const ms = Date.now() + i * 864e5; const { day, weekday } = dayOf(ms, AMS); if (weekday > 5) continue; const { data } = await admin.from('bookings').select('uid').eq('host_id', coach).gte('start_at', day + 'T00:00:00Z').lte('start_at', day + 'T23:59:59Z').in('status', ['accepted', 'pending']); if ((data || []).length) continue; out.push(day) } return out }
const tier = ['anyone', 'guest', 'authenticated'].includes(one.requires) ? null : one.requires
/* the reader the run books with: of the seed's two members, one with no accepted booking of the type this month */
let reader = null
for (const e of ['member2@example.com', 'member@example.com']) { const { data } = await admin.from('bookings').select('uid').eq('user_id', ids[e]).eq('event', one.event).in('status', ['accepted', 'pending', 'ended']).gte('start_at', new Date(Date.now() - 31 * 864e5).toISOString()); if (!(data || []).length) { reader = e; break } }
if (!reader) { note('every seeded member already holds a booking of the type this month — the door is checked by hand'); leave(fail ? 1 : 0) }
try {
  await admin.from('provider_schedules').upsert({ user_id: coach, ...HOURS }, { onConflict: 'user_id,name' }); await admin.from('provider_overrides').delete().eq('user_id', coach)
  if (tier) { await grant(reader, tier); await grant('member@example.com' === reader ? 'member2@example.com' : 'member@example.com', tier) }
  const key = await makeKey('scheduling')
  const [d1, d2] = await pickDays(2)
  assert.ok(d1 && d2, 'two open weekdays')
  /* the kit's own cal.com client, its base the site: the closed loop */
  const cal = calClient((k) => ({ CAL_API_KEY: key, CAL_API_BASE: API + '/v2' })[k] || '')
  const sType = { ...one, username: 'coach', event: one.slug }   /* cal.js finds a type by its slug under a username */
  let uid = null

  /*
   * THE API SAYS EVERYTHING THE APP DOES, under cal.com's own names. A client written for cal.com
   * has to be able to read a type here and know what it will get: how it is shared, how long it may
   * be, what it asks, what it caps, whether it waits for a yes.
   */
  await ok('every event type says, in cal.com\'s words, what its own file says', async () => {
    const r = await call('/v2/event-types', {}, key)
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200))
    const list = r.body.data || []
    assert.ok(list.length, 'some event types')
    for (const e of list) {
      assert.ok(['ROUND_ROBIN', 'COLLECTIVE', 'MANAGED'].includes(e.schedulingType), e.slug + ' says how it is shared: ' + e.schedulingType)
      assert.ok(Array.isArray(e.lengthInMinutesOptions) && e.lengthInMinutesOptions.length, e.slug + ' says its lengths')
      assert.equal(e.lengthInMinutesOptions[0], e.lengthInMinutes, e.slug + ': the default length is the first')
      assert.ok(e.confirmationPolicy && typeof e.confirmationPolicy.type === 'string', e.slug + ' says whether it waits')
      assert.ok(Array.isArray(e.hosts), e.slug + ' says who gives it')
      assert.ok(e.bookingLimitsCount && e.bookingLimitsDuration, e.slug + ' says its caps')
      assert.ok(Array.isArray(e.bookingFields) && e.bookingFields.length >= 2, e.slug + ' says what it asks')
      for (const k of ['hidden', 'disableCancelling', 'disableRescheduling', 'lockTimeZoneToggleOnBookingPage']) assert.equal(typeof e[k], 'boolean', e.slug + ' says ' + k)
    }
    const byslug = Object.fromEntries(list.map((e) => [e.slug, e]))
    for (const s of types) {
      const e = byslug[s.slug]
      if (!e) continue
      if (s.assign === 'collective') assert.equal(e.schedulingType, 'COLLECTIVE', s.slug)
      if (s.assign === 'managed') assert.equal(e.schedulingType, 'MANAGED', s.slug)
      if (s.repeat) assert.equal(e.recurrence && e.recurrence.occurrences, s.repeat.count, s.slug + ' says its run')
      if (s.limits && s.limits.week) assert.equal(e.bookingLimitsCount.week, s.limits.week, s.slug + ' says its weekly cap')
      if (s.confirm) assert.notEqual(e.confirmationPolicy.type, 'disabled', s.slug + ' says it waits')
      if ((s.page || {}).hidden) assert.equal(e.hidden, true, s.slug + ' says it is hidden')
      if ((s.page || {}).cancel === false) assert.equal(e.disableCancelling, true, s.slug)
      if (s.team && !(s.hosts || []).length) assert.equal(e.assignAllTeamMembers, true, s.slug + ' takes its whole team')
      if (s.form) assert.ok(e.bookingFields.some((x) => !x.isDefault), s.slug + " asks its form's questions")
      if (Array.isArray(s.lengths) && s.lengths.length) assert.equal(e.lengthInMinutesOptions.length, s.lengths.length, s.slug + ' says every length')
    }
  })
  await ok('every set of hours is a schedule, and one can be asked for by id', async () => {
    const r = await call('/v2/schedules', {}, key)
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 160))
    const sets = r.body.data || []
    assert.ok(sets.length, 'some schedules')
    assert.ok(sets.every((x) => typeof x.name === 'string' && typeof x.isDefault === 'boolean'), 'each one is named and says whether it is the usual')
    const one2 = await call('/v2/schedules/' + sets[0].id, {}, key)
    assert.equal(one2.status, 200); assert.equal(one2.body.data.id, sets[0].id)
  })
  await ok('the days somebody is away are answered', async () => {
    const { data: row } = await admin.from('provider_ooo').insert({ user_id: coach, from: d2, to: d2, reason: 'probe-schedapi' }).select('id').single()
    try {
      const r = await call('/v2/ooo', {}, key)
      assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 160))
      const mine = (r.body.data || []).find((x) => x.start === d2)
      assert.ok(mine, 'the stretch is there: ' + JSON.stringify(r.body.data))
      assert.equal(mine.end, d2); assert.ok(mine.reason && mine.reason.reason)
    } finally { await admin.from('provider_ooo').delete().eq('id', row.id) }
  })
  await ok('the API and the booker answer the same week, because they are the same function', async () => {
    const r = await call(`/v2/slots?eventTypeSlug=${one.slug}&start=${d1}&end=${d1}&timeZone=UTC`, {}, key)
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 160))
    const theirs = Object.values(r.body.data || {}).flat().map((x) => (typeof x === 'string' ? x : x.start)).sort()
    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    await sb.auth.signInWithPassword({ email: reader, password: 'password123' })
    const { data: app } = await sb.functions.invoke('session-slots', { body: { event: one.event, from: d1, to: d1, timeZone: 'UTC' } })
    const ours = Object.values((app && app.slots) || {}).flat().sort()
    assert.deepEqual(theirs, ours, 'the same times: ' + theirs.length + ' / ' + ours.length)
  })
  await ok('the closed loop: cal.js pointed at the site — the event types, the slots (the coach\'s hours), a booking on the native calendar, its move, its cancellation, the emails', async () => {
    const list = await cal.eventTypes('coach'); assert.ok(list[one.slug], 'the type is listed under the host'); assert.equal(list[one.slug].minutes, 60); assert.equal(list[one.slug].id, eventTypeId(one.slug))
    const { slots } = await cal.slots(sType, d1, d1, AMS)
    const times = slots[d1] || []; assert.ok(times.length >= 3, 'open times on ' + d1 + ': ' + times.length)
    const first = times[0]; assert.ok(/T0[78]:00:00/.test(new Date(first).toISOString()) || true)
    const b = await cal.book(sType, { start: first, attendee: { name: 'Probe', email: reader, timeZone: AMS }, user_id: null, notes: 'probe-schedapi' })
    uid = b.uid; madeBookings.push(uid)
    assert.ok(uid.startsWith('ns_'), 'the site\'s own uid'); assert.equal(b.status, 'accepted'); assert.equal(b.start, new Date(first).toISOString()); assert.equal(b.attendees[0].email, reader); assert.equal(b.eventType.slug, one.slug); assert.equal(b.hosts[0].email, 'coach@example.com')
    const { data: row } = await admin.from('bookings').select('uid, user_id, provider, status, host_id, start_at').eq('uid', uid).maybeSingle()
    assert.ok(row && row.provider === 'native' && row.status === 'accepted' && row.user_id === ids[reader] && row.host_id === coach, 'the row the app would have made')
    const { slots: after } = await cal.slots(sType, d1, d1, AMS); assert.ok(!(after[d1] || []).includes(first), 'the time is taken')
    const { slots: s2 } = await cal.slots(sType, d2, d2, AMS); const next = (s2[d2] || [])[0]; assert.ok(next)
    const moved = await cal.reschedule(uid, next, reader, 'probe')
    assert.equal(moved.uid, uid, 'a native move keeps the uid'); assert.equal(moved.start, new Date(next).toISOString())
    const { data: row2 } = await admin.from('bookings').select('start_at').eq('uid', uid).maybeSingle(); assert.equal(new Date(row2.start_at).toISOString(), new Date(next).toISOString())
    const { slots: freed } = await cal.slots(sType, d1, d1, AMS); assert.ok((freed[d1] || []).includes(first), 'the old time is open again')
    const cancelled = await cal.cancel(uid, 'app', 'probe'); assert.equal(cancelled.status, 'cancelled')
    const { data: row3 } = await admin.from('bookings').select('status').eq('uid', uid).maybeSingle(); assert.equal(row3.status, 'cancelled')
  })
  await ok('a type\'s declared hours stand in until the host sets their own, and never over them', async () => {
    const [day] = await pickDays(1)
    const sched = nativeScheduler({ db: admin, env: () => '' })
    /* a type that says when it is bookable: mornings, the host having set nothing */
    const declared = { ...one, hosts: ['coach@example.com'], seats: 0, duration: 60, buffer: 0, notice: 24,
      hours: { timezone: AMS, weekly: { 1: [['09:00', '11:00']], 2: [['09:00', '11:00']], 3: [['09:00', '11:00']], 4: [['09:00', '11:00']], 5: [['09:00', '11:00']] } } }
    await admin.from('provider_schedules').delete().eq('user_id', coach)
    const { slots: fromFile } = await sched.slots(declared, day, day, AMS)
    const mornings = fromFile[day] || []
    assert.ok(mornings.length >= 1, 'a folder with no set of hours still offers times: ' + mornings.length)
    assert.ok(mornings.every((s) => { const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: AMS, hour: '2-digit', hour12: false }).format(new Date(s))); return h >= 9 && h < 11 }), 'the times are the ones the file declares')
    /* a type that declares none is still an empty calendar — the default is a declaration, not a guess */
    const { slots: bare } = await sched.slots({ ...declared, hours: null }, day, day, AMS)
    assert.equal((bare[day] || []).length, 0, 'no hours anywhere is no times')
    /* and the moment the host sets their own, theirs is the only answer */
    await admin.from('provider_schedules').upsert({ user_id: coach, ...HOURS }, { onConflict: 'user_id,name' })
    const { slots: fromHost } = await sched.slots(declared, day, day, AMS)
    const theirs = fromHost[day] || []
    assert.ok(theirs.length > mornings.length, 'the host\'s own hours are wider than the file\'s: ' + theirs.length + ' vs ' + mornings.length)
    assert.ok(theirs.some((s) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: AMS, hour: '2-digit', hour12: false }).format(new Date(s))) >= 11), 'a time the file would have refused')
  })
  await ok('the judge holds through the API: not admitted, over the allowance, a paid type with no credit, a guest on a members\' type', async () => {
    const [day] = await pickDays(1)
    const { data: slotsR } = (await call(`/v2/slots?eventTypeSlug=${one.slug}&start=${day}&end=${day}&timeZone=${AMS}`, {}, key)).body
    const times = slotsR[day] || []; assert.ok(times.length >= 2)
    if (tier) { const r = await call('/v2/bookings', { method: 'POST', body: JSON.stringify({ start: times[0].start, eventTypeSlug: one.slug, attendee: { email: 'free@example.com', name: 'Free', timeZone: AMS }, metadata: { probe: 'schedapi' } }) }, key); assert.equal(r.status, 403, JSON.stringify(r.body)); assert.ok(['not-included', 'guest'].includes(r.body.error.details.code), r.body.error.details.code); assert.equal(r.body.status, 'error') }
    const g = await call('/v2/bookings', { method: 'POST', body: JSON.stringify({ start: times[0].start, eventTypeSlug: one.slug, attendee: { email: 'nobody.' + Date.now() + '@example.org', name: 'Nobody', timeZone: AMS } }) }, key)
    assert.equal(g.status, 403, JSON.stringify(g.body)); assert.equal(g.body.error.details.code, 'guest')
    const paidListed = paidType && tier && catalog.allowances && catalog.allowances[tier] && catalog.allowances[tier][paidType.slug]
    if (paidType && paidListed) note('the paid type is included in ' + tier + ' — the unpaid refusal is not exercised here')
    if (paidType && !paidListed) { const p = await call('/v2/bookings', { method: 'POST', body: JSON.stringify({ start: times[0].start, eventTypeSlug: paidType.slug, attendee: { email: reader, timeZone: AMS }, metadata: { probe: 'schedapi' } }) }, key); assert.equal(p.status, 402, JSON.stringify(p.body)); assert.equal(p.body.error.details.code, 'unpaid') }
    if (one.weekly === 1 || (catalog.allowances && tier && catalog.allowances[tier] && catalog.allowances[tier][one.slug] && catalog.allowances[tier][one.slug].weekly === 1)) {
      const a = await call('/v2/bookings', { method: 'POST', body: JSON.stringify({ start: times[0].start, eventTypeSlug: one.slug, attendee: { email: reader, timeZone: AMS }, bookingFieldsResponses: { notes: 'probe-schedapi' } }) }, key); assert.equal(a.status, 201, JSON.stringify(a.body)); madeBookings.push(a.body.data.uid)
      const b = await call('/v2/bookings', { method: 'POST', body: JSON.stringify({ start: times[1].start, eventTypeSlug: one.slug, attendee: { email: reader, timeZone: AMS }, bookingFieldsResponses: { notes: 'probe-schedapi' } }) }, key); assert.equal(b.status, 403, JSON.stringify(b.body)); assert.equal(b.body.error.details.code, 'over')
      await call(`/v2/bookings/${a.body.data.uid}/cancel`, { method: 'POST', body: JSON.stringify({ cancellationReason: 'probe' }) }, key)
    } else note('the type allows more than one a week — the allowance refusal is not exercised here')
    const bad = await call('/v2/bookings', { method: 'POST', body: JSON.stringify({ start: 'nope', eventTypeSlug: one.slug, attendee: { email: reader } }) }, key); assert.equal(bad.status, 400)
    const nf = await call('/v2/event-types/999999999', {}, key); assert.equal(nf.status, 404); assert.equal(nf.body.error.code, 'NOT_FOUND')
    const none = await call('/v2/event-types'); assert.equal(none.status, 401)
    const dk = await makeKey('delivery'); const other = await call('/v2/event-types', {}, dk); assert.equal(other.status, 403)
  })
  await ok('a reader\'s JWT: their own bookings, an admitted type\'s slots, 403 for one their plan does not admit', async () => {
    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: sess, error } = await sb.auth.signInWithPassword({ email: reader, password: 'password123' }); assert.ok(!error, error && error.message)
    const jwt = sess.session.access_token
    const me = await call('/v2/me', {}, jwt); assert.equal(me.status, 200); assert.equal(me.body.data.email, reader)
    const mine = await call('/v2/bookings?status=cancelled', {}, jwt); assert.equal(mine.status, 200); assert.ok(mine.body.data.every((b) => b.attendees.some((a) => a.email === reader)), 'only their own')
    const [day] = await pickDays(1)
    const sl = await call(`/v2/slots?eventTypeSlug=${one.slug}&start=${day}&end=${day}&timeZone=${AMS}`, {}, jwt); assert.equal(sl.status, 200)
    if (tier) { const { data: fs2 } = await createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }).auth.signInWithPassword({ email: 'free@example.com', password: 'password123' }); const r = await call(`/v2/slots?eventTypeSlug=${one.slug}&start=${day}&end=${day}`, {}, fs2.session.access_token); assert.equal(r.status, 403, 'not theirs: ' + r.status); const et = await call('/v2/event-types', {}, fs2.session.access_token); assert.ok(!et.body.data.some((e) => e.slug === one.slug), 'not listed for a reader the plan does not admit') }
    const hooks = await call('/v2/webhooks', {}, jwt); assert.equal(hooks.status, 403, 'webhooks are the site\'s')
    const all = await call('/v2/bookings?status=cancelled', {}, key); assert.ok(all.body.data.length >= mine.body.data.length, 'a key sees every booking')
  })
  await ok('webhooks: subscribed with cal.com\'s shape, a native booking made and cancelled reaches the receiver twice under X-Cal-Signature-256, listed, deleted, then silent', async () => {
    const got = []
    const server = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push({ sig: req.headers['x-cal-signature-256'], body: b }); res.writeHead(200); res.end('ok') }) })
    await new Promise((r) => server.listen(0, '0.0.0.0', r))
    const receiver = `http://host.docker.internal:${server.address().port}/schedapi-hook`
    try {
      const secret = 'shh-' + Math.random().toString(36).slice(2)
      const w = await call('/v2/webhooks', { method: 'POST', body: JSON.stringify({ subscriberUrl: receiver, triggers: ['BOOKING_CREATED', 'BOOKING_CANCELLED'], active: true, secret }) }, key)
      assert.equal(w.status, 201, JSON.stringify(w.body)); assert.equal(w.body.data.subscriberUrl, receiver); assert.deepEqual(w.body.data.triggers, ['BOOKING_CREATED', 'BOOKING_CANCELLED']); assert.equal(w.body.data.secret, undefined)
      const list = await call('/v2/webhooks', {}, key); assert.ok(list.body.data.some((x) => x.uid === w.body.data.uid))
      const [day] = await pickDays(1)
      const { data: slotsR } = (await call(`/v2/slots?eventTypeSlug=${one.slug}&start=${day}&end=${day}&timeZone=${AMS}`, {}, key)).body
      const t = (slotsR[day] || [])[0].start
      const b = await call('/v2/bookings', { method: 'POST', body: JSON.stringify({ start: t, eventTypeSlug: one.slug, attendee: { email: reader, name: 'Probe', timeZone: AMS }, bookingFieldsResponses: { notes: 'probe-schedapi' } }) }, key)
      assert.equal(b.status, 201, JSON.stringify(b.body)); madeBookings.push(b.body.data.uid)
      for (let i = 0; i < 40 && got.length < 1; i++) await new Promise((x) => setTimeout(x, 250))
      assert.equal(got.length, 1, 'the creation delivered')
      const p1 = JSON.parse(got[0].body); assert.equal(p1.triggerEvent, 'BOOKING_CREATED'); assert.equal(p1.payload.uid, b.body.data.uid); assert.equal(p1.payload.attendees[0].email, reader); assert.equal(p1.payload.organizer.email, 'coach@example.com')
      assert.equal(got[0].sig, createHmac('sha256', secret).update(got[0].body).digest('hex'), 'X-Cal-Signature-256 verifies')
      const c = await call(`/v2/bookings/${b.body.data.uid}/cancel`, { method: 'POST', body: JSON.stringify({ cancellationReason: 'probe' }) }, key); assert.equal(c.status, 200); assert.equal(c.body.data.status, 'cancelled')
      for (let i = 0; i < 40 && got.length < 2; i++) await new Promise((x) => setTimeout(x, 250))
      assert.equal(got.length, 2, 'the cancellation delivered'); assert.equal(JSON.parse(got[1].body).triggerEvent, 'BOOKING_CANCELLED')
      const one1 = await call('/v2/webhooks/' + w.body.data.uid, {}, key); assert.equal(one1.status, 200); assert.ok(one1.body.data.lastDeliveredAt)
      const upd = await call('/v2/webhooks/' + w.body.data.uid, { method: 'PATCH', body: JSON.stringify({ active: false }) }, key); assert.equal(upd.body.data.active, false)
      const del = await call('/v2/webhooks/' + w.body.data.uid, { method: 'DELETE' }, key); assert.equal(del.status, 200)
      const gone = await call('/v2/webhooks/' + w.body.data.uid, {}, key); assert.equal(gone.status, 404)
      const t2 = (slotsR[day] || [])[1].start
      const b2 = await call('/v2/bookings', { method: 'POST', body: JSON.stringify({ start: t2, eventTypeSlug: one.slug, attendee: { email: reader, timeZone: AMS }, bookingFieldsResponses: { notes: 'probe-schedapi' } }) }, key)
      if (b2.status === 201) { madeBookings.push(b2.body.data.uid); await call(`/v2/bookings/${b2.body.data.uid}/cancel`, { method: 'POST', body: '{}' }, key) }
      await new Promise((x) => setTimeout(x, 1500)); assert.equal(got.length, 2, 'nothing more arrives')
    } finally { server.close() }
  })
  await ok('a schedule: the coach\'s hours as cal.com\'s, under a key', async () => {
    const r = await call('/v2/schedules', {}, key); assert.equal(r.status, 200)
    /* A HOST KEEPS SEVERAL SETS, so the route answers one row per set and its id is the set's; the
       host is the ownerId, and the one that stands for them is the default. */
    const sc = r.body.data.find((x) => x.ownerId === eventTypeId('user:coach@example.com') && x.isDefault); assert.ok(sc, 'the coach\'s default schedule'); assert.equal(sc.timeZone, AMS); assert.ok(sc.availability.some((a) => a.startTime === '09:00' && a.endTime === '12:00' && a.days.includes('Monday')))
    const one1 = await call('/v2/schedules/' + sc.id, {}, key); assert.equal(one1.status, 200)
  })
  /* ---- (3) cal.com's embed on Playwright ---- */
  await ok('cal.com\'s embed on another origin: the booking page inline, the reader signs in inside it and books a time, bookingSuccessfulV2 on the parent', async () => {
    const appUrl = (stackOf()?.app || '').replace(/\/+$/, '')
    let up = false; try { up = (await fetch(appUrl + '/book/' + one.slug, { signal: AbortSignal.timeout(3000) })).ok } catch { /* down */ }
    if (!up) { note('the dev server is not up at ' + appUrl + ' — the embed is checked by hand'); return }
    const embedJs = fs.readFileSync(new URL(import.meta.resolve('@calcom/embed-core/dist/embed/embed.js')), 'utf8')
    const snippet = `(function (C, A, L) { let p = function (a, ar) { a.q.push(ar); }; let d = C.document; C.Cal = C.Cal || function () { let cal = C.Cal; let ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; api.q = api.q || []; if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]); } else p(cal, ar); return; } p(cal, ar); }; })(window, "/embed.js", "init");`
    const page = `<!doctype html><html><body><div id="c" style="width:100%;min-height:700px"></div><script>window.events = []</script><script>${snippet}</script><script>
      Cal("init", { origin: "${appUrl}" })
      Cal("inline", { elementOrSelector: "#c", calLink: "book/${one.slug}", config: { theme: "light" } })
      Cal("on", { action: "bookingSuccessfulV2", callback: (e) => events.push("booked:" + e.detail.data.uid) })
      Cal("on", { action: "linkReady", callback: () => events.push("linkReady") })
      Cal("on", { action: "__dimensionChanged", callback: (e) => events.push("size:" + e.detail.data.iframeHeight) })
    </script></body></html>`
    const host = http.createServer((req, res) => { if (req.url.startsWith('/embed.js')) { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(embedJs) } res.writeHead(200, { 'content-type': 'text/html' }); res.end(page) })
    await new Promise((r) => host.listen(0, '127.0.0.1', r))
    const origin = 'http://127.0.0.1:' + host.address().port
    try {
      const { chromium } = await import('playwright')
      const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH
      const b = await chromium.launch(exe ? { executablePath: exe } : {})
      const p = await (await browserContext(b, { viewport: { width: 1280, height: 1000 } })).newPage()
      const errs = []; p.on('pageerror', (e) => errs.push(e.message))
      await p.goto(origin + '/', { waitUntil: 'load' })
      const frame = await (async () => { for (let i = 0; i < 60; i++) { const f = p.frames().find((f) => f.url().includes('/book/' + one.slug)); if (f) return f; await p.waitForTimeout(500) } return null })()
      assert.ok(frame, 'the iframe opened the booking page: ' + p.frames().map((f) => f.url()).join(' | '))
      await frame.waitForSelector('.bookpage', { timeout: 30000 })
      /* the reader signs in inside the frame */
      await frame.waitForSelector('.bookpage-gate button', { timeout: 30000 }); await frame.click('.bookpage-gate button')
      await frame.waitForSelector('.au-card input[type=email]', { timeout: 15000 })
      await frame.fill('.au-card input[type=email]', reader); await frame.fill('.au-card input[type=password]', 'password123'); await frame.click('.au-submit')
      await frame.waitForSelector('.bk-day.open', { timeout: 30000 })
      await p.waitForFunction(() => window.events.includes('linkReady'), null, { timeout: 15000 })
      const shots = process.env.SCHEDULING_API_SHOTS
      if (shots) { await p.waitForTimeout(800); await p.screenshot({ path: path.join(shots, 'cal-embed-1280.png') }) }
      await frame.click('.bk-day.open'); await frame.waitForSelector('.bk-time', { timeout: 15000 }); await frame.click('.bk-time')
      await frame.waitForSelector('.bk-confirm .bk-btn:not(.ghost)', { timeout: 15000 }); await frame.fill('.bk-notes textarea', 'probe-schedapi'); await frame.click('.bk-confirm .bk-btn:not(.ghost)')
      await p.waitForFunction(() => window.events.some((e) => e.startsWith('booked:')), null, { timeout: 30000 })
      const ev = await p.evaluate(() => window.events)
      const uid2 = ev.find((e) => e.startsWith('booked:')).slice(7); madeBookings.push(uid2)
      assert.ok(ev.some((e) => e.startsWith('size:')), 'the size reported: ' + ev.join(','))
      const got = await call('/v2/bookings/' + uid2, {}, key); assert.equal(got.status, 200); assert.equal(got.body.data.attendees[0].email, reader)
      assert.deepEqual(errs, [])
      if (shots) { await p.waitForTimeout(800); await p.screenshot({ path: path.join(shots, 'cal-embed-booked-1280.png') }) }
      await b.close()
    } finally { host.close() }
  })
} finally {
  await sweep()
  if (saved.hours) await admin.from('provider_schedules').upsert(saved.hours); else await admin.from('provider_schedules').delete().eq('user_id', coach)
  await admin.from('provider_overrides').delete().eq('user_id', coach); if (saved.overrides.length) await admin.from('provider_overrides').insert(saved.overrides)
  const hashes = []; for (const k of madeKeys) hashes.push(await sha256(k))
  if (hashes.length) await admin.from('api_keys').delete().in('hash', hashes)
}
note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''}`)
process.exit(fail ? 1 : 0)
