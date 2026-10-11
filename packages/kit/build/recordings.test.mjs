/* A call's recording, ours (session-recordings / session-files, _shared/recordings.ts). This test's own server
   (host.docker.internal from the edge runtime) stands in for cal.com with its DOCUMENTED shapes — the OpenAPI in
   cal.com's repository (docs/api-reference/v2/openapi.json): GET /v2/bookings/{uid}/recordings answers
   { status, data: [{ id, roomName, startTs, status, maxParticipants, duration, shareToken, downloadLink }] },
   /transcripts { status, data: [url, …] } — and serves the files. The served function, told the base (the service
   bearer alone), asks it as it would cal.com, parses the answer for real, streams the file into the bucket and
   writes the row; nothing there yet → pending and the next pull lands it; a link answering 404 counts a try and the
   cap turns it failed; session-files signs for the attendee and the coach and refuses a stranger; the keep removes
   an old recording and 0 keeps everything. And cal-webhook takes a RECORDING_READY body shaped as cal.com's
   daily-webhook sends it — { triggerEvent, createdAt, payload: { …calendarEvent, downloadLink } }, HMAC-SHA256 over
   the raw body — and marks the booking pending (the pull then asks the real API, which has no key here). Only
   cal.com's live answer is left to a real call. Skips itself with a note when the stack or the function is not
   served (npm run dev serves it). */
import assert from 'node:assert/strict'
import http from 'node:http'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

