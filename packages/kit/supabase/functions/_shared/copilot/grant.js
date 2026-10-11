/*
 * WHAT A SPOKEN CONVERSATION MAY DO, AND FOR HOW LONG.
 *
 * The thing that listens runs OUTSIDE this deployment — a worker on somebody else's machine, in a
 * room with a person's microphone. It must be able to reach exactly one bot, for exactly one
 * person, for a few minutes, and nothing else. So it is not given a session: it is given a GRANT.
 *
 * Not the person's JWT, which is the thing not to hand a third-party process: a JWT is every door
 * that person can open, for as long as it lives. A grant is one door and a short clock, so a
 * worker that leaks one leaks that and no more.
 *
 * It is SIGNED rather than looked up because the endpoint verifies it on every turn, and a lookup
 * per turn is a round trip in the middle of somebody speaking. HMAC over the service role key, the
 * same way the unsubscribe link derives its own — one secret the deployment already has.
 *
 * Pure: no imports, no environment, Web Crypto only, so the function (Deno), the worker (Node) and
 * the kit's tests all read the same arithmetic.
 */

const enc = new TextEncoder()

/* base64url without padding — a grant travels in a header and in a job's metadata */
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const key = (secret) => crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

/*
 * WHAT IS IN IT, and nothing else: the bot, who it answers for, the room, the ceilings it may not
 * exceed, and when it dies. The ceilings are IN the grant rather than looked up, so a worker cannot
 * ask for a larger one — it can only present what it was given.
 */
export async function sign(claims, secret) {
  const body = {
    b: String(claims.bot || ''),
    s: String(claims.subject || ''),
    r: String(claims.room || ''),
    m: Number(claims.minutes || 0),
    c: Number(claims.cents || 0),
    e: {
      m: String(claims.ending?.minutes || '').slice(0, 500),
      c: String(claims.ending?.spend || '').slice(0, 500),
    },
    x: Number(claims.expires || 0),
  }
  if (!body.b || !body.s || !body.x) throw new Error('a grant names a bot, a subject and an expiry')
  const payload = b64u(enc.encode(JSON.stringify(body)))
  const mac = b64u(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)))
  return payload + '.' + mac
}

/*
 * The claims, or an error naming WHICH check failed — a worker that cannot start should be able to
 * say why without anybody reading a log. `now` is injectable so the clock is testable.
 */
export async function open(token, secret, now = Date.now()) {
  const parts = String(token || '').split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { error: 'malformed' }
  let ok = false
  try { ok = await crypto.subtle.verify('HMAC', await key(secret), unb64u(parts[1]), enc.encode(parts[0])) }
  catch { return { error: 'malformed' } }
  /* a bad signature and a tampered field give the same answer on purpose: saying which was wrong
     tells somebody trying things which half to keep */
  if (!ok) return { error: 'signature' }
  let b
  try { b = JSON.parse(new TextDecoder().decode(unb64u(parts[0]))) } catch { return { error: 'malformed' } }
  if (!b || !b.b || !b.s || !b.x) return { error: 'malformed' }
  if (Number(b.x) <= now) return { error: 'expired' }
  return {
    bot: b.b,
    subject: b.s,
    room: b.r || '',
    minutes: Number(b.m) || 0,
    cents: Number(b.c) || 0,
    ending: {
      minutes: typeof b.e?.m === 'string' ? b.e.m.slice(0, 500) : '',
      spend: typeof b.e?.c === 'string' ? b.e.c.slice(0, 500) : '',
    },
    expires: Number(b.x),
  }
}

/* long enough for a conversation, short enough that a leaked one is stale before it is useful */
export const GRANT_MINUTES = 30
export const grantExpiry = (now = Date.now(), minutes = GRANT_MINUTES) => now + minutes * 60_000
