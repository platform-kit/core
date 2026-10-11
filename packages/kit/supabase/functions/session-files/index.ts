/*
 * A call's recording, watched (session-files): POST { uid } behind the reader's JWT → the recording's and the
 * transcript's urls, signed for an hour. The booking is read through the caller's own client, so the bookings
 * select policy — the attendee, the coach, any address on the row, an administrator — is the whole check: a row
 * that does not come back is a 403. An administrator's recording url is also download-named; a member streams.
 * The urls are answered as paths (the function's own host is the stack's inner one locally); the client puts the
 * public address in front, as it does for book-files. Nothing here is public, and no browser is ever sent to cal.com.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isProvider } from '../_shared/roles.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { BUCKET } from '../_shared/recordings.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const user = await getUser(req); if (!user) return json({ error: 'sign in' }, 401)
  let body: any = {}
  try { body = await req.json() } catch { body = {} }
  const uid = String(body?.uid ?? ''); if (!uid) return json({ error: 'uid' }, 400)
  /* the row as the caller may see it */
  const mine = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: row } = await mine.from('bookings').select('uid, recording_path, transcript_path, recording_state, recording_error, recording_at').eq('uid', uid).maybeSingle()
  if (!row) return json({ error: 'not yours' }, 403)
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const isAdmin = isProvider(await rolesOf(user.id))
  const path = (u: string | null | undefined) => (u ? u.replace(/^https?:\/\/[^/]+/, '') : null)
  const out: Record<string, unknown> = { uid, state: row.recording_state, error: row.recording_error, at: row.recording_at, recording: null, transcript: null }
  if (row.recording_path) {
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(row.recording_path, 3600, isAdmin ? { download: `${uid}.mp4` } : undefined)
    out.recording = path(data?.signedUrl)
    if (isAdmin) { const { data: play } = await admin.storage.from(BUCKET).createSignedUrl(row.recording_path, 3600); out.play = path(play?.signedUrl) }
  }
  if (row.transcript_path) { const { data } = await admin.storage.from(BUCKET).createSignedUrl(row.transcript_path, 3600); out.transcript = path(data?.signedUrl) }
  return json(out)
})
