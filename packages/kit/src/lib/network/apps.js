/*
 * SIGNING IN FROM ANOTHER APP, from the account page: the app passwords a member makes for Bluesky's
 * app or any other atproto client, listed, made and revoked. Made through the atproto function's own
 * method (com.atproto.server.createAppPassword) with the site's session, because the secret is made
 * and hashed on the server and shown exactly once; read and revoked as the member's own rows, and
 * revoking one ends every session made with it (the sessions hang off it in 93-network.sql).
 */
import { supabase, configured } from '../supabase.js'
import { user } from '../auth.js'

const XRPC = 'atproto/xrpc/'

/* the handle domain and whether the server answers at all — the function's own description */
export async function describe() {
  if (!configured) return null
  const { data, error } = await supabase.functions.invoke(XRPC + 'com.atproto.server.describeServer', { method: 'GET' })
  if (error || !data) return null
  return { domain: String((data.availableUserDomains || [''])[0] || '').replace(/^\./, ''), did: data.did }
}

export async function listAppPasswords() {
  if (!configured || !user.value) return []
  const { data } = await supabase.from('network_app_passwords').select('id, name, created_at, last_used_at').order('created_at', { ascending: false })
  return data || []
}

export async function makeAppPassword(name) {
  const { data, error } = await supabase.functions.invoke(XRPC + 'com.atproto.server.createAppPassword', { body: { name: String(name || '').trim() } })
  if (error) {
    let message = error.message
    try { const b = await error.context.json(); message = b.message || message } catch { /* no body */ }
    throw new Error(message)
  }
  return data
}

export async function revokeAppPassword(id) {
  const { error } = await supabase.from('network_app_passwords').delete().eq('id', id)
  if (error) throw error
}

/* JOINING THE WIDER NETWORK — the member's own act, on a site that federates: a portable identity
   made for them, their public posts published, and leaving takes them down again */
export async function networkStatus() {
  if (!configured || !user.value) return null
  const { data } = await supabase.from('network_identities').select('did, joined_at, left_at').maybeSingle()
  return data && data.joined_at && !data.left_at ? { joined: true, did: data.did } : { joined: false }
}
async function door(path) {
  const { data, error } = await supabase.functions.invoke('atproto/network/' + path, { body: {} })
  if (error) {
    let message = error.message
    try { const b = await error.context.json(); message = b.message || message } catch { /* no body */ }
    throw new Error(message)
  }
  return data
}
export const joinNetwork = () => door('join')
export const leaveNetwork = () => door('leave')
