/*
 * The spoken books, as the build and Node reach them (openspec: modules-as-packages): how text is cut for the voice, and
 * the engine's pinned weights. The browser's door is ../index.ts.
 */
export { chunkText } from '../lib/chunk.js'
export { talkPieces, stepsFor, openingCut, TALK, FIRST_WORDS, PACK } from '../lib/chunks.js'
export { OWN_VOICES, OWN_DEFAULT } from '../lib/voices.js'
export { REPO, REV, BROWSER_FILES, MODELS } from './setup.mjs'
