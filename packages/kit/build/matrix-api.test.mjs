/*
 * THE MATRIX SURFACE.
 *
 * Two halves. The first is the translation — ids, events, state, refusals — as pure functions
 * under Node, which needs no stack and runs everywhere. The second drives a real Matrix client
 * library against the served function, and is skipped, saying what it did not cover, when there
 * is no stack to drive it at.
 *
 * The pure half is not a formality: every bug this surface can have that is not about permission
 * is a bug in the translation, and the translation is the only part that can be exercised without
 * Docker. A round trip that loses a thread's root, or an edit that points at the wrong line, is
 * caught here in milliseconds rather than in a client three steps later.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const KIT = join(here, '..')
const M = join(KIT, 'supabase', 'functions', '_shared', 'matrix')

const ids = await import(join(M, 'ids.js'))
const events = await import(join(M, 'events.js'))
const state = await import(join(M, 'state.js'))
const errors = await import(join(M, 'errors.js'))

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')) } }
const HOST = 'example.test'
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`

console.log('\nTHE MATRIX SURFACE — the translation\n')

/* ---- 1.1 ids: total and reversible ---- */
{
  const room = ids.roomId(U(1), HOST)
  const space = ids.spaceId(U(2), HOST)
  const user = ids.userId(U(3), HOST)
  const event = ids.eventId(U(4))

  ok('a room id reads back as its channel', (ids.readRoom(room) || {}).id === U(1), room)
  ok('a space id reads back as a space, not a channel', (ids.readRoom(space) || {}).kind === 'space', space)
  ok('a room id reads back as a channel, not a space', (ids.readRoom(room) || {}).kind === 'channel')
  ok('a user id reads back as its profile', (ids.readUser(user) || {}).id === U(3), user)
  ok('an event id reads back as its message', (ids.readEvent(event) || {}).id === U(4), event)
  ok('an event id carries no host, as a modern room version says', !event.includes(':'), event)

  /* a client may send anything at all, and every one of these must be a null rather than a throw */
  for (const junk of ['', null, undefined, '!nonsense:host', '@:host', 'not-an-id', '$notours', '!c0000:host', {}, 42]) {
    let threw = false, got
    try { got = ids.readRoom(junk) } catch { threw = true }
    ok(`junk room id is refused quietly: ${JSON.stringify(junk)}`, !threw && !got)
  }

  /* the sigils must not collide: a user id is not a room id */
  ok('a user id is not read as a room', !ids.readRoom(user))
  ok('a room id is not read as a user', !ids.readUser(room))

  ok('our host is ours', ids.isOurs(room, HOST))
  ok('another host is not', !ids.isOurs(ids.roomId(U(1), 'elsewhere.example'), HOST))
  ok('and it says which host it was', ids.foreignHost(ids.roomId(U(1), 'elsewhere.example')) === 'elsewhere.example')
}

