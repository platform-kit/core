/*
 * SIGNING IN FROM ANOTHER APP — the whole security argument of this surface, kept as the Matrix
 * surface keeps its own (_shared/matrix/session.ts).
 *
 * Every network read and write ends at a policy that asks auth.uid(), so the service role reads
 * nothing of the network here: the only way to serve this surface is to BE the person. A session of
 * another app is therefore a token of OURS, opaque to the client, backed by a session the site's own
 * auth server issued — so a password change, a ban or a sign-out everywhere ends every app at once
 * without this surface being told anything.
 *
 * WHAT A MEMBER GIVES ANOTHER APP IS AN APP PASSWORD, never their own password: a secret made once on
 * their account page, shown once, kept only as a hash, and revoked there — which ends every session
 * made with it. The auth server's session behind it is made from a sign-in link the service role
 * mints for that member and redeems at once (nothing is sent anywhere): the service role vouches for
 * the app password having been right, and the auth server owns the session from then on.
 *
 * THE TOKENS ARE JWTs IN SHAPE ONLY. Bluesky's app reads a token's expiry, so each is a signed JWT
 * (scope, subject, audience, expiry) — but it is never trusted for what it claims: a token is its
 * hash in network_sessions, and a token not found there is no token at all.
 *
 * The service role is used for four things and no others: checking an app password, minting the
 * sign-in it redeems, reading the token table, and resolving whose handle is whose.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { admin } from '../lib.ts'

const URL_ = () => Deno.env.get('SUPABASE_URL') ?? ''
const ANON = () => Deno.env.get('SUPABASE_ANON_KEY') ?? ''

export const ACCESS_S = 2 * 3600
export const REFRESH_S = 90 * 86400
export const LOGIN_CAP = 10
export const LOGIN_WINDOW_S = 3600

const enc = new TextEncoder()
export async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uJson = (o: unknown) => b64u(enc.encode(JSON.stringify(o)))
const random = (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return b }

/* the key the tokens are signed with: derived from the service role key, so there is no second
   secret to hold — and a signature is only ever a check on top of the lookup, never instead of it */
let KEY: CryptoKey | null = null
async function key() {
  if (KEY) return KEY
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('atproto-session:' + (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')))
  KEY = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return KEY
}
async function jwt(claims: Record<string, unknown>) {
  const head = b64uJson({ alg: 'HS256', typ: 'at+jwt' })
  const body = b64uJson(claims)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(head + '.' + body)))
  return head + '.' + body + '.' + b64u(sig)
}
const now = () => Math.floor(Date.now() / 1000)

/* an app password, in the shape Bluesky's own are: four groups of four, letters and digits, easy to
   read off one screen and type into another */
export function newAppPassword() {
  const A = 'abcdefghijkmnpqrstuvwxyz23456789'
  const b = random(16)
  const s = [...b].map((x) => A[x % A.length]).join('')
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`
}

export async function loginAllowed(ip: string) {
  if (!ip) return { ok: true as const }
  const since = new Date(Date.now() - LOGIN_WINDOW_S * 1000).toISOString()
  const { count } = await admin.from('network_login_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('at', since)
  return (count ?? 0) >= LOGIN_CAP ? { ok: false as const, retryAfter: LOGIN_WINDOW_S } : { ok: true as const }
}
export const noteAttempt = (ip: string) => (ip ? admin.from('network_login_attempts').insert({ ip }) : Promise.resolve())

/* a client that acts AS the person, with the auth server's own access token */
const asPerson = (access: string) => createClient(URL_(), ANON(), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${access}` } },
})

/* THE AUTH SERVER'S SESSION for a member whose app password was right — a sign-in link minted and
   redeemed in one breath, sent nowhere */
