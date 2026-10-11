/*
 * THE READER'S OWN CRYPTO — one device, its sessions, and the only place this project does
 * anything cryptographic.
 *
 * Nothing here invents a protocol. `matrix-sdk-crypto-wasm` is the same Rust library Element
 * runs, and this file is its TRANSPORT: the library says what requests it needs made, this makes
 * them against the site's own tables, and hands the answers back. Every decision about keys,
 * sessions, ratchets and verification belongs to the library and none of it belongs here — which
 * is the point, because a hand-rolled version of any of it would be wrong in ways nobody would
 * notice until it mattered.
 *
 * LOADED ONLY WHEN A SEALED ROOM IS OPENED. The wasm is over a megabyte and no unencrypted room
 * should pay for it, so every import that reaches the library is dynamic and the module itself
 * does nothing at import time — including reaching the database, which is why the client is a
 * seam (`useDb`) rather than a top-level import: a module that built a Supabase client on import
 * could not be loaded by a probe under node, and this is the one module in the project whose
 * correctness cannot be argued and has to be demonstrated.
 *
 * IT RUNS ON THE MAIN THREAD, and that is a decision rather than an omission. A worker would keep
 * the wasm off the main thread, and the cost of one is that every database call the library needs
 * would have to be proxied back across a port along with the session — a lot of surface for a
 * library whose work on a single message is measured in microseconds. The case for a worker is a
 * long timeline decrypted at once; the case against is that the proxy is where the mistakes would
 * live. If the timeline ever janks, this is the file to move, and the seam is already here:
 * a context is made from a client, a person and a device and holds nothing global.
 *
 * WHAT IS NEVER HERE: a private key in a row, a passphrase on a wire, a plaintext in a log. The
 * library holds its own store (IndexedDB in a browser, memory under a probe) under a name of this
 * person's own, and the only thing that leaves is a ciphertext and the public halves of keys.
 */

/* The Matrix ids this site mints, which MUST be the ones matrix-api mints: a room sealed by this
   client and the same room opened in Element are one megolm room only if both call it by the same
   name. The shapes are `_shared/matrix/ids.js`, repeated here rather than imported because that
   module belongs to the functions and this one to the browser — and pinned by a check that reads
   both, so they cannot drift apart in silence. */
/* the key's FACE is not crypto: it is how a person reads a secret off a screen, and the panel
   needs it without reaching for this module */
import { spaceOut, tighten } from './model.js'
export { spaceOut, tighten }

const pack = (id) => String(id || '').replace(/-/g, '').toLowerCase()
const env = (k) => {
  try { return (import.meta.env && import.meta.env[k]) || '' } catch { return '' }
}
export const hostOf = () => String(env('VITE_APP_URL') || (typeof location !== 'undefined' ? location.origin : ''))
  .replace(/^https?:\/\//, '').replace(/\/+$/, '')
export const roomIdOf = (channel, host = hostOf()) => `!c${pack(channel)}:${host}`
export const userIdOf = (person, host = hostOf()) => `@${pack(person)}:${host}`
/* …and back, for an id the library hands us */
export const personOf = (mxid) => {
  const m = /^@([0-9a-f]{32}):/i.exec(String(mxid || ''))
  if (!m) return null
  const h = m[1]
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/*
 * THIS BROWSER'S DEVICE. A device is a browser, not an account: two browsers of one person are two
 * devices with two sets of keys, which is the whole reason a sealed room on a new machine cannot
 * read what came before. It is kept in raw localStorage rather than in the synced store, for the
 * same reason the support desk's token is: a value that followed the account to another machine
 * would make both machines one device and the guarantee would be a fiction.
 */
const DEVICE_KEY = 'dl.spaces.device'
export function deviceId() {
  try {
    const had = localStorage.getItem(DEVICE_KEY)
    if (had) return had
    const made = 'W' + [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
    localStorage.setItem(DEVICE_KEY, made)
    return made
  } catch { return 'WEB' }   /* no storage: a device for this page only, which still works */
}

/* ------------------------------------------------------------------ the library */

let loading = null
let sdk = null

/* the wasm, fetched once per page */
export async function load() {
  if (sdk) return sdk
  if (!loading) {
    loading = (async () => {
      const m = await import('@matrix-org/matrix-sdk-crypto-wasm')
      /*
       * THE WASM NEEDS ITS ADDRESS GIVEN. Left to itself the library resolves the file beside its
       * own module and fetches it — which in a dev server comes back as a path, not as
       * `application/wasm`, and `instantiateStreaming` refuses it with "Incorrect response MIME
       * type" and no other sign that anything is wrong: the room simply never sets itself up.
       * Asked for as `?url`, the bundler emits it as an asset and hands back an address that is
       * served correctly in dev and in a build alike. Under node the specifier does not resolve,
       * and the node entry needs no address because it loads the file itself.
       */
      if (m.initAsync) await m.initAsync()
      sdk = m
      return m
    })()
  }
  return loading
}

/* the database, as a seam. The browser never calls `useDb`; a probe does, before anything else,
   and then nothing in this file ever imports the browser's client at all. */
let injected = null
export function useDb(client) { injected = client }
async function database() {
  if (injected) return injected
  const m = await import('../supabase.js')
  injected = m.supabase
  return injected
}

/* ------------------------------------------------------------------ the recovery key */

/*
 * WHAT THE RECOVERY KEY IS. Matrix's key backup gives a person one secret that unlocks the room
 * keys their devices have held; this uses the same secret to carry ONE more thing — the account's
 * cross-signing private keys — because without those a new browser is a device the account has
 * never signed, and a room key is only ever shared with a device the account HAS signed. So the
 * key is the whole of what a new browser needs and the only thing it cannot work out for itself.
 *
 * The sealing is AES-GCM under a key derived from the recovery key by HKDF. Nothing is invented:
 * it is WebCrypto's own, the salt and the nonce are random per write and stored beside the
 * ciphertext, and the recovery key never leaves the browser it was shown in — the row holds the
 * ciphertext and the backup's PUBLIC half, and nothing that could open either.
 */
const B64 = {
  to: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))),
  from: (text) => Uint8Array.from(atob(String(text || '').replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
}
const utf8 = (s) => new TextEncoder().encode(s)
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))

