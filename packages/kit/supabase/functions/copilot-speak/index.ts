/*
 * THE VOICE A SITE NAMED, AND THE KEY THAT NEVER LEAVES.
 *
 * A site may be heard in a voice better than the kit's own by naming an OpenAI-shaped
 * /v1/audio/speech. That endpoint needs a credential, and the only reason this function exists is
 * that the credential must not be in the browser: the site names the endpoint, the platform calls
 * it. Without that this would be a url in the config and no function at all.
 *
 * IT PASSES THE BODY THROUGH. The upstream's `response.body` is handed straight back and never
 * collected, because collecting it would throw away the whole point while still appearing to
 * work: waiting for a sentence to be synthesised before any of it is heard is the difference
 * between a conversation and a form being submitted. A test drives a deliberately slow upstream
 * and watches the first bytes arrive before the last are sent.
 *
 * PCM BY DEFAULT. Raw frames queue into the browser's audio graph as they land; compressed audio
 * needs a decode per chunk or MediaSource, and neither is worth it when the endpoint will hand
 * over PCM for the asking. It is also trivially analysable, which the visualizer wants anyway.
 *
 * NOT CONFIGURED IS NOT AN ERROR. A site that has named no endpoint gets 503 and the page falls
 * back to the kit's own voice — an assistant that sounds ordinary is better than one that says
 * nothing, and the fallback is the designed path rather than a rescue.
 */
import { cors, json } from '../_shared/lib.ts'
import { createSpeechHandler } from '../_shared/copilot/speech-proxy.js'

const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TTS_URL = (Deno.env.get('COPILOT_TTS_URL') ?? '').replace(/\/$/, '')
const TTS_KEY = Deno.env.get('COPILOT_TTS_KEY') ?? ''
const TTS_MODEL = Deno.env.get('COPILOT_TTS_MODEL') || 'tts-1'
const TTS_VOICE = Deno.env.get('COPILOT_TTS_VOICE') || 'alloy'

Deno.serve(createSpeechHandler({
  service: SERVICE,
  url: TTS_URL,
  key: TTS_KEY,
  model: TTS_MODEL,
  voice: TTS_VOICE,
  cors,
  json,
}))
