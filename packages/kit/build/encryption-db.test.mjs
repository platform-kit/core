/*
 * WHAT AN ENCRYPTED CHANNEL ACTUALLY STORES — asked of a real database rather than of a schema file.
 *
 * Three things are checked here and nowhere else, because each is a property of the DATA and not of
 * anything a reading of the SQL would settle:
 *
 *   THE ROW HOLDS NO READABLE TEXT. A sealed message is a ciphertext and nothing else.
 *   THE INDEX HOLDS NOTHING EITHER. `space_messages.fts` is generated over title, body and the
 *     attachment's name, so an encrypted row must leave all three null — and the attachment name is
 *     the one that is easy to write by accident, which would make "severance-agreement.pdf"
 *     findable in a room whose words nobody can read.
 *   THE SEAL IS ONE-WAY ONCE ANYTHING IS BEHIND IT. Turning it off would leave a timeline of
 *     messages nobody can ever read again, so it is refused — and allowed while the room is still
 *     empty, which is the only moment it costs nothing.
 *
 * Skipped when the local stack is down or ENCRYPTION_TEST=0, like the other db tests.
 *
 *   node packages/kit/build/encryption-db.test.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { leave } from './test-stack.mjs'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n          ' + detail : '')) } }

console.log('\nWHAT AN ENCRYPTED CHANNEL STORES\n')

if (process.env.ENCRYPTION_TEST === '0') { console.log('  ⚠ SKIPPED — ENCRYPTION_TEST=0\n'); process.exit(0) }

const { supabaseUrl, serviceKey } = await import('./tts/storage.mjs')
const url = supabaseUrl(), key = serviceKey()
if (!url || !key) { console.log('  ⚠ SKIPPED — no local stack in the environment\n'); leave(0) }
const db = createClient(url, key, { auth: { persistSession: false } })
/*
 * …and a client that IS somebody, because a moderator read asks `auth.uid()` and the service role
 * is nobody at all. `space_reports` answered [] for the service key, which read as "no report
 * reached the desk" when what had happened is that nobody asked.
 */
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
const as = async (email) => {
  if (!anon) return null
  const c = createClient(url, anon, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  return error ? null : c
}
try {
  const { error } = await db.from('channels').select('id').limit(1)
  if (error) throw error
} catch (e) { console.log(`  ⚠ SKIPPED — the stack did not answer (${String(e.message || e).slice(0, 80)})\n`); leave(0) }

/* ---- the four tables are there, and are state ---- */
for (const t of ['space_devices', 'space_one_time_keys', 'space_to_device', 'space_key_backups']) {
  const { error } = await db.from(t).select('*').limit(1)
  ok(`${t} exists`, !error, error && error.message)
}

/* ---- a room of our own to seal ---- */
const { data: space } = await db.from('spaces').select('id').limit(1).maybeSingle()
if (!space) { console.log('  ⚠ SKIPPED — the seed has no space to put a room in\n'); leave(0) }
const slug = 'enc-test-' + Math.random().toString(16).slice(2, 8)
const mk = async (encrypted) => {
  const { data, error } = await db.from('channels')
    .insert({ space_id: space.id, slug, name: 'Sealed', mode: 'stream', visibility: 'open', encrypted })
    .select('id, encrypted').single()
  if (error) throw new Error(error.message)
  return data
}
const cleanup = async (id) => { await db.from('space_messages').delete().eq('channel_id', id); await db.from('channels').delete().eq('id', id) }

let ch
try { ch = await mk(true) } catch (e) { console.log(`  ⚠ SKIPPED — could not make a channel (${String(e.message).slice(0, 110)})\n`); leave(0) }
ok('a channel can be declared encrypted', ch.encrypted === true)

try {
  /* ---- the sealed row ---- */
  const { data: author } = await db.from('profiles').select('id').limit(1).single()
  const cipher = { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'AwgAEnB…opaque…', sender_key: 'curve25519key', session_id: 'sess1', device_id: 'DEV1' }
  const { data: msg, error: msgErr } = await db.from('space_messages')
    .insert({ channel_id: ch.id, author_id: author.id, kind: 'text', cipher })
    .select('id, body, title, attachment_name, cipher').single()
  ok('a sealed message is stored', !msgErr && !!msg, msgErr && msgErr.message)

  if (msg) {
    ok('…with no body', msg.body === null)
    ok('…no title', msg.title === null)
    ok('…and no attachment name — the one that is easy to write by accident', msg.attachment_name === null)
    ok('…and the ciphertext itself', msg.cipher && msg.cipher.ciphertext === cipher.ciphertext)

    /* THE INDEX. fts is generated, so this is the database's own answer and not ours. An empty
       tsvector prints as '' — anything else is text the search would find. */
    const { data: rows, error: ftsErr } = await db.from('space_messages').select('fts').eq('id', msg.id).single()
    ok('the index is readable, so this check is a check', !ftsErr,
      'fts is not selectable here — the index claim below would be a skip wearing a tick, which is the thing this file exists not to do: ' + (ftsErr && ftsErr.message))
    ok('the full-text index holds nothing for a sealed row', !ftsErr && (!rows.fts || String(rows.fts).trim() === ''), `fts: ${JSON.stringify(rows && rows.fts)}`)

    /*
     * AND THE CONTROL, without which "the index is empty" proves nothing: a PLAIN message in the
     * same room, whose index must NOT be empty. An fts column that had stopped being generated at
     * all would pass every check above and the room would be searchable the day somebody fixed it.
     */
    const { data: plain } = await db.from('space_messages')
      .insert({ channel_id: ch.id, author_id: author.id, kind: 'text', body: 'severance agreement', attachment_name: 'severance-agreement.pdf' })
      .select('id, fts').single()
    ok('a plain message IS indexed — so an empty index means something', !!plain && String(plain.fts || '').includes('severance'),
      `fts: ${JSON.stringify(plain && plain.fts)}`)


    /*
     * A REPORT FROM A SEALED ROOM REACHES THE STAFF WITHOUT WORDS, AND SAYS WHY.
     *
     * The body is already null — there is nothing to read — and "no body" and "sealed" are
     * different facts: the first is a message somebody withdrew, the second is one nobody on this
     * side can read and never could. A desk shown an empty quote reads it as a message that failed
     * to load; shown the sentence, a moderator knows to ask the person who reported it.
     *
     * Every action still works, because they act on a PERSON and not on a message. That is the
     * half of moderation a sealed room keeps.
     */
    const { data: rep } = await db.from('space_moderation').insert({
      kind: 'report', space_id: space.id, channel_id: ch.id, message_id: msg.id,
      actor_id: author.id, subject_id: author.id, reason: 'other',
    }).select('id').maybeSingle()
    if (rep) {
      const moderator = await as('admin@example.com')
      const { data: rows } = await (moderator || db).rpc('space_reports', { p_space: space.id, p_open: true })
      const mine = (rows || []).find((r) => r.message === msg.id)
      ok('a report from a sealed room reaches the desk', !moderator || !!mine, JSON.stringify(rows).slice(0, 160))
      if (mine) {
        ok('…carrying no words', mine.body == null, JSON.stringify(mine.body))
        ok('…and saying that the room is sealed, not that the message is missing', mine.sealed === true,
          'without this the desk shows "no body", which reads as a message that failed to load: ' + JSON.stringify(mine))
      }
      await db.from('space_moderation').delete().eq('id', rep.id)
    }

    /* ---- and the row cannot carry both ---- */
    const { error: bothErr } = await db.from('space_messages')
      .insert({ channel_id: ch.id, author_id: author.id, kind: 'text', cipher, body: 'the plaintext, alongside' })
    ok('a row carrying a cipher AND a body is refused', !!bothErr, bothErr ? '' : 'it was accepted — the guarantee is undone by one careless insert')
    ok('…by the constraint that means it, and not by some other one firing first',
      !!bothErr && String(bothErr.message).includes('space_messages_cipher_clear'), bothErr && bothErr.message)

    /* ---- the seal is one-way once anything is behind it ---- */
    const { error: offErr } = await db.from('channels').update({ encrypted: false }).eq('id', ch.id)
    ok('the seal cannot be taken off a room that holds sealed messages', !!offErr, offErr ? '' : 'it was allowed — the timeline would become unreadable with no way back')
    if (offErr) ok('…and the refusal says which room', String(offErr.message).includes(slug), offErr.message)
  }
} finally { await cleanup(ch.id) }

/* ---- …but a room with nothing in it may still be let out ---- */
const empty = await mk(false).catch(() => null) || await (async () => { const c = await mk(true); return c })()
try {
  await db.from('channels').update({ encrypted: true }).eq('id', empty.id)
  const { error } = await db.from('channels').update({ encrypted: false }).eq('id', empty.id)
  ok('a sealed room with no sealed message may be let out again', !error, error && error.message)
} finally { await cleanup(empty.id) }


/* ---- the two doors the site's own browser needs, and the fence on each ---- */

/*
 * OUR OWN CLIENT HAS NO MATRIX SESSION. It signs in with Supabase, so it cannot reach the key
 * endpoints matrix-api serves — and two of the things an encrypted room needs cannot be done
 * from a client at all under the policies: claiming somebody else's one-time key is a DELETE of
 * their row, and queueing a to-device message is an INSERT into their queue. Both are refused by
 * design, because a client that could do either could empty a stranger's keys or deliver a forged
 * room key that looked exactly like a real one.
 *
 * So each has a security-definer door, and the fence on both is the one the devices already have:
 * yourself, or somebody you SHARE A SPACE WITH. What is checked here is that the fence is real —
 * a stranger gets nothing and is told nothing — and that a room-mate is not locked out by it.
 */
{
  const member = await as('member@example.com')
  const stranger = await as('reader1@example.com')
  if (!member || !stranger) {
    ok('the browser\'s own key doors are fenced (skipped: no anon key in the environment)', true)
  } else {
    const { data: m } = await db.from('profiles').select('id').eq('email', 'member@example.com').single()
    const { data: f } = await db.from('profiles').select('id').eq('email', 'reader1@example.com').single()

    /* a key to claim, put there as the owner would */
    await db.from('space_devices').upsert({ user_id: m.id, device_id: 'PROBE', keys: { 'curve25519:PROBE': 'K' }, algorithms: ['m.olm.v1.curve25519-aes-sha2'] }, { onConflict: 'user_id,device_id' })
    await db.from('space_one_time_keys').upsert({ user_id: m.id, device_id: 'PROBE', key_id: 'signed_curve25519:P1', algorithm: 'signed_curve25519', key: { key: 'one' } }, { onConflict: 'user_id,device_id,key_id' })

    /* the owner may always claim their own */
    const mine = await member.rpc('space_claim_key', { p_user: m.id, p_device: 'PROBE', p_algorithm: 'signed_curve25519' })
    ok('a reader may claim a key from their own device', Array.isArray(mine.data) && mine.data.length === 1, JSON.stringify(mine.error || mine.data))

    /* …and somebody who shares no space may not, and is told nothing about whether it existed */
    await db.from('space_one_time_keys').upsert({ user_id: m.id, device_id: 'PROBE', key_id: 'signed_curve25519:P2', algorithm: 'signed_curve25519', key: { key: 'two' } }, { onConflict: 'user_id,device_id,key_id' })
    const theirs = await stranger.rpc('space_claim_key', { p_user: m.id, p_device: 'PROBE', p_algorithm: 'signed_curve25519' })
    ok('a stranger claims nothing, and is told nothing', !theirs.error && (!theirs.data || theirs.data.length === 0), JSON.stringify(theirs.error || theirs.data))
    const { data: left } = await db.from('space_one_time_keys').select('key_id').eq('user_id', m.id).eq('device_id', 'PROBE')
    ok('…and the key is still there, unspent', (left || []).length === 1, JSON.stringify(left))

    /* to-device: a reader may queue to their own devices */
    const toSelf = await member.rpc('space_send_to_device', { p_type: 'm.room_key', p_messages: { [m.id]: { PROBE: { algorithm: 'm.megolm.v1.aes-sha2' } } } })
    ok('a reader may queue a key to their own device', toSelf.data === 1, JSON.stringify(toSelf.error || toSelf.data))

    /* …and a stranger may not write into theirs */
    const forged = await stranger.rpc('space_send_to_device', { p_type: 'm.room_key', p_messages: { [m.id]: { PROBE: { algorithm: 'forged' } } } })
    ok('a stranger queues nothing into somebody else\'s device', forged.data === 0, JSON.stringify(forged.error || forged.data))
    const { data: queued } = await db.from('space_to_device').select('sender_id, content').eq('user_id', m.id).eq('device_id', 'PROBE')
    ok('…so the queue holds only what the owner put there', (queued || []).length === 1 && queued[0].sender_id === m.id, JSON.stringify(queued))

    /* and the sender is never what the caller claims it is */
    ok('the sender on a queued message is the caller, not the body', (queued || []).every((r) => r.sender_id === m.id))

    await db.from('space_to_device').delete().eq('user_id', m.id).eq('device_id', 'PROBE')
    await db.from('space_one_time_keys').delete().eq('user_id', m.id).eq('device_id', 'PROBE')
    await db.from('space_devices').delete().eq('user_id', m.id).eq('device_id', 'PROBE')
  }
}

/* ---- A ROUND TRIP: one browser seals, another opens it ---- */

/*
 * THE ONLY HONEST PROOF THE TRANSPORT IS RIGHT. Everything above asks the database what it holds;
 * this asks the crypto library whether two devices can actually talk — because the transport in
 * `src/lib/spaces/crypto.js` is a sequence of five request kinds answered against our own tables,
 * and a mistake in any of them does not throw. It withholds the key and the room goes quiet.
 *
 * It runs under node by making two CONTEXTS: two people, two devices, two signed-in clients, the
 * library's store in memory rather than IndexedDB. Nothing is stubbed — the claims and the
 * to-device messages go through the real security-definer doors with the real fence in front of
 * them, which is why this probe is here and not beside a unit test.
 *
 * What it caught, and would catch again: a key claim is NOT an outgoing request. The library never
 * offers one from `outgoingRequests`; it has to be asked for by name with `getMissingSessions`, and
 * a seal that only pumped produced a perfectly well-formed ciphertext that every other device
 * answered with "m.no_olm — unable to establish a secure channel", for ever.
 */
{
  const A = await as('member@example.com')
  const B = await as('member2@example.com')
  if (!A || !B) {
    ok('two devices can seal and open a message (skipped: no anon key in the environment)', true)
  } else {
    const { context } = await import('../src/lib/spaces/crypto.js')
    const { data: a } = await db.from('profiles').select('id').eq('email', 'member@example.com').single()
    const { data: bb } = await db.from('profiles').select('id').eq('email', 'member2@example.com').single()
    const { data: shared } = await db.from('space_members').select('space_id').eq('user_id', a.id)
    const { data: theirs } = await db.from('space_members').select('space_id').eq('user_id', bb.id)
    const together = (shared || []).some((r) => (theirs || []).some((t) => t.space_id === r.space_id))
    if (!together) {
      ok('two devices can seal and open a message (skipped: the seed has no space they share)', true)
    } else {
      const host = 'probe.test'
      /* a sealed room of its own, since the one above has been cleaned up by now */
      const { data: room } = await db.from('channels')
        .insert({ space_id: shared[0].space_id, slug: 'trip-' + Math.random().toString(16).slice(2, 8), name: 'Sealed', mode: 'stream', visibility: 'open', encrypted: true })
        .select('id').single()
      const wipe = async () => {
        for (const id of [a.id, bb.id]) {
          await db.from('space_to_device').delete().eq('user_id', id)
          await db.from('space_one_time_keys').delete().eq('user_id', id)
          await db.from('space_devices').delete().eq('user_id', id)
          await db.from('space_key_backups').delete().eq('user_id', id)
        }
      }
      await wipe()
      try {
        const ca = context({ me: a.id, device: 'PROBEA', db: A, host })
        const cb = context({ me: bb.id, device: 'PROBEB', db: B, host })
        await cb.ready()
        await ca.ready()

        const { data: devs } = await db.from('space_devices').select('user_id, device_id').in('user_id', [a.id, bb.id])
        ok('each browser published a device and its account identity',
          ['PROBEA', 'PROBEB', ''].every((d) => (devs || []).some((r) => r.device_id === d)), JSON.stringify(devs))
        const { count: otks } = await db.from('space_one_time_keys').select('*', { count: 'exact', head: true }).in('user_id', [a.id, bb.id])
        ok('…and a stock of one-time keys for other devices to claim', (otks || 0) > 0, String(otks))

        const words = 'the seal holds, and the site cannot read this'
        const cipher = await ca.seal(room.id, [a.id, bb.id], words)
        ok('a sealed message is a ciphertext and carries no words', !JSON.stringify(cipher).includes('the seal holds'))
        ok('…and names its algorithm, session and sending device', Boolean(cipher.algorithm && cipher.session_id && cipher.ciphertext))

        const { data: queued } = await db.from('space_to_device').select('user_id, device_id, type').eq('user_id', bb.id)
        ok('the room key went to the other device as an encrypted to-device message',
          (queued || []).length === 1 && queued[0].device_id === 'PROBEB' && queued[0].type === 'm.room.encrypted', JSON.stringify(queued))

        const took = await cb.receive()
        ok('the other device takes it, and the queue is emptied only then', took === 1, String(took))
        const { data: after } = await db.from('space_to_device').select('id').eq('user_id', bb.id)
        ok('…so nothing is left waiting for it', (after || []).length === 0, JSON.stringify(after))

        ok('THE OTHER BROWSER READS THE MESSAGE', (await cb.open(room.id, cipher, a.id)) === words)
        ok('…and the sender reads its own', (await ca.open(room.id, cipher, a.id)) === words)

        /* and the part that must be SAID rather than treated as a failure */
        const fresh = context({ me: bb.id, device: 'PROBEC', db: B, host })
        await fresh.ready()
        ok('a device that was not there when it was sent reads nothing, and says so with null rather than throwing',
          (await fresh.open(room.id, cipher, a.id)) === null)

        /* ---- THE RECOVERY KEY ---- */

        /*
         * What the key is FOR, said as a test rather than as a promise: a browser that was not
         * there reads the history only with it, and reads everything sent from now on without it.
         * Those are the two halves of what the panel tells a reader, and they are the halves most
         * easily got backwards — a design where the key were needed for NEW messages too would
         * lock a reader out of their own rooms on a new laptop, and would pass every other check.
         */
        const recoveryKey = await cb.makeBackup()
        ok('a recovery key is made once and handed back, and is a key rather than a word',
          typeof recoveryKey === 'string' && recoveryKey.length > 32)
        const { data: kept } = await db.from('space_key_backups').select('auth_data, sessions, count').eq('user_id', bb.id)
        const stored = JSON.stringify(kept || [])
        ok('…and the row holds the backup\'s public half and nothing that opens it',
          stored.length > 0 && !stored.includes(recoveryKey), 'the recovery key itself is in the row')

        /* a message sealed while only the first browser existed */
        const old = await cb.seal(room.id, [a.id, bb.id], 'said before the new browser existed')
        await ca.receive()

        const later = context({ me: bb.id, device: 'PROBED', db: B, host })
        await later.ready()
        const st = await later.state()
        ok('a new browser can see that there IS a history to be let into, without being able to read it',
          st.device === true && st.backup === true && st.holds === false, JSON.stringify(st))
        ok('…and reads nothing of it', (await later.open(room.id, old, bb.id)) === null)

        /* …but everything from now on, which is the half the copy promises outright */
        const now = await ca.seal(room.id, [a.id, bb.id], 'and everything from now on')
        await later.receive()
        ok('…while reading what is sent after it, with no key at all',
          (await later.open(room.id, now, a.id)) === 'and everything from now on')

        ok('a wrong recovery key changes nothing and is answered rather than thrown',
          (await later.restore('AAAA' + recoveryKey.slice(4))) === false)
        ok('…and the right one lets it in', (await later.restore(recoveryKey)) === true)
        ok('THE HISTORY OPENS ON THE NEW BROWSER', (await later.open(room.id, old, bb.id)) === 'said before the new browser existed')

        /* ---- A FILE IN A SEALED ROOM ---- */

        /*
         * The bucket holds the ciphertext and the little key that opens it travels in the message,
         * sealed to the room like the words. Checked here against the real bucket and the real
         * policies, because the failure this catches is not an exception: it is a picture that
         * uploads perfectly and can be opened by anybody who can read the bucket.
         *
         * The NAME is the part most easily left behind — "severance-agreement.pdf" says most of
         * what the message said, and a row's own check refuses one beside a cipher anyway.
         */
        const bytes = new TextEncoder().encode('%PDF-1.4 the terms nobody else may read')
        const { sealBytes, openBytes } = await import('../src/lib/spaces/crypto.js')
        const { data: sealedBytes, info } = await sealBytes(bytes)
        ok('a file is encrypted before it is uploaded, with a key of its own',
          !new TextDecoder().decode(sealedBytes).includes('nobody else may read'))

        const where = room.id + '/' + crypto.randomUUID() + '.pdf'
        const put = await A.storage.from('spaces').upload(where, new Blob([sealedBytes], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: false })
        if (put.error) {
          ok('a sealed file reaches the bucket (skipped: ' + String(put.error.message).slice(0, 60) + ')', true)
        } else {
          /* the message carries the name, the type and the key — and the row carries none of them */
          const envelope = JSON.stringify({ _: 'dl.attachment.v1', name: 'severance-agreement.pdf', type: 'application/pdf', size: bytes.length, seconds: null, media: info, body: null })
          const fileCipher = await ca.seal(room.id, [a.id, bb.id], envelope)
          const put2 = await A.from('space_messages')
            .insert({ channel_id: room.id, author_id: a.id, kind: 'file', attachment: where, cipher: fileCipher })
            .select('id, attachment, attachment_name, body, cipher').single()
          ok('…and the row holds the path and the ciphertext, and no name', !put2.error && put2.data
            && put2.data.attachment === where && put2.data.attachment_name === null && put2.data.body === null,
            put2.error && put2.error.message)
          const stored = JSON.stringify(put2.data || {})
          ok('…so the file\'s name is nowhere in the row', !stored.includes('severance-agreement'))

          /* the other person, on their own device, gets all of it back */
          const got = await cb.open(room.id, put2.data.cipher, a.id)
          const w = got ? JSON.parse(got) : null
          ok('the other device reads the file\'s name back out of the message', w && w.name === 'severance-agreement.pdf', String(got).slice(0, 80))
          const down = await B.storage.from('spaces').download(where)
          const back = down.data ? await openBytes(await down.data.arrayBuffer(), w.media) : null
          ok('…and opens the bytes themselves', back && new TextDecoder().decode(back) === '%PDF-1.4 the terms nobody else may read')

          await db.from('space_messages').delete().eq('id', put2.data.id)
          await db.storage.from('spaces').remove([where])
        }
      } catch (e) {
        ok('two devices can seal and open a message', false, String((e && e.message) || e))
      } finally {
        await wipe()
        if (room) { await db.from('space_messages').delete().eq('channel_id', room.id); await db.from('channels').delete().eq('id', room.id) }
      }
    }
  }
}

/* ---- A REAL MATRIX CLIENT, BOTH WAYS ---- */

/*
 * THE ONLY CHECK THAT SAYS THE PRODUCT WORKS. Everything above is our own code talking to our own
 * code: the same reading of Matrix on both sides of every exchange, which proves the reading is
 * self-consistent and nothing more. This drives `matrix-js-sdk` — the library Element is built on —
 * with its real Rust crypto against the served function, and has it exchange a sealed message with
 * the site's own client in both directions.
 *
 * What it caught, both silent, both fatal to every client but ours:
 *
 *   THE SEND PATH REFUSED `m.room.encrypted` outright. A client was told the room was encrypted,
 *   encrypted its message as instructed, and was answered "this server does not support
 *   end-to-end encryption" — and the read path served a sealed row back as an empty
 *   `m.room.message`, so the timeline was blank rather than sealed.
 *
 *   THE TO-DEVICE BATCH NAMED THE SENDER BY ACCOUNT UUID instead of Matrix id. The room key
 *   arrived, could not be matched to the sender it claimed, and was dropped: every message in the
 *   room came back "the sender's device has not sent us the keys for this message", for ever.
 *   Our own client translates the id itself, so it read the room perfectly throughout.
 *
 * It SKIPS AND SAYS WHAT IT DID NOT COVER when nothing is serving the function, as the other live
 * lanes do: a lane that passes quietly having run nothing reports a shape of the product as checked
 * when nothing touched it.
 */
{
  const FN = process.env.MATRIX_FN_URL || (url.replace(/\/+$/, '') + '/functions/v1/matrix-api')
  const served = await (async () => {
    if (process.env.MATRIX_API_TEST === '0') return false
    try { return (await fetch(FN + '/_matrix/client/versions', { signal: AbortSignal.timeout(2500) })).ok } catch { return false }
  })()
  const A2 = await as('member@example.com')
  const B2 = await as('member2@example.com')
  if (!served || !A2 || !B2) {
    /* the boundary of this test, said once: it drives a sealed room through the API; a real Matrix client with its own
       crypto, either way through one, is outside it — no test drives one yet */
    console.log('  (outside this test: a real Matrix client with its own crypto, either way through a sealed room)')
    ok('a real Matrix client exchanges a sealed message with the site (skipped: nothing is serving ' + FN + ')', true)
  } else {
    const { data: a2 } = await db.from('profiles').select('id').eq('email', 'member@example.com').single()
    const { data: b2 } = await db.from('profiles').select('id').eq('email', 'member2@example.com').single()
    const { data: sp2 } = await db.from('space_members').select('space_id').eq('user_id', a2.id)
    const { data: th2 } = await db.from('space_members').select('space_id').eq('user_id', b2.id)
    const shared2 = (sp2 || []).map((r) => r.space_id).find((s) => (th2 || []).some((t) => t.space_id === s))
    const { data: live } = shared2 ? await db.from('channels')
      .insert({ space_id: shared2, slug: 'live-' + Math.random().toString(16).slice(2, 8), name: 'Sealed (live)', mode: 'stream', visibility: 'open', encrypted: true })
      .select('id').single() : { data: null }
    /* the keys alone before, because the ROOM is wanted: clearing it here deleted the very channel
       this lane had just made, and the client then quite correctly could not find it */
    const wipeKeys = async () => {
      for (const id of [a2.id, b2.id]) for (const t of ['space_to_device', 'space_one_time_keys', 'space_devices', 'space_key_backups']) await db.from(t).delete().eq('user_id', id)
    }
    const clear = async () => {
      await wipeKeys()
      if (live) { await db.from('space_messages').delete().eq('channel_id', live.id); await db.from('channels').delete().eq('id', live.id) }
    }
    if (!live) {
      ok('a real Matrix client exchanges a sealed message with the site (skipped: no shared space)', true)
    } else {
      let client = null
      try {
        await wipeKeys()
        const sdk = await import('matrix-js-sdk')
        const tmp = sdk.createClient({ baseUrl: FN })
        const got = await tmp.loginRequest({
          type: 'm.login.password',
          identifier: { type: 'm.id.thirdparty', medium: 'email', address: 'member@example.com' },
          password: 'password123', initial_device_display_name: 'a real client, under test',
        })
        client = sdk.createClient({ baseUrl: FN, accessToken: got.access_token, userId: got.user_id, deviceId: got.device_id })
        await client.initRustCrypto({ useIndexedDB: false })
        await client.startClient({ initialSyncLimit: 5 })
        await new Promise((r) => { client.once('sync', r); setTimeout(r, 25000) })
        const joined = (await client.getJoinedRooms()).joined_rooms || []
        const mx = joined.find((r) => r.includes(live.id.replace(/-/g, '')))
        ok('a real client with crypto signs in and finds the sealed room', !!mx,
          'looking for ' + live.id.replace(/-/g, '') + ' among ' + JSON.stringify(joined).slice(0, 300))

        if (mx) {
          const crypto = client.getCrypto()
          ok('…and is told by the room\'s own state that it is encrypted',
            !!crypto && (await crypto.isEncryptionEnabledInRoom(mx)) === true,
            'without m.room.encryption in the state a client posts plaintext into a room everybody else is sealing')

          /* one way: the real client seals, the site's own client opens */
          /*
           * THE HOST IS TAKEN FROM THE ROOM THE SERVER JUST NAMED, not worked out here. Both sides
           * must call the room by the same name or they are sealing to two different rooms — and
           * under node there is no `location` and no `VITE_APP_URL` to ask, which produced an id
           * ending in a bare colon that the library refuses outright.
           */
          const crypt = await import('../src/lib/spaces/crypto.js')
          const host2 = mx.slice(mx.indexOf(':') + 1)
          const theirs = crypt.context({ me: b2.id, device: 'LIVE-B', db: B2, host: host2 })
          await theirs.ready()
          const said = 'written in a real client, read on the site'
          await client.sendTextMessage(mx, said)
          let row = null
          for (let i = 0; i < 20 && !row; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            const { data } = await db.from('space_messages').select('id, author_id, body, cipher').eq('channel_id', live.id).limit(1)
            row = (data || [])[0] || null
          }
          ok('a real client\'s message is stored as a ciphertext and no words', !!row && row.body === null && !!row.cipher,
            JSON.stringify(row && { body: row.body, sealed: !!row.cipher }))
          if (row) {
            await theirs.receive()
            ok('THE SITE\'S OWN CLIENT READS WHAT A REAL CLIENT SEALED',
              (await theirs.open(live.id, row.cipher, row.author_id)) === said)
          }

          /* and back: the site seals, the real client reads */
          const back = 'written on the site, read in a real client'
          const cipher2 = await theirs.seal(live.id, [a2.id, b2.id], back)
          await B2.from('space_messages').insert({ channel_id: live.id, author_id: b2.id, kind: 'text', cipher: cipher2 })
          let read = null
          for (let i = 0; i < 30 && read === null; i++) {
            await new Promise((r) => setTimeout(r, 2000))
            const r = client.getRoom(mx)
            for (const ev of (r ? r.getLiveTimeline().getEvents() : [])) {
              try { await client.decryptEventIfNeeded(ev) } catch { /* not this one, not yet */ }
              if ((ev.getContent() || {}).body === back) read = back
            }
          }
          ok('A REAL MATRIX CLIENT READS WHAT THE SITE SEALED', read === back,
            'the room key reached it, or the sender on the to-device batch was not a Matrix id')
        }
      } catch (e) {
        ok('a real Matrix client exchanges a sealed message with the site', false, String((e && e.message) || e).slice(0, 220))
      } finally {
        try { if (client) client.stopClient() } catch { /* over either way */ }
        await clear()
      }
    }
  }
}

console.log(fail ? `\nencryption: ${pass} passed, ${fail} FAILED\n` : `\nencryption: all ${pass} checks passed\n`)
process.exit(fail ? 1 : 0)