/* ---- 1.2 events: a row each way, over every kind the constraint allows ---- */
{
  const row = (over) => ({
    id: U(5), channel_id: U(1), seq: 7, author_id: U(3), kind: 'text', body: 'hello',
    created_at: '2026-01-01T10:00:00Z', meta: {}, ...over,
  })
  const mediaUrl = () => 'mxc://example.test/abc'

  /* every kind the check constraint allows makes an event with a body a client can show */
  for (const kind of ['text', 'voice', 'file', 'system', 'poll', 'announcement']) {
    const r = row({ kind, attachment: kind === 'voice' || kind === 'file' ? 'p.mp3' : null, attachment_name: 'p.mp3', title: kind === 'poll' ? 'Which?' : null })
    const e = events.toEvent(r, { host: HOST, mediaUrl })
    ok(`a ${kind} row becomes an event with a body`, !!e && typeof e.content.body === 'string' && e.content.body.length > 0, JSON.stringify(e && e.content))
    ok(`a ${kind} row keeps its own kind for a client that cares`, e.content['site.platformkit'].kind === kind)
  }

  const voice = events.toEvent(row({ kind: 'voice', attachment: 'v.mp3', attachment_name: 'v.mp3', attachment_type: 'audio/mpeg', seconds: 3.5 }), { host: HOST, mediaUrl })
  ok('a voice note is marked as one', !!voice.content['m.voice'] && voice.content.msgtype === 'm.audio')
  ok('and carries its length in milliseconds', voice.content.info.duration === 3500)

  const pic = events.toEvent(row({ kind: 'file', attachment: 'p.png', attachment_name: 'p.png', attachment_type: 'image/png' }), { host: HOST, mediaUrl })
  ok('a picture is an image, not a file', pic.content.msgtype === 'm.image')

  const thread = events.toEvent(row({ thread_root_id: U(6) }), { host: HOST, mediaUrl })
  ok('a reply hangs off its root', thread.content['m.relates_to'].rel_type === 'm.thread' && thread.content['m.relates_to'].event_id === ids.eventId(U(6)))
  const echoed = events.toEvent(row({ thread_root_id: U(6), echoed: true }), { host: HOST, mediaUrl })
  ok('an echoed reply says it belongs in the channel too', echoed.content['m.relates_to'].is_falling_back === true)

  const edited = events.toEvent(row({ body: 'after', edited_at: '2026-01-01T11:00:00Z' }), { host: HOST, mediaUrl })
  ok('an edit is a replacement of its own line', edited.content['m.relates_to'].rel_type === 'm.replace' && edited.content['m.relates_to'].event_id === ids.eventId(U(5)))
  ok('and carries the new words', edited.content['m.new_content'].body === 'after')

  const gone = events.toEvent(row({ deleted_at: '2026-01-01T12:00:00Z' }), { host: HOST, mediaUrl })
  ok('a withdrawn line is a redaction', !!gone.unsigned.redacted_because && Object.keys(gone.content).length === 0)
  ok('and the redaction names the line it removed', gone.unsigned.redacted_because.redacts === ids.eventId(U(5)))

  /* the other direction */
  const sent = events.fromEvent({ type: 'm.room.message', content: { msgtype: 'm.text', body: 'written' } }, { channelId: U(1) })
  ok('a sent message becomes a row', sent.ok && sent.row.body === 'written' && sent.row.channel_id === U(1))

  const inThread = events.fromEvent({ type: 'm.room.message', content: { msgtype: 'm.text', body: 'r', 'm.relates_to': { rel_type: 'm.thread', event_id: ids.eventId(U(6)) } } }, { channelId: U(1) })
  ok('a threaded reply keeps its root', inThread.ok && inThread.row.thread_root_id === U(6))

  const anEdit = events.fromEvent({ type: 'm.room.message', content: { msgtype: 'm.text', body: '* new', 'm.new_content': { body: 'new' }, 'm.relates_to': { rel_type: 'm.replace', event_id: ids.eventId(U(5)) } } }, { channelId: U(1) })
  ok('an edit names the line it replaces', anEdit.ok && anEdit.replaces === U(5))
  ok("and takes the new words, not the client's asterisk fallback", anEdit.row.body === 'new')

  /*
   * THE TWO REFUSALS ARE THE OTHER WAY ROUND IN A SEALED ROOM, and both halves matter.
   *
   * A ciphertext into an OPEN room would be a line nobody can ever read; a plaintext into a SEALED
   * one would be words in a timeline everybody else is sealing, with nothing about the room to show
   * it. The second is the one that would be missed, because it looks like an ordinary message.
   */
  const cipherOpen = events.fromEvent({ type: 'm.room.encrypted', content: { ciphertext: 'X' } }, { channelId: U(1) })
  ok('a ciphertext into an open room is refused', cipherOpen.why === 'not-sealed')
  const cipherSealed = events.fromEvent({ type: 'm.room.encrypted', content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'X' } }, { channelId: U(1), sealed: true })
  ok('…and taken in a sealed one, as the row\'s ciphertext and no words',
    cipherSealed.ok && cipherSealed.row.cipher && cipherSealed.row.cipher.ciphertext === 'X' && !cipherSealed.row.body)
  const plainSealed = events.fromEvent({ type: 'm.room.message', content: { msgtype: 'm.text', body: 'in the clear' } }, { channelId: U(1), sealed: true })
  ok('a plain message into a sealed room is refused', plainSealed.why === 'must-seal')
  ok('an empty message is refused', !events.fromEvent({ type: 'm.room.message', content: { msgtype: 'm.text', body: '   ' } }, { channelId: U(1) }).ok)

  /* 3b.3 — a slash is words, never a command */
  const slash = events.fromEvent({ type: 'm.room.message', content: { msgtype: 'm.text', body: '/summarise the last hour' } }, { channelId: U(1) })
  ok('a body beginning with a slash is an ordinary message', slash.ok && slash.row.body === '/summarise the last hour' && slash.row.kind === 'text')
  ok('and nothing is parsed out of it', !('command' in slash.row) && !('args' in slash.row))
}

