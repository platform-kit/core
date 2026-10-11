/*
 * Supertonic 3 in the browser: the same engine build/tts/supertonic/helper.js
 * runs on the machine (Supertone's own Node example, MIT — see that folder's
 * LICENSE), carried over to onnxruntime-web with the parts that touched files
 * replaced: the config, the character indexer and the voice arrive as parsed
 * JSON, the four models as bytes, and the audio comes back piece by piece as
 * Float32Array rather than one file. The maths, the text preprocessing, the
 * chunking and the step loop are the Node example's, so a chapter spoken here
 * is the chapter the script would speak.
 *
 * Worker-only: onnxruntime-web is imported here, and nothing on the page
 * should ever load it.
 */
import * as ort from 'onnxruntime-web'

const AVAILABLE_LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi', 'na']

/* ---- text → character ids (verbatim from the Node example) ---- */
class UnicodeProcessor {
  constructor(indexer) { this.indexer = indexer }

  _preprocessText(text, lang) {
    text = text.normalize('NFKD')
    const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu
    text = text.replace(emojiPattern, '')
    const replacements = { '–': '-', '‑': '-', '—': '-', '_': ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ' }
    for (const [k, v] of Object.entries(replacements)) text = text.replaceAll(k, v)
    text = text.replace(/[♥☆♡©\\]/g, '')
    const exprReplacements = { '@': ' at ', 'e.g.,': 'for example, ', 'i.e.,': 'that is, ' }
    for (const [k, v] of Object.entries(exprReplacements)) text = text.replaceAll(k, v)
    text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!').replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':').replace(/ '/g, "'")
    while (text.includes('""')) text = text.replace('""', '"')
    while (text.includes("''")) text = text.replace("''", "'")
    while (text.includes('``')) text = text.replace('``', '`')
    text = text.replace(/\s+/g, ' ').trim()
    if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) text += '.'
    if (!AVAILABLE_LANGS.includes(lang)) throw new Error(`Invalid language: ${lang}`)
    return `<${lang}>` + text + `</${lang}>`
  }

  /* ids and mask for one text: [1, T] int64 and [1, 1, T] float32 */
  call(text, lang) {
    const processed = this._preprocessText(text, lang)
    const chars = Array.from(processed)
    const T = chars.length
    const ids = new BigInt64Array(T)
    for (let j = 0; j < T; j++) ids[j] = BigInt(this.indexer[chars[j].charCodeAt(0)] || 0)
    const mask = new Float32Array(T).fill(1)
    return { ids, mask, T }
  }
}

class Style { constructor(ttl, dp) { this.ttl = ttl; this.dp = dp } }

/* a voice, from its parsed style JSON */
export function loadVoiceStyle(style) {
  const ttlDims = style.style_ttl.dims, dpDims = style.style_dp.dims
  const ttl = new ort.Tensor('float32', Float32Array.from(style.style_ttl.data.flat(Infinity)), [1, ttlDims[1], ttlDims[2]])
  const dp = new ort.Tensor('float32', Float32Array.from(style.style_dp.data.flat(Infinity)), [1, dpDims[1], dpDims[2]])
  return new Style(ttl, dp)
}

/* ---- the engine ---- */
export class TextToSpeech {
  constructor(cfgs, textProcessor, dpOrt, textEncOrt, vectorEstOrt, vocoderOrt) {
    this.cfgs = cfgs; this.textProcessor = textProcessor
    this.dpOrt = dpOrt; this.textEncOrt = textEncOrt; this.vectorEstOrt = vectorEstOrt; this.vocoderOrt = vocoderOrt
    this.sampleRate = cfgs.ae.sample_rate
    this.baseChunkSize = cfgs.ae.base_chunk_size
    this.chunkCompressFactor = cfgs.ttl.chunk_compress_factor
    this.ldim = cfgs.ttl.latent_dim
  }

  /* Gaussian noise the shape of the latent, masked to the predicted length —
     the Node example's sampleNoisyLatent, on flat typed arrays */
  sampleNoisyLatent(duration) {
    const wavLen = Math.floor(duration * this.sampleRate)
    const chunkSize = this.baseChunkSize * this.chunkCompressFactor
    const latentLen = Math.floor((wavLen + chunkSize - 1) / chunkSize)
    const latentDim = this.ldim * this.chunkCompressFactor
    const latentSize = this.baseChunkSize * this.chunkCompressFactor
    const validLen = Math.floor((wavLen + latentSize - 1) / latentSize)
    const mask = new Float32Array(latentLen)
    for (let t = 0; t < latentLen; t++) mask[t] = t < validLen ? 1 : 0
    const noisy = new Float32Array(latentDim * latentLen)
    for (let d = 0; d < latentDim; d++) for (let t = 0; t < latentLen; t++) {
      const u1 = Math.max(1e-10, Math.random()), u2 = Math.random()
      noisy[d * latentLen + t] = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * mask[t]
    }
    return { noisy, mask, latentDim, latentLen }
  }

