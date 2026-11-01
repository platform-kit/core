/*
 * Spoken audio as MP3, in the browser, the way the build script writes it on
 * the machine (ffmpeg, mono, the same bitrate): one encoder fed piece by piece
 * as the voice speaks, so a chapter never has to sit in memory as raw samples.
 * Worker-only.
 */
import { Mp3Encoder } from '@breezystack/lamejs'

export const KBPS = 128
const FRAME = 1152   /* samples per MPEG frame; the encoder likes whole multiples */

export class Mp3Writer {
  constructor(sampleRate = 44100, kbps = KBPS) {
    ;(this as any).sampleRate = sampleRate
    ;(this as any).encoder = new Mp3Encoder(1, sampleRate, kbps)
    ;(this as any).parts = []
    ;(this as any).bytes = 0
    ;(this as any).pending = new Int16Array(0)
  }
  /* float samples in [-1, 1] → 16-bit, in whole frames; the remainder waits */
  write(float32: any) {
    const n = float32.length
    const merged = new Int16Array((this as any).pending.length + n)
    merged.set((this as any).pending, 0)
    for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, float32[i])); merged[(this as any).pending.length + i] = v < 0 ? v * 32768 : v * 32767 }
    const whole = merged.length - (merged.length % FRAME)
    if (whole) this._push((this as any).encoder.encodeBuffer(merged.subarray(0, whole)))
    ;(this as any).pending = merged.subarray(whole)
  }
  writeSilence(seconds: any) { this.write(new Float32Array(Math.floor(seconds * (this as any).sampleRate))) }
  _push(buf: any) { if (buf && buf.length) { (this as any).parts.push(buf); (this as any).bytes += buf.length } }
  /* the rest, and the file */
  finish() {
    if ((this as any).pending.length) this._push((this as any).encoder.encodeBuffer((this as any).pending))
    ;(this as any).pending = new Int16Array(0)
    this._push((this as any).encoder.flush())
    return new Blob((this as any).parts, { type: 'audio/mpeg' })
  }
}