let n = 0, bad = 0
const ta = async (name, fn) => { n++; try { await fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 6).join('\n    ')) } }
const url = supabaseUrl(), anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
let up = false
try { up = url && localStack() && (await fetch(url + '/rest/v1/', { headers: { apikey: anonKey }, signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
let served = false
if (up) { try { served = (await fetch(url + '/functions/v1/session-recordings', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* not served */ } }
if (!up || !served) { console.log(`recordings: skipped — ${!up ? 'the local stack is not up' : 'the function is not served (npm run dev serves it)'}`); process.exit(0) }

const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const call = async (body, bearer = serviceKey()) => { const r = await fetch(url + '/functions/v1/session-recordings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bearer, apikey: anonKey }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) } }
const as = async (email) => { const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }); const { error } = await sb.auth.signInWithPassword({ email, password: 'password123' }); if (error) throw new Error(email + ': ' + error.message); return sb }
const files = async (sb, uid) => { const { data, error } = await sb.functions.invoke('session-files', { body: { uid } }); return error ? (error.context ? error.context.status : 500) : data }

/* this test's own origin: cal.com's two endpoints in their documented shapes (the answer per booking uid settable
   from the test), a small "recording" and a transcript, and a link that answers nothing */
const MP4 = Buffer.alloc(96 * 1024, 7)
const answers = {}   /* uid → { recordings: [...] | 'none', transcripts: [...] } */
let asked = []
const server = http.createServer((req, res) => {
  const m = /^\/v2\/bookings\/([^/]+)\/(recordings|transcripts)$/.exec(req.url || '')
  if (m) {
    asked.push({ uid: decodeURIComponent(m[1]), what: m[2], auth: req.headers.authorization || '', version: req.headers['cal-api-version'] || '' })
    const a = answers[decodeURIComponent(m[1])] || {}
    const data = m[2] === 'recordings' ? (a.recordings === 'none' ? [] : (a.recordings || [])) : (a.transcripts || [])
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ status: 'success', data }))
  }
  if (req.url === '/rec.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': MP4.length }); res.end(MP4) }
  else if (req.url === '/t.vtt') { res.writeHead(200, { 'Content-Type': 'text/vtt' }); res.end('WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n') }
  else { res.writeHead(404); res.end() }
})
await new Promise((r) => server.listen(0, '0.0.0.0', r))
const origin = `http://host.docker.internal:${server.address().port}`, api = origin + '/v2'
const recording = (url) => ({ id: '1234567890', roomName: 'daily-video-room-123', startTs: Math.floor(Date.now() / 1000) - 3600, status: 'finished', maxParticipants: 2, duration: 3600, shareToken: 'share-token-123', downloadLink: url })
const stamp = Date.now().toString(36)
const uids = ['a', 'b', 'c', 'd'].map((k) => `probe-rec-${stamp}-${k}`)
const ids = {}
for (const e of ['member@example.com', 'coach@example.com', 'free@example.com']) { const { data } = await admin.from('profiles').select('id').eq('email', e).maybeSingle(); if (data) ids[e] = data.id }
const row = (uid, extra = {}) => admin.from('bookings').insert({ uid, user_id: ids['member@example.com'] || null, email: 'member@example.com', name: 'Member', provider_id: ids['coach@example.com'] || null, provider_email: 'coach@example.com', attendee_emails: ['member@example.com'], title: 'Probe call', status: 'ended', start_at: new Date(Date.now() - 7200e3).toISOString(), end_at: new Date(Date.now() - 3600e3).toISOString(), event: 'probe', ...extra })

try {
  await ta('a recording pulled from its link into the bucket, the row written', async () => {
    const { error } = await row(uids[0]); if (error) throw new Error(error.message)
    answers[uids[0]] = { recordings: [recording(null), recording(origin + '/rec.mp4')], transcripts: [origin + '/t.vtt'] }   /* one still processing (no link), one done */
    const r = await call({ action: 'pull', uid: uids[0], api })
    assert.equal(r.status, 200); assert.equal(r.body.state, 'pulled', JSON.stringify(r.body))
    assert.ok(asked.some((q) => q.uid === uids[0] && q.what === 'recordings' && /^Bearer /.test(q.auth) && q.version === '2024-08-13'), 'cal.com asked as the API wants: the key, the version')
    assert.ok(asked.some((q) => q.uid === uids[0] && q.what === 'transcripts'), 'and for the transcript')
    const { data: b } = await admin.from('bookings').select('recording_path, transcript_path, recording_at, recording_state, recording_tries').eq('uid', uids[0]).single()
    assert.equal(b.recording_path, uids[0] + '/recording.mp4'); assert.equal(b.transcript_path, uids[0] + '/transcript.vtt'); assert.ok(b.recording_at); assert.equal(b.recording_state, null); assert.equal(b.recording_tries, 0)
    const { data: got, error: e2 } = await admin.storage.from('recordings').download(uids[0] + '/recording.mp4'); if (e2) throw new Error(e2.message)
    assert.equal(got.size, MP4.length, 'the whole file, streamed')
  })
  await ta('nothing there yet: pending, then pulled on the next run', async () => {
    await row(uids[1])
    answers[uids[1]] = { recordings: 'none' }
    let r = await call({ action: 'pull', uid: uids[1], api })
    assert.equal(r.body.state, 'pending'); let { data: b } = await admin.from('bookings').select('recording_state, recording_tries, recording_error').eq('uid', uids[1]).single(); assert.equal(b.recording_state, 'pending'); assert.equal(b.recording_tries, 1)
    answers[uids[1]] = { recordings: [recording(origin + '/rec.mp4')] }
    r = await call({ action: 'pull', uid: uids[1], api })
    assert.equal(r.body.state, 'pulled'); ({ data: b } = await admin.from('bookings').select('recording_state, recording_path').eq('uid', uids[1]).single()); assert.equal(b.recording_state, null); assert.equal(b.recording_path, uids[1] + '/recording.mp4')
  })
  await ta('a link that answers nothing: a try counted with the reason; the cap turns it failed', async () => {
    await row(uids[2])
    answers[uids[2]] = { recordings: [recording(origin + '/missing.mp4')] }
    let r = await call({ action: 'pull', uid: uids[2], api })
    assert.equal(r.body.state, 'pending'); assert.match(r.body.error, /404/)
    await admin.from('bookings').update({ recording_tries: 143 }).eq('uid', uids[2])
    r = await call({ action: 'pull', uid: uids[2], api })
    assert.equal(r.body.state, 'failed'); const { data: b } = await admin.from('bookings').select('recording_state, recording_error').eq('uid', uids[2]).single(); assert.equal(b.recording_state, 'failed'); assert.match(b.recording_error, /404/)
    assert.equal((await call({ action: 'pull', uid: uids[2] }, anonKey)).status, 401, 'a guest at the pull')
  })
  await ta('cal-webhook: RECORDING_READY as cal.com sends it, signed, marks the booking pending; the transcript event keeps its link', async () => {
    const { loadDotEnv } = await import('./tts/storage.mjs'); loadDotEnv()
    const secret = process.env.CAL_WEBHOOK_SECRET || ''
    if (!secret) { console.log('  (the webhook part skipped — CAL_WEBHOOK_SECRET is unset in .env)'); return }
    const { createHmac } = await import('node:crypto')
    const post = async (body) => { const raw = JSON.stringify(body); const sig = createHmac('sha256', secret).update(raw).digest('hex'); const r = await fetch(url + '/functions/v1/cal-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cal-Signature-256': sig, 'X-Cal-Webhook-Version': '2021-10-20', apikey: anonKey }, body: raw }); return r.status }
    const evt = { uid: uids[3], type: 'probe', title: 'Probe call', startTime: new Date(Date.now() - 7200e3).toISOString(), endTime: new Date(Date.now() - 3600e3).toISOString(), organizer: { email: 'coach@example.com', name: 'Coach', timeZone: 'UTC' }, attendees: [{ email: 'member@example.com', name: 'Member', timeZone: 'UTC' }], bookingId: 1 }
    const first = await post({ triggerEvent: 'RECORDING_READY', createdAt: new Date().toISOString(), payload: { ...evt, downloadLink: 'https://app.cal.com/api/video/recording?token=probe' } })
    if (first === 401) { console.log("  (the webhook part skipped — the served functions hold another CAL_WEBHOOK_SECRET than this site's .env)"); return }
    assert.equal(first, 200)
    await new Promise((r) => setTimeout(r, 2500))   /* the pull runs after the answer */
    let b = null; for (let i = 0; i < 20 && !(b && b.recording_state === 'pending' && b.recording_error); i++) { ({ data: b } = await admin.from('bookings').select('recording_url, recording_state, recording_error, email, provider_email').eq('uid', uids[3]).single()); if (!(b && b.recording_state === 'pending' && b.recording_error)) await new Promise((r) => setTimeout(r, 1000)) }
    assert.equal(b.recording_url, 'https://app.cal.com/api/video/recording?token=probe', "cal.com's link kept for the record"); assert.equal(b.email, 'member@example.com'); assert.equal(b.provider_email, 'coach@example.com')
    assert.equal(b.recording_state, 'pending', 'pending: the pull asked cal.com itself, which refuses this stack\'s placeholder key'); assert.ok(b.recording_error, 'with the reason')
    assert.equal(await post({ triggerEvent: 'RECORDING_TRANSCRIPTION_GENERATED', createdAt: new Date().toISOString(), payload: { ...evt, downloadLinks: { transcription: [{ format: 'json', link: 'https://x/t.json' }, { format: 'vtt', link: 'https://x/t.vtt' }], recording: 'https://app.cal.com/api/video/recording?token=probe' } } }), 200)
    const { data: c } = await admin.from('bookings').select('transcript_url').eq('uid', uids[3]).single(); assert.equal(c.transcript_url, 'https://x/t.vtt', 'the vtt transcript link, from downloadLinks.transcription')
    assert.equal(await post({ triggerEvent: 'RECORDING_READY', createdAt: '', payload: {} }), 200, 'a body with no uid is acknowledged and not applied')
  })
  await ta('session-files: the attendee and the coach see it, a stranger does not', async () => {
    const mine = await files(await as('member@example.com'), uids[0])
    assert.ok(mine && mine.recording && /^\/storage\/.*token=/.test(mine.recording), 'the attendee: a signed recording path'); assert.ok(mine.transcript, 'and the transcript')
    const coach = await files(await as('coach@example.com'), uids[0]); assert.ok(coach && coach.recording, 'the coach')
    assert.equal(await files(await as('free@example.com'), uids[0]), 403, 'a stranger')
    const played = await fetch(url + mine.recording); assert.equal(played.status, 200); assert.equal(Number(played.headers.get('content-length')), MP4.length, 'the signed url serves the file')
  })
  await ta('the keep: older than its days removed and said so; 0 keeps everything', async () => {
    await admin.from('bookings').update({ recording_at: new Date(Date.now() - 100 * 86400e3).toISOString() }).eq('uid', uids[0])
    let r = await call({ action: 'retain', days: 0 }); assert.equal(r.body.removed, 0, '0 keeps')
    r = await call({ action: 'retain', days: 90 }); assert.ok(r.body.removed >= 1, 'the old one removed')
    const { data: b } = await admin.from('bookings').select('recording_path, recording_state, recording_error').eq('uid', uids[0]).single()
    assert.equal(b.recording_path, null); assert.equal(b.recording_state, 'removed'); assert.equal(b.recording_error, '90')
    const { data: gone } = await admin.storage.from('recordings').list(uids[0]); assert.equal((gone || []).length, 0, 'the files gone')
    const { data: kept } = await admin.storage.from('recordings').list(uids[1]); assert.ok((kept || []).some((f) => f.name === 'recording.mp4'), 'a fresh one kept')
  })
} finally {
  for (const uid of uids) { const { data: list } = await admin.storage.from('recordings').list(uid); if (list && list.length) await admin.storage.from('recordings').remove(list.map((f) => uid + '/' + f.name)) }
  await admin.from('bookings').delete().like('uid', `probe-rec-${stamp}-%`)
  server.close()
}
console.log(`${bad ? '✖' : '✔'} recordings: ${n - bad}/${n} checks`)
process.exit(bad ? 1 : 0)
