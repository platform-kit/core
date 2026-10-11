/*
 * THE SESSION, WHICH IS THE WHOLE SECURITY ARGUMENT OF THIS SURFACE.
 *
 * Every community read is a SECURITY DEFINER function ending at `can_read_channel`, which asks
 * `auth.uid()`. There are eighty-five such checks in the spaces schema. So the service role reads
 * NOTHING here: `auth.uid()` is null for it and the gate answers false. A function holding the
 * service key cannot over-read this data by accident — it can only fail. The one way to serve
 * Matrix is to genuinely be the person.
 *
 * So a Matrix access token is a token of OURS, opaque to the client, backed by a session GoTrue
 * issued. `/login` verifies the password through GoTrue and keeps the refresh token; each request
 * exchanges it for a short-lived access token and builds a client carrying it. `auth.uid()` is
 * then the person and every guard applies with nothing re-implemented.
 *
 * WHY NOT MINT OUR OWN JWT. It is the obvious shortcut — sign `{sub, role}` with the project
 * secret and skip all of this. Rejected for three reasons, and they are worth keeping written
 * down because the shortcut will look attractive again to whoever reads this next:
 *
 *   1. There is no such secret in this project, so it would be a new one to hold and rotate.
 *   2. A function that can sign a session can forge ANY identity. A token table is a smaller
 *      thing to protect than that.
 *   3. A minted token outlives the account's own decisions. A password change, a ban, a
 *      sign-out-everywhere would not touch it, so revocation would become THIS surface's problem
 *      to reimplement — the same mistake as reimplementing the read rules.
 *
 * Keeping GoTrue's session inverts all three. Ending the session ends every Matrix client of that
 * person without this surface being told anything.
 *
 * The service role is used for two things and no others: checking a password, and reading the
 * token table. Never for community data.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { admin } from '../lib.ts'

const URL = () => Deno.env.get('SUPABASE_URL') ?? ''
const ANON = () => Deno.env.get('SUPABASE_ANON_KEY') ?? ''

export async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export const newToken = () => {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/* HOW MANY WRONG PASSWORDS AN ADDRESS MAY TRY IN AN HOUR. The Matrix door takes a password from
   anybody who can reach it, which our own sign-in does not do in quite the same way, so it is
   capped as the support desk caps its anonymous door. GoTrue has its own throttling underneath;
   this is ours, and it is the one that can say so in Matrix's error shape. */
export const LOGIN_CAP = 10
export const LOGIN_WINDOW_S = 3600

export async function loginAllowed(ip: string) {
  if (!ip) return { ok: true as const }
  const since = new Date(Date.now() - LOGIN_WINDOW_S * 1000).toISOString()
  const { count } = await admin.from('matrix_login_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('at', since)
  if ((count ?? 0) >= LOGIN_CAP) return { ok: false as const, retryAfter: LOGIN_WINDOW_S }
  return { ok: true as const }
}
export const noteAttempt = (ip: string) => (ip ? admin.from('matrix_login_attempts').insert({ ip }) : Promise.resolve())

/*
 * SIGN IN. The password goes to GoTrue and nowhere else: we never see it again, never keep it,
 * and never compare it ourselves.
 */
export async function login(email: string, password: string, device: { id: string; name?: string }) {
  const gate = createClient(URL(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await gate.auth.signInWithPassword({ email, password })
  if (error || !data?.session || !data?.user) return null

  const token = newToken()
  const { error: kept } = await admin.from('matrix_sessions').insert({
    user_id: data.user.id,
    token_hash: await sha256(token),
    device_id: device.id,
    device_name: device.name ?? null,
    refresh_token: data.session.refresh_token,
  })
  if (kept) return null
  return { token, user: data.user, device: device.id, access: data.session.access_token }
}

/*
 * A REQUEST'S PERSON, and a client that acts AS them.
 *
 * The row is claimed under a lock (`matrix_session_claim`, `for update`), because two requests
 * from the same client arriving together would otherwise both take the same refresh token to
 * GoTrue and the second would be refused — signing somebody out in the middle of using the app.
 *
 * A refusal here is never "something went wrong": GoTrue declining the refresh token means the
 * session is over — the password changed, the account was banned, they signed out everywhere —
 * so the row goes and the client is told to sign in again.
 */
export type Session = { userId: string; device: string; db: ReturnType<typeof createClient> }

export async function sessionOf(token: string | null): Promise<Session | null> {
  if (!token) return null
  const hash = await sha256(token)
  const { data: rows, error } = await admin.rpc('matrix_session_claim', { p_hash: hash })
  const row = Array.isArray(rows) ? rows[0] : rows
  if (error || !row) return null

  const gate = createClient(URL(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error: refused } = await gate.auth.refreshSession({ refresh_token: row.refresh_token })
  if (refused || !data?.session) {
    /* the account ended it. Ours goes too, so the next request says "sign in again" rather than
       trying the same dead token for ever. */
    await admin.from('matrix_sessions').delete().eq('id', row.id)
    return null
  }
  /* the rotated token, kept while the row is still locked by this transaction */
  await admin.from('matrix_sessions').update({ refresh_token: data.session.refresh_token, last_used_at: new Date().toISOString() }).eq('id', row.id)

  /* THE CLIENT THAT IS THEM. Every read and write of community data goes through this one, so
     auth.uid() is the person and the guards they meet in a browser are the guards they meet here. */
  const db = createClient(URL(), ANON(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  })
  return { userId: row.user_id, device: row.device_id, db }
}

/* SIGN OUT. Ours goes, and GoTrue's with it — a token left alive on the auth server after the
   client believes it is signed out is the kind of thing nobody notices until it matters. */
export async function logout(token: string | null) {
  if (!token) return
  const hash = await sha256(token)
  const { data: row } = await admin.from('matrix_sessions').select('id, refresh_token').eq('token_hash', hash).maybeSingle()
  if (!row) return
  try {
    const gate = createClient(URL(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data } = await gate.auth.refreshSession({ refresh_token: row.refresh_token })
    if (data?.session) {
      const as = createClient(URL(), ANON(), { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } })
      await as.auth.signOut()
    }
  } catch { /* the auth server having already forgotten it is the outcome we wanted */ }
  await admin.from('matrix_sessions').delete().eq('id', row.id)
}

/* every device of one person, for /devices and for a sign-out-everywhere of our own */
export const devicesOf = (userId: string) =>
  admin.from('matrix_sessions').select('id, device_id, device_name, created_at, last_used_at').eq('user_id', userId)
