/* The site's own video room (session-room / livekit-webhook, _shared/video/livekit.js) against the served
   functions in their mock (no LiveKit keys: the dev pair, no egress — the fixture film landed by the mock):
   the token door — a stranger 403, the attendee and the host each a token for the booking's room, the
   host's with the room's controls, 425 before the window, 410 after; the room's notifications signed as
   LiveKit signs them (a JWT over the body's sha256, keyed by the API secret) — started, finished, a
   recording landed and playable through session-files, a bad signature 400, a replay changing nothing;
   the host's record and end. Picks a native video-room type from the catalog of the site in cwd (the demo
   has one); skips with a note where there is none. Cleans up what it made. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHmac, createHash } from 'node:crypto'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'
import { notHere, leave } from './test-stack.mjs'

let n = 0, bad = 0
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }
const url = supabaseUrl(), anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
let up = false
try { up = url && localStack() && (await fetch(url + '/rest/v1/', { headers: { apikey: anonKey }, signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
let served = false
if (up) { try { served = (await fetch(url + '/functions/v1/session-room', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* not served */ } }
if (!up || !served) { console.log(`meetings: skipped — ${!up ? 'the local stack is not up' : 'the functions are not served (npm run dev serves them)'}`); leave(0) }
const catalog = JSON.parse(fs.readFileSync('supabase/functions/_shared/catalog.json', 'utf8'))
const type = (catalog.sessions || []).find((s) => s.scheduler === 'native' && s.where?.kind === 'video')
if (!type) { notHere('meetings', 'the site has no native booking type in a video room (the demo has)'); process.exit(0) }
/* AND THE SITE MUST HAVE A LIVEKIT ACCOUNT. With none, a native video room is the mesh — browser to
   browser, no account, nothing recorded (build/huddle.test.mjs is its own probe) — and every door
   here would answer no-room. The dev server is the account to point at locally:
   docker run --name lk-dev -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server \
     --keys "devkey: secretsecretsecretsecretsecretsecret" --node-ip 127.0.0.1
   with LIVEKIT_URL=ws://127.0.0.1:7880 and that pair in .env. */
const { videoIdOf } = await import('../supabase/functions/_shared/video/choose.js')
if (videoIdOf(type, (k) => process.env[k] || '') !== 'livekit') { notHere('meetings', 'the site has no LiveKit account, so a room here is the mesh'); process.exit(0); console.log('meetings: skipped — this site has no LiveKit account, so a room here is the mesh (set LIVEKIT_URL and the dev pair to run this)'); process.exit(0) }