/* ---- 1.3 state: power levels derived, and read-only ---- */
{
  const holders = [
    { user_id: U(3), capabilities: ['moderate'] },
    { user_id: U(4), capabilities: ['voice', 'file'] },
    { user_id: U(2), capabilities: [], admin: true },
  ]
  const pl = state.powerLevels(holders, { host: HOST })
  ok('a moderator is Matrix’s own 50', pl.users[ids.userId(U(3), HOST)] === 50)
  ok('an attach-only grant sits below a moderator', pl.users[ids.userId(U(4), HOST)] === 25)
  ok('an administrator is 100', pl.users[ids.userId(U(2), HOST)] === 100)
  ok('somebody with no grant is not listed at all', !(ids.userId(U(1), HOST) in pl.users))

  /* the grant is removed and the number goes with it — the derivation, not a stored copy */
  const without = state.powerLevels(holders.filter((h) => h.user_id !== U(3)), { host: HOST })
  ok('a grant taken away takes the level with it', !(ids.userId(U(3), HOST) in without.users))

  ok('no state may be set from a client', pl.state_default === 100)
  ok('and the power levels themselves need an administrator', pl.events['m.room.power_levels'] === 100)
  ok('every read-only state event is named, so a refusal can say which', Object.keys(state.READ_ONLY_STATE).length >= 8)
  ok('power levels are among them', 'm.room.power_levels' in state.READ_ONLY_STATE)
  ok('encryption is among them', 'm.room.encryption' in state.READ_ONLY_STATE)

  const ch = { id: U(1), name: 'General', topic: 'Anything', created_at: '2026-01-01T00:00:00Z', created_by: U(2) }
  const st = state.roomState(ch, { host: HOST, holders, members: [{ user_id: U(3), name: 'Ada' }] })
  const types = st.map((e) => e.type)
  for (const t of ['m.room.create', 'm.room.name', 'm.room.power_levels', 'm.room.history_visibility', 'm.room.join_rules', 'm.room.topic', 'm.room.member']) {
    ok(`a room's state carries ${t}`, types.includes(t))
  }
  ok('history is shared, as our rooms are', (st.find((e) => e.type === 'm.room.history_visibility') || {}).content.history_visibility === 'shared')

  /*
   * AND WHETHER THE ROOM IS SEALED. This is the one state event that changes what a client DOES
   * rather than what it shows: Element seeing it encrypts everything it sends here and refuses to
   * send a plain message. A client that did NOT see it would post the plaintext into a room
   * everybody else is sealing, which is why the absence is checked as carefully as the presence.
   */
  ok('an unencrypted room says nothing about encryption', !types.includes('m.room.encryption'))
  const sealed = state.roomState({ ...ch, encrypted: true }, { host: HOST, holders, members: [] })
  const enc = sealed.find((e) => e.type === 'm.room.encryption')
  ok('an encrypted room carries m.room.encryption', !!enc)
  ok('…naming megolm, which is what a client needs in order to seal anything', enc && enc.content.algorithm === 'm.megolm.v1.aes-sha2')
  ok('…and saying when a session rotates, so leaving a room eventually means leaving it', enc && enc.content.rotation_period_msgs > 0 && enc.content.rotation_period_ms > 0)
  ok('it is still state no client may set', state.powerLevels([], { host: HOST }).events['m.room.encryption'] === 100)

  const sp = state.spaceState({ id: U(2), name: 'The community', created_at: '2026-01-01T00:00:00Z' }, [{ id: U(1), position: 1 }], { host: HOST })
  ok('a space says it is a Space', (sp.find((e) => e.type === 'm.room.create') || {}).content.type === 'm.space')
  const child = sp.find((e) => e.type === 'm.space.child')
  ok('and its channels are its children', !!child && child.state_key === ids.roomId(U(1), HOST))
}

/* ---- 1.4 errors: every refusal says something a person can act on ---- */
{
  const made = []
  for (const [name, fn] of Object.entries(errors.REFUSALS)) {
    const r = fn(60)
    made.push([name, r])
    ok(`the refusal "${name}" says why, not just a code`, errors.speaks(r), JSON.stringify(r && r.body))
    ok(`the refusal "${name}" carries a Matrix code`, !!(r.body.errcode || '').startsWith('M_'))
    ok(`the refusal "${name}" carries a status`, r.status >= 400 && r.status < 600)
  }
  ok('a rate limit tells the client when to come back', made.find(([n]) => n === 'tooManyLogins')[1].body.retry_after_ms > 0)
  ok('a refusal to register says where to sign up instead', /sign up/i.test(errors.REFUSALS.noRegister('https://example.test').body.error))
  ok('a foreign room names the host it cannot reach', /elsewhere\.example/.test(errors.REFUSALS.foreign('elsewhere.example').body.error))
}

console.log(`\nmatrix (the translation): ${pass} passed${fail ? `, ${fail} FAILED` : ''}\n`)

/* =============================================================================================
 * THE LIVE HALF — a real Matrix client library against the served function.
 *
 * matrix-js-sdk is the library Element itself is built on, so this is the closest a test gets to
 * "a real client works" without driving an application. It is not hand-rolled HTTP on purpose: a
 * test that speaks the protocol by hand proves only that our own reading of the specification is
 * self-consistent, which is the one thing we already know.
 *
 * With no stack it SKIPS AND SAYS WHAT IT DID NOT COVER, as the other API lanes do. A lane that
 * passes quietly when it ran nothing is worse than a lane that fails: it reports a shape of the
 * product as checked when nothing touched it.
 * ============================================================================================= */
