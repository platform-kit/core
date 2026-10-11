/*
 * THE WORLD OUTSIDE, for a member who has joined the wider network: what the site has no copy of —
 * somebody elsewhere, their posts, Bluesky's own view of a joined member's timeline and
 * notifications — is asked of an app view (Bluesky's, unless the site's config names another), as
 * that member, with a service token signed by their own key, as any server asks on behalf of its
 * people. Nothing that comes back is stored: it is merged into what the site answers and forgotten.
 * A closed site, or a member who has not joined, asks nothing of anybody.
 */
import { admin } from '../lib.ts'
import * as SITE from '../pipe/site.js'
import { Secp256k1Keypair } from 'npm:@atproto/crypto@0.5.7'

const S = SITE as { network?: { appview?: string } }
export const appviewUrl = () => String(Deno.env.get('NETWORK_APPVIEW_URL') || (S.network && S.network.appview) || 'https://api.bsky.app').replace(/\/+$/, '')
export const appviewDid = () => String(Deno.env.get('NETWORK_APPVIEW_DID') || 'did:web:api.bsky.app')

const enc = new TextEncoder()
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/* the member's own key, and their portable DID — or nothing for a member who has not joined */
export async function joinedIdentity(userId: string | null) {
  if (!userId) return null
  const { data: i } = await admin.from('network_identities').select('did, signing_key_id, joined_at, left_at').eq('user_id', userId).maybeSingle()
  if (!i || !i.joined_at || i.left_at) return null
  return i
}

/* A SERVICE TOKEN: who is asking (the member), whom (the app view), for which method, for a minute —
   signed with the member's own key, which their DID document names */
export async function serviceToken(identity: any, aud: string, lxm: string) {
  const hex = (await admin.rpc('network_key_read', { p_secret_id: identity.signing_key_id })).data as string
  const key = await Secp256k1Keypair.import(hex)
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256K' })))
  const now = Math.floor(Date.now() / 1000)
  const body = b64u(enc.encode(JSON.stringify({ iss: identity.did, aud, exp: now + 60, iat: now, lxm, jti: crypto.randomUUID() })))
  const sig = await key.sign(enc.encode(head + '.' + body))
  return head + '.' + body + '.' + b64u(sig)
}

/* ask the app view, as the member; null when it cannot be asked or does not answer */
export async function ask(identity: any, nsid: string, params: URLSearchParams | Record<string, string | string[]>) {
  try {
    const q = params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])))
    const token = await serviceToken(identity, appviewDid(), nsid)
    const res = await fetch(`${appviewUrl()}/xrpc/${nsid}?${q}`, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.error('atproto: the app view did not answer', nsid, e)
    return null
  }
}

/* two pages of a feed made one: newest first by when each item happened, nothing twice */
export function mergeFeeds(a: any[], b: any[], limit: number) {
  const at = (f: any) => new Date((f.reason && f.reason.indexedAt) || (f.post && f.post.indexedAt) || 0).getTime()
  const seen = new Set<string>()
  return [...a, ...b].sort((x, y) => at(y) - at(x)).filter((f) => {
    const k = (f.post && f.post.uri) + '|' + ((f.reason && f.reason.by && f.reason.by.did) || '')
    if (seen.has(k)) return false
    seen.add(k); return true
  }).slice(0, limit)
}
