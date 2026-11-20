/*
 * A RUN, RECORDED (openspec: recorded-rounds).
 *
 * One recording per run of the question runner, from before its first screen to after its last, marked at every screen
 * with when it was shown and when it was answered. One recording rather than one per statement because the timing IS
 * the measurement: a recorder started at each statement would put its own few hundred milliseconds into the very
 * pause a shadow is read from, and cut off the first word of every answer.
 *
 * H.264 (with AAC sound), or AAC alone for a voice recording, in a FRAGMENTED MP4 through mediabunny — the same file
 * in every browser. A fragmented MP4 is only ever appended to, so each chunk mediabunny hands over is uploaded as the
 * next part the moment it exists, and the parts in order ARE the file: a closed tab loses the last seconds, not the run.
 * Where the browser can encode no AAC of its own, mediabunny's AAC encoder stands in. Mediabunny is imported only when
 * somebody chooses to record, so nobody else downloads it.
 *
 * The row (run_recordings) is the person's own; the bucket (run-recordings) holds <user>/<recording>/<nnnn>.mp4.
 */
import { ref } from 'vue'
import { supabase } from './supabase.js'
import { user } from './auth.js'
import { us } from './strings.js'

export type RecordKind = 'voice' | 'video'
export type Keep = { days: number, afterMembership: number | null } | null
export interface RecordPlan { kind: RecordKind, source: 'instrument' | 'form', ref: string, responseId?: string | null, staffRead?: boolean, keep?: Keep }
export interface Mark { id: string, shown_ms: number | null, answered_ms: number | null }

const BUCKET = 'run-recordings'
const PART_BYTES = 2 ** 20            /* about eight seconds of 640×480 at a megabit */
const VIDEO = { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' }

const mb = () => import('mediabunny')
const pad = (n: number) => String(n).padStart(4, '0')
const extOf = (kind: RecordKind) => (kind === 'video' ? 'mp4' : 'm4a')
const mimeOf = (kind: RecordKind) => (kind === 'video' ? 'video/mp4' : 'audio/mp4')

/* can this browser record this kind at all: H.264 for video (the one format we keep), and a microphone either way */
export async function canRecord(kind: RecordKind): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof (globalThis as any).VideoEncoder === 'undefined' && kind === 'video') return false
  try { const M = await mb(); return kind === 'video' ? await M.canEncodeVideo('avc') : true } catch { return false }
}

export function createRunRecorder(plan: RecordPlan) {
  const recording = ref(false)
  const failed = ref('')
  let output: any = null, stream: MediaStream | null = null
  let id = '', uid = '', t0 = 0, parts = 0, bytes = 0
  let queue: Promise<unknown> = Promise.resolve()
  const marks: Mark[] = []

  const save = (patch: Record<string, unknown>) => supabase.from('run_recordings').update(patch).eq('id', id)

  /* a part, uploaded in turn; three tries with a growing wait, and the row says how far it got (with the marks so far) */
  function upload(data: Uint8Array) {
    const n = parts++
    const blob = new Blob([data], { type: mimeOf(plan.kind) })
    queue = queue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.storage.from(BUCKET).upload(`${uid}/${id}/${pad(n)}.${extOf(plan.kind)}`, blob, { contentType: mimeOf(plan.kind), upsert: true })
        if (!error) { bytes += data.byteLength; await save({ parts: n + 1, bytes, marks }); return }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      }
      failed.value = 'upload'
    })
  }

  async function start(): Promise<boolean> {
    uid = user.value?.id || ''
    if (!uid) { failed.value = 'signin'; return false }
    try {
      stream = await navigator.mediaDevices.getUserMedia(plan.kind === 'video' ? { video: VIDEO, audio: true } : { audio: true })
    } catch (e) { console.warn('recording: no device', e); failed.value = 'denied'; return false }
    try {
      const M = await mb()
      if (!(await M.canEncodeAudio('aac'))) { const { registerAacEncoder } = await import('@mediabunny/aac-encoder'); registerAacEncoder() }
      id = crypto.randomUUID()
      const { error } = await supabase.from('run_recordings').insert({
        id, user_id: uid, source: plan.source, ref: plan.ref, response_id: plan.responseId ?? null, kind: plan.kind, mime: mimeOf(plan.kind),
        staff_read: plan.source === 'form' && !!plan.staffRead, keep_days: plan.keep?.days ?? null, keep_after_membership: plan.keep?.afterMembership ?? null,
      })
      if (error) throw error
      const writable = new WritableStream({ write: (chunk: { data: Uint8Array }) => upload(chunk.data) })
      output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'fragmented' }), target: new M.StreamTarget(writable, { chunked: true, chunkSize: PART_BYTES }) })
      const v = stream.getVideoTracks()[0], a = stream.getAudioTracks()[0]
      if (plan.kind === 'video' && v) output.addVideoTrack(new M.MediaStreamVideoTrackSource(v, { codec: 'avc', bitrate: 1e6 }))
      if (a) output.addAudioTrack(new M.MediaStreamAudioTrackSource(a, { codec: 'aac', bitrate: 96e3 }))
      await output.start()
      t0 = performance.now()
      recording.value = true
      return true
    } catch (e) {
      console.warn('recording: could not start', e)
      failed.value = 'start'
      stream?.getTracks().forEach((t) => t.stop())
      if (id) await supabase.from('run_recordings').delete().eq('id', id)
      return false
    }
  }

  /* when a screen was shown or answered, from the recording's start; nothing waits on it */
  function mark(screen: string, at: 'shown' | 'answered') {
    if (!recording.value || !screen) return
    const ms = Math.round(performance.now() - t0)
    let m = marks.find((x) => x.id === screen)
    if (!m) { m = { id: screen, shown_ms: null, answered_ms: null }; marks.push(m) }
    if (at === 'shown' && m.shown_ms == null) m.shown_ms = ms
    if (at === 'answered') m.answered_ms = ms
  }

  async function finish(): Promise<void> {
    if (!recording.value) return
    recording.value = false
    const duration = Math.round(performance.now() - t0)
    try { await output.finalize() } catch { /* what arrived is kept */ }
    stream?.getTracks().forEach((t) => t.stop())
    await queue
    await save({ ended_at: new Date().toISOString(), duration_ms: duration, marks, parts, bytes, status: failed.value === 'upload' ? 'partial' : 'complete' })
  }

  return { start, mark, finish, recording, failed, get id() { return id } }
}

