/*
 * The voice's weights, for the browser: which files, from where, and a cache.
 *
 * The same Supertonic 3 files the build script fetches (build/tts/setup.mjs;
 * REPO, REV and BROWSER_FILES are repeated here because that module is
 * node-only, and build/speech.test.mjs keeps the two in step). Hugging Face
 * first, at the pinned revision; our own `models` bucket when a file does not
 * come from there. Every file lands in the Cache API under a name that carries
 * the revision, so a browser downloads the ~400 MB once and a new revision is a
 * new cache. Nothing here creates a session or a worker: fetching is all the
 * pre-warm does, and the engine is built only when a chapter asks for it.
 */
export const REPO = 'supertone-oss-archive/supertonic-3'
export const REV = 'aafc6e32416a594460b32413efc49d7fe4ce6d46'
export const BROWSER_FILES = ['onnx/duration_predictor.onnx', 'onnx/text_encoder.onnx', 'onnx/vector_estimator.onnx', 'onnx/vocoder.onnx', 'onnx/tts.json', 'onnx/unicode_indexer.json', 'voice_styles/M5.json']
/* rough sizes, for progress before a server says content-length (bytes) */
export const SIZES = { 'onnx/duration_predictor.onnx': 3.9e6, 'onnx/text_encoder.onnx': 38.2e6, 'onnx/vector_estimator.onnx': 269e6, 'onnx/vocoder.onnx': 106.3e6, 'onnx/tts.json': 8e3, 'onnx/unicode_indexer.json': 278e3, 'voice_styles/M5.json': 290e3 }
export const TOTAL_BYTES = Object.values(SIZES).reduce((a, b) => a + b, 0)

export const MODEL_CACHE = 'dl-tts-model-' + REV.slice(0, 12)
const KEY = (file) => '/__tts/' + REV + '/' + file
export const hfUrl = (file) => `https://huggingface.co/${REPO}/resolve/${REV}/${file}`
export const bucketUrl = (file) => String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1/object/public/models/supertonic-3/' + REV + '/' + file

const cacheOpen = () => (typeof caches !== 'undefined' ? caches.open(MODEL_CACHE) : Promise.resolve(null))

/* read a response's body, reporting bytes as they come */
async function readAll(res, file, onProgress) {
  const total = Number(res.headers.get('content-length')) || SIZES[file] || 0
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value); got += value.byteLength
    onProgress(file, got, total)
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

/* one file, as bytes: from the cache, else fetched (Hugging Face, then the bucket) and cached */
export async function fetchWeight(file, onProgress) {
  const cache = await cacheOpen()
  if (cache) {
    const hit = await cache.match(KEY(file))
    if (hit) { const buf = new Uint8Array(await hit.arrayBuffer()); if (onProgress) onProgress(file, buf.byteLength, buf.byteLength); return buf }
  }
  let last = null
  for (const url of [hfUrl(file), bucketUrl(file)]) {
    if (!/^https?:\/\//.test(url)) continue
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok || res.type === 'opaque') throw new Error(url + ' → ' + res.status)
      const buf = await readAll(res, file, onProgress)
      if (cache) await cache.put(KEY(file), new Response(buf, { headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'x-source': url.includes('huggingface') ? 'hf' : 'bucket' } }))
      return buf
    } catch (e) { last = e }
  }
  throw last || new Error('no source for ' + file)
}

/* are all the files already in this browser? */
export async function weightsCached() {
  const cache = await cacheOpen()
  if (!cache) return false
  for (const f of BROWSER_FILES) if (!(await cache.match(KEY(f)))) return false
  return true
}

/* the pre-warm: fill the cache, smallest files first so an interrupted tab keeps
   something; never when the browser says it has no room. One run per page. */
let warming = null
export function prefetchWeights(onProgress) {
  if (!warming) warming = (async () => {
    if (await weightsCached()) return true
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { quota = 0, usage = 0 } = await navigator.storage.estimate()
        if (quota && quota - usage < 600e6) return false
      }
    } catch { /* no estimate: try anyway */ }
    const order = BROWSER_FILES.slice().sort((a, b) => (SIZES[a] || 0) - (SIZES[b] || 0))
    for (const f of order) await fetchWeight(f, onProgress)
    return true
  })().catch(() => { warming = null; return false })
  return warming
}
