/*
 * A call with no video account: the people in it talk to each other directly, browser to browser,
 * and the site carries nothing but the signalling — on the channel's own realtime topic, which is
 * already private and already authorised by membership, so it costs nothing new and lets nobody in
 * who could not read the channel anyway.
 *
 * It fills the same shape as the other video providers (room · admit · record · end · event), so the
 * call page draws it exactly as it draws LiveKit's. What differs is stated rather than hidden: a
 * mesh call is **not recorded** — record() refuses with a reason rather than pretending — and it
 * carries **five people in total**, everyone counted the same, a host or a consultant among them.
 * At five each browser holds four connections up and four down, which is the honest ceiling of a
 * mesh on a laptop; above it, a video account is the answer and the call says so.
 *
 * The credentials a person is admitted with are the site's own: a short-lived token naming them and
 * that room alone, which the call page presents to subscribe to the room's topic. There is no
 * account anywhere and nothing to configure.
 */
import { iceServers } from './ice.js'

export const MESH_MAX = 5

const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function sign(secret, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return body + '.' + b64url(sig)
}

export async function readToken(secret, token) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) return null
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)), new TextEncoder().encode(body))
  if (!ok) return null
  try {
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))
    return p.exp && p.exp * 1000 < Date.now() ? null : p
  } catch (e) { return null }
}

export function mesh({ db, env, ice }) {
  const app = () => (env('APP_URL') || '').replace(/\/$/, '')
  const secret = () => env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_ANON_KEY') || 'mesh'
  const servers = iceServers({ env, ice })

  return {
    id: 'mesh',
    /* it needs nothing, so it is always configured and never a mock: there is no service to stand in for */
    configured: () => true,
    mock: () => false,
    max: MESH_MAX,
    records: false,

    room: (b) => ({ join_url: `${app()}/app/call/${b.uid || b.id}`, ref: 'mesh:' + (b.room || b.uid || b.id) }),

    /* the credentials for one person and one room: what to subscribe to, who they are on it, and
       where to find themselves — and a relay only where the site was given one. */
    async admit(b, person, role, opts = {}) {
      const ref = (b.room || b.uid || b.id)
      const ttl = Math.max(60, Math.min(opts.ttl || 3600, 12 * 3600))
      const token = await sign(secret(), { room: ref, id: person.id, name: person.name || '', role: role || 'member', exp: Math.floor(Date.now() / 1000) + ttl })
      const { iceServers: servers_, relay, source } = await servers(person.id, ref, ttl)
      return {
        url: `${app()}/app/call/${b.uid || b.id}`,
        token, ttl, topic: 'call:' + ref, provider: 'mesh',
        iceServers: servers_, relay, relaySource: source, max: MESH_MAX, recorded: false,
      }
    },

    /* nothing here can record: say so, rather than answer as though a film were coming */
    record: () => ({ error: 'a call made browser to browser is not recorded; a video account is what records one' }),

    /* everyone is told to leave on the room's own topic; there is no server holding it open */
    async end(b) {
      const ref = (b.room || b.uid || b.id)
      try { await db.rpc('space_wake', { p_channel: null, p_event: 'call-end', p_payload: { room: ref } }) } catch (e) { /* the room simply empties */ }
      return { ended: true }
    },

    /* there is no third party to notify us of anything: the people in the room are the record */
    event: () => null,
  }
}
