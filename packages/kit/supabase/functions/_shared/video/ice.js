/*
 * The ICE servers a browser is given for a call — where to find itself (STUN) and, when two people
 * cannot reach each other directly, where to be relayed (TURN).
 *
 * **Supabase has no TURN service, and nothing in this stack can relay media.** Realtime carries the
 * signalling and nothing else, and no Supabase-only deployment of anything relays WebRTC: a relay is
 * a box. So the rule for this kit is that the relay is never a service it depends on. What makes
 * that workable is that TURN is a standard with a standard way of authorising a caller, so the
 * function is a **credential minter and never a relay**, and the same setting points at a coturn a
 * site runs itself or at anything else that speaks it.
 *
 * Filled three ways, by no vendor:
 *
 *   1. a secret   WEBRTC_TURN_URL + WEBRTC_TURN_SECRET — username `<expiry>:<person>` and credential
 *                 base64(HMAC-SHA1(secret, username)), which is what coturn's use-auth-secret checks.
 *                 No outbound call, no account, no per-user state on the relay.
 *   2. a pair     WEBRTC_TURN_URL + WEBRTC_TURN_USERNAME / WEBRTC_TURN_PASSWORD — the long-term
 *                 credentials some hosted relays hand out. Not short-lived, so it is the lesser one.
 *   3. a module   the site registers one (video.ice in its config) and answers however it likes —
 *                 a hosted relay with its own credential endpoint lives here, not in the kit.
 *
 * None is required. STUN alone is the default, and a site with none of this holds every call that
 * does not need relaying, which is most of them, and says plainly why it cannot hold the rest.
 * No provider is named in this file or in any variable it reads.
 */

const DEFAULT_STUN = 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean)

/* coturn's own scheme: a name that expires, and its HMAC. The person is in the name so a credential
   handed to one member is of no use to another once it is read off the wire. */
export async function hmacCredential(secret, person, ttlSeconds) {
  const expiry = Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds || 3600)
  const username = expiry + ':' + String(person || 'guest')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username))
  const credential = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return { username, credential, expiry }
}

/* what a browser is handed. `ice` is the site's own module when it registered one. */
export function iceServers({ env, ice }) {
  return async function serversFor(person, room, ttlSeconds = 3600) {
    const stun = list(env('WEBRTC_STUN') || DEFAULT_STUN).map((urls) => ({ urls }))

    if (typeof ice === 'function') {
      const own = await ice({ person, room, ttlSeconds, env })
      if (Array.isArray(own)) return { iceServers: own, relay: own.some((s) => /^turns?:/.test(String(s.urls || ''))), source: 'module' }
      if (own && Array.isArray(own.iceServers)) return { relay: true, source: 'module', ...own }
    }

    const urls = list(env('WEBRTC_TURN_URL'))
    if (!urls.length) return { iceServers: stun, relay: false, source: 'stun' }

    const secret = env('WEBRTC_TURN_SECRET')
    if (secret) {
      const { username, credential, expiry } = await hmacCredential(secret, person, ttlSeconds)
      return { iceServers: [...stun, { urls, username, credential }], relay: true, source: 'secret', expiry }
    }
    const username = env('WEBRTC_TURN_USERNAME')
    const credential = env('WEBRTC_TURN_PASSWORD')
    if (username && credential) return { iceServers: [...stun, { urls, username, credential }], relay: true, source: 'pair' }

    /* a url with no way to authorise against it is not a relay; say so rather than hand out half of one */
    return { iceServers: stun, relay: false, source: 'stun' }
  }
}
