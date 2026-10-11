/*
 * The voice, off the page: one worker that fetches the weights (from the
 * browser's cache when they are there, src/lib/tts/weights.js), builds the
 * engine (src/lib/tts/engine.js — WebGPU when the browser has it, WebAssembly
 * when not or when WebGPU cannot run these graphs), and speaks one chapter at
 * a time into an MP3 (src/lib/tts/mp3.js), reporting as it goes.
 *
 *   in:  { type: 'load' }
 *        { type: 'speak', id, text, live?, engine: { steps, opening, speed, gap, first } }
 *        { type: 'cancel', id }
 *   out: { type: 'download', file, done, total }   bytes, per file
 *        { type: 'loading' }                        sessions being built
 *        { type: 'ready', provider }                'webgpu' | 'wasm'
 *        { type: 'progress', id, piece, pieces }
 *        { type: 'piece', id, i, pcm, rate }        live only — audio, as it is made
 *        { type: 'done', id, blob, seconds, format }
 *        { type: 'error', id?, message }
 *
 * LIVE IS THE WHOLE DIFFERENCE BETWEEN A CHAPTER AND A CONVERSATION. A chapter is made and then
 * played, so one message at the end is right. A conversation is waited for, and `done` at the
 * end meant the first word was heard only once the LAST was made — measured at 3.7 seconds of
 * silence for a four-sentence answer. With `live`, each piece is posted the moment it exists and
 * the page plays it while the next is still being made; the mp3 is still assembled and still
 * arrives as `done`, so nothing that caches recordings changes.
 *
 * The engine holds about a gigabyte; the page terminates the worker when the
 * reader leaves the book.
 */
import { fetchWeight, BROWSER_FILES } from './weights.js'
import { ENGINE } from '../speech.js'
import { talkPieces, stepsFor, TALK } from '../copilot/chunk.js'
import { OWN_VOICES, OWN_DEFAULT } from '../copilot/prefs.js'
import { Mp3Writer, KBPS } from './mp3.js'
import wasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

let engine = null, provider = null, loading = null
/*
 * THE VOICES, FETCHED AS THEY ARE ASKED FOR. Supertonic ships ten styles and each is 290 KB
 * beside a 400 MB model, so there is no reason to download the other nine until somebody picks
 * one — and every reason not to, since most readers never will. They are cached like any other
 * weight, so a reader who has chosen one pays for it once.
 */
const styles = {}
let loadingStyle = null
async function styleFor(name) {
  const want = OWN_VOICES.includes(name) ? name : OWN_DEFAULT
  if (styles[want]) return styles[want]
  const E = await import('./engine.js')
  /* one at a time: two turns asking for the same new voice at once would fetch it twice */
  loadingStyle = (loadingStyle || Promise.resolve()).then(async () => {
    if (styles[want]) return
    const bytes = await fetchWeight('voice_styles/' + want + '.json')
    styles[want] = E.loadVoiceStyle(JSON.parse(new TextDecoder().decode(bytes)))
  })
  await loadingStyle
  return styles[want] || styles[OWN_DEFAULT]
}
let cancelId = null
const post = (m, transfer) => self.postMessage(m, transfer || [])

