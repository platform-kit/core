/*
 * SPOKEN BOOKS WORK IN THE CLOUD, and this claim was wrong before.
 *
 * `tts` is on the admin function's MACHINE list, so an administrator cannot commission a recording
 * there — and that was read as a gap. It is not one. The reader's own browser speaks a chapter with
 * the same model, caches it, and a signed-in reader's finished chapter is uploaded to the bucket
 * under the name the script would have given it; the next reader is served the recording rather
 * than making it. So every book gets audio on first read, wherever it is deployed, and the script
 * is an optimisation that fills the bucket ahead of anybody asking rather than the only way a
 * recording exists.
 *
 * Speaking a library is hours of CPU per book, which is the wrong shape for an Edge Function at any
 * price. That the admin cannot start one is the correct design, not a missing feature.
 */
/* everything tts is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'tts', what: 'the spoken books', needs: 'a recording is kept in a bucket',
  static: false, git: true, cloud: true,
  owns: { steps: ['tts'] },
} satisfies ModuleDeclaration
