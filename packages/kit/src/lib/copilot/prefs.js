/*
 * WHAT THE READER DECIDED ABOUT THE VOICE — theirs, per browser, and nothing to do with the site.
 *
 * The line between this and the bot's `voice:` block is the line between a preference and a
 * configuration. WHICH PROVIDER speaks is the site's: it has an endpoint or it has not, and
 * nobody using an assistant has any way to know what the answer would mean for them. WHICH VOICE,
 * WHAT LANGUAGE, HOW FAST and WHETHER THE MICROPHONE IS ALWAYS ON are all the reader's: they are
 * about this person, in this room, on this machine, and they change from visit to visit.
 *
 * Kept in raw localStorage rather than in an account, because they describe a DEVICE as much as a
 * person — the laptop in a shared office wants push-to-talk; the same person's phone at home does
 * not — and because a preference that needs a sign-in to express is a preference nobody sets.
 *
 * Pure but for the storage it is handed, so the defaults, the merging and the voice lists are all
 * testable under node.
 */

/* the one list of shapes, borrowed rather than copied: two lists of one decided set is how one
   of them falls behind */
import { SHAPES } from './visual.js'

export const KEY = 'dl.copilot.prefs'
export { SHAPES }

/*
 * THE KIT'S OWN VOICES. Supertonic ships ten styles, five of each; the engine fetches only the
 * one in use, which is a 290 KB file beside a 400 MB model, so choosing another costs nothing
 * worth counting. M5 is the default because it is the one the project already speaks its
 * audiobooks in — the warm, soft-spoken one the model's authors made for exactly that.
 */
export const OWN_VOICES = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']
export const OWN_DEFAULT = 'M5'

/* what the model can say, in the model's own codes. The names are words and live in markdown. */
export const LANGS = ['en', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr',
  'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr',
  'uk', 'vi']

/* the speeds worth offering: slower than 0.6 is a drunk and faster than 2 is unintelligible */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

export const DEFAULTS = Object.freeze({
  aloud: true,          /* is it read out at all */
  voice: '',            /* '' means whatever the site or the engine would have chosen */
  visual: '',           /* which shape the orb is; '' means the one the site chose */
  lang: '',             /* '' means the page's own language */
  speed: 1,
  hold: false,          /* push and hold to talk, rather than a microphone that is always on */
})

const num = (v, list, fallback) => (list.includes(Number(v)) ? Number(v) : fallback)
const one = (v, list, fallback) => (list.includes(String(v)) ? String(v) : fallback)

/*
 * READ WHAT IS THERE AND TRUST NONE OF IT. These are in storage a person can edit, survive a
 * deploy that changed what the options are, and come back from a browser that has had the page
 * open since an older version — so every field is checked against what exists NOW and anything
 * unrecognised falls back rather than being passed to an engine that would throw on it.
 */
export function readPrefs(store, { voices = OWN_VOICES } = {}) {
  let raw = {}
  try { raw = JSON.parse((store && store.getItem(KEY)) || '{}') || {} } catch { raw = {} }
  return {
    aloud: raw.aloud === undefined ? DEFAULTS.aloud : !!raw.aloud,
    voice: one(raw.voice, voices, DEFAULTS.voice),
    visual: one(raw.visual, SHAPES, DEFAULTS.visual),
    lang: one(raw.lang, LANGS, DEFAULTS.lang),
    speed: num(raw.speed, SPEEDS, DEFAULTS.speed),
    hold: !!raw.hold,
  }
}

export function writePrefs(store, prefs) {
  try { store && store.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...prefs })) } catch { /* private window */ }
  return prefs
}

/*
 * WHAT THE READER CHOSE, AS THE ENGINE WANTS IT. The reader's choice wins over the bot's file,
 * and the bot's file over the engine's own default — the same order every other preference in
 * this project keeps. A field left alone is left out entirely rather than sent as a default,
 * so the layer underneath still gets to decide.
 */
export function voiceSettings(prefs = {}, botVoice = {}) {
  const out = {}
  if (prefs.voice) out.voice = prefs.voice
  else if (botVoice.own) out.voice = botVoice.own
  if (prefs.lang) out.lang = prefs.lang
  if (prefs.speed && prefs.speed !== 1) out.speed = prefs.speed
  return out
}

/*
 * WHICH VOICES THE READER MAY PICK FROM. The kit's own ten where the kit is speaking; where an
 * endpoint is, only what the SITE says that endpoint offers — the kit cannot enumerate somebody
 * else's service and must not pretend to, and a list baked in here would be wrong the week the
 * provider adds one.
 */
export function voicesFor(speakerId, botVoice = {}) {
  if (speakerId === 'endpoint') {
    const named = Array.isArray(botVoice.voices) ? botVoice.voices.filter((v) => typeof v === 'string' && v.trim()) : []
    return named.map((v) => v.trim())
  }
  return OWN_VOICES.slice()
}