async function build() {
  const E = await import('./engine.js')
  const ort = E.ort
  ort.env.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl }
  /* threads need cross-origin isolation; without it one thread, which the
     measurements on the machine say costs little for this engine */
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1

  const got = {}
  let doneBytes = 0
  const totals = {}
  for (const f of BROWSER_FILES) {
    let last = 0
    got[f] = await fetchWeight(f, (file, done, total) => {
      totals[file] = total; doneBytes += done - last; last = done
      post({ type: 'download', file, done: doneBytes, total: Object.values(totals).reduce((a, b) => a + b, 0) })
    })
  }
  post({ type: 'loading' })
  const text = new TextDecoder()
  const cfgs = JSON.parse(text.decode(got['onnx/tts.json']))
  const indexer = JSON.parse(text.decode(got['onnx/unicode_indexer.json']))
  styles[OWN_DEFAULT] = E.loadVoiceStyle(JSON.parse(text.decode(got['voice_styles/' + OWN_DEFAULT + '.json'])))
  const buffers = { dp: got['onnx/duration_predictor.onnx'], textEnc: got['onnx/text_encoder.onnx'], vectorEst: got['onnx/vector_estimator.onnx'], vocoder: got['onnx/vocoder.onnx'] }

  /* WebGPU first, when there is one; a smoke run proves it can carry these
     graphs, and anything thrown drops to WebAssembly */
  const tries = (typeof navigator !== 'undefined' && navigator.gpu) ? [['webgpu'], ['wasm']] : [['wasm']]
  let lastErr = null
  for (const providers of tries) {
    let tts = null
    try {
      tts = await E.loadTextToSpeech({ buffers, cfgs, indexer, providers })
      await tts.call('Hello.', 'en', styles[OWN_DEFAULT], 1, 1.0, 0, async () => {})
      engine = tts; provider = providers[0]
      break
    } catch (e) {
      lastErr = e
      if (tts) for (const s of [tts.dpOrt, tts.textEncOrt, tts.vectorEstOrt, tts.vocoderOrt]) { try { await s.release() } catch { /* gone */ } }
    }
  }
  for (const k of Object.keys(got)) got[k] = null
  if (!engine) throw lastErr || new Error('no runtime could load the voice')
  post({ type: 'ready', provider })
}

function load() { if (!loading) loading = build().catch((e) => { loading = null; throw e }); return loading }

async function speak({ id, text, live, engine: settings }) {
  await load()
  /* a chapter's defaults, or a conversation's — they differ in pace and in what the opening
     piece is worth spending, and TALK says why */
  const D = live ? { ...ENGINE, ...TALK } : ENGINE
  const settingsOr = (k) => (settings && settings[k] !== undefined ? settings[k] : D[k])
  const steps = settingsOr('steps'), speed = settingsOr('speed'), gap = settingsOr('gap')
  /* only the opening piece is ever waited for, so only the opening piece is worth making cheaply */
  const opening = live ? settingsOr('opening') : steps
  const first = settingsOr('first')
  /* the reader's own choices: which of the ten voices, and what language the model is told it is
     reading — neither is the site's business and both are checked before they reach the engine */
  const style = await styleFor(settings && settings.voice)
  const lang = (settings && settings.lang) || 'en'
  const writer = new Mp3Writer(engine.sampleRate)
  let n = 0, samples = 0
  const cancelled = () => cancelId === id
  const r = await engine.call(text, lang, style, steps, speed, gap, async (i, pieces, wav, seconds) => {
    /* whole pieces, a pause between: nothing trimmed, as in build/tts/worker.mjs */
    if (i) { writer.writeSilence(gap); samples += Math.floor(gap * engine.sampleRate) }
    writer.write(wav)
    samples += wav.length; n = pieces
    post({ type: 'progress', id, piece: i + 1, pieces })
    if (live) {
      /* a copy, because the writer keeps the original and the buffer is transferred away */
      const pcm = new Float32Array(wav.length + (i ? Math.floor(gap * engine.sampleRate) : 0))
      pcm.set(wav, pcm.length - wav.length)
      post({ type: 'piece', id, i, pcm, rate: engine.sampleRate }, [pcm.buffer])
    }
  }, cancelled, live ? { cut: (t) => talkPieces(t, { first }), stepsAt: (i) => stepsFor(i, { steps, opening }) } : {})
  if (r.cancelled) { post({ type: 'error', id, message: 'cancelled' }); return }
  const blob = writer.finish()
  post({ type: 'done', id, blob, seconds: Math.round(samples / engine.sampleRate), pieces: n, format: { codec: 'mp3', bitrate: KBPS * 1000, sampleRate: engine.sampleRate, channels: 1 } })
}

let chain = Promise.resolve()
self.onmessage = (e) => {
  const m = e.data || {}
  if (m.type === 'load') { load().catch((err) => post({ type: 'error', message: String(err && err.message || err) })); return }
  if (m.type === 'cancel') { cancelId = m.id; return }
  if (m.type === 'speak') chain = chain.then(() => speak(m)).catch((err) => post({ type: 'error', id: m.id, message: String(err && err.message || err) }))
}
