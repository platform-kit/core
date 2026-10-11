/*
 * One Supertonic 3 engine, loaded once, speaking one job at a time. build/tts.mjs
 * runs a few of these in parallel and hands each a chapter as a JSON line on
 * stdin; the answer is one JSON line on stdout:
 *
 *   in   {"id": "…", "text": "…", "out": "/path/chapter.wav"}
 *   out  {"id": "…", "ok": true, "seconds": 812.4} | {"id": "…", "ok": false, "error": "…"}
 *
 * The engine (vendored from the archived supertone-oss-archive/supertonic Node
 * example, MIT) cuts the text at sentence ends into pieces of at most 300
 * characters, speaks each, and joins them with a short breath — so a whole
 * chapter goes in and one WAV comes out. Pure CPU through onnxruntime-node.
 */
import path from 'node:path'
import readline from 'node:readline'
import * as ort from 'onnxruntime-node'
import { MODELS } from './setup.mjs'

/* How many threads this engine may use inside a model run (TTS_THREADS). The
   runtime's default is every core, which is right for one engine and wrong
   for several side by side; the driver sizes engines × threads to the machine.
   The vendored engine builds its sessions with the runtime's defaults, so the
   one setting is applied here, before it loads. */
const THREADS = Math.max(1, Number(process.env.TTS_THREADS || 0))
if (process.env.TTS_THREADS) {
  const create = ort.InferenceSession.create.bind(ort.InferenceSession)
  ort.InferenceSession.create = (p, opts) => create(p, { ...(opts || {}), intraOpNumThreads: THREADS, interOpNumThreads: 1 })
}
const { loadTextToSpeech, loadVoiceStyle, writeWavFile, chunkText } = await import('./supertonic/helper.js')

const VOICE = process.env.TTS_VOICE || 'M5'
const STEPS = Number(process.env.TTS_STEPS || 8)       /* denoising steps: 8 is the engine's default, 10 a touch cleaner */
const SPEED = Number(process.env.TTS_SPEED || 1.0)     /* the engine's own default is 1.05; a book reads a shade slower */
const GAP = Number(process.env.TTS_GAP || 0.45)        /* seconds between pieces */

const say = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const tts = await loadTextToSpeech(path.join(MODELS, 'onnx'), false)
const style = loadVoiceStyle([path.join(MODELS, 'voice_styles', VOICE + '.json')], false)
say({ ready: true, voice: VOICE, steps: STEPS, speed: SPEED, sampleRate: tts.sampleRate })

const rl = readline.createInterface({ input: process.stdin })
for await (const line of rl) {
  if (!line.trim()) continue
  let job; try { job = JSON.parse(line) } catch { continue }
  try {
    const t = Date.now()
    /* The pieces are joined here, whole, with GAP of quiet between — the same
       join the reader's in-browser engine makes (src/lib/tts/tts.worker.js).
       Nothing is trimmed: the model speaks in blocks of about 70 ms, so a piece
       ends up to one block past the length it predicted, and cutting it back
       (as the engine's own call() does to the whole, which took the sum of
       every block off the END of a long chapter) can clip a final consonant.
       The remainder is quiet inside the pause. */
    const lang = job.lang || 'en'
    const pieces = chunkText(job.text, (lang === 'ko' || lang === 'ja') ? 120 : 300)
    const parts = []
    for (let i = 0; i < pieces.length; i++) {
      const { wav } = await tts._infer([pieces[i]], [lang], style, STEPS, SPEED)
      if (i) parts.push(new Float32Array(Math.floor(GAP * tts.sampleRate)))
      parts.push(Float32Array.from(wav))
    }
    const total = parts.reduce((n, p) => n + p.length, 0)
    const joined = new Float32Array(total)
    let at = 0; for (const p of parts) { joined.set(p, at); at += p.length }
    writeWavFile(job.out, joined, tts.sampleRate)
    const seconds = total / tts.sampleRate
    say({ id: job.id, ok: true, seconds: Math.round(seconds * 10) / 10, took: Math.round((Date.now() - t) / 1000) })
  } catch (e) { say({ id: job.id, ok: false, error: String(e && e.message || e) }) }
}
