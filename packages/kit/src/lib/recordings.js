/*
 * A call's recording, watched: the `session-files` function decides from the booking's own policy (the attendee,
 * the coach, an administrator) and signs the bucket's urls for an hour; nothing here knows the bucket, and no
 * browser is sent to cal.com. Answered as paths; the public address goes in front, as for a buyer's files. Asked
 * once per booking per visit; `fresh` asks again (an hour on, or after Fetch again).
 */
import { supabase, configured, url as SUPABASE_URL } from './supabase.js'

const cache = new Map()
const here = (p) => (p && /^\//.test(p) ? SUPABASE_URL.replace(/\/$/, '') + p : p || null)
export async function recordingFor(uid, fresh = false) {
  if (!supabase || !configured) return null
  if (!fresh && cache.has(uid)) return cache.get(uid)
  const { data, error } = await supabase.functions.invoke('session-files', { body: { uid } })
  if (error) throw error
  const out = { ...data, recording: here(data && data.recording), play: here(data && data.play), transcript: here(data && data.transcript) }
  cache.set(uid, out)
  return out
}
/* an administrator's Fetch again: the pull asked for one booking, its tries reset */
export async function fetchAgain(uid) {
  const { data, error } = await supabase.functions.invoke('session-recordings', { body: { action: 'pull', uid } })
  if (error) throw error
  cache.delete(uid)
  return data
}
export const forget = () => cache.clear()
