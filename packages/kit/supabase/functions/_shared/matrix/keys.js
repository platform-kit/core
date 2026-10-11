/*
 * THE KEY STORE BEHIND AN ENCRYPTED CHANNEL — every endpoint Matrix's end-to-end machinery needs,
 * and nothing else.
 *
 * Plain JavaScript on a database client, so the Edge Function and a test under Node run the same
 * code. Every function takes its client: `as` is the caller's own (RLS applies, which is most of
 * the fence) and `svc` is the service role, used for exactly the three things a policy cannot
 * express safely — claiming somebody else's one-time key, writing into somebody else's to-device
 * queue, and reading the devices of people in a shared room when the caller is a Matrix client
 * rather than a signed-in browser.
 *
 * WHAT IS STORED IS PUBLIC OR OPAQUE, always. A private key never arrives here; the backup does,
 * and it is sealed under a recovery key the site has never seen. If this file were read by
 * somebody who should not have it, they would learn who has which devices and nothing they could
 * decrypt — which is the property the whole feature rests on.
 */

/* Matrix spells a device's keys "<algorithm>:<device id>"; the parts are needed separately */
export const keyAlgorithm = (id) => String(id || '').split(':')[0] || ''

/*
 * UPLOAD. A client sends its device keys (once, usually), its one-time keys (often, in batches as
 * it runs low), and sometimes a fallback key. The answer is the COUNT of unclaimed one-time keys
 * it now has, which is how a client decides whether to send more — answering zero when keys were
 * in fact stored makes a client upload for ever.
 */
