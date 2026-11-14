/*
 * The copilot, as the browser reaches it (openspec: modules-as-packages): a conversation with a bot by voice — its engine,
 * its turns, its levels and echo, its preferences — and the two screens the voice page draws.
 */
export * from './lib/converse.js'
export * from './lib/echo.js'
export * from './lib/engine.js'
export * from './lib/levels.js'
export * from './lib/play.js'
export * from './lib/prefs.js'
export * from './lib/speak.js'
export * from './lib/threads.js'
export { default as VoiceSettings } from './ui/VoiceSettings.vue'
export { default as VoiceVisual } from './ui/VoiceVisual.vue'
