/*
 * End-to-end encryption, as the browser reaches it (openspec: modules-as-packages): the one file that is cryptographic
 * (lib/crypto.ts), which spaces fetches only for an encrypted channel, and the screen that sets up a device's seal.
 */
export * from './lib/crypto.js'
export { default as SpaceSealSetup } from './ui/SpaceSealSetup.vue'