  /* one piece: the Node example's _infer for a batch of one */
  async _infer(text, lang, style, totalStep, speed) {
    const { ids, mask, T } = this.textProcessor.call(text, lang)
    const textIds = new ort.Tensor('int64', ids, [1, T])
    const textMask = new ort.Tensor('float32', mask, [1, 1, T])
    const dp = await this.dpOrt.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask })
    const duration = Number(dp.duration.data[0]) / speed
    const enc = await this.textEncOrt.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask })
    const textEmb = enc.text_emb
    let { noisy, mask: lmask, latentDim, latentLen } = this.sampleNoisyLatent(duration)
    const latentMask = new ort.Tensor('float32', lmask, [1, 1, latentLen])
    const totalStepT = new ort.Tensor('float32', Float32Array.of(totalStep), [1])
    for (let step = 0; step < totalStep; step++) {
      const r = await this.vectorEstOrt.run({
        noisy_latent: new ort.Tensor('float32', noisy, [1, latentDim, latentLen]),
        text_emb: textEmb, style_ttl: style.ttl, text_mask: textMask, latent_mask: latentMask,
        total_step: totalStepT, current_step: new ort.Tensor('float32', Float32Array.of(step), [1]),
      })
      noisy = Float32Array.from(r.denoised_latent.data)
    }
    const voc = await this.vocoderOrt.run({ latent: new ort.Tensor('float32', noisy, [1, latentDim, latentLen]) })
    return { wav: Float32Array.from(voc.wav_tts.data), duration }
  }

  /* the whole text: cut at sentence ends as the Node example cuts it, each
     piece spoken whole and handed to onPiece(i, n, wav, seconds); the caller
     joins them with silenceDuration of quiet between */
  /*
   * `cut` precuts the text and `stepsAt(i)` sets the solver's steps for each piece, so a
   * conversation can make its OPENING piece short and cheap — the only piece anybody waits for —
   * while a chapter keeps one setting throughout. Both default to what the chapter did.
   */
  async call(text, lang, style, totalStep, speed, silenceDuration, onPiece, cancelled, { cut = null, stepsAt = null } = {}) {
    const maxLen = (lang === 'ko' || lang === 'ja') ? 120 : 300
    const pieces = cut ? cut(text, maxLen) : chunkText(text, maxLen)
    let total = 0
    for (let i = 0; i < pieces.length; i++) {
      if (cancelled && cancelled()) return { pieces: pieces.length, duration: total, cancelled: true }
      const { wav, duration } = await this._infer(pieces[i], lang, style, stepsAt ? stepsAt(i) : totalStep, speed)
      total += duration + (i ? silenceDuration : 0)
      await onPiece(i, pieces.length, wav, duration)
    }
    return { pieces: pieces.length, duration: total }
  }
}

/* the four models from their bytes, on the given providers */
export async function loadTextToSpeech({ buffers, cfgs, indexer, providers }) {
  const opts = { executionProviders: providers, graphOptimizationLevel: 'all' }
  const make = (b) => ort.InferenceSession.create(b, opts)
  const [dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = await Promise.all([make(buffers.dp), make(buffers.textEnc), make(buffers.vectorEst), make(buffers.vocoder)])
  return new TextToSpeech(cfgs, new UnicodeProcessor(indexer), dpOrt, textEncOrt, vectorEstOrt, vocoderOrt)
}

/* the Node example's chunkText, verbatim */
export function chunkText(text, maxLen = 300) {
  const paragraphs = text.trim().split(/\n\s*\n+/).filter((p) => p.trim())
  const chunks = []
  for (let paragraph of paragraphs) {
    paragraph = paragraph.trim()
    if (!paragraph) continue
    const sentences = paragraph.split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/)
    let current = ''
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= maxLen) current += (current ? ' ' : '') + sentence
      else { if (current) chunks.push(current.trim()); current = sentence }
    }
    if (current) chunks.push(current.trim())
  }
  return chunks
}

export { ort }
