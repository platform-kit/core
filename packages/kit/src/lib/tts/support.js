/*
 * Whether this browser may make a chapter's recording itself, and the quiet
 * pre-warm that fetches the voice's weights before a reader asks.
 *
 * The voice is about 400 MB and wants a gigabyte of memory to run, so it is
 * offered on desktops only: a fine pointer that hovers, a wide window, no
 * device that reports itself small or on a data-saving connection, and never
 * the build's own browser (the prerender). IN_BROWSER_TTS=false switches it off
 * for everyone (vite.config.js exposes that one name to the client).
 */
import { moduleOn } from '../modules.js'
import { ROUTES, isPageRoute } from '../router.js'

import { modules } from '#site'
/* the tts module's switch (platformkit.config.js), and IN_BROWSER_TTS=false for one deployment */
export const TTS_ON = moduleOn('tts') && !/^(0|false|no|off)$/i.test(String(import.meta.env.IN_BROWSER_TTS || '').trim())

let supported = null
export function ttsSupported() {
  if (supported !== null) return supported
  try {
    const w = typeof window !== 'undefined' ? window : null
    const n = typeof navigator !== 'undefined' ? navigator : null
    supported = !!(TTS_ON && w && n
      && typeof Worker !== 'undefined' && typeof caches !== 'undefined' && typeof WebAssembly !== 'undefined'
      && w.crypto && w.crypto.subtle
      && w.matchMedia('(pointer: fine)').matches && w.matchMedia('(hover: hover)').matches && w.matchMedia('(min-width: 900px)').matches
      && (n.deviceMemory == null || n.deviceMemory >= 4)
      && !(n.connection && n.connection.saveData)
      && !/PlatformKitPrerender/.test(n.userAgent || '')
      && !n.webdriver)
  } catch { supported = false }
  return supported
}

/* A DRIVEN BROWSER NEVER ASKS TO HEAR ANYTHING, so it never warms: the weights are ~400 MB and
   a check that waits for the network to go quiet would be waiting for a download nobody wanted.
   `navigator.webdriver` above is the one line that covers every automation tool. */

/* the pre-warm belongs to the pages a reader might read from: not the landing
   pages, and not the build's own share and preview routes */
export function prewarmAllowed(path) {
  const p = String(path || '/')
  return p !== ROUTES.home && !isPageRoute(p) && p !== ROUTES.preview && !p.startsWith(ROUTES.share)
}

/* Start the weights downloading into the browser's cache, once, when the page
   has settled — the same shape as warmEmbedder in src/lib/content.js. Only the
   cache fills: no worker and no sessions until a chapter asks. */
let warmed = false
export function warmSpeech(path) {
  if (warmed || !prewarmAllowed(path) || !ttsSupported()) return
  warmed = true
  const go = () => import('./weights.js').then((m) => m.prefetchWeights()).catch(() => {})
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 3000)
}
