/* The site's own scheduler (session-slots / book-session / cancel-session over _shared/schedulers/native.js): the
   open times are a host's hours less their bookings; a time is never booked twice; the judge holds for a native type;
   a move keeps the notice for the reader and not for the host; a no-show is the host's; a host's hours are theirs
   under RLS. Runs against the served functions of the site in cwd and picks a native booking type from its catalog
   (the demo has three; a site with none skips with a note). The hours are set through the coach-hours function as
   the Coaching tab sets them. Every booking it makes carries the note 'probe-sched' and every grant the source
   'probe-sched' / 'probe-al', and the sweep — run before the checks as well as after, so a run cut short leaves
   nothing for the next — removes them with what followed them (a paid session's week of chat, a reminder, the
   invitee's account). The readers it books with are chosen by what the seed has already booked for them, so the
   demo's own members' call never counts against the run. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { openStarts, byDay, wallToUtc, dayOf } from '../supabase/functions/_shared/schedulers/times.js'

let n = 0, bad = 0
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }
const url = supabaseUrl(), anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
let up = false
try { up = url && localStack() && (await fetch(url + '/rest/v1/', { headers: { apikey: anonKey }, signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
let served = false
if (up) { try { served = (await fetch(url + '/functions/v1/session-slots', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* not served */ } }
if (!up || !served) { console.log(`scheduling: skipped — ${!up ? 'the local stack is not up' : 'the functions are not served (npm run dev serves them)'}`); process.exit(0) }
const catalog = JSON.parse(fs.readFileSync('supabase/functions/_shared/catalog.json', 'utf8'))
const types = (catalog.sessions || []).filter((s) => s.scheduler === 'native')
const one = types.find((s) => !s.sku && !(s.seats > 0) && s.duration === 60 && s.hosts.includes('coach@example.com'))   /* an hour long: the overlaps below are counted for an hour */
const group = types.find((s) => !s.sku && s.seats > 0 && s.hosts.includes('coach@example.com'))
const paidType = (catalog.sessions || []).find((s) => s.scheduler === 'native' && s.sku && s.hosts.includes('coach@example.com'))
const allowances = catalog.allowances || {}
const linked = types.find((s) => !s.sku && !(s.seats > 0) && s.where?.kind === 'link' && s.hosts.includes('coach@example.com'))
/* Mailpit takes the local stack's mail (npm run dev points SMTP_HOST at it): its API on the stack's inbucket port */
const MAIL = url.replace(/:\d+$/, ':54324')
const mail = { async up() { try { return (await fetch(MAIL + '/api/v1/messages?limit=1', { signal: AbortSignal.timeout(1500) })).ok } catch { return false } }, async clear() { await fetch(MAIL + '/api/v1/messages', { method: 'DELETE' }) }, async list() { const r = await fetch(MAIL + '/api/v1/messages?limit=50'); return (await r.json()).messages || [] }, async raw(id) { return await (await fetch(MAIL + '/api/v1/message/' + id + '/raw')).text() } }
/* IS THE SITE'S MAIL GOING TO THE LOCAL MAILPIT? Only then are the letters safe to read — Mailpit
   answers on every machine that has the stack running, and on one whose SMTP_HOST is a real relay
   the letters go there instead, so asking Mailpit whether it is awake and then reading nothing is a
   failure about somebody's .env rather than about the code. */
