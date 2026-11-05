/*
 * THE BROWSER'S HALF OF SETTING AN INTERIOR, imported the way the admin bundle imports it (PrintAdmin.vue): the module
 * and the compiler's .wasm by Vite's `?url`. build/print-jobs-db.test.mjs loads this through the site's own Vite in a
 * real browser, so what it proves is the bundle's path and not a test's own.
 */
export { finishWaiting, setInterior } from '../print/typeset/interior.js'
export { default as wasm } from '@myriaddreamin/typst-ts-web-compiler/wasm?url'