const FN = process.env.MATRIX_FN_URL || 'http://127.0.0.1:54321/functions/v1/matrix-api'
const SKIP = process.env.MATRIX_API_TEST === '0'

async function served() {
  if (SKIP) return false
  try {
    const r = await fetch(FN + '/_matrix/client/versions', { signal: AbortSignal.timeout(2500) })
    return r.ok
  } catch { return false }
}

if (!(await served())) {
  console.log('  ⚠ SKIPPED — nothing is serving the Matrix function at ' + FN)
  console.log('    Not covered by this run: a real client signing in, /sync, paging a room, sending,')
  console.log('    threads, edits, redactions, Spaces, the media repository, the guards, the session')
  console.log('    ending with the account, the sign-in cap, and a mention waking a bot.')
  if (fail) process.exit(1)
  process.exit(0)
}

console.log('\nTHE MATRIX SURFACE — a real client\n')
const sdk = await import('matrix-js-sdk')
const seeded = (n) => ({ user: n + '@example.com', password: 'password123' })

/* the seeded member, through the library's own login rather than a hand-made request */
let client = null
try {
  const tmp = sdk.createClient({ baseUrl: FN })
  const who = seeded('member')
  const got = await tmp.loginRequest({ type: 'm.login.password', identifier: { type: 'm.id.thirdparty', medium: 'email', address: who.user }, password: who.password, initial_device_display_name: 'the test' })
  ok('a real client library signs in with the site\'s own password', !!got.access_token && /^@[0-9a-f]{32}:/.test(got.user_id), JSON.stringify(got).slice(0, 200))
  client = sdk.createClient({ baseUrl: FN, accessToken: got.access_token, userId: got.user_id, deviceId: got.device_id })
} catch (e) {
  ok('a real client library signs in with the site\'s own password', false, String(e && e.message).slice(0, 300))
}

