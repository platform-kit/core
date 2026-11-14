/*
 * The spoken books, as the browser reaches them (openspec: modules-as-packages): whether this browser can speak a chapter,
 * the warm-up of the voice's weights as a reader moves about the site, how text is cut for the voice, and the reader's
 * audiobook player — fetched only when asked for, since it carries the engine.
 */
export { ttsSupported, warmSpeech } from './lib/support.js'
export { chunkText } from './lib/chunk.js'
export const loadAudiobook = () => import('./lib/audiobook.js')
/* the voice's own worker, for a reader that speaks somewhere other than the book reader (the copilot); written out here so
   the bundler sees the worker it has to build */
export const createSpeechWorker = () => new Worker(new URL('./lib/tts.worker.ts', import.meta.url), { type: 'module' })