async function gotrueSessionFor(userId: string) {
  const { data: u } = await admin.auth.admin.getUserById(userId)
  const email = u?.user?.email
  if (!email) return null
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const hashed = link.data?.properties?.hashed_token
  if (link.error || !hashed) return null
  const gate = createClient(URL_(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await gate.auth.verifyOtp({ type: 'magiclink', token_hash: hashed })
  if (error || !data?.session) return null
  return data.session
}

export type Identity = { userId: string; did: string; handle: string; email?: string | null }

/* the two tokens of a session, minted together and kept as their hashes */
async function mint(id: Identity, serviceDid: string) {
  const iat = now()
  const accessJwt = await jwt({ scope: 'com.atproto.appPass', sub: id.did, aud: serviceDid, iat, exp: iat + ACCESS_S, jti: b64u(random(12)) })
  const refreshJwt = await jwt({ scope: 'com.atproto.refresh', sub: id.did, aud: serviceDid, iat, exp: iat + REFRESH_S, jti: b64u(random(12)) })
  return { accessJwt, refreshJwt, accessHash: await sha256(accessJwt), refreshHash: await sha256(refreshJwt), accessExp: new Date((iat + ACCESS_S) * 1000).toISOString() }
}

/* SIGN IN: the member found by handle, DID or address; an app password of theirs that matches. */
export async function createSession(userId: string, password: string, id: Identity, serviceDid: string) {
  const hash = await sha256(String(password || '').trim().toLowerCase())
  const { data: pw } = await admin.from('network_app_passwords').select('id').eq('user_id', userId).eq('hash', hash).maybeSingle()
  if (!pw) return null
  const gs = await gotrueSessionFor(userId)
  if (!gs) return null
  const t = await mint(id, serviceDid)
  const { error } = await admin.from('network_sessions').insert({
    user_id: userId, app_password_id: pw.id, access_hash: t.accessHash, refresh_hash: t.refreshHash, access_expires_at: t.accessExp,
    gotrue_refresh: gs.refresh_token, gotrue_access: gs.access_token, gotrue_expires_at: new Date((gs.expires_at ?? now() + 3000) * 1000).toISOString(),
  })
  if (error) return null
  await admin.from('network_app_passwords').update({ last_used_at: new Date().toISOString() }).eq('id', pw.id)
  return { accessJwt: t.accessJwt, refreshJwt: t.refreshJwt }
}

export type Session = { userId: string; db: ReturnType<typeof createClient>; sessionId: string | null; kind: 'app' | 'site' }

/*
 * A REQUEST'S PERSON. A token of ours is looked up by its hash; the auth server's access token
 * behind it is reused while it is good and refreshed when it is not — and a refusal there means the
 * account ended it, so the row goes and the client is told to sign in again.
 *
 * The site's OWN session is accepted too, as the site's pages carry it: the account page makes and
 * revokes app passwords through the same methods another app would call, and a site session is the
 * person exactly as surely as an app's is.
 */
export async function sessionOf(token: string | null): Promise<Session | 'expired' | null> {
  if (!token) return null
  const hash = await sha256(token)
  const { data: row } = await admin.from('network_sessions').select('*').eq('access_hash', hash).maybeSingle()
  if (row) {
    if (new Date(row.access_expires_at).getTime() < Date.now()) return 'expired'
    let access = row.gotrue_access as string | null
    if (!access || !row.gotrue_expires_at || new Date(row.gotrue_expires_at).getTime() < Date.now() + 60_000) {
      const gate = createClient(URL_(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } })
      const { data, error } = await gate.auth.refreshSession({ refresh_token: row.gotrue_refresh })
      if (error || !data?.session) { await admin.from('network_sessions').delete().eq('id', row.id); return null }
      access = data.session.access_token
      await admin.from('network_sessions').update({
        gotrue_refresh: data.session.refresh_token, gotrue_access: access,
        gotrue_expires_at: new Date((data.session.expires_at ?? now() + 3000) * 1000).toISOString(), last_used_at: new Date().toISOString(),
      }).eq('id', row.id)
    }
    return { userId: row.user_id, db: asPerson(access!), sessionId: row.id, kind: 'app' }
  }
  /* not one of ours: the site's own session, or nothing */
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return null
  return { userId: data.user.id, db: asPerson(token), sessionId: null, kind: 'site' }
}

/* a refresh token traded for a new pair; the old pair is gone the moment the new one exists */
export async function refreshSession(token: string | null, id: (userId: string) => Promise<Identity | null>, serviceDid: string) {
  if (!token) return null
  const { data: row } = await admin.from('network_sessions').select('*').eq('refresh_hash', await sha256(token)).maybeSingle()
  if (!row) return null
  if (new Date(row.created_at).getTime() + REFRESH_S * 1000 < Date.now()) { await admin.from('network_sessions').delete().eq('id', row.id); return 'expired' as const }
  const who = await id(row.user_id)
  if (!who) return null
  const t = await mint(who, serviceDid)
  await admin.from('network_sessions').update({ access_hash: t.accessHash, refresh_hash: t.refreshHash, access_expires_at: t.accessExp, last_used_at: new Date().toISOString() }).eq('id', row.id)
  return { who, accessJwt: t.accessJwt, refreshJwt: t.refreshJwt }
}

/* sign out: the session goes, and the auth server's with it */
export async function deleteSession(token: string | null) {
  if (!token) return
  const h = await sha256(token)
  const { data: row } = await admin.from('network_sessions').select('id, gotrue_refresh').or(`refresh_hash.eq.${h},access_hash.eq.${h}`).maybeSingle()
  if (!row) return
  try {
    const gate = createClient(URL_(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data } = await gate.auth.refreshSession({ refresh_token: row.gotrue_refresh })
    if (data?.session) await asPerson(data.session.access_token).auth.signOut({ scope: 'local' })
  } catch { /* the auth server having forgotten it already is the outcome we wanted */ }
  await admin.from('network_sessions').delete().eq('id', row.id)
}

/* app passwords, made and revoked by the member themselves */
export async function makeAppPassword(userId: string, name: string) {
  const password = newAppPassword()
  const { data, error } = await admin.from('network_app_passwords')
    .insert({ user_id: userId, name: String(name || '').trim().slice(0, 60), hash: await sha256(password) })
    .select('name, created_at').single()
  if (error) return { error: /duplicate|unique/i.test(error.message) ? 'taken' : error.message }
  return { name: data.name, password, createdAt: data.created_at }
}
