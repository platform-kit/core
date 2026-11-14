/*
 * THE KIT'S OWN VOICE, FOR A CONVERSATION.
 *
 * The engine and its worker already exist for the audiobooks; this is only the one line that
 * makes one, and it is the tts module's door that makes it (createSpeechWorker) rather than the page, because `new URL(<the worker>, import.meta.url)`
 * has to be written NEXT TO the worker for a bundler to find it. A theme page naming the worker
 * by a package specifier cannot work, and fails at load with a missing-export error that does not
 * mention workers at all — which is an afternoon nobody should spend twice.
 */
import { createSpeechWorker } from 'platformkit/modules/tts/index.js'
export function voiceWorker() {
  if (typeof Worker === 'undefined') return null
  try { return createSpeechWorker() }
  catch { return null }
}
