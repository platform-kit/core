/*
 * Who is asking: the key on the request (a bearer, or ?access_token=) looked up by its sha256 in api_keys — its kind
 * (delivery, preview, management), whether it may read gated content, whether it is revoked — one indexed read per
 * request, so a revoked key is refused from that moment; its last use stamped at most once a minute; no key is a public delivery read where the site leaves
 * Delivery public, else AccessTokenInvalid. A Contentful client always sends a token: on a public site a token that is
 * not one of the site's keys (they begin pk_) reads as the public does, while a revoked key of the site's is refused. The rate limit beside it: Contentful's numbers per key or address.
 * The other doors (the Forms API, the Scheduling API) ask `keyOf(token, kinds)`: a live key of one of those kinds, or
 * null — never a public reading, whatever `api.public` says; a key of another kind is told apart (`'other-kind'`) so
 * the door can say FORBIDDEN rather than unauthenticated.
 */
import { admin } from '../lib.ts'
import { PUBLIC } from './flags.ts'

export type Kind = 'delivery' | 'preview' | 'management' | 'forms' | 'scheduling' | 'storefront' | 'support' | 'matrix'
export type Caller = { kind: Kind; gated: boolean; id: string | null; token: string | null }
const CONTENT_KINDS: Kind[] = ['delivery', 'preview', 'management']
const touched = new Map<string, number>()

export async function sha256(s: string) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('') }

export function tokenOf(req: Request, q: Record<string, string>) {
  const h = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  return h || (q.access_token ?? '').trim() || null
}

/* the caller for a token, or null for a token that is not a live key; public delivery for no token where allowed */
export async function callerOf(token: string | null): Promise<Caller | null | 'public-denied'> {
  if (!token) return PUBLIC ? { kind: 'delivery', gated: false, id: null, token: null } : 'public-denied'
  if (PUBLIC && !token.startsWith('pk_')) return { kind: 'delivery', gated: false, id: null, token: null }
  const hash = await sha256(token)
  const { data } = await admin.from('api_keys').select('id, kind, gated, revoked_at').eq('hash', hash).maybeSingle()
  const caller: Caller | null = data && !data.revoked_at && CONTENT_KINDS.includes(data.kind) ? { kind: data.kind, gated: !!data.gated, id: data.id, token } : null
  touch(caller)
  return caller
}
function touch(caller: Caller | null) { if (caller && caller.id && (touched.get(caller.id) ?? 0) < Date.now() - 60_000) { touched.set(caller.id, Date.now()); admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', caller.id).then(() => {}, () => {}) } }

/* a door's own key: a live key of one of `kinds`, null for none or a dead one, 'other-kind' for a live key of another door */
export async function keyOf(token: string | null, kinds: Kind[]): Promise<Caller | null | 'other-kind'> {
  if (!token) return null
  const { data } = await admin.from('api_keys').select('id, kind, gated, revoked_at').eq('hash', await sha256(token)).maybeSingle()
  if (!data || data.revoked_at) return null
  if (!kinds.includes(data.kind)) return 'other-kind'
  const caller: Caller = { kind: data.kind, gated: !!data.gated, id: data.id, token }
  touch(caller)
  return caller
}

/* Contentful's rate limit: 78 a second, 36 000 an hour, per key or address, in this instance's memory */
const SEC = 78, HOUR = 36_000

/*
 * THE COUNTER IS THE DATABASE'S, because an isolate's memory is not shared.
 *
 * This was a Map in module scope. A Map lives in ONE isolate, and the edge runtime runs as many
 * as it likes — so the door promised 78 requests a second in its own headers while actually
 * allowing 78 times however many workers were up. It was not a limit; it was a limit-shaped
 * object, and it held only by accident on a quiet machine with one worker. The test that covered
 * it passed for that reason rather than the right one, and started failing the moment another
 * lane ran first and left the runtime warm enough to scale.
 *
 * `api_rate_take` increments both windows and returns the new counts in one statement, so two
 * requests cannot both read 77 and both write 78. The cost is a round trip on a door that is
 * already reading the database; the benefit is that the number in the header is true.
 *
 * A database that refuses the call FAILS OPEN — the request is served and the headers say the
 * allowance is full. A rate limiter that took the site down when it could not count would be a
 * worse outage than the one it exists to prevent.
 */
export async function rateLimit(who: string) {
  let sec = 1, hr = 1
  try {
    const { data, error } = await admin.rpc('api_rate_take', { p_who: who || 'anon' })
    const row = Array.isArray(data) ? data[0] : data
    if (!error && row) { sec = Number(row.sec) || 1; hr = Number(row.hr) || 1 }
  } catch { /* fail open: see above */ }
  const over = sec > SEC || hr > HOUR
  /* how long until the window this call fell foul of turns over */
  const reset = sec > SEC ? 1 : hr > HOUR ? Math.ceil((3_600_000 - (Date.now() % 3_600_000)) / 1000) : 0
  return {
    over,
    reset,
    headers: {
      'X-Contentful-RateLimit-Hour-Limit': String(HOUR),
      'X-Contentful-RateLimit-Hour-Remaining': String(Math.max(0, HOUR - hr)),
      'X-Contentful-RateLimit-Second-Limit': String(SEC),
      'X-Contentful-RateLimit-Second-Remaining': String(Math.max(0, SEC - sec)),
      'X-Contentful-RateLimit-Reset': String(reset),
    },
  }
}