async function aesFor(recoveryKey, salt) {
  const material = await crypto.subtle.importKey('raw', B64.from(recoveryKey), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('platformkit.spaces.secrets.v1') },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export async function sealSecrets(recoveryKey, value) {
  const salt = randomBytes(16), iv = randomBytes(12)
  const key = await aesFor(recoveryKey, salt)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(JSON.stringify(value)))
  return { v: 1, salt: B64.to(salt), iv: B64.to(iv), ct: B64.to(ct) }
}

/* null for a key that does not open it — a wrong recovery key is a thing to SAY, not to throw */
export async function openSecrets(recoveryKey, sealed) {
  if (!sealed || !sealed.ct) return null
  try {
    const key = await aesFor(recoveryKey, B64.from(sealed.salt))
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B64.from(sealed.iv) }, key, B64.from(sealed.ct))
    return JSON.parse(new TextDecoder().decode(out))
  } catch { return null }
}


/* ------------------------------------------------------------------ files and voice notes */

/*
 * A FILE IN A SEALED ROOM IS SEALED TOO, and it would be no use sealing the words and leaving the
 * picture, the recording and even the FILE NAME in the clear beside them — "severance-agreement.pdf"
 * says most of what the message said.
 *
 * Matrix's own scheme, and the library's own implementation of it: the bytes get a key of their
 * own (AES-CTR, with a SHA-256 of the ciphertext to check it came back whole), and what the bucket
 * holds is the ciphertext and nothing else. The little key that opens it travels in the MESSAGE —
 * sealed to the room like any other words — so the bucket, the policy and whoever can read the
 * bucket have the file and no way into it.
 *
 * To the reader none of this shows: a voice note plays, a picture appears, a pdf downloads, which
 * is what a room being sealed is supposed to cost them.
 */
export async function sealBytes(bytes) {
  const m = await load()
  const enc = m.Attachment.encrypt(new Uint8Array(bytes))
  /* the info must be read BEFORE the data: reading it is what consumes it, and the library hands
     back null the second time */
  const info = enc.mediaEncryptionInfo
  const data = enc.encryptedData
  return { data, info }
}

/* …and back. `null` for a file whose key this device has not got, exactly as for words. */
export async function openBytes(data, info) {
  if (!data || !info) return null
  const m = await load()
  try {
    const enc = new m.EncryptedAttachment(new Uint8Array(data), typeof info === 'string' ? info : JSON.stringify(info))
    return m.Attachment.decrypt(enc)
  } catch { return null }
}

/* ------------------------------------------------------------------ a context */

