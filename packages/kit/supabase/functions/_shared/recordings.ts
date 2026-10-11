/*
 * A call's recording, ours (session-recordings): pulled from cal.com the moment it is ready and kept in the private
 * `recordings` bucket under the booking's uid — never a cal.com link in a browser. `pull(uid)` asks cal.com's API for
 * the booking's recordings (a fresh link every time), streams the newest into `<uid>/recording.mp4` and the transcript
 * beside it — the response body piped straight into the storage API's upload, a chunk at a time, so an edge function
 * never holds a 600 MB file — and writes the paths and the time onto the row. A pull that cannot land leaves the row
 * `pending` with the reason and a try counted; the ten-minute cron asks again until TRIES (a day), then `failed`.
 * A booking on another provider (nothing to pull) is left clean. `retain(days)` removes files older than the policy's
 * keep and says so on the row.
 */
import { admin } from './lib.ts'
import { recordingsOf, transcriptsOf } from './cal.ts'

export const BUCKET = 'recordings'
export const TRIES = 144   /* ten-minute runs for a day */
const TIMEOUT_MS = 240000

type Row = { uid: string; recording_state: string | null; recording_tries: number; end_at: string | null; recording_path: string | null; transcript_path: string | null }

/* the storage API's plain upload, streamed: the body is the origin's own stream, never read into memory */
async function streamToBucket(path: string, url: string, fallbackType: string) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const src = await fetch(url, { signal: ctl.signal })
    if (!src.ok || !src.body) throw new Error(`the origin answered ${src.status}`)
    const type = src.headers.get('content-type')?.split(';')[0] || fallbackType
    const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': type, 'x-upsert': 'true', ...(src.headers.get('content-length') ? { 'Content-Length': src.headers.get('content-length')! } : {}) },
      body: src.body, signal: ctl.signal,
      // @ts-ignore: a streamed request body needs the duplex hint
      duplex: 'half',
    })
    if (!up.ok) { const t = await up.text().catch(() => ''); throw new Error(`the bucket refused (${up.status}): ${t.slice(0, 200)}`) }
    return { type, size: Number(src.headers.get('content-length') ?? 0) || null }
  } finally { clearTimeout(timer) }
}

export type PullResult = { uid: string; state: 'pulled' | 'pending' | 'failed' | 'nothing'; error?: string }
/* the links to pull from: cal.com's API by default; a source given by the service bearer (a test's local server,
   an administrator's own link) stands in for the API's answer */
export type Source = { recording?: string | null; transcript?: string | null; transcriptFormat?: string }

/* one booking: ask, stream, write; on a miss count the try and say why */
export async function pull(uid: string, opts: { force?: boolean; source?: Source; api?: string } = {}): Promise<PullResult> {
  const { data: row } = await admin.from('bookings').select('uid, recording_state, recording_tries, end_at, recording_path, transcript_path').eq('uid', uid).maybeSingle()
  if (!row) return { uid, state: 'failed', error: 'no such booking' }
  const r = row as Row
  const tries = opts.force ? 0 : r.recording_tries
  try {
    const recs = opts.source ? (opts.source.recording ? [{ id: 'given', url: opts.source.recording, startTs: Date.now(), duration: 0, status: 'finished' }] : []) : await recordingsOf(uid, opts.api)
    if (!recs.length) {
      /* nothing there yet: pending while it may still come; nothing at all for a call on another provider or one long past */
      const old = r.end_at && Date.now() - Date.parse(r.end_at) > 86400e3
      if (old || tries + 1 >= TRIES) { await admin.from('bookings').update({ recording_state: old && !r.recording_state ? null : 'failed', recording_error: 'cal.com has no recording for this call', recording_tries: tries + 1 }).eq('uid', uid); return { uid, state: old && !r.recording_state ? 'nothing' : 'failed', error: 'no recording' } }
      await admin.from('bookings').update({ recording_state: 'pending', recording_error: 'not ready yet', recording_tries: tries + 1 }).eq('uid', uid)
      return { uid, state: 'pending', error: 'not ready yet' }
    }
    const rec = [...recs].sort((a, b) => b.startTs - a.startTs)[0]
    const recPath = `${uid}/recording.mp4`
    await streamToBucket(recPath, rec.url, 'video/mp4')
    let transcriptPath: string | null = null
    try {
      const ts = opts.source ? (opts.source.transcript ? [{ format: opts.source.transcriptFormat ?? 'vtt', url: opts.source.transcript }] : []) : await transcriptsOf(uid, opts.api)
      const kind = (x: { format: string; url: string }) => (x.format || (x.url.match(/\.(vtt|srt|json|txt)(\?|$)/i) || [])[1] || '').toLowerCase()
      const t = ts.find((x) => kind(x).includes('vtt')) ?? ts[0]
      if (t) { const k = kind(t); transcriptPath = `${uid}/transcript.${k.includes('json') ? 'json' : k.includes('srt') ? 'srt' : k.includes('txt') ? 'txt' : 'vtt'}`; await streamToBucket(transcriptPath, t.url, 'text/vtt') }
    } catch { /* a transcript is a bonus; the recording stands without it */ }
    await admin.from('bookings').update({ recording_path: recPath, transcript_path: transcriptPath, recording_at: new Date().toISOString(), recording_state: null, recording_error: null, recording_tries: 0 }).eq('uid', uid)
    return { uid, state: 'pulled' }
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 300)
    const failed = tries + 1 >= TRIES
    await admin.from('bookings').update({ recording_state: failed ? 'failed' : 'pending', recording_error: error, recording_tries: tries + 1 }).eq('uid', uid)
    return { uid, state: failed ? 'failed' : 'pending', error }
  }
}

/* every pending row under the cap, oldest first */
export async function pullPending(limit = 20): Promise<PullResult[]> {
  const { data } = await admin.from('bookings').select('uid').eq('recording_state', 'pending').lt('recording_tries', TRIES).order('updated_at', { ascending: true }).limit(limit)
  const out: PullResult[] = []
  for (const r of data ?? []) out.push(await pull((r as any).uid))
  return out
}

/* the keep: files older than `days` removed, the row saying so; 0 keeps forever */
export async function retain(days: number): Promise<{ removed: number }> {
  if (!days || days <= 0) return { removed: 0 }
  const before = new Date(Date.now() - days * 86400e3).toISOString()
  const { data: old } = await admin.from('bookings').select('uid, recording_path, transcript_path').not('recording_path', 'is', null).lt('recording_at', before)
  let removed = 0
  for (const r of old ?? []) {
    const paths = [(r as any).recording_path, (r as any).transcript_path].filter(Boolean) as string[]
    const { error } = await admin.storage.from(BUCKET).remove(paths)
    if (error) continue
    await admin.from('bookings').update({ recording_path: null, transcript_path: null, recording_state: 'removed', recording_error: String(days) }).eq('uid', (r as any).uid)
    removed++
  }
  return { removed }
}