/* ---- watching back ---- */

export interface RecordingRow { id: string, source: string, ref: string, kind: RecordKind, mime: string, started_at: string, ended_at: string | null, duration_ms: number | null, parts: number, marks: Mark[], status: string }

/* the person's own recordings, newest first; one left mid-way more than an hour ago is closed as partial */
export async function myRecordings(source?: string): Promise<RecordingRow[]> {
  let q = supabase.from('run_recordings').select('id, source, ref, kind, mime, started_at, ended_at, duration_ms, parts, marks, status').order('started_at', { ascending: false })
  if (source) q = q.eq('source', source)
  const { data } = await q
  const rows = (data || []) as RecordingRow[]
  const stale = rows.filter((r) => r.status === 'recording' && Date.parse(r.started_at) < Date.now() - 3600e3)
  if (stale.length) { await supabase.from('run_recordings').update({ status: 'partial' }).in('id', stale.map((r) => r.id)); stale.forEach((r) => { r.status = 'partial' }) }
  return rows
}

/* the parts, in order, joined into one playable file */
export async function recordingUrl(rec: RecordingRow, owner: string): Promise<string> {
  const prefix = `${owner}/${rec.id}`
  const { data: files } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  const names = (files || []).map((f: any) => f.name).sort()
  if (!names.length) return ''
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(names.map((n: string) => `${prefix}/${n}`), 3600)
  const blobs = await Promise.all((signed || []).map((s: any) => fetch(s.signedUrl).then((r) => r.blob())))
  return URL.createObjectURL(new Blob(blobs, { type: rec.mime }))
}

/* a recording gone: its files, then its row (the row's trigger queues the folder too, for anything left) */
export async function deleteRecording(rec: { id: string }, owner: string): Promise<void> {
  const prefix = `${owner}/${rec.id}`
  const { data: files } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000 })
  if (files && files.length) await supabase.storage.from(BUCKET).remove(files.map((f: any) => `${prefix}/${f.name}`))
  await supabase.from('run_recordings').delete().eq('id', rec.id)
}

/* the "record yourself?" question as an ordinary choice screen, offering only the kinds this browser can record */
export async function recordChoiceScreen(kinds: RecordKind[], words?: Record<string, string>): Promise<any | null> {
  const ok: RecordKind[] = []
  for (const k of kinds) if (await canRecord(k)) ok.push(k)
  if (!ok.length) return null
  const W = { ...(((us('recording').page || {}).main) || {}), ...(words || {}) }
  return { id: 'rec:choice', kind: 'choice', headline: W['choice-title'], sub: W['choice-body'],
    options: [{ v: 'none', label: W.none }, ...ok.map((k) => ({ v: k, label: W[k] }))], meta: { step: 'record' } }
}
