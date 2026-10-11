/*
 * PLAYING WHAT THE ASSISTANT SAYS, AS IT ARRIVES.
 *
 * The seam hands over bytes while they are still being made; something has to turn them into
 * sound without waiting for the end, or the streaming above it bought nothing. That is this.
 *
 * TWO KINDS COME IN and both leave as one thing:
 *   PCM     raw frames from a speech endpoint (16-bit, mono). Queued straight into the graph as
 *           they land, which is why PCM is asked for rather than mp3 — compressed audio needs a
 *           decode per chunk or MediaSource, and neither starts sooner.
 *   a BLOB  the kit's own engine answers with a finished mp3 per utterance, decoded once.
 *
 * IT ALSO MEASURES ITSELF. The visualizer has to answer to the assistant's voice, not only the
 * person's — which of the two is live is the turn-taking made visible — so everything played here
 * goes through an analyser on the way out, and `level()` is what the orb draws from.
 *
 * AND IT ACTUALLY REACHES THE SPEAKERS. The chain is source → analyser → destination, always. An
 * analyser connected to nothing measures the reply perfectly and silently, which is the one fault
 * no test catches and only ears do.
 */

const FRAME = 2       /* bytes per sample, 16-bit */

export function player(ctx, { rate = 24000 } = {}) {
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.2
  const gain = ctx.createGain()
  /* source → analyser → destination. Never analyser alone. */
  gain.connect(analyser)
  analyser.connect(ctx.destination)
  const wave = new Uint8Array(analyser.fftSize)

  let at = 0            /* when the next chunk should start, in context time */
  let live = []         /* what is scheduled, so an interruption can silence it */
  let tail = null       /* a half sample carried between chunks */

  const start = () => { const now = ctx.currentTime + 0.06; if (at < now) at = now; return at }

  function schedule(buffer) {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(gain)
    const when = start()
    src.start(when)
    at = when + buffer.duration
    live.push(src)
    src.onended = () => { live = live.filter((s) => s !== src) }
  }

  return {
    /* a chunk of raw PCM, which may arrive split mid-sample */
    write(bytes) {
      if (!bytes || !bytes.length) return
      let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      if (tail) { const j = new Uint8Array(tail.length + u8.length); j.set(tail); j.set(u8, tail.length); u8 = j; tail = null }
      const whole = Math.floor(u8.length / FRAME) * FRAME
      if (whole < u8.length) tail = u8.slice(whole)
      if (!whole) return
      const view = new DataView(u8.buffer, u8.byteOffset, whole)
      const buffer = ctx.createBuffer(1, whole / FRAME, rate)
      const ch = buffer.getChannelData(0)
      for (let i = 0; i < ch.length; i++) ch[i] = view.getInt16(i * FRAME, true) / 32768
      schedule(buffer)
    },

    /*
     * A PIECE THE KIT'S OWN ENGINE HAS JUST MADE — float samples at its own rate, queued like
     * any other. No encode and no decode: the engine's mp3 exists for the recording cache, and
     * putting the live path through it would add an encoder delay and a frame of padding per
     * piece for no reason at all.
     */
    frames(pcm, rate) {
      if (!pcm || !pcm.length) return
      const buffer = ctx.createBuffer(1, pcm.length, rate || ctx.sampleRate)
      buffer.getChannelData(0).set(pcm)
      schedule(buffer)
      return buffer.duration
    },

    /* the kit's own engine answers with one finished mp3 per utterance */
    async play(blob) {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
      schedule(buf)
      return buf.duration
    },

    /*
     * WHAT THE ORB DRAWS FROM — and, more than that, the one answer to "is the assistant audible
     * right now", which the page uses to decide whether to trust the microphone.
     *
     * THE SCHEDULE IS THE TRUTH, NOT THE ANALYSER. Asked after the last source has finished, an
     * analyser with nothing playing into it does not fall to zero: measured, it sat at 0.29 and
     * crawled to 0.20 over two seconds and never arrived. Two things follow from believing it.
     * The orb goes on showing the assistant speaking into the silence, and — far worse — the
     * page's echo gate is renewed on every frame, so the microphone is suspect forever and the
     * person is never heard again. The conversation dies and nothing in it looks broken.
     *
     * What IS known exactly is what has been scheduled and when it ends, so that is the gate and
     * the analyser is only ever asked for the shape of a sound already known to be playing.
     */
    level() {
      if (!live.length || ctx.currentTime > at) return 0
      /* the WAVEFORM, not the spectrum — see loudness() in levels.js for why the spectrum gave
         a number that did not move */
      analyser.getByteTimeDomainData(wave)
      let sum = 0
      for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; sum += v * v }
      return Math.min(1, Math.sqrt(sum / wave.length) * 4)
    },

    /* interrupted: what has been scheduled must stop, not merely stop being added to */
    stop() {
      for (const s of live) { try { s.stop() } catch { /* already done */ } }
      live = []; tail = null; at = 0
    },
  }
}
