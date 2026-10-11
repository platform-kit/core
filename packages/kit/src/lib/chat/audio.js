/*
 * A voice note's sound. The chat bucket is private, so a recording is fetched
 * through the signed-in client (RLS lets only the two parties read it) and
 * held as an object url for the session; one that this browser just made is
 * played from the blob it has. The urls are let go on sign-out.
 */
import { supabase } from '../supabase.js'
import { beforeSignOut, onIdentity } from '../auth.js'

const BUCKET = 'chat'
const urls = new Map()      /* audio_path → object url */
const pending = new Map()   /* audio_path → promise */

export function voiceUrl(m) {
  if (!m) return Promise.resolve(null)
  if (m.blob) {
    if (!urls.has(m.id)) urls.set(m.id, URL.createObjectURL(m.blob))
    return Promise.resolve(urls.get(m.id))
  }
  /* the support chat hands its rows a url of their own (the private bucket, signed) */
  if (m.url) return Promise.resolve(m.url)
  const path = m.audio_path
  if (!path || !supabase) return Promise.resolve(null)
  if (urls.has(path)) return Promise.resolve(urls.get(path))
  if (pending.has(path)) return pending.get(path)
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

/* AND THE SAME FOR ANYTHING ELSE ATTACHED. The support chat's rows arrive carrying a signed url
   because its own function signs one; the coaching chat's do not, so the file is fetched through
   the signed-in client exactly as a voice note is — the bucket is private and RLS is the rule. */
export function attachmentUrl(m) {
  if (!m) return Promise.resolve(null)
  if (m.url) return Promise.resolve(m.url)
  const path = m.attachment_path
  if (!path || !supabase) return Promise.resolve(null)
  if (urls.has(path)) return Promise.resolve(urls.get(path))
  if (pending.has(path)) return pending.get(path)
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
