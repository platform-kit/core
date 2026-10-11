#!/usr/bin/env node
/*
 * Fetch the Supertonic 3 weights (Supertone, OpenRAIL-M; the project is archived
 * and the weights are pinned to the archive's final revision) into
 * build/tts/models/supertonic-3 — about 380 MB, once. build/tts.mjs runs on
 * them with onnxruntime-node on the CPU; no Python, no GPU. Idempotent: a file
 * already present at the right size is left alone.
 *
 * The reader's in-browser engine (src/lib/tts/) fetches the same files at the
 * same revision, from Hugging Face first and from our own `models` bucket when
 * that fails. `node build/tts/setup.mjs --mirror` puts the browser's files in
 * that bucket (once; a file already there is left alone); build/deploy.mjs runs
 * it after the spoken books. src/lib/tts/weights.js repeats REPO, REV and
 * BROWSER_FILES (it cannot import a node module) and build/speech.test.mjs
 * checks the two agree.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MODELS = path.join(HERE, 'models', 'supertonic-3')
export const REPO = 'supertone-oss-archive/supertonic-3'
export const REV = 'aafc6e32416a594460b32413efc49d7fe4ce6d46'
/* what the browser needs: the four models, their config and indexer, one voice */
export const BROWSER_FILES = ['onnx/duration_predictor.onnx', 'onnx/text_encoder.onnx', 'onnx/vector_estimator.onnx', 'onnx/vocoder.onnx', 'onnx/tts.json', 'onnx/unicode_indexer.json', 'voice_styles/M5.json']
const FILES = ['LICENSE', 'config.json',
  'onnx/duration_predictor.onnx', 'onnx/text_encoder.onnx', 'onnx/vector_estimator.onnx', 'onnx/vocoder.onnx', 'onnx/tts.json', 'onnx/unicode_indexer.json',
  ...['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'].map((v) => 'voice_styles/' + v + '.json')]

export function ready() { return FILES.every((f) => fs.existsSync(path.join(MODELS, f))) }

export async function setup() {
  fs.mkdirSync(MODELS, { recursive: true })
  for (const f of FILES) {
    const out = path.join(MODELS, f)
    const url = `https://huggingface.co/${REPO}/resolve/${REV}/${f}`
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    const size = Number(head.headers.get('content-length') || 0)
    if (fs.existsSync(out) && size && fs.statSync(out).size === size) continue
    process.stdout.write(`[tts] ${f} (${size ? (size / 1048576).toFixed(1) + ' MB' : '?'}) … `)
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok) throw new Error(url + ' → ' + r.status)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()))
    process.stdout.write('ok\n')
  }
  console.log('[tts] weights in ' + MODELS)
}

/* the browser's files into the `models` bucket, under the revision, where they
   are not yet: the fallback the reader turns to when Hugging Face does not answer.
   A hosted plan's file-size cap can refuse the largest one; that is reported,
   not fatal, since Hugging Face stays the first source. */
export async function mirror() {
  const { bucket, listAll, supabaseUrl } = await import('./storage.mjs')
  const st = await bucket('models')
  const prefix = 'supertonic-3/' + REV
  const have = new Set()
  for (const dir of ['onnx', 'voice_styles']) for (const n of await listAll(st, prefix + '/' + dir)) have.add(dir + '/' + n)
  let up = 0, skipped = 0
  for (const f of BROWSER_FILES) {
    if (have.has(f)) continue
    const local = path.join(MODELS, f)
    if (!fs.existsSync(local)) throw new Error(f + ' is not fetched yet: run node build/tts/setup.mjs first')
    const type = f.endsWith('.json') ? 'application/json' : 'application/octet-stream'
    const { error } = await st.upload(prefix + '/' + f, fs.readFileSync(local), { contentType: type, upsert: false, cacheControl: '31536000' })
    if (error) { skipped++; console.log(`[tts] ${f}: not mirrored — ${error.message}`); continue }
    up++
  }
  console.log(`[tts] models bucket at ${supabaseUrl()}: ${up} uploaded, ${BROWSER_FILES.length - up - skipped} already there${skipped ? ', ' + skipped + ' refused' : ''}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const job = process.argv.includes('--mirror') ? mirror : setup
  job().catch((e) => { console.error('[tts] ' + (e.message || e)); process.exit(1) })
}
