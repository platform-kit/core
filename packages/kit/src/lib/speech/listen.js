/*
 * The browser's own speech recognition, wrapped the way the recorder is wrapped: one object with a
 * reactive state and start/stop. It runs BESIDE the recorder rather than over its audio — the Web
 * Speech API takes the microphone itself and gives no way to feed it a stream — which is why
 * nothing here touches the recorder's pipeline and why the two are started and stopped together.
 *
 * Two things are worth knowing. It is **not** on every browser (Chrome and Safari have it, Firefox
 * does not), so everything that uses it asks first and simply does without where it is missing — a
 * voice note is still a voice note with no transcript. And on most browsers it is **not local**:
 * the audio goes to the vendor's servers to be recognised. That is a real disclosure, not a footnote,
 * so the surfaces that use it say so where somebody can read it before they speak.
 *
 * The arithmetic — what to show while they are talking, what to keep when they stop — is
 * lib/speech/transcript.js, which has no browser in it and is pinned by build/transcript.test.mjs.
 */
import { reactive } from 'vue'
import { readResults, showing, asSentence } from './transcript.js'

const Engine = () => (typeof window === 'undefined' ? null : (window.SpeechRecognition || window.webkitSpeechRecognition || null))

/* is there anything to listen with? A secure origin, the API, and not the prerender's browser */
export function listenUsable() {
  if (typeof window === 'undefined' || window.isSecureContext === false) return false
  if (document.documentElement.dataset.prerender === '1') return false
  return !!Engine()
}

/* the language to recognise in: what the page says it is, else what the browser is set to */
export const speechLang = () => (typeof document !== 'undefined' && document.documentElement.lang)
  || (typeof navigator !== 'undefined' && navigator.language) || 'en-US'

export function createListener(opts = {}) {
  const state = reactive({ listening: false, kept: '', saying: '', text: '', error: null, usable: listenUsable() })
  const E = Engine()
  let rec = null, want = false

  function start() {
    if (!E || state.listening) return
    want = true
    state.error = null
    rec = new E()
    rec.lang = opts.lang || speechLang()
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      const { done, saying } = readResults(e.results, 0)
      state.kept = done
      state.saying = saying
      state.text = showing(done, saying)
    }
    /* it stops itself on a pause, on a long silence, and on some browsers for no reason at all;
       while we still want it, start it again and keep what it had */
    rec.onend = () => { state.listening = false; if (want) { try { rec.start(); state.listening = true } catch (e) { /* it will not restart twice */ } } }
    rec.onerror = (e) => {
      const err = (e && e.error) || 'failed'
      /* no-speech and aborted are not faults, they are what a quiet room sounds like */
      if (err !== 'no-speech' && err !== 'aborted') state.error = err
      if (err === 'not-allowed' || err === 'service-not-allowed') { want = false; state.usable = false }
    }
    try { rec.start(); state.listening = true } catch (e) { state.error = 'failed' }
  }

  /* what was said, as a sentence — and nothing kept after it */
  function stop() {
    want = false
    if (rec) { try { rec.stop() } catch (e) { /* already gone */ } }
    state.listening = false
    const out = asSentence(state.kept || state.text)
    rec = null
    return out
  }

  return { state, start, stop }
}