/*
 * ONE PERSON, ONE DEVICE, ONE CLIENT. Everything cryptographic happens inside one of these, and
 * the browser has exactly one — but the SHAPE is what makes a round trip demonstrable: two
 * contexts in one process are two devices talking to each other over the real tables, which is
 * the only honest proof that the transport below is right.
 *
 * WHAT THE LIBRARY ASKS FOR, MADE AGAINST THE SITE'S OWN TABLES. The function's copy of this
 * (`_shared/matrix/keys.js`) is NOT shared with it, and the reason is the fence rather than the
 * shape: there, the caller has been identified by a Matrix session and the service role does the
 * writing; here the caller IS the session, two of the five go through security-definer doors (a
 * claim deletes somebody else's row, a to-device message lands in their queue) and the other
 * three are plain RLS. Sharing the code would mean sharing a fence that is wrong on one side.
 */
export function context({ me, device, db, host, store }) {
  const mx = host || hostOf()
  let mach = null

  const keyAlgorithm = (id) => String(id || '').split(':')[0] || ''
  /* when each person's device list was last looked at, so a device that appears later is noticed */
  const looked = new Map()

  async function machine() {
    if (mach) return mach
    const m = await load()
    /* a named store is IndexedDB; no name is memory, which is what a probe gets */
    mach = store
      ? await m.OlmMachine.initialize(new m.UserId(userIdOf(me, mx)), new m.DeviceId(device), store)
      : await m.OlmMachine.initialize(new m.UserId(userIdOf(me, mx)), new m.DeviceId(device))
    return mach
  }

  async function keysUpload(body) {
    const b = JSON.parse(body || '{}')
    if (b.device_keys) {
      await db.from('space_devices').upsert({
        user_id: me, device_id: device,
        keys: b.device_keys.keys || {},
        algorithms: Array.isArray(b.device_keys.algorithms) ? b.device_keys.algorithms : [],
        signatures: b.device_keys.signatures || {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,device_id' })
    }
    const rows = []
    const take = (bag, fallback) => {
      for (const [keyId, key] of Object.entries(bag || {})) {
        rows.push({ user_id: me, device_id: device, key_id: keyId, algorithm: keyAlgorithm(keyId), key, fallback })
      }
    }
    take(b.one_time_keys, false)
    take(b.fallback_keys || b['org.matrix.msc2732.fallback_keys'], true)
    if (rows.length) {
      if (rows.some((r) => r.fallback)) {
        await db.from('space_one_time_keys').delete().eq('user_id', me).eq('device_id', device).eq('fallback', true)
      }
      await db.from('space_one_time_keys').upsert(rows, { onConflict: 'user_id,device_id,key_id' })
    }
    /* the COUNT it now has, which is how it decides whether to make more. Answering zero when keys
       were stored makes a client upload for ever. The fallback is not counted: it is never spent. */
    const { data } = await db.from('space_one_time_keys')
      .select('algorithm').eq('user_id', me).eq('device_id', device).eq('fallback', false)
    const counts = {}
    for (const r of data || []) counts[r.algorithm] = (counts[r.algorithm] || 0) + 1
    return { one_time_key_counts: counts }
  }

  async function keysQuery(body) {
    const b = JSON.parse(body || '{}')
    const ids = Object.keys(b.device_keys || {}).map(personOf).filter(Boolean)
    const out = { device_keys: {}, failures: {}, master_keys: {}, self_signing_keys: {}, user_signing_keys: {} }
    if (!ids.length) return out
    /* the policy is the fence: a person's own devices, and anybody sharing a space with them */
    const { data } = await db.from('space_devices')
      .select('user_id, device_id, keys, algorithms, signatures, cross_signing, display_name').in('user_id', ids)
    for (const r of data || []) {
      const who = userIdOf(r.user_id, mx)
      if (!r.device_id) {
        const cs = r.cross_signing || {}
        if (cs.master_key) out.master_keys[who] = cs.master_key
        if (cs.self_signing_key) out.self_signing_keys[who] = cs.self_signing_key
        if (cs.user_signing_key) out.user_signing_keys[who] = cs.user_signing_key
        continue
      }
      out.device_keys[who] = out.device_keys[who] || {}
      out.device_keys[who][r.device_id] = {
        user_id: who, device_id: r.device_id,
        algorithms: r.algorithms || [], keys: r.keys || {}, signatures: r.signatures || {},
        ...(r.display_name ? { unsigned: { device_display_name: r.display_name } } : {}),
      }
    }
    return out
  }

  async function keysClaim(body) {
    const b = JSON.parse(body || '{}')
    const out = { one_time_keys: {}, failures: {} }
    for (const [mxid, devices] of Object.entries(b.one_time_keys || {})) {
      const uid = personOf(mxid)
      if (!uid) continue
      for (const [dev, algorithm] of Object.entries(devices || {})) {
        /* a security-definer door: a claim is a DELETE of somebody else's row, fenced to a person
           you share a space with (92-encryption.sql) */
        const { data } = await db.rpc('space_claim_key', { p_user: uid, p_device: dev, p_algorithm: String(algorithm) })
        const got = Array.isArray(data) ? data[0] : data
        if (!got || !got.key_id) continue
        const who = userIdOf(uid, mx)
        out.one_time_keys[who] = out.one_time_keys[who] || {}
        out.one_time_keys[who][dev] = { ...(out.one_time_keys[who][dev] || {}), [got.key_id]: got.key }
      }
    }
    return out
  }

  async function toDevice(eventType, body) {
    const b = JSON.parse(body || '{}')
    /* the other security-definer door: the row lands in somebody else's queue, and the sender is
       taken from the session rather than from anything here */
    const messages = {}
    for (const [mxid, devices] of Object.entries(b.messages || {})) {
      const uid = personOf(mxid)
      if (uid) messages[uid] = devices
    }
    if (Object.keys(messages).length) {
      await db.rpc('space_send_to_device', { p_type: eventType || 'm.room.encrypted', p_messages: messages })
    }
    return {}
  }

  /*
   * THE ACCOUNT'S OWN IDENTITY. Cross-signing is what makes a device belong to a person rather
   * than merely claim to: the account's self-signing key signs each of its devices, and a room key
   * is only ever shared with a device that signature covers. Without it a device list is a list of
   * assertions, and whoever serves the list — us — could add one to it.
   *
   * The three public halves go in the person's own row, the one with no device of its own; the
   * private halves never leave the library's store, which is why a new browser has to be let in
   * with the recovery key rather than simply signing itself in.
   */
  async function signingKeysUpload(body) {
    const b = JSON.parse(body || '{}')
    const { data: row } = await db.from('space_devices').select('cross_signing').eq('user_id', me).eq('device_id', '').maybeSingle()
    const cs = { ...((row && row.cross_signing) || {}) }
    for (const which of ['master_key', 'self_signing_key', 'user_signing_key']) if (b[which]) cs[which] = b[which]
    await db.from('space_devices').upsert({ user_id: me, device_id: '', cross_signing: cs, updated_at: new Date().toISOString() }, { onConflict: 'user_id,device_id' })
    return {}
  }

  async function signatureUpload(body) {
    const b = JSON.parse(body || '{}')
    /* a signature is keyed by its SIGNER, and the signer is whoever is signed in. The policy lets
       a person write their own row and no other, so a signature on somebody else's key cannot be
       made from here — the same answer Matrix gives a client with no permission. Our own device's
       signatures are the case that matters for reading a room. */
    const out = { failures: {} }
    const mine = userIdOf(me, mx)
    for (const [mxid, items] of Object.entries(b.signed_keys || b || {})) {
      if (personOf(mxid) !== me) continue
      for (const [deviceOrKey, signed] of Object.entries(items || {})) {
        const ours = (signed && signed.signatures && signed.signatures[mxid]) || {}
        if (!Object.keys(ours).length) continue
        if (signed.device_id) {
          const { data: row } = await db.from('space_devices').select('signatures').eq('user_id', me).eq('device_id', deviceOrKey).maybeSingle()
          const had = (row && row.signatures) || {}
          await db.from('space_devices').update({ signatures: { ...had, [mine]: { ...(had[mine] || {}), ...ours } }, updated_at: new Date().toISOString() })
            .eq('user_id', me).eq('device_id', deviceOrKey)
        } else {
          const { data: row } = await db.from('space_devices').select('cross_signing').eq('user_id', me).eq('device_id', '').maybeSingle()
          const cs = { ...((row && row.cross_signing) || {}) }
          for (const which of ['master_key', 'self_signing_key', 'user_signing_key']) {
            if (!cs[which] || !cs[which].keys) continue
            if (!Object.values(cs[which].keys).includes(deviceOrKey)) continue
            cs[which] = { ...cs[which], signatures: { ...(cs[which].signatures || {}), [mine]: { ...((cs[which].signatures || {})[mine] || {}), ...ours } } }
          }
          await db.from('space_devices').upsert({ user_id: me, device_id: '', cross_signing: cs, updated_at: new Date().toISOString() }, { onConflict: 'user_id,device_id' })
        }
      }
    }
    return out
  }

  /*
   * THE PUMP. The library does not make requests; it says what it needs made, and keeps saying so
   * until each is marked sent. Everything above is called from here.
   *
   * It runs until the library has nothing left to ask, because one request's answer is what makes
   * the next one appear — a query of somebody's devices is what makes a claim of their keys
   * possible, which is what makes a session. Stopping after one pass leaves the machine halfway.
   */
  async function pump() {
    const m = await load()
    const o = await machine()
    for (let pass = 0; pass < 12; pass++) {
      const requests = await o.outgoingRequests()
      if (!requests.length) return
      for (const r of requests) {
        let body = {}
        try {
          if (r.type === m.RequestType.KeysUpload) body = await keysUpload(r.body)
          else if (r.type === m.RequestType.KeysQuery) body = await keysQuery(r.body)
          else if (r.type === m.RequestType.KeysClaim) body = await keysClaim(r.body)
          else if (r.type === m.RequestType.ToDevice) body = await toDevice(r.event_type, r.body)
          else if (r.type === m.RequestType.SignatureUpload) body = await signatureUpload(r.body)
          else if (r.type === m.RequestType.SigningKeysUpload) body = await signingKeysUpload(r.body)
          else body = {}   /* a backup or a room message: nothing of ours turns on it yet */
        } catch (e) {
          /* a request that could not be made is left UNMARKED, so the library asks again rather
             than carrying on as though it had been answered */
          console.error('spaces/crypto: a request could not be made —', String((e && e.message) || e))
          return
        }
        await o.markRequestAsSent(r.id, r.type, JSON.stringify(body))
      }
    }
  }

  /*
   * WHAT IS WAITING FOR THIS DEVICE. Matrix's contract is that a batch is handed over and deleted
   * once the client has acknowledged it, so a row is removed only AFTER the library has taken it:
   * a browser that dies mid-receive sees its keys again rather than losing them for good.
   */
  async function receive() {
    const m = await load()
    const o = await machine()
    const { data } = await db.from('space_to_device')
      .select('id, sender_id, type, content')
      .eq('user_id', me).in('device_id', [device, '*']).order('id', { ascending: true }).limit(200)
    const rows = data || []
    if (rows.length) {
      const events = rows.map((r) => ({ sender: userIdOf(r.sender_id, mx), type: r.type, content: r.content }))
      await o.receiveSyncChanges(JSON.stringify(events), new m.DeviceLists(), new Map(), undefined)
      await db.from('space_to_device').delete().in('id', rows.map((r) => r.id))
    }
    await pump()
    if (rows.length) { try { await backUpKeys() } catch { /* as above */ } }
    return rows.length
  }

  /*
   * READY. Called when a sealed room is opened: it makes or finds this browser's device, publishes
   * its public keys and takes whatever is waiting in its to-device queue — which is where a room
   * key sent by somebody else arrives. The one call that may take a second on a cold browser;
   * everything after it is cheap.
   */
  async function ready() {
    const o = await machine()
    await pump()        /* the device's own keys go up before anything asks for them */

    /* …and the account's identity, once. A person whose row carries no master key has never had
       one made, so this browser makes it and signs itself; a later browser is let in by the
       recovery key instead, which is the one thing a new machine cannot work out for itself. */
    const { data: row } = await db.from('space_devices').select('cross_signing').eq('user_id', me).eq('device_id', '').maybeSingle()
    if (!row || !row.cross_signing || !row.cross_signing.master_key) {
      const m = await load()
      const boot = await o.bootstrapCrossSigning(false)
      if (boot.uploadKeysRequest) {
        const r = boot.uploadKeysRequest
        await o.markRequestAsSent(r.id, m.RequestType.KeysUpload, JSON.stringify(await keysUpload(r.body)))
      }
      if (boot.uploadSigningKeysRequest) await signingKeysUpload(boot.uploadSigningKeysRequest.body)
      if (boot.uploadSignaturesRequest) await signatureUpload(boot.uploadSignaturesRequest.body)
      await pump()
    }

    /* a backup this browser already holds the key to is simply turned back on; one it does not is
       the panel's business, not this call's — it asks `state()` and shows the recovery-key form. */
    try {
      const row = await currentBackup()
      const keys = row ? await o.getBackupKeys() : null
      if (row && keys && keys.decryptionKey) await o.enableBackupV1((row.auth_data || {}).public_key, row.version)
    } catch { /* no backup, or none this device can use */ }

    await receive()
    return true
  }

  /*
   * WHAT THE PANEL ASKS. Three facts and no advice: whether this browser has published a device,
   * whether the account has a backup at all, and whether THIS browser can open it. The panel
   * decides what to show from those — set up, hand over the recovery key, or carry on without it.
   */
  async function state() {
    const o = await machine()
    const row = await currentBackup()
    let holds = false
    try { const keys = await o.getBackupKeys(); holds = !!(keys && keys.decryptionKey) } catch { holds = false }
    return { device: await published(), backup: !!row, holds, keys: row ? row.count : 0 }
  }

  /*
   * WHOSE DEVICES HAVE MOVED. A real Matrix client is told by `/sync`: `device_lists.changed` names
   * the people whose devices are no longer what it last saw, and the library then asks for them
   * again. We have no sync loop, so the same thing is worked out from the rows — the newest
   * `updated_at` among a person's devices, against when we last looked at them.
   *
   * Without this the library never asks twice. It marks a person's list up to date the moment its
   * query is answered, so a browser somebody opened AFTER this one started sealing is a device it
   * does not know exists, and the room key is never sent to it: the other person sits in a room
   * reading nothing, on a device that is working perfectly. This is the one place that is noticed.
   */
  async function freshen(ids) {
    const m = await load()
    const o = await machine()
    const { data } = await db.from('space_devices').select('user_id, updated_at').in('user_id', ids)
    const newest = new Map()
    for (const r of data || []) {
      const t = Date.parse(r.updated_at || 0) || 0
      if (t > (newest.get(r.user_id) || 0)) newest.set(r.user_id, t)
    }
    const moved = [...newest.entries()].filter(([p, t]) => t > (looked.get(p) || 0)).map(([p]) => p)
    for (const [p, t] of newest) looked.set(p, t)
    if (!moved.length) return 0
    await o.receiveSyncChanges('[]', new m.DeviceLists(moved.map((p) => new m.UserId(userIdOf(p, mx)))), new Map(), undefined)
    await pump()
    return moved.length
  }

  /*
   * SEAL. The room key is shared with everybody in the room first — which is what makes the
   * to-device traffic — and then the body is encrypted to it.
   *
   * `people` is who is in the room, by their account ids. The caller knows that; this file does
   * not ask, because who is in a room is the surface's question and asking it twice is how two
   * answers appear.
   */
  async function seal(channelId, people, body) {
    const m = await load()
    const o = await machine()
    const room = new m.RoomId(roomIdOf(channelId, mx))
    const ids = [...new Set([me, ...(people || [])])].filter(Boolean)

    /* the library will not seal to somebody whose devices it has never seen, so three things
       happen before anything is encrypted, in this order and no other: their devices are tracked
       and queried, a one-time key is claimed from each device there is no session with yet, and
       the room key is sent to each. Each of `updateTrackedUsers`, `getMissingSessions` and
       `shareRoomKey` invalidates the ids it is handed, so each gets its own. */
    const them = () => ids.map((p) => new m.UserId(userIdOf(p, mx)))
    await o.updateTrackedUsers(them())
    await freshen(ids)
    await pump()

    /* THE CLAIM IS NOT AN OUTGOING REQUEST. `outgoingRequests` never produces one: a key claim is
       asked for by name, which is why a seal that only pumped left every other device with
       "m.no_olm — unable to establish a secure channel" and no session, for ever. */
    const missing = await o.getMissingSessions(them())
    if (missing) await o.markRequestAsSent(missing.id, m.RequestType.KeysClaim, JSON.stringify(await keysClaim(missing.body)))
    await pump()

    const requests = await o.shareRoomKey(room, them(), new m.EncryptionSettings())
    for (const r of requests) {
      await toDevice(r.event_type, r.body)
      /* …and marked, or the library shares the same key again on the next message */
      await o.markRequestAsSent(r.id, m.RequestType.ToDevice, '{}')
    }
    await pump()

    const cipher = await o.encryptRoomEvent(room, 'm.room.message', JSON.stringify({ msgtype: 'm.text', body: String(body ?? '') }))
    /* the session this was sealed to goes to the backup now rather than later: a key that lives in
       one browser's store is a key one cleared cache takes away from its owner for ever */
    try { await backUpKeys() } catch { /* a backup that could not be written is not a message that
      could not be sent, and the room must not fail for it */ }
    return JSON.parse(cipher)
  }

  /*
   * OPEN. The cipher as the row holds it, back into the words that were written.
   *
   * A message this device has no key for is not an error and must not read as one: it is a message
   * sent before this browser existed, or to a device since signed out of, and the room says so in
   * its own words rather than throwing. `null` means exactly that — not "something went wrong".
   */
  async function open(channelId, cipher, sender) {
    if (!cipher) return null
    const m = await load()
    const o = await machine()
    const room = new m.RoomId(roomIdOf(channelId, mx))
    const event = JSON.stringify({
      type: 'm.room.encrypted',
      event_id: '$' + (cipher.session_id || 'x') + ':' + mx,
      origin_server_ts: Date.now(),
      sender: userIdOf(sender || me, mx),
      content: cipher,
    })
    try {
      const got = await o.decryptRoomEvent(event, room, new m.DecryptionSettings(m.TrustRequirement.Untrusted))
      const parsed = JSON.parse(got.event)
      return typeof parsed.content?.body === 'string' ? parsed.content.body : null
    } catch {
      /* no key for this one, on this device. The surface says so where the words would be. */
      return null
    }
  }

  /* ---- the backup ---- */

  const ALGO = 'm.megolm_backup.v1.curve25519-aes-sha2'

  /* the person's current backup, if they have ever made one. Ordered as a NUMBER: '9' sorts after
     '10' as text, and a tenth version would then be read as the ninth for ever. */
  async function currentBackup() {
    const { data } = await db.from('space_key_backups')
      .select('version, algorithm, auth_data, sessions, count').eq('user_id', me).is('deleted_at', null)
    const rows = data || []
    if (!rows.length) return null
    return rows.sort((a, b) => Number(b.version) - Number(a.version))[0]
  }

  /*
   * MAKE ONE, ONCE, AND SHOW THE KEY. The return value is the only time the recovery key exists
   * outside this browser's own store: it is handed to the panel, shown, and never asked for again.
   * Nothing writes it anywhere — not a row, not localStorage, not a log.
   */
  async function makeBackup() {
    const m = await load()
    const o = await machine()
    const had = await currentBackup()
    const version = String(had ? Number(had.version) + 1 : 1)
    const dk = m.BackupDecryptionKey.createRandomKey()
    const recoveryKey = dk.toBase64()
    const pub = dk.megolmV1PublicKey.publicKeyBase64

    /* the account's own private halves travel with it; a new browser is nobody without them */
    const x = await o.exportCrossSigningKeys()
    const secrets = await sealSecrets(recoveryKey, {
      master: (x && x.masterKey) || null,
      self_signing: (x && x.self_signing_key) || null,
      user_signing: (x && x.userSigningKey) || null,
    })

    const { error } = await db.from('space_key_backups').insert({
      user_id: me, version, algorithm: ALGO, auth_data: { public_key: pub, secrets }, count: 0,
    })
    if (error) throw new Error(error.message)

    await o.saveBackupDecryptionKey(dk, version)
    await o.enableBackupV1(pub, version)
    await backUpKeys()
    return recoveryKey
  }

  /*
   * PUSH WHAT THIS DEVICE HOLDS. Called after every seal and every receive, because a room key
   * that is only in one browser's store is a room key one cleared cache deletes for ever. The
   * blobs are sealed to the backup's public half by the library; this file merges them into the
   * row and never looks inside one.
   */
  async function backUpKeys() {
    const m = await load()
    const o = await machine()
    const req = await o.backupRoomKeys()
    if (!req) return 0
    const body = JSON.parse(req.body || '{}')
    const row = await currentBackup()
    if (!row || row.version !== req.version) { await o.markRequestAsSent(req.id, m.RequestType.KeysBackup, '{}'); return 0 }
    const sessions = { ...(row.sessions || {}) }
    let added = 0
    for (const [roomId, rooms] of Object.entries(body.rooms || {})) {
      const held = { ...(sessions[roomId] && sessions[roomId].sessions ? sessions[roomId].sessions : {}) }
      for (const [sessionId, blob] of Object.entries((rooms && rooms.sessions) || {})) {
        if (!held[sessionId]) added++
        held[sessionId] = blob
      }
      sessions[roomId] = { sessions: held }
    }
    const count = Object.values(sessions).reduce((n, r) => n + Object.keys(r.sessions || {}).length, 0)
    await db.from('space_key_backups')
      .update({ sessions, count, etag: String(Date.now()), updated_at: new Date().toISOString() })
      .eq('user_id', me).eq('version', row.version)
    await o.markRequestAsSent(req.id, m.RequestType.KeysBackup, '{ "etag": "1", "count": ' + count + ' }')
    return added
  }

  /*
   * LET THIS BROWSER IN. The key is checked by deriving the backup's public half from it and
   * comparing: a wrong key is answered with `false` and nothing is changed, because the panel has
   * a sentence for that and an exception is not a sentence.
   *
   * Then three things, in order: the account's private halves, so this device can be signed and
   * can be shared with; the backed-up room keys, so the history opens; and a pump, so the
   * signature this device just gained is published for everybody else to see.
   */
  async function restore(recoveryKey) {
    const m = await load()
    const o = await machine()
    const row = await currentBackup()
    if (!row) return false
    const key = tighten(recoveryKey)
    let dk = null
    try { dk = m.BackupDecryptionKey.fromBase64(key) } catch { return false }
    if (dk.megolmV1PublicKey.publicKeyBase64 !== (row.auth_data || {}).public_key) return false

    const secrets = await openSecrets(key, (row.auth_data || {}).secrets)
    if (secrets) await o.importCrossSigningKeys(secrets.master || null, secrets.self_signing || null, secrets.user_signing || null)

    await o.saveBackupDecryptionKey(dk, row.version)
    await o.enableBackupV1((row.auth_data || {}).public_key, row.version)

    /* every session, opened one at a time and handed over already in the clear: the library takes
       the decrypted shape, and the decryption is the key's own work */
    const rooms = new Map()
    for (const [roomId, held] of Object.entries(row.sessions || {})) {
      const got = new Map()
      for (const [sessionId, blob] of Object.entries((held && held.sessions) || {})) {
        const d = blob && blob.session_data
        if (!d) continue
        try { got.set(sessionId, JSON.parse(dk.decryptV1(d.ephemeral, d.mac, d.ciphertext))) } catch { /* one session we cannot open is not the rest */ }
      }
      if (got.size) rooms.set(new m.RoomId(roomId), got)
    }
    if (rooms.size) await o.importBackedUpRoomKeys(rooms, undefined, row.version)
    await pump()
    return true
  }

  /* whether there is a history to be let into at all — what the panel asks to decide between
     "set this device up" and "read your earlier messages" */
  async function hasBackup() { return !!(await currentBackup()) }

  /* has this device been published at all — what the set-up panel asks before offering to make one */
  async function published() {
    const { data } = await db.from('space_devices')
      .select('device_id').eq('user_id', me).eq('device_id', device).maybeSingle()
    return !!data
  }

  return { me, device, host: mx, machine, ready, receive, seal, open, published, state, makeBackup, restore, hasBackup, backUpKeys }
}

/* ------------------------------------------------------------------ this browser's one context */

let here = null

async function mine(me) {
  const device = deviceId()
  if (here && here.me === me && here.device === device) return here
  const db = await database()
  if (!db) return null
  here = context({ me, device, db, host: hostOf(), store: `dl-${pack(me)}` })
  return here
}

export async function ready(me) { const c = me && (await mine(me)); return c ? c.ready() : false }
export async function receive(me) { const c = me && (await mine(me)); return c ? c.receive() : 0 }
export async function seal(me, channelId, people, body) { const c = await mine(me); return c.seal(channelId, people, body) }
export async function open(me, channelId, cipher, sender) { const c = me && (await mine(me)); return c ? c.open(channelId, cipher, sender) : null }
export async function published(me) { const c = me && (await mine(me)); return c ? c.published() : false }
export async function makeBackup(me) { const c = await mine(me); return c.makeBackup() }
export async function restore(me, recoveryKey) { const c = me && (await mine(me)); return c ? c.restore(recoveryKey) : false }
export async function hasBackup(me) { const c = me && (await mine(me)); return c ? c.hasBackup() : false }
export async function state(me) { const c = me && (await mine(me)); return c ? c.state() : { device: false, backup: false, holds: false, keys: 0 } }