const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const as = async (email) => { const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }); const { error } = await sb.auth.signInWithPassword({ email, password: 'password123' }); if (error) throw new Error(email + ': ' + error.message); return sb }
const fn = async (sb, name, body) => { const { data, error } = await sb.functions.invoke(name, { body }); if (error) { let j = null; try { j = await error.context.json() } catch { /* none */ } return { status: error.context ? error.context.status : 500, ...(j || { error: error.message }) } } return { status: 200, ...data } }
const ids = {}
for (const e of ['member@example.com', 'coach@example.com', 'free@example.com']) { const { data } = await admin.from('profiles').select('id').eq('email', e).maybeSingle(); if (data) ids[e] = data.id }
const coach = ids['coach@example.com']
const b64url = (b) => Buffer.from(b).toString('base64url')
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString())
/* a notification signed as LiveKit signs it: HS256 with the API secret, the body's sha256 (base64) as a claim */
const DEV = { key: 'devkey', secret: 'secretsecretsecretsecretsecretsecret' }
const signed = (body) => { const raw = JSON.stringify(body); const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const now = Math.floor(Date.now() / 1000); const pl = b64url(JSON.stringify({ iss: DEV.key, nbf: now - 10, exp: now + 300, sha256: createHash('sha256').update(raw).digest('base64') })); const sig = createHmac('sha256', DEV.secret).update(head + '.' + pl).digest('base64url'); return { raw, auth: head + '.' + pl + '.' + sig } }
const post = async (body, auth) => { const { raw, auth: a } = signed(body); const r = await fetch(url + '/functions/v1/livekit-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth ?? a }, body: raw }); return { status: r.status, ...(await r.json().catch(() => ({}))) } }
const stamp = Date.now().toString(36)
const mk = async (uid, startMs, extra = {}) => { await admin.from('bookings').insert({ uid, provider: 'native', type: type.slug, event: type.event, title: type.title, user_id: ids['member@example.com'], email: 'member@example.com', name: 'Member Person', host_id: coach, provider_id: coach, provider_email: 'coach@example.com', attendee_emails: ['member@example.com'], start_at: new Date(startMs).toISOString(), end_at: new Date(startMs + type.duration * 6e4).toISOString(), status: 'accepted', where: { kind: 'video' }, room: uid, join_url: '/app/call/' + uid, ...extra }) }
const uids = { now: `ns_meet${stamp}a`, early: `ns_meet${stamp}b`, over: `ns_meet${stamp}c` }

try {
  await ta('a meeting type exposes only its public availability, while a booking still needs a JWT', async () => {
    const body = { event: type.event, from: 'bad', to: 'bad', timeZone: 'UTC' }
    const slots = await fetch(url + '/functions/v1/session-slots', { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal(slots.status, ['anyone', 'guest'].includes(type.requires) ? 400 : 401, await slots.text())
    const booking = await fetch(url + '/functions/v1/book-session', { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ event: type.event, start: new Date(Date.now() + 864e5).toISOString(), timeZone: 'UTC' }) })
    assert.equal(booking.status, 401, await booking.text())
  })
  await mk(uids.now, Date.now() + 5 * 6e4)
  await mk(uids.early, Date.now() + 3 * 36e5)
  await mk(uids.over, Date.now() - 4 * 36e5, { status: 'ended' })
  const member = await as('member@example.com'), host = await as('coach@example.com'), stranger = await as('free@example.com')

  await ta('the door: a stranger is refused; the attendee and the host each get a token for the room, the host\'s with the controls', async () => {
    const s = await fn(stranger, 'session-room', { uid: uids.now })
    assert.equal(s.status, 403, JSON.stringify(s))
    const a = await fn(member, 'session-room', { uid: uids.now })
    assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(a.role, 'attendee'); assert.equal(a.room, uids.now); assert.ok(a.url && a.token)
    const ac = claims(a.token); assert.equal(ac.video.room, uids.now); assert.equal(ac.video.roomJoin, true); assert.ok(!ac.video.roomAdmin, 'no controls for the attendee'); assert.equal(ac.sub, ids['member@example.com'])
    const h = await fn(host, 'session-room', { uid: uids.now })
    assert.equal(h.status, 200, JSON.stringify(h)); assert.equal(h.role, 'host')
    const hc = claims(h.token); assert.equal(hc.video.roomAdmin, true); assert.equal(hc.video.roomRecord, true); assert.equal(hc.video.room, uids.now)
    assert.ok(hc.exp - Math.floor(Date.now() / 1000) > 60 * 60, 'the token lasts to an hour after the end')
  })
  await ta('the window: too early is 425 with when it opens, over is 410', async () => {
    const e = await fn(member, 'session-room', { uid: uids.early })
    assert.equal(e.status, 425, JSON.stringify(e)); assert.equal(e.code, 'early'); assert.ok(e.opens)
    const o = await fn(member, 'session-room', { uid: uids.over })
    assert.equal(o.status, 410, JSON.stringify(o)); assert.equal(o.code, 'over')
  })
  await ta('the room\'s notifications, signed: started, finished (the follow-up timed), a bad signature refused, a replay changing nothing', async () => {
    const bad = await post({ event: 'room_started', room: { name: uids.now } }, 'Bearer nonsense')
    assert.equal(bad.status, 400)
    const st = await post({ event: 'room_started', room: { name: uids.now }, createdAt: Math.floor(Date.now() / 1000) })
    assert.equal(st.status, 200, JSON.stringify(st)); assert.equal(st.kind, 'started')
    let { data: r } = await admin.from('bookings').select('started_at, status').eq('uid', uids.now).single()
    assert.ok(r.started_at, 'started'); const started = r.started_at
    await post({ event: 'participant_joined', room: { name: uids.now } })
    ;({ data: r } = await admin.from('bookings').select('started_at').eq('uid', uids.now).single())
    assert.equal(r.started_at, started, 'a second start does not move it')
    const fin = await post({ event: 'room_finished', room: { name: uids.now } })
    assert.equal(fin.status, 200); assert.equal(fin.kind, 'ended')
    ;({ data: r } = await admin.from('bookings').select('status, followup_at').eq('uid', uids.now).single())
    assert.equal(r.status, 'ended'); assert.ok(r.followup_at && Date.parse(r.followup_at) - Date.now() < 6 * 6e4 && Date.parse(r.followup_at) - Date.now() > 3 * 6e4, 'the follow-up five minutes on')
    const f2 = r.followup_at
    await post({ event: 'room_finished', room: { name: uids.now } })
    ;({ data: r } = await admin.from('bookings').select('followup_at').eq('uid', uids.now).single())
    assert.equal(r.followup_at, f2, 'a replayed finish does not move the follow-up')
    const nobody = await post({ event: 'room_started', room: { name: 'no-such-room' } })
    assert.equal(nobody.status, 200); assert.equal(nobody.ignored, true)
  })
  await ta('the recording: the host starts it, the film lands under the booking, the event marks the row as a pulled one, the attendee plays it and a stranger is refused', async () => {
    await admin.from('bookings').update({ status: 'accepted' }).eq('uid', uids.now)
    const nope = await fn(member, 'session-room', { uid: uids.now, action: 'record' })
    assert.equal(nope.status, 403)
    const rec = await fn(host, 'session-room', { uid: uids.now, action: 'record' })
    assert.equal(rec.status, 200, JSON.stringify(rec)); assert.equal(rec.path, uids.now + '/recording.mp4')
    let { data: r } = await admin.from('bookings').select('recording_state, recording_path').eq('uid', uids.now).single()
    assert.ok(r.recording_state === 'pending' || (r.recording_state === null && r.recording_path), 'recording, or landed at once under the mock: ' + JSON.stringify(r))
    const ev = await post({ event: 'egress_ended', egressInfo: { roomName: uids.now, status: 'EGRESS_COMPLETE', fileResults: [{ filename: uids.now + '/recording.mp4', size: 98304 }] } })
    assert.equal(ev.status, 200, JSON.stringify(ev)); assert.equal(ev.kind, 'recording')
    ;({ data: r } = await admin.from('bookings').select('recording_state, recording_path, recording_at').eq('uid', uids.now).single())
    assert.equal(r.recording_state, null, 'landed: no state, as a pulled one'); assert.equal(r.recording_path, uids.now + '/recording.mp4'); assert.ok(r.recording_at)
    const { data: f, error } = await member.functions.invoke('session-files', { body: { uid: uids.now } })
    assert.ok(!error, error && error.message); assert.ok(f.recording && /\/storage\/v1\/object\/sign\//.test(f.recording), 'a signed path for the attendee')
    const play = await fetch(url + f.recording); assert.equal(play.status, 200); assert.equal((await play.arrayBuffer()).byteLength, 96 * 1024, 'the film as landed')
    const { error: se } = await stranger.functions.invoke('session-files', { body: { uid: uids.now } })
    assert.ok(se && se.context && se.context.status === 403, 'a stranger 403')
    const failed = await post({ event: 'egress_ended', egressInfo: { roomName: uids.early, status: 'EGRESS_FAILED', error: 'no such storage' } })
    assert.equal(failed.status, 200)
    ;({ data: r } = await admin.from('bookings').select('recording_state, recording_error').eq('uid', uids.early).single())
    assert.equal(r.recording_state, 'failed'); assert.equal(r.recording_error, 'no such storage')
  })
  await ta('the host ends the room for everyone: the row says ended; the attendee cannot', async () => {
    await admin.from('bookings').update({ status: 'accepted' }).eq('uid', uids.now)
    const nope = await fn(member, 'session-room', { uid: uids.now, action: 'end' })
    assert.equal(nope.status, 403)
    const ok = await fn(host, 'session-room', { uid: uids.now, action: 'end' })
    assert.equal(ok.status, 200, JSON.stringify(ok))
    const { data: r } = await admin.from('bookings').select('status, followup_at').eq('uid', uids.now).single()
    assert.equal(r.status, 'ended'); assert.ok(r.followup_at, 'the follow-up timed')
  })
  await ta('a booking of a video-room type made through book-session carries the call page as its Join and the room as its own name', async () => {
    const tier = ['anyone', 'guest', 'authenticated'].includes(type.requires) ? null : type.requires
    if (tier) await admin.from('entitlements').insert({ user_id: ids['free@example.com'], kind: 'class', key: 'subscribed', source: 'grant', source_id: 'probe-meet', tier, active: true, expires_at: new Date(Date.now() + 864e5).toISOString() })
    const day = new Date(Date.now() + 5 * 864e5); const dow = day.getUTCDay(); if (dow === 6) day.setUTCDate(day.getUTCDate() + 2); if (dow === 0) day.setUTCDate(day.getUTCDate() + 1)
    const from = day.toISOString().slice(0, 10)
    const s = await fn(stranger, 'session-slots', { event: type.event, from, to: from, timeZone: 'UTC' })
    const start = Object.values(s.slots || {}).flat()[0]
    assert.ok(start, 'an open time: ' + JSON.stringify(s))
    const r = await fn(stranger, 'book-session', { event: type.event, start, timeZone: 'UTC' })
    assert.equal(r.status, 200, JSON.stringify(r))
    uids.booked = r.booking.uid
    assert.ok(/\/app\/call\/ns_/.test(r.booking.join_url), 'the Join is the call page: ' + r.booking.join_url)
    const { data: row } = await admin.from('bookings').select('room, seat_of, join_url').eq('uid', r.booking.uid).single()
    assert.equal(row.room, row.seat_of || r.booking.uid)
  })
} finally {
  await admin.from('bookings').delete().in('uid', Object.values(uids))
  await admin.from('bookings').delete().like('uid', 'ns_meet%')
  await admin.from('entitlements').delete().eq('source_id', 'probe-meet')
  for (const u of Object.values(uids)) await admin.storage.from('recordings').remove([u + '/recording.mp4'])
}
console.log(bad ? `✖ meetings: ${n - bad}/${n} checks` : `✔ meetings: ${n}/${n} checks`)
process.exit(bad ? 1 : 0)