if (client) {
  /* whoami, which is the cheapest proof the token authorises as a person */
  try {
    const me = await client.whoami()
    ok('and the token authorises as that person', /^@[0-9a-f]{32}:/.test(me.user_id))
  } catch (e) { ok('and the token authorises as that person', false, String(e && e.message).slice(0, 200)) }

  /* the rooms that are theirs */
  let rooms = []
  try {
    const got = await client.getJoinedRooms()
    rooms = got.joined_rooms || []
    ok('a member has rooms, and every one of them is ours', rooms.length > 0 && rooms.every((r) => r.startsWith('!')), JSON.stringify(rooms).slice(0, 200))
  } catch (e) { ok('a member has rooms', false, String(e && e.message).slice(0, 200)) }

  /* a channel, not a Space, to read and write in */
  const channel = rooms.find((r) => r.startsWith('!c'))
  const space = rooms.find((r) => r.startsWith('!s'))
  ok('and among them a Space, so a client draws the site\'s own arrangement', !!space, JSON.stringify(rooms).slice(0, 160))

  if (channel) {
    try {
      const page = await client.createMessagesRequest(channel, null, 20, 'b')
      ok('a room pages backwards', Array.isArray(page.chunk))
    } catch (e) { ok('a room pages backwards', false, String(e && e.message).slice(0, 200)) }

    let sentId = null
    try {
      const sent = await client.sendTextMessage(channel, 'a line from a real Matrix client')
      sentId = sent.event_id
      ok('a real client sends a message', !!sentId && sentId.startsWith('$m'))
    } catch (e) { ok('a real client sends a message', false, String(e && e.message).slice(0, 300)) }

    if (sentId) {
      try {
        const page = await client.createMessagesRequest(channel, null, 30, 'b')
        ok('and it is there when the room is read back', (page.chunk || []).some((e) => e.event_id === sentId))
      } catch (e) { ok('and it is there when the room is read back', false, String(e && e.message).slice(0, 200)) }
      try {
        await client.redactEvent(channel, sentId)
        const page = await client.createMessagesRequest(channel, null, 30, 'b')
        const back = (page.chunk || []).find((e) => e.event_id === sentId)
        ok('a withdrawal comes back as a redaction', !!back && !!(back.unsigned || {}).redacted_because)
      } catch (e) { ok('a withdrawal comes back as a redaction', false, String(e && e.message).slice(0, 200)) }
    }

    /* NOTHING IS SET FROM A CLIENT — the refusal a second, weaker way to grant moderation would
       have gone through */
    try {
      await client.sendStateEvent(channel, 'm.room.power_levels', { users: {} }, '')
      ok('a client cannot raise its own power level', false, 'the write was accepted')
    } catch (e) {
      ok('a client cannot raise its own power level', /forbidden|M_FORBIDDEN|403/i.test(String(e && (e.errcode || e.message))))
      ok('and the refusal says which thing it was', /decided by this site|power/i.test(String(e && (e.data?.error || e.message))), String(e && (e.data?.error || e.message)).slice(0, 160))
    }
  }

  /* /sync twice: the second carries what is new and not the room again */
  try {
    const first = await client.http.authedRequest('GET', '/sync', { timeout: '0' })
    const token = first.next_batch
    const second = await client.http.authedRequest('GET', '/sync', { since: token, timeout: '0' })
    ok('sync gives a token that pages forward', !!token && !!second.next_batch)
    ok('and a second sync is smaller than the first', JSON.stringify(second.rooms || {}).length <= JSON.stringify(first.rooms || {}).length)
  } catch (e) { ok('sync gives a token that pages forward', false, String(e && e.message).slice(0, 200)) }

  /* a room on another homeserver: a refusal that says why, never a hang */
  try {
    await client.createMessagesRequest('!c' + '0'.repeat(30) + 'ff:elsewhere.example', null, 5, 'b')
    ok('a room on another homeserver is refused', false, 'it was not')
  } catch (e) {
    const said = String((e && (e.data?.error || e.message)) || '')
    ok('a room on another homeserver is refused', /403|forbidden/i.test(String(e && (e.errcode || e.httpStatus || e.message))))
    ok('and the refusal names federation as the reason', /federat/i.test(said), said.slice(0, 160))
  }

  /* registration is refused, and says where to sign up */
  try {
    const r = await fetch(FN + '/_matrix/client/v3/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const b = await r.json()
    ok('registration is refused', r.status === 403 && b.errcode === 'M_FORBIDDEN')
    ok('and says where to sign up instead', /sign up/i.test(b.error || ''), String(b.error).slice(0, 140))
  } catch (e) { ok('registration is refused', false, String(e && e.message).slice(0, 200)) }

  /* a token that is not ours */
  try {
    const r = await fetch(FN + '/_matrix/client/v3/joined_rooms', { headers: { Authorization: 'Bearer not-a-real-token' } })
    const b = await r.json()
    ok('a made-up token is refused as unknown', r.status === 401 && b.errcode === 'M_UNKNOWN_TOKEN')
  } catch (e) { ok('a made-up token is refused as unknown', false, String(e && e.message).slice(0, 200)) }

  /* and it says federation and encryption are absent rather than letting a client find out */
  try {
    const caps = await client.getCapabilities(true)
    const fed = caps['site.platformkit.federation']
    const enc = caps['site.platformkit.encryption']
    ok('capabilities say federation is absent, with a reason', fed && fed.enabled === false && (fed.reason || '').length > 20)
    /* a site with the module on says encryption is THERE — and says what a sealed room costs,
       which is the part a client's user needs and a capability flag alone never carries */
    ok('capabilities say whether a room may be encrypted, with a reason either way', enc && typeof enc.enabled === 'boolean' && (enc.reason || '').length > 20, JSON.stringify(enc))
    ok('…and where it is on, the reason says what it costs', !enc || !enc.enabled || /search|bot|moder/i.test(enc.reason), String(enc && enc.reason).slice(0, 160))
  } catch (e) { ok('capabilities say what is absent', false, String(e && e.message).slice(0, 200)) }

  /*
   * THE KEY ENDPOINTS, for real. Every one of these answered empty before a channel could be
   * sealed, and a client reading "empty" from a store that is meant to hold something is the
   * failure mode that cannot be seen from the outside — the room looks fine and no message in it
   * can ever be read. So each is asked to store something and then to give it back.
   */
  const K = async (where, init = {}) => {
    const r = await fetch(FN + where, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + client.getAccessToken(), ...(init.headers || {}) },
    })
    return { status: r.status, body: await r.json().catch(() => null) }
  }
  const me = client.getUserId(), dev = client.getDeviceId()

  const up = await K('/_matrix/client/v3/keys/upload', {
    method: 'POST',
    body: JSON.stringify({
      device_keys: { user_id: me, device_id: dev, algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'], keys: { ['curve25519:' + dev]: 'CURVE', ['ed25519:' + dev]: 'ED' }, signatures: { [me]: { ['ed25519:' + dev]: 'SIG' } } },
      one_time_keys: { 'signed_curve25519:AAAAAQ': { key: 'one', signatures: {} }, 'signed_curve25519:AAAAAg': { key: 'two', signatures: {} } },
    }),
  })
  ok('a device uploads its keys', up.status === 200, JSON.stringify(up.body).slice(0, 160))
  ok('…and is told how many one-time keys it now has', (up.body && up.body.one_time_key_counts && up.body.one_time_key_counts.signed_curve25519) === 2,
    'a count of zero after a successful upload makes a client upload for ever: ' + JSON.stringify(up.body))

  const qy = await K('/_matrix/client/v3/keys/query', { method: 'POST', body: JSON.stringify({ device_keys: { [me]: [] } }) })
  const mine = qy.body && qy.body.device_keys && qy.body.device_keys[me] && qy.body.device_keys[me][dev]
  ok('a query gives the device back', !!mine, JSON.stringify(qy.body).slice(0, 200))
  ok('…with the public keys it uploaded', mine && mine.keys['curve25519:' + dev] === 'CURVE')
  ok('…and the signature that makes them its own rather than whatever the server served', mine && mine.signatures[me]['ed25519:' + dev] === 'SIG')

  const c1 = await K('/_matrix/client/v3/keys/claim', { method: 'POST', body: JSON.stringify({ one_time_keys: { [me]: { [dev]: 'signed_curve25519' } } }) })
  const got1 = c1.body && c1.body.one_time_keys && c1.body.one_time_keys[me] && c1.body.one_time_keys[me][dev]
  ok('a one-time key can be claimed', !!got1 && Object.keys(got1).length === 1, JSON.stringify(c1.body).slice(0, 200))
  const c2 = await K('/_matrix/client/v3/keys/claim', { method: 'POST', body: JSON.stringify({ one_time_keys: { [me]: { [dev]: 'signed_curve25519' } } }) })
  const got2 = c2.body && c2.body.one_time_keys && c2.body.one_time_keys[me] && c2.body.one_time_keys[me][dev]
  ok('…and the second claim gives a DIFFERENT key, never the same one twice',
    !!got2 && Object.keys(got2)[0] !== Object.keys(got1 || {})[0],
    'two sessions built on one key is exactly what a one-time key exists to prevent: ' + JSON.stringify([got1, got2]))
  const c3 = await K('/_matrix/client/v3/keys/claim', { method: 'POST', body: JSON.stringify({ one_time_keys: { [me]: { [dev]: 'signed_curve25519' } } }) })
  const got3 = c3.body && c3.body.one_time_keys && c3.body.one_time_keys[me]
  ok('…and when they run out, none is invented', !got3 || !Object.keys(got3[dev] || {}).length, JSON.stringify(c3.body).slice(0, 160))

  const cs = await K('/_matrix/client/v3/keys/device_signing/upload', {
    method: 'POST',
    body: JSON.stringify({ master_key: { user_id: me, usage: ['master'], keys: { 'ed25519:MASTER': 'MASTER' } }, self_signing_key: { user_id: me, usage: ['self_signing'], keys: { 'ed25519:SELF': 'SELF' } } }),
  })
  ok('cross-signing keys are taken', cs.status === 200, JSON.stringify(cs.body).slice(0, 160))
  const qy2 = await K('/_matrix/client/v3/keys/query', { method: 'POST', body: JSON.stringify({ device_keys: { [me]: [] } }) })
  ok('…and given back, which is what makes verification possible at all',
    !!(qy2.body && qy2.body.master_keys && qy2.body.master_keys[me]), JSON.stringify(qy2.body && qy2.body.master_keys).slice(0, 160))
  ok('…and a device row is never mistaken for the person\'s own', !(qy2.body.device_keys[me] || {})[''])


  /*
   * A SIGNATURE IS KEYED BY ITS SIGNER. Ada signing her own device is an entry under Ada — and so
   * is Ada signing Bob's master key, which is the case that tells the two apart. Written to take
   * the key from the TARGET instead, self-signing verifies and vouching for anybody else silently
   * never does, with nothing anywhere saying why.
   */
  const sig = await K('/_matrix/client/v3/keys/signatures/upload', {
    method: 'POST',
    body: JSON.stringify({ [me]: { [dev]: { user_id: me, device_id: dev, algorithms: ['m.megolm.v1.aes-sha2'], keys: { ['ed25519:' + dev]: 'ED' }, signatures: { [me]: { 'ed25519:MASTER': 'CROSSSIG' } } } } }),
  })
  ok('a signature is taken', sig.status === 200, JSON.stringify(sig.body).slice(0, 160))
  const qy3 = await K('/_matrix/client/v3/keys/query', { method: 'POST', body: JSON.stringify({ device_keys: { [me]: [] } }) })
  const back2 = qy3.body && qy3.body.device_keys && qy3.body.device_keys[me] && qy3.body.device_keys[me][dev]
  ok('…and comes back under the signer, which is what verification reads',
    !!(back2 && back2.signatures && back2.signatures[me] && back2.signatures[me]['ed25519:MASTER'] === 'CROSSSIG'),
    JSON.stringify(back2 && back2.signatures))
  ok('…without losing the device\'s own signature over its keys',
    !!(back2 && back2.signatures && back2.signatures[me] && back2.signatures[me]['ed25519:' + dev] === 'SIG'),
    'a signature is merged per signer; replacing the lot un-verifies the key for everybody else: ' + JSON.stringify(back2 && back2.signatures))


  /*
   * AND THE CASE THAT TELLS A RIGHT IMPLEMENTATION FROM A WRONG ONE: SOMEBODY ELSE SIGNING.
   *
   * A signature is keyed by its SIGNER. When Ada signs her own device the signer and the target
   * are the same person, so taking the key from either gives the same answer — which is why the
   * self-signing check above passes against an implementation that reads the TARGET'S id, and why
   * it proves nothing on its own. Ada signing BOB'S key is where the two part company: written
   * wrongly it lands under Bob, where no client will ever look for it, and cross-signing silently
   * never verifies with nothing anywhere saying why.
   *
   * Skipped where the two seeded accounts do not share a space, since the device rows are fenced
   * by the rooms and there would then be nothing to sign.
   */
  {
    const other = seeded('coach')
    let them = null
    try {
      const t2 = sdk.createClient({ baseUrl: FN })
      them = await t2.loginRequest({ type: 'm.login.password', identifier: { type: 'm.id.thirdparty', medium: 'email', address: other.user }, password: other.password, initial_device_display_name: 'the other test' })
    } catch (e) { /* no such account on this stack */ }

    if (!them || !them.access_token) {
      ok('a second account signs the first (skipped: no second seeded account)', true)
    } else {
      const K2 = async (where, init = {}) => {
        const r = await fetch(FN + where, { ...init, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + them.access_token, ...(init.headers || {}) } })
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      /* the other person signs OUR device, naming themselves as the signer */
      const cross = await K2('/_matrix/client/v3/keys/signatures/upload', {
        method: 'POST',
        body: JSON.stringify({ [me]: { [dev]: { user_id: me, device_id: dev, algorithms: ['m.megolm.v1.aes-sha2'], keys: { ['ed25519:' + dev]: 'ED' }, signatures: { [them.user_id]: { 'ed25519:THEIRS': 'THEIRSIG' } } } } }),
      })
      ok('somebody else may sign a key', cross.status === 200, JSON.stringify(cross.body).slice(0, 160))

      const seen = await K('/_matrix/client/v3/keys/query', { method: 'POST', body: JSON.stringify({ device_keys: { [me]: [] } }) })
      const row = seen.body && seen.body.device_keys && seen.body.device_keys[me] && seen.body.device_keys[me][dev]
      const sigs = (row && row.signatures) || {}
      ok('…and it is stored under the SIGNER, not under whoever the key belongs to',
        !!(sigs[them.user_id] && sigs[them.user_id]['ed25519:THEIRS'] === 'THEIRSIG'),
        'keyed by the target it lands where no client looks and cross-signing never verifies: ' + JSON.stringify(sigs))
      ok('…and the key\'s own earlier signatures are still there',
        !!(sigs[me] && sigs[me]['ed25519:' + dev]),
        JSON.stringify(sigs))
      /* and a signature the body attributes to somebody who is not the caller is not written */
      const forged = await K2('/_matrix/client/v3/keys/signatures/upload', {
        method: 'POST',
        body: JSON.stringify({ [me]: { [dev]: { user_id: me, device_id: dev, keys: {}, signatures: { [me]: { 'ed25519:FORGED': 'NOPE' } } } } }),
      })
      void forged
      const after = await K('/_matrix/client/v3/keys/query', { method: 'POST', body: JSON.stringify({ device_keys: { [me]: [] } }) })
      const sigs2 = ((((after.body || {}).device_keys || {})[me] || {})[dev] || {}).signatures || {}
      ok('a signature the body attributes to somebody else is not written in their name',
        !(sigs2[me] && sigs2[me]['ed25519:FORGED']),
        'the body says who signed, and taking that at its word lets anybody write "Ada vouched for me" into Ada\'s name: ' + JSON.stringify(sigs2))
      try { await fetch(FN + '/_matrix/client/v3/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + them.access_token } }) } catch { /* over either way */ }
    }
  }

  const bk = await K('/_matrix/client/v3/room_keys/version', { method: 'POST', body: JSON.stringify({ algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2', auth_data: { public_key: 'PUB' } }) })
  ok('a key backup version can be made', bk.status === 200 && !!(bk.body && bk.body.version), JSON.stringify(bk.body).slice(0, 160))
  const ver = bk.body && bk.body.version
  const put = await K('/_matrix/client/v3/room_keys/keys?version=' + encodeURIComponent(ver), {
    method: 'PUT',
    body: JSON.stringify({ rooms: { '!room:here': { sessions: { s1: { first_message_index: 0, forwarded_count: 0, is_verified: true, session_data: { ciphertext: 'OPAQUE' } } } } } }),
  })
  ok('…and sessions stored in it', put.status === 200 && (put.body || {}).count === 1, JSON.stringify(put.body).slice(0, 160))
  const back = await K('/_matrix/client/v3/room_keys/keys?version=' + encodeURIComponent(ver))
  ok('…and read back out of it, which is the whole point of a backup',
    back.status === 200 && !!(((back.body || {}).rooms || {})['!room:here'] || {}).sessions.s1, JSON.stringify(back.body).slice(0, 200))
  const none = await K('/_matrix/client/v3/room_keys/version/999999')
  ok('a backup that is not there is M_NOT_FOUND, which is a client\'s normal first day',
    none.status === 404 || (none.body && none.body.errcode === 'M_NOT_FOUND'), JSON.stringify(none.body).slice(0, 160))


  /*
   * TEN VERSIONS, because the tenth is where a text column stops being a number. A backup's
   * version is a number spelt as a string and the column is text, so ordered by the database
   * "9" sorts after "10": the tenth backup is numbered 10 a second time, and the one served as
   * current stays "9" for ever. Nine of these would pass against either implementation.
   */
  {
    let seen = []
    for (let i = 0; i < 10; i++) {
      const r = await K('/_matrix/client/v3/room_keys/version', {
        method: 'POST', body: JSON.stringify({ algorithm: 'm.megolm_backup.v1.curve25519-aes-sha2', auth_data: { public_key: 'PUB' + i } }),
      })
      seen.push(r.body && r.body.version)
    }
    ok('each new backup version is a number nobody has had before', new Set(seen).size === seen.length, seen.join(','))
    ok('…and they count up past ten', Number(seen[seen.length - 1]) >= 10, seen.join(','))
    const cur = await K('/_matrix/client/v3/room_keys/version')
    ok('…and the one served as current is the newest, not the one that sorts last as text',
      cur.body && String(cur.body.version) === String(seen[seen.length - 1]),
      'served ' + JSON.stringify(cur.body && cur.body.version) + ', newest is ' + seen[seen.length - 1])

    /*
     * AND THEN IT PUTS THEM BACK, which is a route as well as a tidy-up: Matrix lets a client
     * delete a backup version (Element calls it "delete backup") and we had no route for one, so a
     * client could make a backup and never be rid of it.
     *
     * The tidy-up matters on its own. Every run of this block left eleven backup versions on a
     * seeded account for good, each with a made-up public key — and a REAL client signing in as
     * that member afterwards fetches the current backup, fails to decode "PUB9" as a Curve25519
     * key, and throws on sign-in. A test that leaves rubbish behind breaks the next test, and this
     * one broke the live client lane below.
     */
    const gone = []
    for (const v of [...seen, ver]) {
      const d = await K('/_matrix/client/v3/room_keys/version/' + encodeURIComponent(v), { method: 'DELETE' })
      gone.push(d.status)
    }
    ok('a client can delete a backup version it made', gone.every((x) => x === 200), gone.join(','))
    const after = await K('/_matrix/client/v3/room_keys/version')
    ok('…and with every version deleted there is no backup, which is where a client starts',
      after.status === 404 || (after.body && after.body.errcode === 'M_NOT_FOUND'), JSON.stringify(after.body).slice(0, 160))
    const twice = await K('/_matrix/client/v3/room_keys/version/' + encodeURIComponent(seen[0]), { method: 'DELETE' })
    ok('…and deleting one twice is M_NOT_FOUND rather than a second success',
      twice.status === 404 || (twice.body && twice.body.errcode === 'M_NOT_FOUND'), JSON.stringify(twice.body).slice(0, 160))
  }

  /* to-device, and the sync that delivers it */
  const td = await K('/_matrix/client/v3/sendToDevice/m.room_key/txn1', {
    method: 'PUT', body: JSON.stringify({ messages: { [me]: { [dev]: { algorithm: 'm.megolm.v1.aes-sha2', session_id: 's1' } } } }),
  })
  ok('a to-device message is accepted', td.status === 200, JSON.stringify(td.body).slice(0, 160))
  const sync1 = await K('/_matrix/client/v3/sync')
  const events = ((sync1.body || {}).to_device || {}).events || []
  ok('…and arrives in the next sync', events.some((e) => e.type === 'm.room_key'), JSON.stringify(events).slice(0, 200))
  ok('a sync carries device_lists, so a client knows when to re-query', !!(sync1.body || {}).device_lists)
  const sync2 = await K('/_matrix/client/v3/sync?since=' + encodeURIComponent((sync1.body || {}).next_batch || '0'))
  const again = ((sync2.body || {}).to_device || {}).events || []
  ok('…and is gone from the one after, having been acknowledged',
    !again.some((e) => e.type === 'm.room_key'), JSON.stringify(again).slice(0, 200))

  try { await fetch(FN + '/_matrix/client/v3/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + client.getAccessToken() } }) } catch { /* the run is over either way */ }
}

console.log(`\nmatrix: ${pass} passed${fail ? `, ${fail} FAILED` : ''}\n`)
if (fail) process.exit(1)
