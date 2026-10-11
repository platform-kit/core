/*
 * A voice note's sound, in a space. The spaces bucket is private, so a recording is fetched through
 * the signed-in client — the policy lets anybody who may read the channel hear it, and nobody else
 * — and held as an object url for the session; one this browser has just made is played from the
 * blob it already has. The urls are let go on sign-out.
 *
 * The same shape the chat's own audio.js answers, because the theme's VoiceNote takes either: a
 * blob, or a url somebody else resolved. That is why this is nine lines and not a second player.
 */
import { supabase } from '../supabase.js'
import { beforeSignOut, onIdentity } from '../auth.js'

const BUCKET = 'spaces'
const urls = new Map()      /* path → object url */
const pending = new Map()   /* path → promise */

export const voicePath = (channelId, messageId) => channelId + '/' + messageId + '.mp3'
/* WHAT MAY BE ATTACHED, and the name it takes in the bucket — the same list the bucket itself
   holds and the storage policy's own pattern, said here so a browser refuses a file by name
   rather than sending it to be refused. */
export const FILE_TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'text/plain': 'txt',
}
export const FILE_MAX = 20 * 1024 * 1024
export const filePath = (channelId, messageId, ext) => channelId + '/' + messageId + '.' + ext

/*
 * A SEALED ATTACHMENT IS FETCHED AND OPENED BEFORE IT IS AN ADDRESS. The bucket holds ciphertext,
 * so a signed url would play as noise and download as rubbish: the bytes have to come down, be
 * opened with the little key the message carried, and become a blob of their own. Everything above
 * then works unchanged — the player takes an object url either way.
 *
 * `media` is on the row only for a message this device could open; a row without it is either not
 * sealed, or sealed to a device this one is not, and the surface has already said so.
 */
async function opened(m) {
  const { data, error } = await supabase.storage.from(BUCKET).download(m.attachment)
  if (error || !data) return null
  const crypt = await import('./crypto.js')
  const bytes = await crypt.openBytes(await data.arrayBuffer(), m.media)
  if (!bytes) return null
  return new Blob([bytes], { type: m.attachment_type || 'application/octet-stream' })
}

/* WHAT IS ATTACHED, as an address a browser can use: the bytes this browser just sent where it
   still has them, and otherwise a signed url, kept for the session as the recordings are. The
   bucket is private, so there is no such thing as a plain address for one of these. */
const signed = new Map()
export function fileUrl(m) {
  if (!m) return Promise.resolve(null)
  if (m.blob) {
    if (!urls.has(m.id)) urls.set(m.id, URL.createObjectURL(m.blob))
    return Promise.resolve(urls.get(m.id))
  }
  const path = m.attachment
  if (!path || !supabase) return Promise.resolve(null)
  if (m.media) {
    if (urls.has(path)) return Promise.resolve(urls.get(path))
    if (pending.has(path)) return pending.get(path)
    const q = opened(m).then((b) => {
      pending.delete(path)
      if (!b) return null
      const u = URL.createObjectURL(b)
      urls.set(path, u)
      return u
    }).catch(() => { pending.delete(path); return null })
    pending.set(path, q)
    return q
  }
  if (signed.has(path)) return signed.get(path)
  const p = supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    .then(({ data }) => (data && data.signedUrl) || null)
    .catch(() => null)
  signed.set(path, p)
  return p
}

export function voiceUrl(m) {
  if (!m) return Promise.resolve(null)
  if (m.blob) {
    if (!urls.has(m.id)) urls.set(m.id, URL.createObjectURL(m.blob))
    return Promise.resolve(urls.get(m.id))
  }
  const path = m.attachment
  if (!path || !supabase) return Promise.resolve(null)
  if (urls.has(path)) return Promise.resolve(urls.get(path))
  if (pending.has(path)) return pending.get(path)
  if (m.media) {
    const q = opened(m).then((b) => {
      pending.delete(path)
      if (!b) return null
      const u = URL.createObjectURL(b)
      urls.set(path, u)
      return u
    }).catch(() => { pending.delete(path); return null })
    pending.set(path, q)
    return q
  }
  const p = supabase.storage.from(BUCKET).download(path).then(({ data, error }) => {
    pending.delete(path)
    if (error || !data) return null
    const u = URL.createObjectURL(data)
    urls.set(path, u)
    return u
  }).catch(() => { pending.delete(path); return null })
  pending.set(path, p)
  return p
}

export function forget() {
  for (const u of urls.values()) { try { URL.revokeObjectURL(u) } catch (e) { /* gone */ } }
  urls.clear()
}
beforeSignOut.push(forget)
/* AND ON EVERY CHANGE OF PERSON, including guest to person: these are urls signed for somebody,
   and one minted for whoever was here must never be handed to whoever is here now. */
onIdentity(forget)
