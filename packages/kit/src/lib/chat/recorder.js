/*
 * A voice note, spoken into the microphone and encoded as it goes: the mic
 * stream → an AudioContext → a ScriptProcessorNode handing over Float32 pieces
 * → the same Mp3Writer the in-browser voice uses (mono, 128 kbps, the
 * context's own sample rate — 48 kHz on most machines, which the encoder takes
 * natively). Nothing is trimmed: the file holds every sample the mic gave.
 * A ScriptProcessorNode rather than a worklet because it is universal (Safari,
 * iOS) and a voice note is a minute or two, not a chapter.
 *
 * `level` is the last forty loudness readings, for the live bars; `seconds` the
 * running length. stop() closes everything and gives { blob, seconds }.
 */
import { reactive } from 'vue'
import { Mp3Writer } from '../tts/mp3.js'

/* Is there a usable microphone? The same four checks the instrument's voice
   makes (engine/voice.js), kept here so the chat does not pull the instrument
   in: the API, a secure origin, the frame's permission, an input device. */
export function micUsable() {
  if (!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices && navigator.mediaDevices.getUserMedia)) return Promise.resolve(false)
  if (window.isSecureContext === false) return Promise.resolve(false)
  try { const fp = document.permissionsPolicy || document.featurePolicy; if (fp && fp.allowsFeature && !fp.allowsFeature('microphone')) return Promise.resolve(false) } catch (e) { /* no policy api */ }
  return navigator.mediaDevices.enumerateDevices().then((list) => list.some((d) => d.kind === 'audioinput')).catch(() => false)
}

const BARS = 40
const BUFFER = 4096

export function createRecorder() {
  const state = reactive({ recording: false, seconds: 0, level: new Array(BARS).fill(0), error: null })
  let stream = null, ctx = null, src = null, proc = null, writer = null, samples = 0, tick = null, silent = null

  async function start() {
    if (state.recording) return
    state.error = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch (e) { state.error = (e && e.name) || 'failed'; throw e }
    const AC = window.AudioContext || window.webkitAudioContext
    ctx = new AC()
    if (ctx.state === 'suspended') { try { await ctx.resume() } catch (e) { /* will resume on gesture */ } }
    writer = new Mp3Writer(ctx.sampleRate)
    samples = 0
    src = ctx.createMediaStreamSource(stream)
    proc = ctx.createScriptProcessor(BUFFER, 1, 1)
    proc.onaudioprocess = (e) => {
      const buf = e.inputBuffer.getChannelData(0)
      writer.write(buf)
      samples += buf.length
      let sum = 0
      for (let i = 0; i < buf.length; i += 4) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / (buf.length / 4))
      const lvl = Math.min(1, rms * 6)
      state.level = state.level.slice(1).concat([lvl])
      state.seconds = samples / ctx.sampleRate
    }
    src.connect(proc)
    /* a processor only runs when it leads somewhere; a silent gain keeps the
       speakers quiet */
    silent = ctx.createGain(); silent.gain.value = 0
    proc.connect(silent); silent.connect(ctx.destination)
    state.recording = true
    state.seconds = 0
    state.level = new Array(BARS).fill(0)
  }

  function teardown() {
    try { if (proc) { proc.onaudioprocess = null; proc.disconnect() } } catch (e) { /* gone */ }
    try { if (src) src.disconnect() } catch (e) { /* gone */ }
    try { if (silent) silent.disconnect() } catch (e) { /* gone */ }
    try { if (stream) stream.getTracks().forEach((t) => t.stop()) } catch (e) { /* gone */ }
    try { if (ctx && ctx.close) ctx.close() } catch (e) { /* gone */ }
    clearInterval(tick)
    stream = ctx = src = proc = silent = null
    state.recording = false
  }

  /* the file, and its length as the samples it holds */
  function stop() {
    if (!state.recording) return null
    const rate = ctx.sampleRate
    teardown()
    const blob = writer.finish()
    writer = null
    const seconds = Math.round((samples / rate) * 10) / 10
    return { blob, seconds }
  }

  function cancel() { teardown(); writer = null; samples = 0; state.seconds = 0 }

  return { state, start, stop, cancel }
}