const toMailpit = () => {
  let h = process.env.SMTP_HOST || ''
  if (!h) { try { h = (fs.readFileSync('.env', 'utf8').match(/^SMTP_HOST=(.*)$/m) || [, ''])[1].trim().replace(/^["']|["']$/g, '') } catch { h = '' } }
  return /^(127\.|localhost$|0\.0\.0\.0$|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)
}
const mailUp = toMailpit() && await mail.up()
if (!mailUp) console.log('scheduling: the site\'s relay is not the local Mailpit — the letters are not looked at')
const settle = (ms = 2500) => new Promise((r) => setTimeout(r, ms))
const publicType = (catalog.sessions || []).find((s) => s.published !== false && ['anyone', 'guest'].includes(s.requires))
if (publicType) {
  const post = async (name, body) => {
    const r = await fetch(url + '/functions/v1/' + name, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, ...(await r.json().catch(() => ({}))) }
  }
  await ta('anonymous availability is limited to public declared types, and booking and paid checkout still require a JWT', async () => {
    const open = await post('session-slots', { event: publicType.event, from: 'bad', to: 'bad' })
    assert.equal(open.status, 400, JSON.stringify(open))  /* passed the public gate; invalid dates stop before the scheduler */
    const privateType = (catalog.sessions || []).find((s) => s.published !== false && !['anyone', 'guest'].includes(s.requires))
    if (privateType) {
      const denied = await post('session-slots', { event: privateType.event, from: 'bad', to: 'bad' })
      assert.equal(denied.status, 401, JSON.stringify(denied))
    }
    const book = await post('book-session', { event: publicType.event, start: new Date(Date.now() + 864e5).toISOString(), timeZone: 'UTC' })
    assert.equal(book.status, 401, JSON.stringify(book))
    if (publicType.sku) {
      const checkout = await post('create-checkout-session', { items: [{ sku: publicType.sku, quantity: 1 }], booking: { event: publicType.event, start: new Date(Date.now() + 864e5).toISOString(), timeZone: 'UTC' } })
      assert.equal(checkout.status, 400, JSON.stringify(checkout))
      assert.equal(checkout.code, 'guest_session_cart', JSON.stringify(checkout))
    }
  })
} else console.log('scheduling: no public session type to test anonymous availability')
if (!one) { console.log('scheduling: skipped — this site has no native 60-minute one-to-one type hosted by coach@example.com (the demo has)'); process.exit(0) }

const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const as = async (email) => { const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }); const { error } = await sb.auth.signInWithPassword({ email, password: 'password123' }); if (error) throw new Error(email + ': ' + error.message); return sb }
const fn = async (sb, name, body) => { const { data, error } = await sb.functions.invoke(name, { body }); if (error) { let j = null; try { j = await error.context.json() } catch { /* none */ } return { status: error.context ? error.context.status : 500, ...(j || { error: error.message }) } } return { status: 200, ...data } }
const ids = {}
for (const e of ['member@example.com', 'member2@example.com', 'free@example.com', 'coach@example.com', 'admin@example.com', 'writer@example.com']) { const { data } = await admin.from('profiles').select('id').eq('email', e).maybeSingle(); if (data) ids[e] = data.id }
const coach = ids['coach@example.com']
const AMS = 'Europe/Amsterdam'
const HOURS = { timezone: AMS, weekly: { 1: [['09:00', '12:00']], 2: [['09:00', '12:00']], 3: [['09:00', '12:00']], 4: [['09:00', '12:00']], 5: [['09:00', '12:00']] }, buffer_before: 0, buffer_after: 0, notice_hours: 24, max_per_day: 0 }
/* a weekday at least three days out, with nothing of the coach's on it */
const pickDay = async () => { for (let i = 3; i < 20; i++) { const ms = Date.now() + i * 864e5; const { day, weekday } = dayOf(ms, AMS); if (weekday > 5) continue; const { data } = await admin.from('bookings').select('uid').eq('host_id', coach).gte('start_at', day + 'T00:00:00Z').lte('start_at', day + 'T23:59:59Z'); if (!(data || []).length) return day } throw new Error('no free weekday') }
const grant = async (email, tier) => { await admin.from('entitlements').insert({ user_id: ids[email], kind: 'class', key: 'subscribed', source: 'grant', source_id: 'probe-sched', tier, active: true, expires_at: new Date(Date.now() + 864e5).toISOString() }) }
/* a host keeps any number of sets now, so the run puts back every one of them, exactly */
const saved = { hours: (await admin.from('provider_schedules').select('*').eq('user_id', coach)).data || [], overrides: (await admin.from('provider_overrides').select('*').eq('user_id', coach)).data || [] }
const made = []   /* uids to remove */
const newUsers = []   /* accounts the run made */
/* what a run leaves and the next must not meet: its bookings (by the note, the probe uids, the uids in hand) with
   the entitlements a paid one granted (session:<uid>) and its reminders, its grants, the invitee's account */
async function sweep() {
  const { data: mine } = await admin.from('bookings').select('uid').or("payload->>notes.eq.probe-sched,uid.like.ns_probe%")
  const uids = [...new Set([...(mine || []).map((b) => b.uid), ...made])]
  if (uids.length) {
    await admin.from('entitlements').delete().in('source_id', uids.map((u) => 'session:' + u))
    await admin.from('session_reminders').delete().in('booking_uid', uids)
    await admin.from('bookings').delete().in('uid', uids)
  }
  /* a week of chat whose booking is gone (a run killed between the two deletes) */
  const { data: weeks } = await admin.from('entitlements').select('id, source_id').like('source_id', 'session:ns_%')
  if (weeks && weeks.length) { const { data: live } = await admin.from('bookings').select('uid').in('uid', weeks.map((w) => w.source_id.slice(8))); const have = new Set((live || []).map((b) => b.uid)); const gone = weeks.filter((w) => !have.has(w.source_id.slice(8))).map((w) => w.id); if (gone.length) await admin.from('entitlements').delete().in('id', gone) }
  await admin.from('entitlements').delete().in('source_id', ['probe-sched', 'probe-al'])
  await admin.from('provider_ooo').delete().eq('reason', 'probe-sched')
  { const { data: w } = await admin.from('profiles').select('id').eq('email', 'writer@example.com').maybeSingle(); if (w) await admin.from('provider_schedules').delete().eq('user_id', w.id) }
  const { data: guest } = await admin.from('profiles').select('id').eq('email', 'guest.person@example.org').maybeSingle()
  if (guest) await admin.auth.admin.deleteUser(guest.id).catch(() => {})
}
await sweep()
/* the readers the run books with: of the seed's three, those with no accepted booking of a type in the last month
   (the seed itself books the demo's member on the members' call) */
const fresh = async (event, n) => { const out = []; for (const e of ['member@example.com', 'member2@example.com', 'free@example.com']) { const { data } = await admin.from('bookings').select('uid').eq('user_id', ids[e]).eq('event', event).in('status', ['accepted', 'pending']).gte('start_at', new Date(Date.now() - 31 * 864e5).toISOString()); if (!(data || []).length) out.push(e); if (out.length === n) break } return out }

try {
  const tier = ['anyone', 'guest', 'authenticated'].includes(one.requires) ? null : one.requires
  for (const e of ['member@example.com', 'member2@example.com', 'free@example.com']) if (tier) await grant(e, tier)
  const member = await as('member@example.com'), member2 = await as('member2@example.com'), free = await as('free@example.com'), host = await as('coach@example.com')
  const day = await pickDay()
  const at = (hhmm) => new Date(wallToUtc(day, hhmm, AMS)).toISOString()
  /* the paid type's checks book on a day of their own: by then the first day's morning is full */
  const pickAnother = async (...not) => { for (let i = 3; i < 200; i++) { const ms = Date.now() + i * 864e5; const { day: d, weekday } = dayOf(ms, AMS); if (weekday > 5 || not.includes(d)) continue; const { data } = await admin.from('bookings').select('uid').eq('host_id', coach).in('status', ['accepted', 'pending']).gte('start_at', d + 'T00:00:00Z').lte('start_at', d + 'T23:59:59Z'); if (!(data || []).length) return d } throw new Error('no free weekday left — every check takes one, so the scan looks half a year out') }
  const day2 = await pickAnother(day)
  /* each check that books several times wants a morning of its own, or the last one's bookings would
     be the next one's "busy" — so the days are handed out rather than picked twice */
  const used = [day, day2]
  const nextDay = async () => { const d = await pickAnother(...used); used.push(d); return d }

  await ta('the hours are set through coach-hours as the Coaching tab sets them, and read back', async () => {
    const r = await fn(host, 'coach-hours', { action: 'set', hours: HOURS })
    assert.equal(r.status, 200, JSON.stringify(r))
    await admin.from('provider_overrides').delete().eq('user_id', coach)
    const g = await fn(host, 'coach-hours', { action: 'get' })
    assert.equal(g.hours.timezone, AMS); assert.equal(g.hours.notice_hours, 24); assert.deepEqual(g.hours.weekly['1'], [['09:00', '12:00']])
  })
  await ta('the open times are the host\'s hours: 09:00 … 11:00 on the 15-minute step, nothing within the notice', async () => {
    const r = await fn(member, 'session-slots', { event: one.event, from: day, to: day, timeZone: 'UTC' })
    assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.scheduler, 'native'); assert.equal(r.minutes, one.duration)
    const expected = byDay(openStarts({ hours: { ...HOURS, overrides: [] }, type: { duration: one.duration, step: 15 }, from: day, to: day, now: Date.now() }), 'UTC')
    assert.deepEqual(r.slots, expected)
    const all = Object.values(r.slots).flat()
    assert.equal(all[0], at('09:00')); assert.ok(all.length >= 5, 'a morning of starts')
    const soon = dayOf(Date.now() + 36e5, AMS).day
    const s2 = await fn(member, 'session-slots', { event: one.event, from: soon, to: soon, timeZone: 'UTC' })
    assert.equal(Object.values(s2.slots || {}).flat().filter((t) => Date.parse(t) < Date.now() + 24 * 36e5).length, 0, 'nothing inside 24 hours')
  })
  await ta('a day off by exception offers nothing, and is gone when removed', async () => {
    const r = await fn(host, 'coach-hours', { action: 'override', day, ranges: null })
    assert.equal(r.status, 200, JSON.stringify(r))
    const s = await fn(member, 'session-slots', { event: one.event, from: day, to: day, timeZone: 'UTC' })
    assert.deepEqual(s.slots, {})
    const d = await fn(host, 'coach-hours', { action: 'unoverride', day })
    assert.equal(d.status, 200)
    const s2 = await fn(member, 'session-slots', { event: one.event, from: day, to: day, timeZone: 'UTC' })
    assert.ok(Object.values(s2.slots).flat().length > 0)
  })
  let booked = null
  await ta('a booking is the site\'s own row, with the host and the place, and the overlapping times are gone', async () => {
    const r = await fn(member, 'book-session', { event: one.event, start: at('10:00'), timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(r.status, 200, JSON.stringify(r)); booked = r.booking; made.push(booked.uid)
    assert.ok(booked.uid.startsWith('ns_'))
    const { data: row } = await admin.from('bookings').select('*').eq('uid', booked.uid).single()
    assert.equal(row.provider, 'native'); assert.equal(row.host_id, coach); assert.equal(row.provider_id, coach); assert.equal(row.type, one.slug); assert.equal(row.status, 'accepted')
    assert.equal(row.where.kind, one.where.kind); assert.equal(Date.parse(row.end_at), Date.parse(at('10:00')) + one.duration * 6e4)
    assert.ok(row.followup_at, 'the follow-up timed'); assert.equal(Date.parse(row.followup_at) - Date.parse(row.end_at), 5 * 6e4)
    const s = await fn(member, 'session-slots', { event: one.event, from: day, to: day, timeZone: 'UTC' })
    const all = Object.values(s.slots).flat()
    assert.ok(!all.includes(at('10:00')) && !all.includes(at('09:15')) && !all.includes(at('10:45')), 'the overlapping starts are gone: ' + JSON.stringify({ booked: row.start_at, all }))
    assert.ok(all.includes(at('09:00')) || one.duration > 60, '09:00 stands for a 60-minute session')
  })
  let loser = 'free@example.com', loserSb = free
  await ta('the last time, twice: one booking, the other told taken', async () => {
    const [a, b] = await Promise.all([fn(member2, 'book-session', { event: one.event, start: at('09:00'), timeZone: 'UTC', notes: 'probe-sched' }), fn(free, 'book-session', { event: one.event, start: at('09:00'), timeZone: 'UTC', notes: 'probe-sched' })])
    if (a.status === 200) { loser = 'free@example.com'; loserSb = free } else { loser = 'member2@example.com'; loserSb = member2 }
    const okays = [a, b].filter((r) => r.status === 200), takens = [a, b].filter((r) => r.status === 409 && r.code === 'taken')
    for (const r of okays) made.push(r.booking.uid)
    assert.equal(okays.length, 1, JSON.stringify([a, b])); assert.equal(takens.length, 1, JSON.stringify([a, b]))
    const { data } = await admin.from('bookings').select('uid').eq('host_id', coach).eq('start_at', at('09:00')).in('status', ['accepted', 'pending'])
    assert.equal(data.length, 1)
  })
  await ta('the judge holds for a native type: over the allowance is refused', async () => {
    if (!(one.monthly > 0 || one.weekly > 0)) return
    const r = await fn(member, 'book-session', { event: one.event, start: at('11:00'), timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(r.status, 403, JSON.stringify(r)); assert.equal(r.code, 'over')
  })
  await ta('a move 30+ hours ahead lands, frees the old time, keeps the uid; inside the notice the reader is refused and the host is not', async () => {
    const r = await fn(member, 'book-session', { event: one.event, start: at('11:00'), timeZone: 'UTC', reschedule: booked.uid, notes: 'probe-sched' })
    assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.booking.uid, booked.uid)
    const s = await fn(member, 'session-slots', { event: one.event, from: day, to: day, timeZone: 'UTC' })
    assert.ok(Object.values(s.slots).flat().includes(at('10:00')), 'the old time is open again')
    /* a booking of theirs 10 hours out */
    const soonStart = new Date(Date.now() + 10 * 36e5); soonStart.setUTCMinutes(0, 0, 0)
    const uid = 'ns_probe' + Date.now().toString(36)
    await admin.from('bookings').insert({ uid, provider: 'native', type: one.slug, event: one.event, title: one.title, user_id: ids[loser], email: loser, name: 'Probe', host_id: coach, provider_id: coach, provider_email: 'coach@example.com', attendee_emails: ['member2@example.com'], start_at: soonStart.toISOString(), end_at: new Date(soonStart.getTime() + one.duration * 6e4).toISOString(), status: 'accepted', where: { kind: 'none' } })
    made.push(uid)
    const later = new Date(soonStart.getTime() + 3 * 864e5); later.setUTCHours(7, 0, 0, 0)
    const m2 = await fn(loserSb, 'book-session', { event: one.event, start: later.toISOString(), timeZone: 'UTC', reschedule: uid, notes: 'probe-sched' })
    assert.equal(m2.status, 403, JSON.stringify(m2)); assert.equal(m2.code, 'too-soon'); assert.equal(m2.hours, one.notice)
    const c = await fn(loserSb, 'cancel-session', { uid })
    assert.equal(c.status, 403, JSON.stringify(c)); assert.equal(c.code, 'too-soon')
    const h = await fn(host, 'cancel-session', { uid, reason: 'the host cancels' })
    assert.equal(h.status, 200, JSON.stringify(h))
    const { data: row } = await admin.from('bookings').select('status').eq('uid', uid).single()
    assert.equal(row.status, 'cancelled')
  })
  await ta('a cancellation by the reader beyond the notice frees the time', async () => {
    const r = await fn(member, 'cancel-session', { uid: booked.uid })
    assert.equal(r.status, 200, JSON.stringify(r))
    const s = await fn(member, 'session-slots', { event: one.event, from: day, to: day, timeZone: 'UTC' })
    assert.ok(Object.values(s.slots).flat().includes(at('11:00')))
  })
  await ta('booked: the reader and the host each get the email with the invitation — the place in its location, a link as its url', async () => {
    if (!mailUp) { console.log('    (Mailpit is not up: the emails are not checked)'); return }
    await mail.clear()
    const r = await fn(member, 'book-session', { event: one.event, start: at('10:00'), timeZone: 'Europe/Amsterdam', notes: 'probe-sched' })
    assert.equal(r.status, 200, JSON.stringify(r)); made.push(r.booking.uid)
    await settle()
    const list = await mail.list()
    const booked = list.filter((m) => /is booked/.test(m.Subject))
    assert.equal(booked.length, 2, JSON.stringify(list.map((m) => m.Subject)))
    const tos = booked.map((m) => m.To[0].Address).sort()
    assert.deepEqual(tos, ['coach@example.com', 'member@example.com'])
    const raw = await mail.raw(booked.find((m) => m.To[0].Address === 'member@example.com').ID)
    assert.ok(/BEGIN:VCALENDAR/.test(raw) && /METHOD:REQUEST/.test(raw), 'an invitation attached')
    if (one.where?.kind === 'place') { const un = raw.replace(/=\r?\n/g, '').replace(/\r?\n /g, ''); assert.ok(un.includes('LOCATION:' + (one.where.name || '').replace(/,/g, '\\,')), 'the place in the invitation\'s location: ' + (un.match(/LOCATION:[^\r\n]*/) || [])[0]) }
    assert.ok(!/cal\.com/.test(raw), 'no cal.com link')
    assert.ok(/One on one|with/.test(raw), 'the words')
    await fn(member, 'cancel-session', { uid: r.booking.uid })
    await settle()
    const cancelled = (await mail.list()).filter((m) => /is cancelled/.test(m.Subject))
    assert.equal(cancelled.length, 2)
    const craw = await mail.raw(cancelled[0].ID)
    assert.ok(/METHOD:CANCEL/.test(craw) && /SEQUENCE:1/.test(craw), 'a cancellation with its sequence')
    if (linked) {
      await mail.clear()
      const tier2 = ['anyone', 'guest', 'authenticated'].includes(linked.requires) ? null : linked.requires
      if (tier2 && tier2 !== tier) await grant('member@example.com', tier2)
      const l = await fn(member, 'book-session', { event: linked.event, start: at('11:00'), timeZone: 'UTC', notes: 'probe-sched' })
      assert.equal(l.status, 200, JSON.stringify(l)); made.push(l.booking.uid)
      assert.equal(l.booking.join_url, linked.where.url)
      await settle()
      const lraw = await mail.raw((await mail.list()).find((m) => m.To[0].Address === 'member@example.com').ID)
      assert.ok(lraw.replace(/=\r?\n/g, '').includes('URL:' + linked.where.url) || lraw.includes(linked.where.url), 'the link in the invitation')
    }
  })
  await ta('reminded at the policy\'s hours, once each, never for a cancelled session', async () => {
    if (!mailUp) return
    await mail.clear()
    const mk = async (uid, startMs, status = 'accepted') => { await admin.from('bookings').insert({ uid, provider: 'native', type: one.slug, event: one.event, title: one.title, user_id: ids['member@example.com'], email: 'member@example.com', name: 'Member Person', host_id: coach, provider_id: coach, provider_email: 'coach@example.com', attendee_emails: ['member@example.com'], start_at: new Date(startMs).toISOString(), end_at: new Date(startMs + one.duration * 6e4).toISOString(), status, where: { kind: 'none' }, payload: { tz: 'UTC' } }); made.push(uid) }
    const t = Date.now().toString(36)
    await mk('ns_probe24' + t, Date.now() + 24 * 36e5 - 5 * 6e4)
    await mk('ns_probe1' + t, Date.now() + 36e5 - 5 * 6e4)
    await mk('ns_probex' + t, Date.now() + 36e5 - 5 * 6e4, 'cancelled')
    await mk('ns_probefar' + t, Date.now() + 48 * 36e5)
    const call = async (body) => { const r = await fetch(url + '/functions/v1/session-reminders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + serviceKey() }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) } }
    const dry = await call({ action: 'send', dry: true })
    assert.equal(dry.status, 200, JSON.stringify(dry))
    assert.deepEqual(dry.reminders.map((d) => d.uid + ':' + d.hours).sort(), ['ns_probe1' + t + ':1', 'ns_probe24' + t + ':24'].sort(), JSON.stringify(dry))
    const first = await call({ action: 'send' })
    assert.equal(first.sent, 2, JSON.stringify(first))
    const again = await call({ action: 'send' })
    assert.equal(again.sent, 0); assert.equal(again.reminders.length, 0)
    await settle()
    const list = await mail.list()
    const rem = list.filter((m) => /Your session is/.test(m.Subject))
    assert.equal(rem.length, 2, JSON.stringify(list.map((m) => m.Subject)))
    assert.ok(rem.some((m) => /in 24 hours/.test(m.Subject)) && rem.some((m) => /in an hour/.test(m.Subject)), JSON.stringify(rem.map((m) => m.Subject)))
    assert.ok(rem.every((m) => m.To[0].Address === 'member@example.com'), 'the reader alone')
    const guest = await fetch(url + '/functions/v1/session-reminders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + anonKey }, body: '{"action":"send"}' })
    assert.equal(guest.status, 401)
    await admin.from('session_reminders').delete().like('booking_uid', 'ns_probe%')
  })
  await ta('a tier\'s own allowance: a tier that lists a type admits it under its counts, a paid one included; a tier that lists nothing leaves the type\'s rules', async () => {
    const [tierName, list] = Object.entries(allowances).find(([, l]) => paidType && l[paidType.slug]) || []
    if (!tierName) { console.log('    (no tier lists the paid type here — the demo\'s patron does)'); return }
    const al = list[paidType.slug]
    assert.equal(al.monthly, 2, 'the demo\'s patron: two a month')
    await admin.from('entitlements').delete().eq('source_id', 'probe-al')
    await admin.from('entitlements').insert({ user_id: ids['free@example.com'], kind: 'class', key: 'subscribed', source: 'grant', source_id: 'probe-al', tier: tierName, active: true, expires_at: new Date(Date.now() + 864e5).toISOString() })
    const freeSb = await as('free@example.com')
    const s1 = await fn(freeSb, 'session-slots', { event: paidType.event, from: day2, to: day2, timeZone: 'UTC' })
    assert.equal(s1.status, 200, JSON.stringify(s1))
    const times = Object.values(s1.slots).flat()
    assert.ok(times.length >= 3, 'a morning of open times for the paid type: ' + JSON.stringify(s1.slots))
    const a = await fn(freeSb, 'book-session', { event: paidType.event, start: times[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(a.status, 200, 'included by the tier, no credit asked: ' + JSON.stringify(a)); made.push(a.booking.uid)
    /* the next time still open once the first is booked */
    const s2 = await fn(freeSb, 'session-slots', { event: paidType.event, from: day2, to: day2, timeZone: 'UTC' })
    const open2 = Object.values(s2.slots).flat(); assert.ok(open2.length, 'a second open time: ' + JSON.stringify(s2.slots))
    const b = await fn(freeSb, 'book-session', { event: paidType.event, start: open2[open2.length - 1], timeZone: 'UTC', notes: 'probe-sched' })
    const { data: theirs } = await admin.from('bookings').select('uid, event, status, start_at, made_by').eq('user_id', ids['free@example.com'])
    assert.equal(b.status, 200, 'the second of two a month: ' + JSON.stringify(b) + ' theirs: ' + JSON.stringify(theirs)); made.push(b.booking.uid)
    const s3 = await fn(freeSb, 'session-slots', { event: paidType.event, from: day2, to: day2, timeZone: 'UTC' })
    const open3 = Object.values(s3.slots).flat(); assert.ok(open3.length, 'a third open time: ' + JSON.stringify(s3.slots))
    const c = await fn(freeSb, 'book-session', { event: paidType.event, start: open3[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(c.status, 403, JSON.stringify(c)); assert.equal(c.code, 'over')
    /* a reader with no listing tier is held to the type's own rule: a paid type asks for a credit (every grant of theirs off for the moment) */
    await admin.from('entitlements').delete().eq('user_id', ids['free@example.com']).in('source_id', ['probe-al', 'probe-sched'])
    const d = await fn(freeSb, 'book-session', { event: paidType.event, start: open3[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(d.status, 402, JSON.stringify(d)); assert.equal(d.code, 'unpaid')
    if (tier) await grant('free@example.com', tier)
  })
  await ta('a host books for people: no judge, no credit, every invitee on it, counted against no one; a reader may not', async () => {
    if (!paidType) return
    await mail.clear().catch(() => {})
    /* a host booking for somebody asks for THEIR OWN times, not the union: a time only a colleague
       keeps is no use to them, and would be refused as taken */
    const s1 = await fn(host, 'session-slots', { event: paidType.event, from: day2, to: day2, timeZone: 'UTC', host: coach })
    assert.equal(s1.status, 200, 'a host reads any type\'s times: ' + JSON.stringify(s1))
    const t = Object.values(s1.slots).flat()[0]
    assert.ok(t, 'an open time of the paid type on the day: ' + JSON.stringify(s1.slots))
    const countOwn = async () => ((await admin.from('bookings').select('uid').eq('user_id', ids['free@example.com']).eq('event', paidType.event).is('made_by', null).in('status', ['accepted', 'pending'])).data || []).length
    const before = await countOwn()
    const nope = await fn(member, 'book-session', { event: paidType.event, start: t, timeZone: 'UTC', for: ['free@example.com'], notes: 'probe-sched' })
    assert.equal(nope.status, 403, JSON.stringify(nope)); assert.equal(nope.code, 'not-host')
    const r = await fn(host, 'book-session', { event: paidType.event, start: t, timeZone: 'UTC', for: ['free@example.com', 'guest.person@example.org'], notes: 'probe-sched' })
    assert.equal(r.status, 200, JSON.stringify(r)); made.push(r.booking.uid)
    const { data: row } = await admin.from('bookings').select('user_id, email, attendee_emails, made_by, made_by_name, credit_id, host_id').eq('uid', r.booking.uid).single()
    assert.equal(row.user_id, ids['free@example.com']); assert.equal(row.email, 'free@example.com'); assert.deepEqual(row.attendee_emails.sort(), ['free@example.com', 'guest.person@example.org'])
    assert.equal(row.made_by, coach); assert.ok(row.made_by_name); assert.equal(row.credit_id, null); assert.equal(row.host_id, coach)
    /* the time is taken for others; the reader\'s own allowance is untouched */
    const taken = await fn(member, 'book-session', { event: one.event, start: t, timeZone: 'UTC', notes: 'probe-sched' })
    assert.ok(taken.status === 409 || taken.status === 403, JSON.stringify(taken))
    assert.equal(await countOwn(), before, 'nothing of theirs counted')
    if (mailUp) {
      await settle()
      const list = await mail.list()
      const booked = list.filter((m) => /is booked/.test(m.Subject))
      const tos = booked.map((m) => m.To[0].Address).sort()
      assert.deepEqual(tos, ['coach@example.com', 'free@example.com', 'guest.person@example.org'], JSON.stringify(tos))
    }
    /* an invitee with no account yet: signing up with that address finds the booking by email — no linking step */
    const { data: made2, error: mkErr } = await admin.auth.admin.createUser({ email: 'guest.person@example.org', password: 'password123', email_confirm: true, user_metadata: { full_name: 'Guest Person' } })
    assert.ok(!mkErr, mkErr && mkErr.message); newUsers.push(made2.user.id)
    const guestSb = await as('guest.person@example.org')
    const { data: seen } = await guestSb.from('bookings').select('uid, made_by_name').eq('uid', r.booking.uid)
    assert.equal((seen || []).length, 1, 'the invitee sees the booking once signed up with that address')
    const seats = await fn(host, 'book-session', { event: (group || one).event, start: t, timeZone: 'UTC', for: ['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org'], notes: 'probe-sched' })
    if (group && group.seats < 4) { assert.equal(seats.status, 400); assert.equal(seats.code, 'seats') } else if (seats.status === 200) made.push(seats.booking.uid)
  })
  await ta('a no-show is the host\'s to mark, after the time', async () => {
    const uid = 'ns_probepast' + Date.now().toString(36)
    await admin.from('bookings').insert({ uid, provider: 'native', type: one.slug, event: one.event, title: one.title, user_id: ids['free@example.com'], email: 'free@example.com', name: 'Free', host_id: coach, provider_id: coach, provider_email: 'coach@example.com', attendee_emails: ['free@example.com'], start_at: new Date(Date.now() - 2 * 36e5).toISOString(), end_at: new Date(Date.now() - 36e5).toISOString(), status: 'accepted', where: { kind: 'none' } })
    made.push(uid)
    const r = await fn(free, 'cancel-session', { uid, action: 'no-show' })
    assert.equal(r.status, 403)
    const h = await fn(host, 'cancel-session', { uid, action: 'no-show' })
    assert.equal(h.status, 200, JSON.stringify(h))
    const { data: row } = await admin.from('bookings').select('no_show, no_show_by, status').eq('uid', uid).single()
    assert.equal(row.no_show, true); assert.equal(row.no_show_by, coach); assert.equal(row.status, 'ended')
  })
  if (group) await ta('a group session: two readers share one time, under its seats', async () => {
    const gtier = ['anyone', 'guest', 'authenticated'].includes(group.requires) ? null : group.requires
    const two = await fresh(group.event, 2)
    assert.equal(two.length, 2, 'two of the seed\'s readers with no booking of the group type this month')
    if (gtier) for (const e of two) await grant(e, gtier)
    const [x, y] = await Promise.all(two.map((e) => as(e)))
    /* a day of its own (the group's ninety minutes need a clear morning), its last open start */
    const day3 = await nextDay()
    const s0 = await fn(x, 'session-slots', { event: group.event, from: day3, to: day3, timeZone: 'UTC' })
    const open = Object.values(s0.slots || {}).flat(); assert.ok(open.length, 'an open time for the group: ' + JSON.stringify(s0))
    const t0 = open[open.length - 1]
    const [a, b] = await Promise.all([fn(x, 'book-session', { event: group.event, start: t0, timeZone: 'UTC', notes: 'probe-sched' }), fn(y, 'book-session', { event: group.event, start: t0, timeZone: 'UTC', notes: 'probe-sched' })])
    assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b))
    made.push(a.booking.uid, b.booking.uid)
    const { data } = await admin.from('bookings').select('uid, seat_of').in('uid', [a.booking.uid, b.booking.uid])
    assert.equal(data.length, 2); assert.equal(data[0].seat_of, data[1].seat_of); assert.ok(data[0].seat_of)
  })
  /*
   * HOW A TYPE IS SHARED between its hosts. Each of these is a rota somebody has to be able to
   * predict: who takes the next booking, what a cancellation does to the order, whether a busy host
   * is skipped, and who the hosts even are when a team gives the type.
   */
  const rr = types.find((s) => s.assign === 'round-robin' && (s.team || s.hosts.length > 1) && !s.sku && !(s.seats > 0))
  if (rr) await ta('the rota puts the booking on the host whose turn it is, and a busy host is skipped', async () => {
    /* both hosts keep the same hours, so only the rota can decide between them */
    const both = rr.team ? (await admin.from('team_members').select('user_id').eq('team', rr.team)).data.map((m) => m.user_id) : (await admin.from('profiles').select('id').in('email', rr.hosts)).data.map((p) => p.id)
    assert.ok(both.length >= 2, 'the type has two hosts to share between: ' + JSON.stringify(both))
    for (const id of both) { await admin.from('provider_schedules').delete().eq('user_id', id); await admin.from('provider_schedules').insert({ user_id: id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayR = await nextDay()
    const who = async (start) => { const r = await fn(member, 'book-session', { event: rr.event, start, timeZone: 'UTC', notes: 'probe-sched' }); assert.equal(r.status, 200, JSON.stringify(r)); made.push(r.booking.uid); return (await admin.from('bookings').select('host_id').eq('uid', r.booking.uid).single()).data.host_id }
    const s = await fn(member, 'session-slots', { event: rr.event, from: dayR, to: dayR, timeZone: 'UTC' })
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length >= 2, 'two open times: ' + JSON.stringify(s))
    /* NOBODY HAS BEEN BOOKED, so the first goes to whichever the ladder settles on; the SECOND must
       go to the other one, because the first now has a turn behind them */
    const first = await who(open[0])
    const second = await who(open[1])
    assert.ok(both.includes(first) && both.includes(second), 'both bookings went to hosts of the type')
    assert.notEqual(first, second, 'the second booking went to the host who had not taken one')
    /* A CANCELLED BOOKING LEAVES THE TURN WHERE IT WAS: cancel the second, and the third goes back
       to the same host rather than to the one who still holds a confirmed booking. */
    const { data: sec } = await admin.from('bookings').select('uid').eq('host_id', second).eq('type', rr.slug).eq('status', 'accepted').order('start_at', { ascending: false }).limit(1)
    await admin.from('bookings').update({ status: 'cancelled' }).eq('uid', sec[0].uid)
    await admin.from('booking_holds').delete().eq('booking_uid', sec[0].uid)
    const third = await who(open[2] || open[1])
    assert.equal(third, second, 'a cancelled booking does not take a turn, so it is still their turn')
  })
  if (rr && rr.team) await ta('a team\'s type takes its members, so who gives it follows the rows', async () => {
    const { data: before } = await admin.from('team_members').select('user_id').eq('team', rr.team)
    const outsider = ids['member2@example.com']
    assert.ok(!before.some((m) => m.user_id === outsider), 'the reader is not in the team to begin with')
    /* put them in by hand — an act, a row, source 'manual' — and give them the same hours */
    await admin.from('provider_schedules').delete().eq('user_id', outsider)
    await admin.from('provider_schedules').insert({ user_id: outsider, name: 'Working hours', is_default: true, ...HOURS })
    await admin.from('team_members').insert({ team: rr.team, user_id: outsider, source: 'manual' })
    try {
      const dayT = await nextDay()
      const s = await fn(member, 'session-slots', { event: rr.event, from: dayT, to: dayT, timeZone: 'UTC' })
      assert.ok(Object.values(s.slots || {}).flat().length, 'the team still offers times with a new member')
      /* they take the next booking, because everybody else has turns behind them and they have none */
      const r = await fn(member, 'book-session', { event: rr.event, start: Object.values(s.slots).flat()[0], timeZone: 'UTC', notes: 'probe-sched' })
      if (r.status !== 200) { const { data: hh } = await admin.from('booking_holds').select('user_id, start_at'); console.log('    (covered: ' + JSON.stringify(covered.slice(0,4)) + ' holds: ' + JSON.stringify(hh) + ')') }
      assert.equal(r.status, 200, JSON.stringify(r))
      made.push(r.booking.uid)
      const { data: row } = await admin.from('bookings').select('host_id').eq('uid', r.booking.uid).single()
      assert.equal(row.host_id, outsider, 'the new member is a host of the type the moment they are in the team')
    } finally {
      await admin.from('team_members').delete().eq('team', rr.team).eq('user_id', outsider)
      await admin.from('provider_schedules').delete().eq('user_id', outsider)
    }
  })
  const coll = types.find((s) => s.assign === 'collective' && s.hosts.length > 1 && !s.sku)
  if (coll) await ta('a collective booking takes the time from every host at once', async () => {
    const all = (await admin.from('profiles').select('id, email').in('email', coll.hosts)).data
    assert.equal(all.length, coll.hosts.length)
    for (const p of all) { await admin.from('provider_schedules').delete().eq('user_id', p.id); await admin.from('provider_schedules').insert({ user_id: p.id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayC = await nextDay()
    const s = await fn(member, 'session-slots', { event: coll.event, from: dayC, to: dayC, timeZone: 'UTC' })
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length, 'a time both hosts keep: ' + JSON.stringify(s))
    const r = await fn(member, 'book-session', { event: coll.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(r.status, 200, JSON.stringify(r))
    made.push(r.booking.uid)
    /* ONE ROW, and a hold on every host — which is the whole difference between a collective type
       and a rota, and the only thing that stops one host being double-booked at that hour. */
    const { data: holds } = await admin.from('booking_holds').select('user_id').eq('booking_uid', r.booking.uid)
    assert.equal(holds.length, all.length, 'a hold per host: ' + JSON.stringify(holds))
    assert.deepEqual(holds.map((h) => h.user_id).sort(), all.map((p) => p.id).sort())
    const { data: row } = await admin.from('bookings').select('payload').eq('uid', r.booking.uid).single()
    assert.equal((row.payload.co_hosts || []).length, all.length - 1, 'the booking says who else is coming')
    /* and that time is now gone for both of them, on every type they give */
    const after = await fn(member, 'session-slots', { event: coll.event, from: dayC, to: dayC, timeZone: 'UTC' })
    assert.ok(!Object.values(after.slots || {}).flat().includes(open[0]), 'the time is no longer offered')
  })
  const man = types.find((s) => s.assign === 'managed' && s.team)
  if (man) await ta('a managed type is each member\'s own: bookable at their address, dead at somebody else\'s, and a leaver\'s bookings stand', async () => {
    const { data: mem } = await admin.from('team_members').select('user_id').eq('team', man.team)
    const them = (await admin.from('profiles').select('id, email, username').in('id', mem.map((m) => m.user_id))).data.filter((p) => p.username)
    assert.ok(them.length, 'a member with a username to be addressed by')
    const me = them[0]
    await admin.from('provider_schedules').delete().eq('user_id', me.id)
    await admin.from('provider_schedules').insert({ user_id: me.id, name: 'Working hours', is_default: true, ...HOURS })
    const dayM = await nextDay()
    /* THEIR address — the type's slug and their username, which is a thing somebody can be given */
    const theirs = man.slug + '@' + me.username
    const s = await fn(member, 'session-slots', { event: theirs, from: dayM, to: dayM, timeZone: 'UTC' })
    assert.equal(s.status, 200, 'the copy is bookable at their address: ' + JSON.stringify(s))
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length, 'their own hours are the copy\'s hours: ' + JSON.stringify(s.slots))
    /* SOMEBODY WHO IS NOT IN THE TEAM HAS NO COPY — the address simply does not exist */
    const outsider = (await admin.from('profiles').select('username').eq('email', 'member2@example.com').maybeSingle()).data
    if (outsider && outsider.username) {
      const no = await fn(member, 'session-slots', { event: man.slug + '@' + outsider.username, from: dayM, to: dayM, timeZone: 'UTC' })
      assert.equal(no.status, 404, 'a copy nobody holds is not a thing: ' + JSON.stringify(no))
    }
    const r = await fn(member, 'book-session', { event: theirs, start: open[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(r.status, 200, JSON.stringify(r))
    made.push(r.booking.uid)
    const { data: row } = await admin.from('bookings').select('host_id, event, type').eq('uid', r.booking.uid).single()
    assert.equal(row.host_id, me.id, 'the booking is theirs')
    assert.equal(row.event, theirs, 'and it remembers the address it was made at')
    /* A MEMBER LEAVING STOPS THEIR COPY, and the booking already made STANDS: retiring is about new
       bookings and nothing else, and a row does not vanish when a rule changes. */
    const { data: was } = await admin.from('team_members').select('*').eq('team', man.team).eq('user_id', me.id).single()
    await admin.from('team_members').delete().eq('team', man.team).eq('user_id', me.id)
    try {
      const gone = await fn(member, 'session-slots', { event: theirs, from: dayM, to: dayM, timeZone: 'UTC' })
      assert.equal(gone.status, 404, 'a leaver\'s copy is no longer bookable: ' + JSON.stringify(gone))
      const still = await admin.from('bookings').select('uid, status').eq('uid', r.booking.uid).single()
      assert.equal(still.data.status, 'accepted', 'and what was booked against it stands')
      /* and it can still be cancelled, which is what `any` is for */
      const c = await fn(host, 'cancel-session', { uid: r.booking.uid })
      assert.equal(c.status, 200, 'a booking against a retired copy can still be cancelled: ' + JSON.stringify(c))
    } finally {
      await admin.from('team_members').insert(was)
    }
  })
  const capped = types.find((s) => s.limits && Number(s.limits.week) > 0 && !s.sku && !(s.seats > 0))
  if (capped) await ta('the cap is reached, not approached: the week fills, the week after is untouched, and a late confirmation is told which', async () => {
    const week = Number(capped.limits.week)
    const ids2 = (await admin.from('profiles').select('id').in('email', capped.hosts)).data.map((p) => p.id)
    for (const id of ids2) { await admin.from('provider_schedules').delete().eq('user_id', id); await admin.from('provider_schedules').insert({ user_id: id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayL = await nextDay()
    const book = async (start) => { const r = await fn(member, 'book-session', { event: capped.event, start, timeZone: 'UTC', notes: 'probe-sched' }); if (r.status === 200) made.push(r.booking.uid); return r }
    const s = await fn(member, 'session-slots', { event: capped.event, from: dayL, to: dayL, timeZone: 'UTC' })
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length >= week, `${week} open times to fill the week: ` + JSON.stringify(s.slots))
    /* THE TYPE'S GRID IS ITS OWN: an interval and an offset written on the type, not in the week */
    if (capped.interval) {
      const mins = open.map((iso) => new Date(iso).getUTCMinutes())
      assert.ok(mins.every((m, i) => i === 0 || (m - mins[i - 1] + 60) % 60 === capped.interval % 60), 'the times sit on the type\'s own interval: ' + JSON.stringify(open.slice(0, 4)))
      /* the host's hours begin on the hour, so every start sits at the offset within the interval */
      if (capped.offset) { const step = capped.interval % 60 || 60; assert.ok(mins.every((m) => m % step === capped.offset % step), 'and begin at its offset: ' + JSON.stringify(open.slice(0, 3))) }
    }
    for (let i = 0; i < week; i++) { const r = await book(open[i]); assert.equal(r.status, 200, `the ${i + 1} of ${week}: ` + JSON.stringify(r)) }
    /* the week is now full, and the calendar says so rather than offering a time it would refuse */
    const after = await fn(member, 'session-slots', { event: capped.event, from: dayL, to: dayL, timeZone: 'UTC' })
    assert.equal(Object.values(after.slots || {}).flat().length, 0, 'a week at its cap offers nothing more that week')
    assert.equal((after.why || {}).kind, 'full', 'and says why: ' + JSON.stringify(after.why))
    /* A LATE CONFIRMATION IS TOLD WHICH CAP IT MET — not "that time has gone", which would send
       them to another time on the same full week. */
    const late = await book(open[week])
    assert.equal(late.status, 409, JSON.stringify(late))
    assert.equal(late.code, 'full', 'the refusal names the cap rather than blaming the clock: ' + JSON.stringify(late))
    assert.equal(late.span, 'week'); assert.equal(late.limit, week)
    /* THE WEEK AFTER IS UNTOUCHED: a cap is a week's, not a run of days */
    const nextWeek = new Date(Date.parse(dayL + 'T12:00:00Z') + 7 * 864e5).toISOString().slice(0, 10)
    const later = await fn(member, 'session-slots', { event: capped.event, from: nextWeek, to: nextWeek, timeZone: 'UTC' })
    assert.ok(Object.values(later.slots || {}).flat().length, 'the week after is untouched: ' + JSON.stringify(later))
  })
  const seasonal = types.find((s) => s.windowTo && !s.sku)
  if (seasonal) await ta('a window that has closed says so, rather than showing an empty month', async () => {
    const past = seasonal.windowTo.slice(0, 8) + '01'
    const later = new Date(Date.parse(seasonal.windowTo + 'T12:00:00Z') + 40 * 864e5).toISOString().slice(0, 10)
    const shut = await fn(member, 'session-slots', { event: seasonal.event, from: later.slice(0, 8) + '01', to: later, timeZone: 'UTC' })
    assert.equal(shut.status, 200, JSON.stringify(shut))
    assert.equal(Object.values(shut.slots || {}).flat().length, 0)
    assert.equal((shut.why || {}).kind, 'closed', 'and names the day it stopped: ' + JSON.stringify(shut.why))
    assert.equal(shut.why.to, seasonal.windowTo)
    void past
  })
  const noCancel = types.find((s) => s.page && s.page.cancel === false && !s.sku)
  if (noCancel) await ta("the page's own switches are refused where they say no, and a host is not held to them", async () => {
    const ids3 = (await admin.from('profiles').select('id').in('email', noCancel.hosts)).data.map((p) => p.id)
    for (const id of ids3) { await admin.from('provider_schedules').delete().eq('user_id', id); await admin.from('provider_schedules').insert({ user_id: id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayP = await nextDay()
    const s = await fn(member, 'session-slots', { event: noCancel.event, from: dayP, to: dayP, timeZone: 'UTC' })
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length, 'an open time: ' + JSON.stringify(s))
    const r = await fn(member, 'book-session', { event: noCancel.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(r.status, 200, JSON.stringify(r))
    made.push(r.booking.uid)
    /* THE READER IS REFUSED, and told which switch rather than blamed for being late */
    const no = await fn(member, 'cancel-session', { uid: r.booking.uid })
    assert.equal(no.status, 403, JSON.stringify(no))
    assert.equal(no.code, 'never', 'the refusal names the switch: ' + JSON.stringify(no))
    if (noCancel.page.reschedule === false) {
      const nomove = await fn(member, 'book-session', { event: noCancel.event, start: open[1] || open[0], timeZone: 'UTC', reschedule: r.booking.uid })
      assert.equal(nomove.status, 403, JSON.stringify(nomove)); assert.equal(nomove.code, 'never')
    }
    /* AND A HOST IS NOT HELD TO IT: these are the reader's page's switches, not the desk's */
    const yes = await fn(host, 'cancel-session', { uid: r.booking.uid })
    assert.equal(yes.status, 200, 'the host cancels it anyway: ' + JSON.stringify(yes))
  })
  const hidden = types.find((s) => s.page && s.page.hidden === true && !s.sku)
  if (hidden) await ta('a hidden type is off every list and books by its own address all the same', async () => {
    const ids4 = (await admin.from('profiles').select('id').in('email', hidden.hosts)).data.map((p) => p.id)
    for (const id of ids4) { await admin.from('provider_schedules').delete().eq('user_id', id); await admin.from('provider_schedules').insert({ user_id: id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayH = await nextDay()
    const s = await fn(member, 'session-slots', { event: hidden.event, from: dayH, to: dayH, timeZone: 'UTC' })
    assert.equal(s.status, 200, 'the calendar answers for somebody who has the address: ' + JSON.stringify(s))
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length, 'and offers times')
    const r = await fn(member, 'book-session', { event: hidden.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(r.status, 200, 'and books: ' + JSON.stringify(r))
    made.push(r.booking.uid)
  })
  const asks = types.find((s) => s.form && !(s.seats > 0))
  if (asks) await ta('what they answered on the way in is kept with the booking — and only if it is theirs', async () => {
    const ids5 = (await admin.from('profiles').select('id').in('email', asks.hosts)).data.map((p) => p.id)
    for (const id of ids5) { await admin.from('provider_schedules').delete().eq('user_id', id); await admin.from('provider_schedules').insert({ user_id: id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayF = await nextDay()
    const atier = ['anyone', 'guest', 'authenticated'].includes(asks.requires) ? null : asks.requires
    if (atier) await grant('member@example.com', atier)
    const s = await fn(member, 'session-slots', { event: asks.event, from: dayF, to: dayF, timeZone: 'UTC' })
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length, 'an open time: ' + JSON.stringify(s))
    /* the answers are a form response like any other — made the way the runner makes one */
    const mine = (await admin.from('form_responses').insert({ form: asks.form, user_id: ids['member@example.com'], completed_at: new Date().toISOString() }).select('id').single()).data
    await admin.from('form_answers').insert([
      { response_id: mine.id, field: 'working_on', value: 'Deciding whether to take the job' },
      { response_id: mine.id, field: 'tried', value: 'Writing two lists and asking my sister' },
    ])
    const r = await fn(member, 'book-session', { event: asks.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched', response: mine.id })
    assert.equal(r.status, 200, JSON.stringify(r))
    made.push(r.booking.uid)
    const { data: row } = await admin.from('bookings').select('response_id').eq('uid', r.booking.uid).single()
    assert.equal(row.response_id, mine.id, 'the booking remembers which response it collected')
    /* SOMEBODY ELSE'S ANSWERS ARE NOT WRITTEN DOWN. A response id is a thing anybody can type, and a
       booking carrying the wrong person's would show the host the wrong person's. */
    const theirs = (await admin.from('form_responses').insert({ form: asks.form, user_id: ids['member2@example.com'], completed_at: new Date().toISOString() }).select('id').single()).data
    const r2 = await fn(member, 'book-session', { event: asks.event, start: open[1] || open[0], timeZone: 'UTC', notes: 'probe-sched', response: theirs.id })
    if (r2.status === 200) {
      made.push(r2.booking.uid)
      const { data: row2 } = await admin.from('bookings').select('response_id').eq('uid', r2.booking.uid).single()
      assert.equal(row2.response_id, null, "somebody else's answers are not written onto the booking")
    }
    /* AND A BOOKING THAT ANSWERED NOTHING carries nothing, rather than the last response lying about */
    const r3 = await fn(member2, 'book-session', { event: asks.event, start: open[2] || open[0], timeZone: 'UTC', notes: 'probe-sched' })
    if (r3.status === 200) {
      made.push(r3.booking.uid)
      const { data: row3 } = await admin.from('bookings').select('response_id').eq('uid', r3.booking.uid).single()
      assert.equal(row3.response_id, null, 'a booking that answered nothing carries nothing')
    }
    await admin.from('form_responses').delete().in('id', [mine.id, theirs.id])
  })
  const asked2 = types.find((s) => s.confirm === true && !s.sku && !(s.seats > 0))
  if (asked2) await ta('a booking that waits for the host holds the time, and yes or no is theirs to say', async () => {
    const ids6 = (await admin.from('profiles').select('id').in('email', asked2.hosts)).data.map((p) => p.id)
    for (const id of ids6) { await admin.from('provider_schedules').delete().eq('user_id', id); await admin.from('provider_schedules').insert({ user_id: id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayC2 = await nextDay()
    const s = await fn(member, 'session-slots', { event: asked2.event, from: dayC2, to: dayC2, timeZone: 'UTC' })
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length, 'an open time: ' + JSON.stringify(s))
    const r = await fn(member, 'book-session', { event: asked2.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(r.status, 200, JSON.stringify(r))
    made.push(r.booking.uid)
    const { data: row } = await admin.from('bookings').select('status').eq('uid', r.booking.uid).single()
    assert.equal(row.status, 'pending', 'it waits rather than being booked')
    /* IT HOLDS THE TIME FROM THE MOMENT IT IS MADE: a time somebody is waiting on is not a time to
       offer anybody else, and a second reader must not be able to take it while the host decides */
    const { data: holds } = await admin.from('booking_holds').select('user_id').eq('booking_uid', r.booking.uid)
    assert.equal(holds.length, 1, 'the time is held while it waits')
    const gone = await fn(member2, 'book-session', { event: asked2.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched' })
    assert.ok(gone.status >= 400, 'and nobody else is offered it: ' + JSON.stringify(gone))
    /* ONLY THE HOST SAYS */
    const nope = await fn(member, 'book-session', { action: 'accept', uid: r.booking.uid })
    assert.equal(nope.status, 403, JSON.stringify(nope)); assert.equal(nope.code, 'not-host')
    const yes = await fn(host, 'book-session', { action: 'accept', uid: r.booking.uid })
    assert.equal(yes.status, 200, JSON.stringify(yes))
    const { data: after } = await admin.from('bookings').select('status').eq('uid', r.booking.uid).single()
    assert.equal(after.status, 'accepted')
    /* and it is not answered twice: two taps on Accept must not send two letters */
    const again = await fn(host, 'book-session', { action: 'accept', uid: r.booking.uid })
    assert.equal(again.status, 409, JSON.stringify(again)); assert.equal(again.code, 'settled')
    /* A DECLINE FREES THE TIME */
    /* the LAST open time, not the next one: a ninety-minute session at the first start swallows
       every slot for the next hour and a half */
    const r2 = await fn(member2, 'book-session', { event: asked2.event, start: open[open.length - 1], timeZone: 'UTC', notes: 'probe-sched' })
    assert.equal(r2.status, 200, JSON.stringify(r2))
    made.push(r2.booking.uid)
    const no = await fn(host, 'book-session', { action: 'decline', uid: r2.booking.uid })
    assert.equal(no.status, 200, JSON.stringify(no))
    const { data: dead } = await admin.from('bookings').select('status').eq('uid', r2.booking.uid).single()
    assert.equal(dead.status, 'rejected')
    const { data: freed } = await admin.from('booking_holds').select('id').eq('booking_uid', r2.booking.uid)
    assert.equal(freed.length, 0, 'the time is free again')
    const back = await fn(member, 'session-slots', { event: asked2.event, from: dayC2, to: dayC2, timeZone: 'UTC' })
    assert.ok(Object.values(back.slots || {}).flat().includes(open[open.length - 1]), 'and offered again')
  })
  const many = types.find((s) => Array.isArray(s.lengths) && s.lengths.length > 1 && !s.sku && !(s.seats > 0))
  if (many) await ta('the length they chose is the length that is booked, and the booking is called what the type says', async () => {
    const ids7 = (await admin.from('profiles').select('id').in('email', many.hosts)).data.map((p) => p.id)
    for (const id of ids7) { await admin.from('provider_schedules').delete().eq('user_id', id); await admin.from('provider_schedules').insert({ user_id: id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayN = await nextDay()
    const longest = many.lengths[many.lengths.length - 1].minutes || many.lengths[many.lengths.length - 1]
    /* A LONGER SESSION FITS IN FEWER PLACES, so the calendar is asked at the length being chosen —
       offering the short one's times would offer what cannot be booked */
    const short = await fn(member, 'session-slots', { event: many.event, from: dayN, to: dayN, timeZone: 'UTC' })
    const long = await fn(member, 'session-slots', { event: many.event, from: dayN, to: dayN, timeZone: 'UTC', minutes: longest })
    const nShort = Object.values(short.slots || {}).flat().length, nLong = Object.values(long.slots || {}).flat().length
    assert.ok(nShort > 0 && nLong > 0, 'both lengths have times: ' + nShort + ' / ' + nLong)
    assert.ok(nLong < nShort, 'the longer one fits in fewer places: ' + nShort + ' / ' + nLong)
    const at = Object.values(long.slots).flat()[0]
    const r = await fn(member, 'book-session', { event: many.event, start: at, timeZone: 'UTC', notes: 'probe-sched', minutes: longest })
    assert.equal(r.status, 200, JSON.stringify(r))
    made.push(r.booking.uid)
    const { data: row } = await admin.from('bookings').select('start_at, end_at, title').eq('uid', r.booking.uid).single()
    assert.equal((Date.parse(row.end_at) - Date.parse(row.start_at)) / 6e4, longest, 'it is booked at the length they chose')
    if (many.name) assert.notEqual(row.title, many.title, 'and called what the type says rather than its own title: ' + row.title)
    /* A LENGTH THE TYPE DOES NOT OFFER falls back to its default rather than booking whatever was asked */
    const dayN2 = await nextDay()
    const s2 = await fn(member, 'session-slots', { event: many.event, from: dayN2, to: dayN2, timeZone: 'UTC' })
    const r2 = await fn(member2, 'book-session', { event: many.event, start: Object.values(s2.slots).flat()[0], timeZone: 'UTC', notes: 'probe-sched', minutes: 7 })
    assert.equal(r2.status, 200, JSON.stringify(r2))
    made.push(r2.booking.uid)
    const { data: row2 } = await admin.from('bookings').select('start_at, end_at').eq('uid', r2.booking.uid).single()
    assert.equal((Date.parse(row2.end_at) - Date.parse(row2.start_at)) / 6e4, many.duration, 'a length nobody offers is the type\'s own')
  })
  const seated = types.find((s) => s.seats > 1 && (s.page || {}).seatsLeft === true)
  if (seated) await ta('a group says how many seats are left, and a seat gives up only its own', async () => {
    const s = await fn(member, 'session-slots', { event: seated.event, from: await nextDay(), to: await nextDay(), timeZone: 'UTC' })
    /* a fixed-time type answers for its own occurrences, so the day asked for may hold none */
    const wide = await fn(member, 'session-slots', { event: seated.event, from: new Date().toISOString().slice(0, 10), to: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10), timeZone: 'UTC' })
    const open = Object.values(wide.slots || {}).flat()
    assert.ok(open.length, 'an occurrence to sit in: ' + JSON.stringify(wide).slice(0, 200))
    assert.ok(wide.left && typeof wide.left === 'object', 'the calendar says how many are left: ' + JSON.stringify(wide.left))
    const before = wide.left[open[0]]
    assert.ok(before > 0, 'and it is a number of seats: ' + JSON.stringify(before))
    void s
    const gtier = ['anyone', 'guest', 'authenticated'].includes(seated.requires) ? null : seated.requires
    if (gtier) { await grant('member@example.com', gtier); await grant('member2@example.com', gtier) }
    const a = await fn(member, 'book-session', { event: seated.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched' })
    if (a.status !== 200) return   /* their allowance may already be spent by the seed; the count is what this checks */
    made.push(a.booking.uid)
    const after = await fn(member, 'session-slots', { event: seated.event, from: new Date().toISOString().slice(0, 10), to: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10), timeZone: 'UTC' })
    assert.equal(after.left[open[0]], before - 1, 'one fewer once a seat is taken')
    /* AND GIVING UP A SEAT GIVES UP ONLY THAT SEAT: the others are still in the room */
    const b2 = await fn(member2, 'book-session', { event: seated.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched' })
    if (b2.status === 200) {
      made.push(b2.booking.uid)
      await fn(member, 'cancel-session', { uid: a.booking.uid })
      const { data: theirs } = await admin.from('bookings').select('status').eq('uid', b2.booking.uid).single()
      assert.equal(theirs.status, 'accepted', "one seat leaving does not cancel anybody else's")
      const { data: holds } = await admin.from('booking_holds').select('id').eq('booking_uid', b2.booking.uid)
      assert.ok(holds.length || (await admin.from('booking_holds').select('id').eq('booking_uid', a.booking.uid)).data.length === 0, 'and the hour is still held while somebody is in it')
    }
  })
  const course = types.find((s) => s.repeat && s.repeat.count > 1 && !s.sku)
  if (course) await ta('a run is booked whole, one of it can be moved alone, and cancelling asks which', async () => {
    const ids8 = (await admin.from('profiles').select('id').in('email', course.hosts)).data.map((p) => p.id)
    for (const id of ids8) { await admin.from('provider_schedules').delete().eq('user_id', id); await admin.from('provider_schedules').insert({ user_id: id, name: 'Working hours', is_default: true, ...HOURS }) }
    const dayR2 = await nextDay()
    const s = await fn(member, 'session-slots', { event: course.event, from: dayR2, to: dayR2, timeZone: 'UTC', count: course.repeat.count })
    const open = Object.values(s.slots || {}).flat()
    assert.ok(open.length, 'a start whose whole run fits: ' + JSON.stringify(s).slice(0, 200))
    assert.equal(s.run, course.repeat.count, 'and the calendar says how many it is answering for')
    const r = await fn(member, 'book-session', { event: course.event, start: open[0], timeZone: 'UTC', notes: 'probe-sched', count: course.repeat.count })
    assert.equal(r.status, 200, JSON.stringify(r))
    const { data: run } = await admin.from('bookings').select('uid, start_at, run_of').eq('run_of', r.booking.uid).order('start_at')
    for (const b of run) made.push(b.uid)
    assert.equal(run.length, course.repeat.count, 'every session of the run is its own booking')
    assert.ok(run.every((b) => b.run_of === r.booking.uid), 'and they all carry the first one\'s uid')
    /* A WEEK APART IN WALL TIME, not by adding milliseconds — the clocks change and nine stays nine */
    const gaps = run.slice(1).map((b, i) => Math.round((Date.parse(b.start_at) - Date.parse(run[i].start_at)) / 864e5))
    assert.ok(gaps.every((g) => g === 7), 'a week apart, every one: ' + gaps.join(','))
    /* MOVING ONE LEAVES THE REST WHERE THEY ARE */
    const dayR3 = await nextDay()
    const s2 = await fn(member, 'session-slots', { event: course.event, from: dayR3, to: dayR3, timeZone: 'UTC' })
    const to = Object.values(s2.slots || {}).flat()[0]
    const mv = await fn(member, 'book-session', { event: course.event, start: to, timeZone: 'UTC', reschedule: run[1].uid })
    assert.equal(mv.status, 200, JSON.stringify(mv))
    const { data: after } = await admin.from('bookings').select('uid, start_at').eq('run_of', r.booking.uid).order('start_at')
    assert.equal(after.length, course.repeat.count, 'the run is still the same size')
    assert.equal(Date.parse(after.find((b) => b.uid === run[1].uid).start_at), Date.parse(to), 'the one moved is where it was moved to')
    assert.equal(Date.parse(after.find((b) => b.uid === run[2].uid).start_at), Date.parse(run[2].start_at), 'and the rest are where they were')
    /* CANCELLING ONE TAKES ONE; CANCELLING THE RUN TAKES WHAT IS LEFT TO COME */
    const one = await fn(member, 'cancel-session', { uid: run[3].uid })
    assert.equal(one.status, 200, JSON.stringify(one))
    const { data: left } = await admin.from('bookings').select('uid, status').eq('run_of', r.booking.uid)
    assert.equal(left.filter((b) => b.status === 'cancelled').length, 1, 'one means one')
    const all = await fn(member, 'cancel-session', { uid: run[0].uid, run: true })
    assert.equal(all.status, 200, JSON.stringify(all))
    const { data: end } = await admin.from('bookings').select('status').eq('run_of', r.booking.uid)
    assert.equal(end.filter((b) => b.status === 'cancelled').length, course.repeat.count, 'and the run means the run')
  })
  /* a type with NO allowance to run out of: this check is about which days are open, and a reader
     refused because they have had their one this month tells us nothing about being away */
  const freeType = types.find((s) => !s.sku && !(s.seats > 0) && !s.weekly && !s.monthly && !s.repeat && !s.team && !s.confirm && !Object.keys(s.limits || {}).length && s.assign !== 'collective' && !s.windowTo && !s.windowFrom && !s.windowDays && s.hosts.length === 1 && s.hosts.includes('coach@example.com') && !(s.page || {}).hidden && (s.page || {}).cancel !== false)
  if (freeType) await ta('away takes the days off, a cover stands in, and what was already booked stands', async () => {
    await admin.from('provider_schedules').delete().eq('user_id', coach)
    await admin.from('provider_schedules').insert({ user_id: coach, name: 'Working hours', is_default: true, ...HOURS })
    await admin.from('provider_ooo').delete().eq('user_id', coach)
    /* the cover is somebody with nothing of their own booked — the administrator gives half these
       types and an earlier check has usually taken their afternoon */
    const cover = ids['writer@example.com']
    assert.ok(cover, 'a second provider to cover')
    const dayA = await nextDay()
    /* something booked in the days they will be away: it must stand */
    const s0 = await fn(member, 'session-slots', { event: freeType.event, from: dayA, to: dayA, timeZone: 'UTC' })
    const open0 = Object.values(s0.slots || {}).flat()
    assert.ok(open0.length, 'an open time before they are away: ' + JSON.stringify(s0))
    /* the first start that is actually free: an earlier check may hold one of them */
    let kept = { status: 0 }
    for (const at of open0) { kept = await fn(member, 'book-session', { event: freeType.event, start: at, timeZone: 'UTC', notes: 'probe-sched' }); if (kept.status === 200) break }
    if (kept.status !== 200) { const { data: hh } = await admin.from('booking_holds').select('user_id, start_at').gte('start_at', dayA); console.log('    (type ' + freeType.slug + ' on ' + dayA + ', ' + open0.length + ' starts, holds ' + JSON.stringify(hh) + ')') }
    assert.equal(kept.status, 200, JSON.stringify(kept))
    made.push(kept.booking.uid)
    /* now they are away for that day */
    const { data: ooo } = await admin.from('provider_ooo').insert({ user_id: coach, from: dayA, to: dayA, reason: 'probe-sched' }).select('id').single()
    try {
      const s1 = await fn(free, 'session-slots', { event: freeType.event, from: dayA, to: dayA, timeZone: 'UTC' })
      assert.equal(Object.values(s1.slots || {}).flat().length, 0, 'the day is gone: ' + JSON.stringify(s1.slots))
      const { data: still } = await admin.from('bookings').select('status').eq('uid', kept.booking.uid).single()
      assert.equal(still.status, 'accepted', 'and what was already booked stands')
      /* A COVER STANDS IN. The administrator gives the same hours and takes the days. */
      /* the cover keeps AFTERNOONS, so their times cannot collide with anything an earlier check
         booked in the mornings — this is about the days standing in, not about who is busy */
      await admin.from('provider_schedules').delete().eq('user_id', cover)
      await admin.from('provider_schedules').insert({ user_id: cover, name: 'Working hours', is_default: true, ...HOURS, weekly: { 1: [['14:00', '17:00']], 2: [['14:00', '17:00']], 3: [['14:00', '17:00']], 4: [['14:00', '17:00']], 5: [['14:00', '17:00']] } })
      await admin.from('provider_ooo').update({ cover_id: cover }).eq('id', ooo.id)
      const s2 = await fn(free, 'session-slots', { event: freeType.event, from: dayA, to: dayA, timeZone: 'UTC' })
      const covered = Object.values(s2.slots || {}).flat()
      assert.ok(covered.length, 'the cover\'s own times stand in for those days: ' + JSON.stringify(s2))
      /* and the booking made in them goes to the cover, not the person who is away */
      /* the cover may already hold an hour of their own from an earlier check, so the first start
         that is actually theirs to give is taken rather than assuming any particular one */
      let r = { status: 0 }
      for (const at of covered) { r = await fn(free, 'book-session', { event: freeType.event, start: at, timeZone: 'UTC', notes: 'probe-sched' }); if (r.status === 200) break }
      assert.equal(r.status, 200, JSON.stringify(r))
      made.push(r.booking.uid)
      const { data: row } = await admin.from('bookings').select('host_id').eq('uid', r.booking.uid).single()
      assert.equal(row.host_id, cover, 'the cover takes it')
      /* AND ONLY THOSE DAYS: the cover is not quietly added to every other day of the type */
      const dayB = await nextDay()
      /* asked as a HOST, because only a host may narrow the calendar to one person */
      const s3 = await fn(host, 'session-slots', { event: freeType.event, from: dayB, to: dayB, timeZone: 'UTC', host: cover })
      assert.equal(Object.values(s3.slots || {}).flat().length, 0, 'the cover stands in for those days and no others: ' + JSON.stringify(s3.slots))
    } finally {
      await admin.from('provider_ooo').delete().eq('id', ooo.id)
    }
  })
  await ta('a host\'s hours are theirs: a member reads none, the coach their own, another coach is refused the set', async () => {
    const { data: m } = await member.from('provider_schedules').select('user_id')
    assert.equal((m || []).length, 0)
    const { data: c } = await host.from('provider_schedules').select('user_id')
    assert.ok((c || []).some((r) => r.user_id === coach), 'the coach reads their own (an administrator every host\'s)')
    const r = await fn(member, 'coach-hours', { action: 'set', hours: HOURS })
    assert.equal(r.status, 403, JSON.stringify(r))
  })
} finally {
  await sweep()
  for (const id of newUsers) await admin.auth.admin.deleteUser(id).catch(() => {})
  await admin.from('provider_overrides').delete().eq('user_id', coach)
  await admin.from('provider_schedules').delete().eq('user_id', coach)
  if (saved.hours.length) await admin.from('provider_schedules').insert(saved.hours)
  if (saved.overrides.length) await admin.from('provider_overrides').insert(saved.overrides)
}
console.log(bad ? `✖ scheduling: ${n - bad}/${n} checks` : `✔ scheduling: ${n}/${n} checks`)
process.exit(bad ? 1 : 0)
