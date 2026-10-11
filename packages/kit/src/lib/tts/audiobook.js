/*
 * A book being read aloud on this machine: the queue of chapters to make, the
 * worker that makes them, and what each one has become. Reactive, so the
 * reader's slot can show a chapter's state as it changes.
 *
 * A chapter's recording is named by the hash of its words (src/lib/speech.js,
 * the same name the build script gives it) and kept in the browser's cache
 * under that name, as an MP3, so a reopened chapter plays at once and a
 * chapter the script later records simply takes over the same key.
 *
 * The bucket the pregenerated recordings are served from is also where a
 * finished chapter goes: before a chapter is made here, the bucket is asked
 * for that name (a HEAD on its public url) — a chapter any reader has already
 * spoken plays at once, nowhere generated twice — and a chapter finished here
 * is uploaded there under the same name when the reader is signed in (the
 * bucket's policy lets a signed-in reader add a recording, never replace one),
 * with the engine and the format in the object's metadata, so the library's
 * recordings fill in as people read. The build script adopts what it finds
 * there into the store (build/tts.mjs), which is how those become the copy
 * of record.
 */
import { reactive } from 'vue'
import { ENGINE, hashInput } from '../speech.js'
import { supabase } from '../supabase.js'
import { session } from '../auth.js'

const BUCKET = 'audio'
const bucketUrl = (slug, hash) => (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1/object/public/' + BUCKET + '/books/' + slug + '/' + hash + '.mp3'
/* the script and the browser both write 128 kbps constant-rate mono, so a
   recording's length follows from its size closely enough for the player's
   label (the player measures the real one once it has the file) */
const KBPS = 128
const secondsOf = (bytes) => Math.round((bytes * 8) / (KBPS * 1000))

const AUDIO_CACHE = 'dl-audio'
const key = (hash) => '/__audio/' + hash + '.mp3'

export const status = reactive({ phase: 'idle', provider: null, download: { done: 0, total: 0 }, error: null, slug: null })
/* hash → { status: 'queued' | 'generating' | 'done' | 'failed', url, seconds, piece, pieces, title, error } */
export const tracks = reactive({})

/* the recording's name for a text: sha1 of the shared hash input, 16 hex */
export async function hashText(text) {
  const bytes = new TextEncoder().encode(hashInput(text))
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

const cacheOpen = () => (typeof caches !== 'undefined' ? caches.open(AUDIO_CACHE) : Promise.resolve(null))

/* Is this recording in the bucket already? Asked once per name; a hit becomes
   a done track served from the bucket's public url. */
const probed = {}
export function probe(slug, hash) {
  if (!hash || !slug) return Promise.resolve(false)
  if (tracks[hash] && tracks[hash].status === 'done') return Promise.resolve(true)
  if (!import.meta.env.VITE_SUPABASE_URL) return Promise.resolve(false)
  const k = slug + '/' + hash
  if (!probed[k]) probed[k] = fetch(bucketUrl(slug, hash), { method: 'HEAD', cache: 'no-store' }).then((r) => {
    if (!r.ok) return false
    if (!tracks[hash] || tracks[hash].status !== 'done') tracks[hash] = { ...(tracks[hash] || {}), status: 'done', url: bucketUrl(slug, hash), seconds: secondsOf(Number(r.headers.get('content-length')) || 0), remote: true }
    return true
  }).catch(() => false)
  return probed[k]
}

/* a finished chapter goes up to the bucket under its name, when the reader
   may write there: signed in, and the name not taken (never replaced) */
async function share(slug, hash, blob, seconds, format) {
  if (!supabase || !session.value || !slug) return false
  const { error } = await supabase.storage.from(BUCKET).upload('books/' + slug + '/' + hash + '.mp3', blob, {
    contentType: 'audio/mpeg', cacheControl: '31536000', upsert: false,
    metadata: { ...ENGINE, ...(format || {}), seconds, made: 'browser', provider: status.provider || null, at: new Date().toISOString() },
  })
  if (error) return false
  if (tracks[hash]) tracks[hash].shared = true
  return true
}

/* what this browser already has of a set of recordings */
export async function hydrate(hashes) {
  const cache = await cacheOpen()
  if (!cache) return
  for (const h of hashes) {
    if (tracks[h] && tracks[h].status === 'done') continue
    const hit = await cache.match(key(h))
    if (!hit) continue
    const blob = await hit.blob()
    tracks[h] = { status: 'done', url: URL.createObjectURL(blob), seconds: Number(hit.headers.get('x-seconds')) || 0, title: (tracks[h] || {}).title || '' }
  }
}

/* ---- the worker and the queue ---- */
let worker = null
const queue = reactive([])   /* [{ hash, text, title }] not yet sent; reactive so "n ahead" follows it */
let current = null      /* the job the worker has */
const jobs = {}         /* hash → job */

function boot() {
  if (worker) return worker
  worker = new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' })
  status.phase = 'downloading'
  worker.onmessage = async (e) => {
    const m = e.data || {}
    if (m.type === 'download') { status.phase = 'downloading'; status.download = { done: m.done, total: m.total } }
    else if (m.type === 'loading') status.phase = 'loading'
    else if (m.type === 'ready') { status.phase = 'ready'; status.provider = m.provider }
    else if (m.type === 'progress') { const t = tracks[m.id]; if (t) { t.status = 'generating'; t.piece = m.piece; t.pieces = m.pieces } }
    else if (m.type === 'done') {
      const cache = await cacheOpen()
      if (cache) await cache.put(key(m.id), new Response(m.blob, { headers: { 'content-type': 'audio/mpeg', 'x-seconds': String(m.seconds) } }))
      tracks[m.id] = { ...(tracks[m.id] || {}), status: 'done', url: URL.createObjectURL(m.blob), seconds: m.seconds }
      const j = jobs[m.id]
      current = null; pump()
      if (j) share(j.slug, m.id, m.blob, m.seconds, m.format).catch(() => {})
    }
    else if (m.type === 'error') {
      if (m.id) { const t = tracks[m.id]; if (t && t.status !== 'done') { t.status = m.message === 'cancelled' ? 'queued' : 'failed'; t.error = m.message } if (current === m.id) { current = null; pump() } }
      else { status.phase = 'failed'; status.error = m.message; for (const j of queue) if (tracks[j.hash]) tracks[j.hash].status = 'failed'; queue.splice(0) }
    }
  }
  worker.onerror = (e) => { status.phase = 'failed'; status.error = String(e.message || e) }
  worker.postMessage({ type: 'load' })
  return worker
}

async function pump() {
  if (current || !queue.length || !worker) return
  const job = queue.shift()
  current = job.hash
  /* the bucket first: a chapter another reader has spoken is not made again */
  if (await probe(job.slug, job.hash)) { current = null; return pump() }
  if (current !== job.hash || !worker) return
  tracks[job.hash] = { ...(tracks[job.hash] || {}), status: 'generating', piece: 0, pieces: 0, title: job.title }
  worker.postMessage({ type: 'speak', id: job.hash, text: job.text })
}

/* queue these chapters, in this order; ones already made are skipped */
export function start(slug, list) {
  status.slug = slug
  for (const j of list) {
    if (tracks[j.hash] && (tracks[j.hash].status === 'done' || tracks[j.hash].status === 'generating')) continue
    if (queue.some((q) => q.hash === j.hash)) continue
    const job = { ...j, slug }
    jobs[j.hash] = job
    tracks[j.hash] = { ...(tracks[j.hash] || {}), status: 'queued', title: j.title }
    queue.push(job)
  }
  boot()
  pump()
}

/* the chapter the reader is looking at goes next */
export function prioritise(hash) {
  const i = queue.findIndex((q) => q.hash === hash)
  if (i > 0) queue.unshift(...queue.splice(i, 1))
}

/* how many wait ahead of a chapter */
export function ahead(hash) { const i = queue.findIndex((q) => q.hash === hash); return i < 0 ? 0 : i + (current ? 1 : 0) }

/* leaving the book: stop everything and free the engine's memory */
export function stop() {
  queue.splice(0)
  if (worker) { if (current) worker.postMessage({ type: 'cancel', id: current }); worker.terminate(); worker = null }
  if (current && tracks[current] && tracks[current].status !== 'done') tracks[current].status = 'queued'
  current = null
  status.phase = 'idle'; status.slug = null; status.download = { done: 0, total: 0 }
}