export async function uploadKeys(as, { userId, deviceId, body }) {
  const b = body || {}

  if (b.device_keys) {
    const d = b.device_keys
    /* a client may only ever speak for the device it signed in as: taking `device_id` from the
       body would let one device publish keys as another, and every message sealed to the second
       would be readable by the first */
    await as.from('space_devices').upsert({
      user_id: userId,
      device_id: deviceId,
      keys: d.keys || {},
      algorithms: Array.isArray(d.algorithms) ? d.algorithms : [],
      signatures: d.signatures || {},
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,device_id' })
  }

  const rows = []
  const take = (bag, fallback) => {
    for (const [keyId, key] of Object.entries(bag || {})) {
      rows.push({ user_id: userId, device_id: deviceId, key_id: keyId, algorithm: keyAlgorithm(keyId), key, fallback })
    }
  }
  take(b.one_time_keys, false)
  /* "fallback_keys" is the current name; "org.matrix.msc2732.fallback_keys" is what older clients
     send. Both mean the same thing and a client that gets no answer for its spelling uploads for
     ever, so both are taken. */
  take(b.fallback_keys || b['org.matrix.msc2732.fallback_keys'], true)
  if (rows.length) {
    /* a fallback key REPLACES the previous one rather than queueing beside it */
    const fb = rows.filter((r) => r.fallback)
    if (fb.length) await as.from('space_one_time_keys').delete().eq('user_id', userId).eq('device_id', deviceId).eq('fallback', true)
    await as.from('space_one_time_keys').upsert(rows, { onConflict: 'user_id,device_id,key_id' })
  }

  return { one_time_key_counts: await countKeys(as, userId, deviceId) }
}

/* how many unclaimed one-time keys a device has, by algorithm. The fallback is not counted: it is
   not spent, so counting it would tell a client it has keys to spare when it has none. */
export async function countKeys(as, userId, deviceId) {
  const { data } = await as.from('space_one_time_keys')
    .select('algorithm').eq('user_id', userId).eq('device_id', deviceId).eq('fallback', false)
  const out = {}
  for (const r of data || []) out[r.algorithm] = (out[r.algorithm] || 0) + 1
  return out
}

/*
 * QUERY. "What devices do these people have, and what are their public keys?" — asked before
 * sealing anything, because sealing to somebody means sealing to each of their devices.
 *
 * The fence is the RLS policy on `space_devices`: a person's own, plus anybody sharing a space
 * with them. A caller asking about somebody they share nothing with gets no rows, which is the
 * right answer and not an error — Matrix has no "you may not ask" for this, and inventing one
 * would tell the asker that the person exists.
 */
export async function queryKeys(as, { userIds, host, idOf, asking = null }) {
  const out = { device_keys: {}, failures: {}, master_keys: {}, self_signing_keys: {}, user_signing_keys: {} }
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return out

  const { data } = await as.from('space_devices').select('user_id, device_id, keys, algorithms, signatures, cross_signing, display_name').in('user_id', ids)
  for (const r of data || []) {
    const mx = idOf ? idOf(r.user_id, host) : r.user_id
    /* THE PERSON'S OWN ROW. Cross-signing keys belong to the person and not to any one device, so
       they are kept on the row whose device_id is '' — and that row is never a device. */
    if (!r.device_id) {
      const cs = r.cross_signing || {}
      if (cs.master_key) out.master_keys[mx] = cs.master_key
      if (cs.self_signing_key) out.self_signing_keys[mx] = cs.self_signing_key
      /* A PERSON'S USER-SIGNING KEY IS THEIRS ALONE. It says whom THEY have decided to trust,
         which is nobody else's business, and Matrix's own spec serves it back only to its owner.
         `asking` is the caller's id, passed in rather than guessed: without it the only safe
         answer would be to serve it to nobody, which breaks the owner's own client. */
      if (cs.user_signing_key && asking && r.user_id === asking) out.user_signing_keys[mx] = cs.user_signing_key
      continue
    }
    out.device_keys[mx] = out.device_keys[mx] || {}
    out.device_keys[mx][r.device_id] = {
      user_id: mx,
      device_id: r.device_id,
      algorithms: r.algorithms || [],
      keys: r.keys || {},
      signatures: r.signatures || {},
      ...(r.display_name ? { unsigned: { device_display_name: r.display_name } } : {}),
    }
  }
  return out
}

/*
 * CLAIM. A one-time key, taken for good.
 *
 * `delete … returning` and not `select` then `delete`: two callers racing for the last key, one
 * gets it and one gets nothing. A select-then-delete hands the same key to both, and two sessions
 * built on one key is exactly the failure a one-time key exists to prevent. It needs the service
 * role because the row belongs to somebody else — a delete policy that let one person empty
 * another's keys would let anybody make anybody unreachable.
 */
export async function claimKeys(svc, { request, host, idOf, userOf }) {
  const out = { one_time_keys: {}, failures: {} }
  for (const [mxid, devices] of Object.entries(request || {})) {
    const uid = userOf ? userOf(mxid) : mxid
    if (!uid) { out.failures[mxid] = { errcode: 'M_NOT_FOUND', error: 'no such user here' }; continue }
    for (const [deviceId, algorithm] of Object.entries(devices || {})) {
      const row = await claimOne(svc, uid, deviceId, String(algorithm))
      if (!row) continue
      const mx = idOf ? idOf(uid, host) : uid
      out.one_time_keys[mx] = out.one_time_keys[mx] || {}
      out.one_time_keys[mx][deviceId] = { ...(out.one_time_keys[mx][deviceId] || {}), [row.key_id]: row.key }
    }
  }
  return out
}

/*
 * one key, taken exactly once — through the database, because PostgREST has no
 * `DELETE … ORDER BY … LIMIT 1`. This was written here first as a delete with an order and a
 * limit, which PostgREST silently ignores: the delete matched every key the device had and the
 * select returned them all, so the first claim emptied the device and the second found nothing.
 * `space_claim_otk` picks its row inside the delete, which is the only way two callers racing for
 * the last key end up with one of them empty-handed rather than both holding the same one.
 */
async function claimOne(svc, userId, deviceId, algorithm) {
  const { data } = await svc.rpc('space_claim_otk', { p_user: userId, p_device: deviceId, p_algorithm: algorithm })
  const got = Array.isArray(data) ? data[0] : data
  return got && got.key_id ? got : null
}

/*
 * CROSS-SIGNING. Three keys that let one of a person's devices vouch for another, so a reader is
 * not asked to verify every device against every other by hand. They belong to the person, so they
 * live on the row of no device at all.
 */
export async function uploadCrossSigning(as, { userId, body }) {
  const b = body || {}
  const { data: had } = await as.from('space_devices').select('cross_signing').eq('user_id', userId).eq('device_id', '').maybeSingle()
  const cs = { ...((had && had.cross_signing) || {}) }
  if (b.master_key) cs.master_key = b.master_key
  if (b.self_signing_key) cs.self_signing_key = b.self_signing_key
  if (b.user_signing_key) cs.user_signing_key = b.user_signing_key
  await as.from('space_devices').upsert({
    user_id: userId, device_id: '', cross_signing: cs, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,device_id' })
  return {}
}

/*
 * SIGNATURES. One device saying "this other key is really mine", or one person saying "this other
 * person's master key is really theirs". A signature is merged into whatever the target already
 * carries rather than replacing it — a device has one signature per signer and losing the others
 * un-verifies it everywhere.
 *
 * A caller may only ever add signatures of their OWN making. The body says who signed, and taking
 * that at its word would let anybody write "Ada's device vouched for mine" into Ada's row.
 */
/*
 * IT TAKES THE SERVICE ROLE, and the reason is the whole shape of the feature.
 *
 * A signature is an addition to SOMEBODY ELSE'S key: Ada vouching for Bob's master key writes into
 * Bob's row. `space_devices_own` rightly refuses that — a person writes their own row and nobody
 * else's — so written through the caller's client the update matched nothing, returned no error,
 * and cross-user signing silently did nothing at all. That is how it was found: by a check where
 * one account signs another's device, which is the only case that tells a right implementation
 * from a wrong one, since self-signing works either way.
 *
 * What makes it safe is not the client but WHOSE NAME IS WRITTEN: `asking` is the caller's own id,
 * taken from their session, and nothing else is ever used as the key. The body says who signed;
 * believing it would let anybody write "Ada vouched for me" into Ada's name.
 */
export async function uploadSignatures(svc, { userId, body, userOf, asking = null }) {
  const as = svc
  const out = { failures: {} }
  /*
   * WHO SIGNED IS THE CALLER, not whoever the row belongs to. A signature is keyed by its SIGNER —
   * Ada signing Bob's master key is an entry under Ada — and taking the key from the target's id
   * is right only in the self-signing case, where the two are the same person. That is also the
   * common case, which is exactly why it would have looked as though it worked: signing one's own
   * devices would have verified and vouching for somebody else never would, with nothing to say
   * why. `asking` is the caller's own Matrix id, and it is both what is read and what is written.
   */
  const signer = asking || null
  if (!signer) return out
  for (const [mxid, items] of Object.entries(body || {})) {
    const uid = userOf ? userOf(mxid) : mxid
    if (!uid) { out.failures[mxid] = { '*': { errcode: 'M_NOT_FOUND', error: 'no such user here' } }; continue }
    for (const [deviceOrKey, signed] of Object.entries(items || {})) {
      /* only the CALLER'S OWN signatures are kept, whatever else the body claims: the body says
         who signed, and taking that at its word lets anybody write "Ada vouched for me" into
         Ada's name */
      const ours = { ...((signed && signed.signatures && signed.signatures[signer]) || {}) }
      if (!Object.keys(ours).length) continue

      const isDevice = !!(signed && signed.device_id)
      const row = isDevice
        ? await as.from('space_devices').select('signatures').eq('user_id', uid).eq('device_id', deviceOrKey).maybeSingle()
        : await as.from('space_devices').select('cross_signing').eq('user_id', uid).eq('device_id', '').maybeSingle()

      /* a signature is MERGED into whatever the target already carries, never set over it: a key
         has one entry per signer, and replacing the lot un-verifies it for everybody else */
      if (isDevice) {
        const had = (row.data && row.data.signatures) || {}
        const sigs = { ...had, [signer]: { ...(had[signer] || {}), ...ours } }
        await as.from('space_devices').update({ signatures: sigs, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('device_id', deviceOrKey)
      } else {
        const cs = { ...((row.data && row.data.cross_signing) || {}) }
        for (const which of ['master_key', 'self_signing_key', 'user_signing_key']) {
          if (!cs[which] || !cs[which].keys) continue
          if (!Object.values(cs[which].keys).includes(deviceOrKey)) continue
          cs[which] = { ...cs[which], signatures: { ...(cs[which].signatures || {}), [signer]: { ...((cs[which].signatures || {})[signer] || {}), ...ours } } }
        }
        await as.from('space_devices').upsert({ user_id: uid, device_id: '', cross_signing: cs, updated_at: new Date().toISOString() }, { onConflict: 'user_id,device_id' })
      }
    }
  }
  return out
}

/*
 * TO-DEVICE. The out-of-band channel a room key travels on. The body is already sealed to the
 * recipient device, so this is a queue of ciphertext.
 *
 * It takes the service role because the row lands in SOMEBODY ELSE'S queue. There is no insert
 * policy for this on purpose: one that let a client write into another person's queue would let
 * anybody deliver anything to anybody — including a forged room key — and the delivery would look
 * exactly like a real one.
 */
export async function sendToDevice(svc, { senderId, type, messages, userOf }) {
  const rows = []
  for (const [mxid, devices] of Object.entries(messages || {})) {
    const uid = userOf ? userOf(mxid) : mxid
    if (!uid) continue
    for (const [deviceId, content] of Object.entries(devices || {})) {
      rows.push({ user_id: uid, device_id: String(deviceId), sender_id: senderId, type: String(type), content })
    }
  }
  if (rows.length) await svc.from('space_to_device').insert(rows)
  return {}
}

/*
 * …and taking them off the queue in a sync. Matrix's contract is that a batch is delivered until
 * the client acknowledges it by syncing again with the next token — so a message is deleted on the
 * NEXT sync and not on this one, and a client that dies mid-sync sees its keys again rather than
 * losing them. `since` carries the high-water mark of what was handed over last time.
 */
export async function takeToDevice(as, { userId, deviceId, since = 0, limit = 100, host = null, idOf = null }) {
  /* '*' is Matrix's "every device of this person" */
  const { data } = await as.from('space_to_device')
    .select('id, sender_id, type, content, device_id')
    .eq('user_id', userId)
    .in('device_id', [deviceId, '*'])
    .order('id', { ascending: true })
    .limit(limit)
  const rows = data || []
  /* anything the last sync already handed over is now acknowledged and may go */
  const done = rows.filter((r) => r.id <= since).map((r) => r.id)
  if (done.length) await as.from('space_to_device').delete().in('id', done)
  const fresh = rows.filter((r) => r.id > since)
  return {
    /*
     * THE SENDER IS A MATRIX ID, not the account's uuid. A to-device message is olm-encrypted to
     * this device and the client checks it against the sender it was told — handed "0000…-a4fa…"
     * instead of "@0000…:host" it cannot match the two, the room key is never installed, and every
     * message in the room comes back "the sender's device has not sent us the keys for this
     * message". Nothing errors; the room is simply unreadable in every client but our own, which
     * translates the id itself.
     */
    events: fresh.map((r) => ({ sender: idOf ? idOf(r.sender_id, host) : r.sender_id, type: r.type, content: r.content })),
    next: fresh.length ? fresh[fresh.length - 1].id : since,
  }
}

/*
 * THE KEY BACKUP. An opaque blob per session, sealed under a recovery key shown to the reader once
 * and never again — because the site never had it to show twice. Everything here is store-and-serve;
 * nothing in this file ever looks inside `sessions`.
 */
/*
 * Matrix's backup version is a NUMBER SPELT AS A STRING, and the column is text, so the database
 * cannot order it: sorted as text, "9" comes after "10" and the tenth backup a reader makes is
 * numbered 10 for a second time. Every version is read and the highest found in JavaScript, which
 * is a handful of short rows per person and the only way to get this right without a cast
 * PostgREST will not do.
 */
const highest = (rows) => (rows || []).reduce((n, r) => Math.max(n, Number(r.version) || 0), 0)

export async function putBackupVersion(as, { userId, body }) {
  const { data: all } = await as.from('space_key_backups').select('version').eq('user_id', userId)
  const next = String(highest(all) + 1)
  await as.from('space_key_backups').insert({
    user_id: userId, version: next,
    algorithm: String((body || {}).algorithm || ''),
    auth_data: (body || {}).auth_data || {},
    etag: String(Date.now()),
  })
  return { version: next }
}

/*
 * AND DELETING ONE, which Matrix gives a client (Element calls it "delete backup") and which we had
 * no route for at all: a client could make a backup and never be rid of it. It is marked deleted
 * rather than removed, because the sessions in it are the only copy of keys somebody may still
 * want, and a row nobody serves costs nothing.
 */
export async function deleteBackupVersion(as, { userId, version }) {
  const v = String(version || '')
  if (!v) return false
  const { data } = await as.from('space_key_backups')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', userId).eq('version', v).is('deleted_at', null).select('version')
  return Array.isArray(data) && data.length > 0
}

export async function getBackupVersion(as, { userId, version = null }) {
  let q = as.from('space_key_backups').select('version, algorithm, auth_data, count, etag').eq('user_id', userId).is('deleted_at', null)
  if (version) q = q.eq('version', String(version))
  const { data } = await q
  /* the CURRENT one is the highest-numbered, found here for the same reason as above: ordered by
     the database it is text, and "9" would be served as the latest backup forever after the tenth */
  const row = version ? (Array.isArray(data) ? data[0] : data)
    : (data || []).find((r) => Number(r.version) === highest(data)) || null
  if (!row) return null
  return { version: row.version, algorithm: row.algorithm, auth_data: row.auth_data, count: row.count || 0, etag: row.etag || '0' }
}

/* the sessions themselves, merged room by room: a client sends one room at a time and sending the
   second must not drop the first */
export async function putRoomKeys(as, { userId, version, rooms }) {
  const { data } = await as.from('space_key_backups').select('sessions, count').eq('user_id', userId).eq('version', String(version)).maybeSingle()
  if (!data) return null
  const sessions = { ...(data.sessions || {}) }
  for (const [room, body] of Object.entries(rooms || {})) {
    sessions[room] = { ...(sessions[room] || {}), ...((body && body.sessions) || {}) }
  }
  const count = Object.values(sessions).reduce((n, r) => n + Object.keys(r || {}).length, 0)
  const etag = String(Date.now())
  await as.from('space_key_backups').update({ sessions, count, etag, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('version', String(version))
  return { count, etag }
}

export async function getRoomKeys(as, { userId, version, room = null, session = null }) {
  const { data } = await as.from('space_key_backups').select('sessions').eq('user_id', userId).eq('version', String(version)).maybeSingle()
  if (!data) return null
  const sessions = data.sessions || {}
  if (room && session) return (sessions[room] || {})[session] || null
  if (room) return { sessions: sessions[room] || {} }
  return { rooms: Object.fromEntries(Object.entries(sessions).map(([r, s]) => [r, { sessions: s }])) }
}

/*
 * WHOSE DEVICES CHANGED. A client is told in `/sync` so that it re-queries before sealing the next
 * message — without it, somebody who added a device would stop being able to read the room from
 * that device and nobody would know why.
 *
 * It is the people sharing a space with the caller whose device rows changed since the last sync.
 */
export async function changedDevices(as, { since = null }) {
  if (!since) return []
  const { data } = await as.from('space_devices').select('user_id').gt('updated_at', since)
  return [...new Set((data || []).map((r) => r.user_id))]
}
