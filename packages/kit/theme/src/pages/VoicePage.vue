<!--
  SPEAKING TO AN ASSISTANT — /app/voice/<bot>.

  THE ORB IS THE INTERFACE. A voice surface is not a page with a widget on it: the person is
  listening, not reading, and their eyes have one job — to tell them whether they are being heard,
  whether it is thinking, and whether it is talking. So the stage is the whole viewport, the orb is
  the only thing in the middle of it, and everything else is at the edges where it can be ignored.

  TWO PLACES, AND A SENTENCE ONLY LIVES IN ONE OF THEM. The big centred line is the LIVE one —
  what the person is saying as they say it, and then that same sentence held while the model
  thinks, because a question with no answer yet is the one thing somebody needs in front of them.
  The moment the answer lands the big line goes dark and the pair drops into the log beneath,
  which is the record. Nothing is ever in both at once: a sentence shown twice reads as a bug and
  the eye does not know which copy to follow.

  THE LOG IS OPEN by default, because the answer is spoken and speech is gone the moment it is
  made. It scrolls itself to the newest line and brings each one in on the surface's own curve.

  The ground is the site's own (`lpbg`/`lpblobs`/`lpgrain`), so a spoken conversation looks like it
  belongs to the site rather than to a demo. Every colour is a look token; there is not one literal.
-->
<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { Room, RoomEvent } from 'livekit-client'
import { supabase, functionsBase } from 'platformkit/lib/supabase.js'
import { us } from 'platformkit/lib/content.js'
import { conversation } from 'platformkit/lib/copilot/converse.js'
import { speaker, speakerIdOf } from 'platformkit/lib/copilot/speak.js'
import { hearPerson } from 'platformkit/lib/copilot/levels.js'
import { echoGuard } from 'platformkit/lib/copilot/echo.js'
import { player } from 'platformkit/lib/copilot/play.js'
import { voiceWorker } from 'platformkit/lib/copilot/engine.js'
import { threads as threadStore, whenOf } from 'platformkit/lib/copilot/threads.js'
import { readPrefs, writePrefs, voiceSettings, voicesFor, OWN_DEFAULT } from 'platformkit/lib/copilot/prefs.js'
import VoiceVisual from '../components/copilot/VoiceVisual.vue'
import VoiceSettings from '../components/copilot/VoiceSettings.vue'

const W = computed(() => ((us('copilot').page || {}).head || {}))
const WHEN = computed(() => ((us('copilot').page || {}).when || {}))
const MEMORY = computed(() => ((us('copilot').page || {}).memory || {}))
const slug = computed(() => decodeURIComponent((location.pathname.split('/app/voice/')[1] || '').replace(/\/$/, '')))

/*
 * DEV ONLY, and inert in a build. ?state=thinking draws a phase with nobody talking, so all four
 * can be looked at before they are shipped; ?demo seeds a conversation, because a headless
 * browser has no speech recogniser and a log with nothing in it proves nothing about the log.
 */
const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : new URLSearchParams()
const forced = dev.get('state')
const DEMO = [
  ['me', 'What should I read first?'],
  ['them', 'Begin with the introduction — it is the thesis of the whole book, and every chapter after it assumes you have read it.'],
  ['me', 'How long is it?'],
  ['them', 'About nine hundred words. Ten minutes, less if you read quickly.'],
  ['me', 'And after that?'],
]

const chat = shallowRef(null)
const bot = ref(null), fault = ref(''), mine = ref(0), theirs = ref(0)
const muted = ref(false), showLog = ref(true), ended = ref(false), held = ref(false)
/*
 * TYPING IS NOT A FALLBACK, it is the other way in. Somebody mutes the microphone because they
 * are not alone, and a surface that then has no way to say anything has simply stopped working;
 * a browser that cannot listen at all (Firefox has no recogniser) used to get a dead end where
 * the whole page should be. Either way the box appears, and it is the same conversation.
 */
const typed = ref('')
const deaf = ref(false)              /* this browser cannot listen, whatever the microphone says */
const canType = computed(() => muted.value || deaf.value)

/* the conversations they have had with THIS assistant, and which one they are in */
const sessions = ref([])
const threadId = ref(null)
const showSessions = ref(false)
const asking = ref(null)             /* the one whose Delete is waiting to be confirmed */
const pastView = ref('sessions')
const memories = ref([])
const memoryLoading = ref(false)
const memoryFault = ref('')
const askingMemory = ref(null)
const memoryDeleting = ref(null)
const usageFault = ref('')
let store = null
/* what the recogniser has heard so far in this breath, before it has committed to it */
const heard = ref('')
/*
 * WHETHER IT SPEAKS AT ALL — the one thing about the voice a reader should ever be asked.
 *
 * There was briefly a control here for WHICH voice, the site's studio endpoint against the kit's
 * own in-browser engine. That was a developer's question wearing a reader's hat: nobody using an
 * assistant has any way to know what either phrase means, and the answer is the site's to make
 * once in a file (`voice.by`) rather than a reader's to make every visit. It is gone.
 *
 * Silence is a real need and a common one — the office, a train, somebody who reads faster than
 * any voice talks. Off means no speech is MADE, not speech made and muted: no synthesis in the
 * page and no call to an endpoint the site is paying for. The answer is still written down, which
 * is what the transcript has been for all along.
 */
/*
 * WHAT COUNTS AS BEING INTERRUPTED. Echo cancellation leaves a residue, so while the assistant is
 * talking the microphone is not trusted on its own: a person taking the turn back has to be
 * properly louder than the leak. Below that, what the recogniser heard was almost certainly the
 * assistant, and acting on it is the self-answering loop.
 *
 * It is a gate rather than a mute because muting the microphone while speaking would kill
 * barge-in, and barge-in is the thing that makes this a conversation rather than a kiosk.
 */
/*
 * THE RECOGNISER HAS ITS OWN MICROPHONE, AND THAT IS THE WHOLE PROBLEM.
 *
 * Everything tried before this failed for one reason, and it is a fact about the platform rather
 * than a bug in the arithmetic: `SpeechRecognition` opens its OWN capture, inside the browser.
 * The stream this page asks for with `echoCancellation: true` is a SECOND, separate stream used
 * only to measure loudness. Our constraint does not touch what the recogniser hears, and no
 * amount of gating our own analyser can change a word of what it decides to transcribe. Reading
 * its results and then discarding them was always going to leak, because by then the recogniser
 * had already heard the speakers and already restarted its own clock.
 *
 * So the only control that works is the one control it offers: START AND STOP. While the
 * assistant is audible the recogniser is STOPPED — half-duplex, which is what every agent built
 * on the Web Speech API does, because there is nothing else to do. Barge-in is then taken from
 * the stream we DO control, which has echo cancellation and a learned noise floor
 * (lib/copilot/echo.js), and from the press of the microphone button.
 */
const ear = echoGuard()
/*
 * WHEN A BREATH IS OVER. The recogniser finalises in phrases, not in sentences — ask it for
 * continuous results and "what should I read first" can arrive as three finals — so submitting
 * on each one turns one question into three turns, and showing each one turns the caption into
 * a flicker of fragments. A breath ends when the words stop, which is a pause: long enough not
 * to cut somebody drawing breath mid-sentence, short enough not to be felt as lag. People pause
 * around half a second at a real turn boundary, so this sits just past it.
 */
const BREATH_MS = 700

/* `store` is already the conversations'; this one is the browser's own box */
const box = typeof localStorage === 'undefined' ? null : localStorage
const prefs = ref(readPrefs(box))
const aloud = computed(() => prefs.value.aloud)
const haveEndpoint = ref(false)
const showPrefs = ref(false)
const speaking = ref('browser')   /* which provider ended up speaking; a computed cannot watch a let */
/*
 * THE VOICE IS 400 MB AND HAS TO ARRIVE BEFORE IT CAN SAY ANYTHING. Until this was shown, a
 * reader whose site had no endpoint — or whose endpoint had just failed — waited several minutes
 * in front of a surface that said "Listening" and made no sound, which is indistinguishable from
 * broken. It is not the conversation; it is the reason there is not one yet, so it goes where the
 * state goes.
 */
const fetching = ref(null)
const canPick = computed(() => voicesFor(speaking.value, bot.value?.voice || {}))
/* the voice that would be used if the reader chose nothing: the endpoint's named one, or the
   engine's own. The control shows this rather than a phrase about where it came from. */
const voiceNow = computed(() => (speaking.value === 'endpoint' ? (bot.value?.voice?.say || '') : OWN_DEFAULT))
const langNow = computed(() => (document.documentElement.lang || 'en').slice(0, 2).toLowerCase())
/* the shape the site chose, and the reader's own over the top of it */
const visualNow = computed(() => bot.value?.voice?.visual || 'aura')
const visual = computed(() => prefs.value.visual || visualNow.value)

function setPrefs(next) {
  const was = prefs.value
  prefs.value = writePrefs(box, next)
  /* silenced mid-sentence means mid-sentence: what is already playing stops */
  if (!next.aloud) { voiced && voiced.cancel(); out && out.stop() }
  /* a new voice or language is a new engine setting, which takes effect on the next thing said */
  if (next.voice !== was.voice || next.lang !== was.lang || next.speed !== was.speed) buildSpeaker()
  /* and the way they are heard changes the microphone there and then */
  if (next.hold !== was.hold) listenAs(next.hold)
  if (next.lang !== was.lang && recog) { try { recog.lang = next.lang || document.documentElement.lang || 'en-GB' } catch { /* going */ } }
}
const flipAloud = () => setPrefs({ ...prefs.value, aloud: !prefs.value.aloud })
const said_when = (at) => whenOf(at, WHEN.value)

/*
 * EVERY LINE IS KEPT AS IT IS SAID, not at the end: a conversation has no end — the tab is
 * closed, the laptop is shut — and a transcript written on the way out is a transcript that is
 * usually not written. The thread itself is made by the first thing said rather than on arrival,
 * so opening the page and walking away leaves nothing in the list.
 */
async function keep(line) {
  if (!store) return
  try {
    const first = !threadId.value
    if (first) threadId.value = await store.start()
    await store.append(threadId.value, line.who, line.text, { title: true })
    if (first || line.who === 'me') sessions.value = await store.list()
  } catch { /* the conversation is the point; a transcript that will not save never stops it */ }
}

async function openSession(id) {
  if (!store || id === threadId.value) return
  showSessions.value = false
  const lines = await store.lines(id).catch(() => [])
  threadId.value = id
  chat.value && chat.value.load(lines)
}

function freshSession() {
  showSessions.value = false
  threadId.value = null
  chat.value && chat.value.load([])
}

async function dropSession(id) {
  if (!store) return
  asking.value = null
  await store.remove(id).catch(() => {})
  if (id === threadId.value) freshSession()
  sessions.value = await store.list().catch(() => [])
}

async function showMemories() {
  pastView.value = 'memory'
  memoryLoading.value = true
  memoryFault.value = ''
  try {
    const { data, error } = await supabase.from('copilot_memory')
      .select('id, said, created_at')
      .eq('bot', slug.value)
      .order('created_at', { ascending: false })
    if (error) throw error
    memories.value = data || []
  } catch (error) {
    console.error('Unable to load assistant memories', error)
    memoryFault.value = MEMORY.value['load-error'] || ''
  } finally {
    memoryLoading.value = false
  }
}

async function dropMemory(id) {
  memoryDeleting.value = id
  memoryFault.value = ''
  try {
    const { error } = await supabase.from('copilot_memory')
      .delete().eq('id', id).eq('bot', slug.value)
    if (error) throw error
    memories.value = memories.value.filter((item) => item.id !== id)
    askingMemory.value = null
  } catch (error) {
    console.error('Unable to delete assistant memory', error)
    memoryFault.value = MEMORY.value['delete-error'] || ''
  } finally {
    memoryDeleting.value = null
  }
}

/* the typed line goes in exactly where a spoken one does, so nothing downstream knows which */
function sendTyped() {
  const t = typed.value.trim()
  if (!t || !chat.value) return
  typed.value = ''
  chat.value.say(t)
}

let grant = '', mic = null, ctx = null, raf = 0, recog = null, out = null, sttStartedAt = 0
let voiceRoom = null
const roomAnswers = new Map()
const ROOM_INPUT = 'copilot.input'
const ROOM_OUTPUT = 'copilot.output'
let shut = false          /* the recogniser is stopped because the assistant is talking */
let overFor = 0           /* how long the person has been over the leak, in frames */
let breath = ''           /* everything finalised in the sentence being spoken now */
let settle = 0            /* the timer that decides the sentence has ended */

const phase = computed(() => forced || (ended.value ? 'connecting' : (chat.value?.state.phase || 'connecting')))
const label = computed(() => {
  const f = fetching.value
  if (f) return (W.value[f.pct >= 100 ? 'starting' : 'fetching'] || '').replace('{n}', String(f.pct))
  if (phase.value === 'thinking') return W.value.holding || ''
  return W.value[phase.value] || ''
})
const said = computed(() => chat.value?.state.said || [])
/*
 * THE PENDING SENTENCE: the person's last line while the model is still thinking about it. It is
 * the one entry of `said` the log does not show, because it is on the big line instead.
 */
const pending = computed(() => {
  if (chat.value?.state.phase !== 'thinking') return null
  const last = said.value[said.value.length - 1]
  return last && last.who === 'me' ? last : null
})
/* the big line: what is being said right now, or the question still waiting for its answer */
const latest = computed(() => {
  const h = heard.value.trim()
  if (h) return { who: 'me', text: h }
  if (pending.value) return pending.value
  if (!said.value.length) return { who: 'them', text: bot.value?.voice?.greeting || W.value.greeting || '' }
  return null
})
/* the record: everything settled. The pending sentence joins it when its answer does. */
const log = computed(() => (pending.value ? said.value.slice(0, -1) : said.value))

/*
 * THE LOG FOLLOWS THE CONVERSATION. A transcript that has to be scrolled by hand is a transcript
 * nobody reads, and on a surface where the answer is spoken the written copy is the only one that
 * stays. Smooth, except for the reader who asked for no motion.
 */
const logEl = ref(null)
/* the top of the log fades out ONLY once there is something above it to fade; a soft edge on a
   first line that is fully in view is a gradient over nothing */
const clipped = ref(false)
watch(() => [log.value.length, showLog.value], async () => {
  await nextTick()
  const el = logEl.value
  if (!el) return
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollTo({ top: el.scrollHeight, behavior: still ? 'auto' : 'smooth' })
  clipped.value = el.scrollHeight > el.clientHeight + 1
})
const needsSignIn = computed(() => fault.value === (W.value['sign-in'] || ''))
const openAuth = () => { if (window.DLauth) window.DLauth.open({ intent: 'buy' }) }

async function reportStt(elapsedMs) {
  if (!grant || !bot.value?.usage?.offer_key || elapsedMs <= 0) return
  const secondsMicros = Math.min(Math.round(elapsedMs * 1000), Number(bot.value.minutes || 0) * 60_000_000)
  if (!secondsMicros) return
  const payload = { kind: 'stt', id: crypto.randomUUID(), seconds_micros: secondsMicros }
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${functionsBase()}/copilot-llm/telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `******` },
        body: JSON.stringify(payload),
      })
      if (response.ok) return
      const result = await response.json().catch(() => ({}))
      if (response.status < 500 || attempt === 1) {
        throw new Error(result?.error?.message || String(response.status))
      }
    }
  } catch (error) {
    console.error('Unable to record speech recognition time', error)
    usageFault.value = W.value['telemetry-error'] || ''
  }
}

async function begin() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) { fault.value = W.value['sign-in'] || ''; return }
  const r = await fetch(`${functionsBase()}/copilot-llm/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ bot: slug.value }),
  }).catch(() => null)
  if (!r || !r.ok) { fault.value = W.value['no-bot'] || ''; return }
  const got = await r.json()
  grant = got.grant; bot.value = got

  if (got.transport) {
    try {
      await connectVoiceRoom(got.transport)
    } catch (error) {
      console.error('Unable to connect the assistant room', error)
      fault.value = W.value['connection-error'] || ''
      return
    }
  }

  ctx = new (window.AudioContext || window.webkitAudioContext)()
  out = player(ctx)

  const probe = await fetch(`${functionsBase()}/copilot-speak`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${grant}` },
    body: JSON.stringify({ text: '' }),
  }).catch(() => null)
  haveEndpoint.value = !!probe && probe.status !== 503

  buildSpeaker()
  /*
   * THE PRE-WARM FILLS THE CACHE; THIS BUILDS THE ENGINE. `warmSpeech` in App.vue has already
   * downloaded the weights by the time anybody reaches this page — including the default voice —
   * but it deliberately stops at the cache: no worker and no sessions, because a reader browsing
   * articles may never ask to hear anything and the sessions hold about a gigabyte.
   *
   * A page whose whole purpose is being spoken to is the one place that calculation reverses.
   * Four ONNX sessions take seconds to build, and paying for them at the first answer is paying
   * for them exactly when somebody is waiting. So the engine is started the moment the page
   * opens — but only where the kit's own voice is the one that will speak, since a deployment
   * with a working endpoint should never hold a gigabyte it has no use for. If that endpoint
   * later fails, the failover builds it then.
   */
  if (sp.id === 'browser') warmEngine()
  chat.value = conversation({ speaker: voiced, ask, onSaid: (line) => {
    if (line.who === 'them') {
      ear.speaking(line.text)
      if (bot.value?.usage) setTimeout(() => { void refreshUsage() }, 1_000)
    }
    keep(line)
  } })
  store = threadStore(supabase, slug.value)
  store.list().then((l) => { sessions.value = l }).catch(() => { store = null })
  /*
   * NO MICROPHONE IS NOT NO SURFACE. A refused permission used to replace the whole page with a
   * sentence; it now says so once and leaves the conversation standing, because there is a box
   * to type in and everything else — the answer, the voice, the record — works exactly as it did.
   */
  /*
   * READY BEFORE THE MICROPHONE, not after. The permission prompt is answered by a person, and a
   * person may take a while or never — awaiting it first left the surface saying "Connecting…"
   * with a working assistant behind it and no way to reach it. The conversation is ready the
   * moment there is something to think with; listening starts when listening is possible.
   */
  chat.value.ready()
  await openMic().catch(() => { deaf.value = true })
}

let sp = null
let voiced = null
let engineWorker = null
/* one worker for the page, so the pre-build and the speaking are the same engine */
function theWorker() {
  if (!engineWorker) engineWorker = voiceWorker()
  return engineWorker
}
function warmEngine() {
  try { theWorker().postMessage({ type: 'load' }) } catch { /* no worker here */ }
}
function buildSpeaker() {
  const got = bot.value || {}
  /* the person's choice wins over the file's, and the file's over the default */
  const id = speakerIdOf({ voice: got.voice || {}, haveEndpoint: haveEndpoint.value })
  speaking.value = id
  /* the reader's choice over the file's, the file's over the engine's own — the order every
     other preference in this project keeps */
  sp = speaker({
    id, voice: { ...(got.voice || {}), ...voiceSettings(prefs.value, got.voice || {}) },
    onState: (st) => {
      /* the endpoint may have failed and handed over, so the provider in force can change */
      if (st.at === 'ready') { fetching.value = null; speaking.value = 'browser' }
      else if (st.at === 'starting') fetching.value = { pct: 100 }
      else fetching.value = { pct: st.total ? Math.min(99, Math.round((st.done / st.total) * 100)) : 0 }
    },
    /* a FACTORY, not a worker: the endpoint may fail at any point and fall back to this, so
       the kit's own voice has to be reachable — but a deployment whose endpoint works should
       never build one, and a worker holds about a gigabyte once it has */
    worker: theWorker,
    post: async ({ text, voice, format }) => {
      const res = await fetch(`${functionsBase()}/copilot-speak`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${grant}` },
        body: JSON.stringify({ text, voice, format: format || 'pcm' }),
      })
      if (!res.ok || !res.body || !bot.value?.usage) return res.ok ? res.body : null
      const reader = res.body.getReader()
      return new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read()
            if (done) {
              await refreshUsage()
              controller.close()
            } else controller.enqueue(value)
          } catch (error) {
            controller.error(error)
          }
        },
        async cancel(reason) {
          try { await reader.cancel(reason) } finally { void refreshUsage() }
        },
      })
    },
  })
  /* whatever the provider, the bytes end up here — raw frames played as they land, or the
     engine's finished mp3 decoded once. Either way the assistant is audible AND measurable. */
  voiced = {
    get id() { return sp.id },
    cancel: (u) => { sp.cancel(u); out && out.stop() },
    /* READING ALOUD IS OFF: nothing is synthesised and nothing is fetched. The turn still ends —
       the machine is waiting on this promise to give the turn back — it simply ends at once. */
    /*
     * ONE HANDLER, AND IT ASKS THE CHUNK WHAT IT IS — never the provider.
     *
     * This chose the handler by `sp.id` at the moment `say` was called, which is wrong the one
     * time it matters: a failing endpoint falls back to the kit's own engine PART WAY THROUGH an
     * utterance, so the id was 'endpoint' when the handler was picked and the pieces that then
     * arrived were float samples being fed to a byte reader. It took the length of an object,
     * got undefined, returned, and played nothing — no sound, and an orb with no level to draw,
     * which is exactly "the effect is unresponsive".
     *
     * The page is not supposed to know which provider is speaking. So it does not ask.
     */
    say: (text) => (!aloud.value
      ? Object.assign(Promise.resolve(null), { utterance: null })
      : sp.say(text, (c) => { if (c && c.pcm) out.frames(c.pcm, c.rate); else out.write(c) })),
  }
}

async function ask(text) {
  if (voiceRoom) return askInRoom(text)
  const r = await fetch(`${functionsBase()}/copilot-llm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${grant}` },
    body: JSON.stringify({ stream: false, messages: [{ role: 'user', content: text }] }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message || String(r.status))
  return (await r.json()).choices?.[0]?.message?.content || ''
}

async function connectVoiceRoom(transport) {
  const room = new Room()
  room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    if (topic !== ROOM_OUTPUT || participant?.identity === room.localParticipant.identity) return
    let message
    try { message = JSON.parse(new TextDecoder().decode(payload)) } catch { return }
    const pending = roomAnswers.get(message?.id)
    if (!pending) return
    clearTimeout(pending.timer)
    roomAnswers.delete(message.id)
    if (message.error || typeof message.text !== 'string') pending.reject(new Error(W.value['turn-error'] || ''))
    else pending.resolve(message.text)
  })
  room.on(RoomEvent.Disconnected, () => {
    for (const pending of roomAnswers.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(W.value['connection-error'] || ''))
    }
    roomAnswers.clear()
    if (voiceRoom === room) voiceRoom = null
  })
  try {
    await room.connect(transport.url, transport.token)
    voiceRoom = room
  } catch (error) {
    await room.disconnect()
    throw error
  }
}

function askInRoom(text) {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const pending = {
      resolve,
      reject,
      timer: setTimeout(() => {
        roomAnswers.delete(id)
        reject(new Error(W.value['turn-error'] || ''))
      }, 70_000),
    }
    roomAnswers.set(id, pending)
    voiceRoom.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ id, text })),
      { reliable: true, topic: ROOM_INPUT },
    ).catch((error) => {
      clearTimeout(pending.timer)
      roomAnswers.delete(id)
      reject(error)
    })
  })
}

async function openMic() {
  /*
   * ON SPEAKERS, THE MICROPHONE HEARS THE ASSISTANT. Without these the recogniser transcribes the
   * reply, the machine takes it as the person speaking, and the assistant answers itself forever
   * — which reads as a broken agent and is a broken audio graph. Echo cancellation is the first
   * line and it is not on by default everywhere.
   */
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
  /*
   * THE LEVEL LOOP IS NOT THE MICROPHONE'S. It also carries what the ASSISTANT is saying, which
   * is half of what the orb draws and the whole of the echo gate — so it starts before the
   * permission is asked and survives a refusal. Starting it inside the success path left a
   * person with no microphone watching a dead shape while the answer played.
   */
  const tick = () => {
    mine.value = muted.value || !mic ? 0 : mic.read()
    theirs.value = out ? out.level() : 0
    const t = performance.now()
    ear.tick(theirs.value, mine.value, t)

    /*
     * SHUT THE EAR WHILE IT TALKS, OPEN IT AFTER. Not a filter on the results — the capture
     * itself, because the results were never ours to filter in time.
     */
    if (!prefs.value.hold && recog && !muted.value) {
      const audible = ear.audible(t)
      if (audible && !shut) { shut = true; try { recog.stop() } catch { /* not going */ } }
      else if (!audible && shut) { shut = false; try { recog.start() } catch { /* already */ } }
    }

    /*
     * AND A REAL INTERRUPTION, from the stream we own. Over this room's learned leak, for long
     * enough not to be a door closing: that is a person, and the turn is theirs.
     */
    if (ear.audible(t) && !muted.value && mine.value >= ear.bar()) {
      if (++overFor >= 6 && ['speaking', 'thinking'].includes(chat.value?.state.phase)) {
        overFor = 0
        chat.value.interrupt()
        voiced && voiced.cancel(); out && out.stop()
      }
    } else overFor = 0
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  mic = hearPerson(ctx, stream)
  listen()
}

/* the microphone, as the reader asked to be heard */
function listenAs(hold) {
  if (!recog) return
  if (hold) { try { recog.stop() } catch { /* not started */ } return }
  try { recog.start() } catch { /* already going */ }
}

/* the button is held: listen, and take the turn back from whatever is being said */
function holdOn() {
  if (!prefs.value.hold || !recog) return
  held.value = true
  if (['speaking', 'thinking'].includes(chat.value?.state.phase)) chat.value.interrupt()
  try { recog.start() } catch { /* already going */ }
}
function holdOff() {
  if (!prefs.value.hold || !recog) return
  held.value = false
  try { recog.stop() } catch { /* not going */ }
}

function listen() {
  const Engine = window.SpeechRecognition || window.webkitSpeechRecognition
  /* Firefox has no recogniser. That is a reason to type, not a reason to show a wall. */
  if (!Engine) { deaf.value = true; return }
  recog = new Engine()
  recog.continuous = true; recog.interimResults = true; recog.lang = document.documentElement.lang || 'en-GB'
  recog.onstart = () => { sttStartedAt = performance.now() }
  /* the sentence is over: it goes to the model, and the words on screen do not move — the line
     clears at the same moment the pending sentence takes its place, with the same text in it */
  const finish = () => {
    clearTimeout(settle); settle = 0
    const t = breath.trim()
    breath = ''
    heard.value = ''
    if (t && chat.value) chat.value.say(t)
  }
  const forget = () => { clearTimeout(settle); settle = 0; breath = ''; heard.value = '' }

  recog.onresult = (e) => {
    /* muted mid-sentence: whatever is on the big line was heard before the microphone was shut
       and leaving it there says the surface is still listening, which it is not */
    if (muted.value) { forget(); return }
    /*
     * EVERY RESULT IN THIS BREATH, NOT THE NEWEST ONE. The recogniser hands back a growing list
     * and `resultIndex` is where it changed; reading only that one put a single phrase on screen
     * and replaced it with the next, so the caption flickered through fragments and the whole
     * sentence appeared for an instant at the end. What a person wants to see is what they have
     * said so far, growing, and then simply staying there.
     */
    let settled = '', saying = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) settled += r[0].transcript
      else saying += r[0].transcript
    }
    /*
     * THE LAST LINE, AND IT NEEDS NO MICROPHONE. Stopping the capture is the defence; this is
     * what catches the half-second the recogniser was still finishing when it was stopped. A
     * sentence that is the assistant's own sentence coming back is the assistant, whatever any
     * level says about it.
     */
    if (ear.isEcho(settled + ' ' + saying)) { forget(); return }

    breath += settled
    heard.value = (breath + ' ' + saying).replace(/\s+/g, ' ').trim()
    /* the words are still coming, so the sentence is not over yet */
    clearTimeout(settle)
    settle = breath.trim() ? setTimeout(finish, BREATH_MS) : 0
  }
  /* the recogniser noticed the silence before the timer did */
  recog.onspeechend = () => { if (breath.trim()) finish() }
  /*
   * HELD, OR OPEN THE WHOLE TIME. An always-open microphone is the better conversation and the
   * worse room-mate: in an office, on a train, in a house with other people in it, "this page is
   * listening" is a thing somebody reasonably does not want. Holding to talk is not a lesser
   * mode — for some people it is the only usable one — so it starts and stops the recogniser
   * rather than muting it, and nothing is listened to between presses.
   */
  recog.onend = () => {
    if (sttStartedAt) {
      const elapsed = performance.now() - sttStartedAt
      sttStartedAt = 0
      void reportStt(elapsed)
    }
    if (!ended.value && !prefs.value.hold) try { recog.start() } catch { /* going */ }
  }
  listenAs(prefs.value.hold)
}

/*
 * THE PAGE IS GOING AWAY. This used to be an "End" button, and pressing it put the surface at
 * Connecting… for ever: the recogniser stopped, nothing restarted it, and the only way back was
 * a reload. A voice assistant has no end — somebody stops talking and leaves, the way they leave
 * a phone call by hanging up rather than by closing the conversation — so there is no control
 * for it, and this runs when the page is actually unmounted.
 */
function leaving() {
  out && out.stop()
  clearInterval(usageTimer); usageTimer = 0
  clearTimeout(settle); settle = 0; breath = ''
  heard.value = ''
  ended.value = true
  try { recog && (recog.onend = null, recog.stop()) } catch { /* gone */ }
  chat.value && chat.value.stop()
}

/*
 * DEV ONLY. The chain from the audio graph to the shape has been proved a piece at a time and
 * been wrong in the page anyway, which means the pieces were never the problem — the wiring
 * between them was. This hands a probe the real page's own objects so synthetic audio can be
 * pushed through the real player and the real numbers read out. Inert in a build.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__voice = {
    get theirs() { return theirs.value },
    get mine() { return mine.value },
    get phase() { return phase.value },
    get speaker() { return sp && sp.id },
    get aloud() { return aloud.value },
    level: () => (out ? out.level() : null),
    /* push a second of speech-shaped audio through the page's OWN player */
    push(secs = 1.5) {
      if (!out) return 'no player'
      const R = 44100, n = Math.floor(R * secs), f = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const t = i / R, syl = Math.floor(t / 0.28)
        const amp = (t % 0.28) < 0.18 ? 0.12 + 0.3 * Math.abs(Math.sin(syl * 1.7)) : 0.004
        f[i] = Math.sin(2 * Math.PI * 170 * t) * amp
      }
      out.frames(f, R)
      return 'pushed'
    },
  }
}

onMounted(() => {
  if (dev.has('demo')) {
    chat.value = conversation({ speaker: { say: () => Promise.resolve(), cancel() {} }, ask: async () => '' })
    DEMO.forEach(([who, text]) => chat.value.state.said.push({ who, text }))
    chat.value.state.phase = forced || 'thinking'
    return
  }
  if (!forced) begin()
})
onBeforeUnmount(() => {
  leaving()
  if (voiceRoom) { void voiceRoom.disconnect(); voiceRoom = null }
  for (const pending of roomAnswers.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error(W.value['connection-error'] || ''))
  }
  roomAnswers.clear()
  cancelAnimationFrame(raf)
  clearTimeout(settle)
  try { recog && (recog.onend = null, recog.stop()) } catch { /* gone */ }
  try { mic && mic.stop() } catch { /* gone */ }
  try { ctx && ctx.close() } catch { /* gone */ }
  chat.value && chat.value.stop()
})
</script>

<template>
  <div class="vp lproot lpfull" :data-phase="phase" :data-typing="canType ? 'yes' : 'no'">
    <!-- the site's own ground, so a conversation belongs to the site rather than to a demo -->
    <div class="lpbg"></div>
    <div class="lpblobs"><span class="lpblob lpb1"></span><span class="lpblob lpb2"></span><span class="lpblob lpb3"></span></div>
    <div class="lpgrain"></div>

    <div v-if="fault" class="vp-gate">
      <p class="vp-gate-say">{{ fault }}</p>
      <button v-if="needsSignIn" type="button" class="vp-btn vp-btn-wide" @click="openAuth">{{ W['sign-in-cta'] }}</button>
    </div>

    <!--
      WHAT WAS SAID BEFORE. A drawer rather than a column: this surface is one thing in the middle
      of an empty room, and a permanent sidebar beside it would make the orb a panel in an app.
      It is shut until it is asked for, and it shuts itself the moment a conversation is chosen,
      because what somebody wants after choosing one is the conversation.
    -->
    <template v-else>
    <div class="vp-past" :class="{ 'is-open': showSessions }" :aria-hidden="!showSessions">
      <div class="vp-past-top">
        <p class="vp-past-head">{{ pastView === 'memory' ? MEMORY.title : W['sessions-head'] }}</p>
        <button v-if="pastView === 'sessions'" type="button" class="vp-past-new" @click="freshSession">{{ W['sessions-new'] }}</button>
      </div>
      <div v-if="bot?.memory === 'person+recall'" class="vp-past-tabs" role="group"
           :aria-label="MEMORY['views-label']">
        <button type="button" :aria-pressed="pastView === 'sessions'"
                :class="{ 'is-selected': pastView === 'sessions' }" @click="pastView = 'sessions'">
          {{ W['sessions-head'] }}
        </button>
        <button v-if="bot?.memory === 'person+recall'" type="button"
                :aria-pressed="pastView === 'memory'" :class="{ 'is-selected': pastView === 'memory' }"
                @click="showMemories">
          {{ MEMORY.tab }}
        </button>
      </div>
      <template v-if="pastView === 'sessions'">
      <p v-if="!sessions.length" class="vp-past-none">{{ W['sessions-none'] }}</p>
      <ul v-else class="vp-past-list">
        <li v-for="t in sessions" :key="t.id" :class="{ 'is-here': t.id === threadId }">
          <button type="button" class="vp-past-one" @click="openSession(t.id)">
            <span class="vp-past-title">{{ t.title }}</span>
            <span class="vp-past-when">{{ said_when(t.spoke_at) }}</span>
          </button>
          <!-- a conversation is deleted once and for ever, so it is asked about in place rather
               than behind a dialogue that covers the thing being deleted -->
          <template v-if="asking === t.id">
            <button type="button" class="vp-past-yes" @click="dropSession(t.id)">{{ W['session-yes'] }}</button>
            <button type="button" class="vp-past-no" @click="asking = null">{{ W['session-no'] }}</button>
          </template>
          <button v-else type="button" class="vp-past-x" :title="W['session-delete']" @click="asking = t.id">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>
            <span class="vp-sr">{{ W['session-delete'] }}</span>
          </button>
        </li>
      </ul>
      </template>
      <template v-else>
        <p v-if="memoryFault" class="vp-past-none" role="alert">{{ memoryFault }}</p>
        <p v-else-if="memoryLoading" class="vp-past-none" role="status">{{ MEMORY.loading }}</p>
        <p v-else-if="!memories.length" class="vp-past-none">{{ MEMORY.empty }}</p>
        <ul v-else class="vp-past-list vp-memory-list">
          <li v-for="item in memories" :key="item.id">
            <div class="vp-past-one">
              <span class="vp-memory-said">{{ item.said }}</span>
              <span class="vp-past-when">{{ said_when(item.created_at) }}</span>
            </div>
            <template v-if="askingMemory === item.id">
              <button type="button" class="vp-past-yes" :disabled="!!memoryDeleting" @click="dropMemory(item.id)">
                {{ memoryDeleting === item.id ? MEMORY.deleting : MEMORY['delete-yes'] }}
              </button>
              <button type="button" class="vp-past-no" :disabled="!!memoryDeleting" @click="askingMemory = null">
                {{ MEMORY['delete-no'] }}
              </button>
            </template>
            <button v-else type="button" class="vp-past-x" :title="MEMORY['delete-label']"
                    :aria-label="MEMORY['delete-label']" :disabled="!!memoryDeleting" @click="askingMemory = item.id">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>
            </button>
          </li>
        </ul>
      </template>
    </div>
    <p v-if="usageFault" class="vp-telemetry-alert" role="alert">{{ usageFault }}</p>
    <div v-if="showSessions" class="vp-veil" @click="showSessions = false"></div>

    <!--
      THE TWO CORNERS. What is open on the left and what is set on the right: both are reached
      for rarely, both are about the surface rather than about the conversation, and neither
      belongs in a bar beside the microphone. The drawer opens from the left, so its button is
      on the left, where the thing it opens will appear.
    -->
    <button type="button" class="vp-corner vp-rail" :class="{ 'is-on': showSessions }"
            :aria-pressed="showSessions" :title="W[showSessions ? 'sessions-hide' : 'sessions-show']"
            @click="showSessions = !showSessions">
      <!-- the panel-and-divider every editor uses for this, not an invention -->
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/></svg>
      <span class="vp-sr">{{ W[showSessions ? 'sessions-hide' : 'sessions-show'] }}</span>
    </button>

    <button type="button" class="vp-corner vp-cog" :title="W['settings']" @click="showPrefs = true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      <span class="vp-sr">{{ W['settings'] }}</span>
    </button>

    <VoiceSettings v-if="showPrefs" :prefs="prefs" :voices="canPick" :voice-now="voiceNow" :lang-now="langNow" :visual-now="visualNow"
                   @change="setPrefs" @close="showPrefs = false" />

    <div class="vp-stage">
      <p class="vp-eyebrow">{{ bot?.name || '' }}</p>

      <!-- THE ORB: the only thing in the middle, with a glow that breathes behind it -->
      <div class="vp-mid">
      <div class="vp-orb">
        <!-- the aura paints its own light; behind anything else a soft halo gives the shape a
             ground to sit on, and behind the aura it only washes the strands out -->
        <span v-if="visual !== 'aura'" class="vp-halo" aria-hidden="true"></span>
        <VoiceVisual :shape="visual" :state="phase" :mine="mine" :theirs="theirs" :label="label" />
      </div>

      <p class="vp-status" aria-hidden="true"><span class="vp-dot"></span>{{ label }}</p>

      <!-- THE LIVE LINE: being spoken, or spoken and still waiting. Never what has been answered. -->
      <p class="vp-line" :class="{ 'is-held': !!latest }" :data-who="latest?.who || ''"
         :role="said.length ? null : 'status'" :aria-live="said.length ? 'off' : 'polite'"
         :aria-hidden="said.length > 0">{{ latest?.text || '' }}</p>

      </div>

      <!--
        The record. In the DOM whether it is open or shut, because it is also the accessible form
        of the whole surface. A ROW OF THE STAGE, not a child of the centred block: inside it,
        every line that arrived pushed the orb another notch up the screen.

        A DIV WITH A ROLE, never a <section>: the site's global stylesheet owns the bare element
        and pads it 96px top and bottom. That padding is the whole of the 192px hole that sat
        under this page for days and was twice blamed on flex — the panel was 192px tall while
        closed and 100px of it hung empty below the last line while open. A page component that
        borrows a bare element name borrows whatever the site has done to it.
      -->
      <div ref="logEl" class="vp-log" :class="{ 'is-open': showLog, 'is-clipped': clipped }" role="log">
        <TransitionGroup tag="ol" name="vp-msg" class="vp-roll">
          <li v-for="(s, i) in log" :key="i" :data-who="s.who"><span>{{ s.text }}</span></li>
        </TransitionGroup>
      </div>

      <!--
        THE FURNITURE, as one thing. The box and the controls were laid out separately — the bar
        fixed to the floor, the box in the flow above it — and they landed on top of each other
        with the box half off the bottom of the screen. They are one footer, and the stage is
        padded by whatever it comes to.
      -->
      <div class="vp-foot">
      <!-- the way in when there is no voice: the same conversation, typed -->
      <form v-if="canType" class="vp-say" @submit.prevent="sendTyped">
        <input v-model="typed" type="text" class="vp-say-in" :placeholder="W['compose']"
               :aria-label="W['compose']" autocomplete="off" />
        <button type="submit" class="vp-say-go" :disabled="!typed.trim()" :title="W['send']">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M12 6l6 6-6 6"/></svg>
          <span class="vp-sr">{{ W['send'] }}</span>
        </button>
      </form>

      <div class="vp-bar">
        <!-- THE SAME BUTTON, TWO JOBS, because there are two ways of being heard and only one
             microphone: where the microphone is open it mutes, and where it is held it IS the
             way in. Pointer events rather than click, so it works with a finger and a mouse and
             so letting go anywhere — even off the button — stops it. -->
        <button type="button" class="vp-btn"
                :class="{ 'is-off': muted && !prefs.hold, 'is-held': held }"
                :aria-pressed="prefs.hold ? held : muted"
                :title="prefs.hold ? W['talk'] : W[muted ? 'unmute' : 'mute']"
                @click="prefs.hold || (muted = !muted)"
                @pointerdown="holdOn" @pointerup="holdOff" @pointercancel="holdOff" @pointerleave="holdOff">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="!muted" d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"/><path v-else d="M12 3a3 3 0 0 1 3 3v5.2L9 5.2V6a3 3 0 0 1 3-3Zm0 15v3M4 4l16 16"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
          <span class="vp-sr">{{ prefs.hold ? W['talk'] : W[muted ? 'unmute' : 'mute'] }}</span>
        </button>
        <button type="button" class="vp-btn" :class="{ 'is-on': showLog }" :aria-pressed="showLog"
                :title="W[showLog ? 'transcript-hide' : 'transcript-show']" @click="showLog = !showLog">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 11h16M4 16h9"/></svg>
          <span class="vp-sr">{{ W[showLog ? 'transcript-hide' : 'transcript-show'] }}</span>
        </button>
        <!--
          SPEAK OR DO NOT. Here the ✕ through a speaker is exactly right, because off really is
          off — which is why it was wrong on the control this replaced, where both states were a
          working voice and the ✕ said one of them was broken.
        -->
        <button type="button" class="vp-btn" :class="{ 'is-off': !aloud }" :aria-pressed="!aloud"
                :title="W[aloud ? 'silence' : 'speak']" @click="flipAloud">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4Z"/>
            <template v-if="aloud"><path d="M16.2 9.4a3.6 3.6 0 0 1 0 5.2"/><path d="M18.8 7a7 7 0 0 1 0 10"/></template>
            <template v-else><path d="M17 10l4 4M21 10l-4 4"/></template>
          </svg>
          <span class="vp-sr">{{ W[aloud ? 'silence' : 'speak'] }}</span>
        </button>
      </div>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* one curve for the whole surface, and nothing moves where less motion was asked for */
.vp { --ease: cubic-bezier(.2,.8,.2,1); position: relative; min-height: 100dvh; display: grid; place-items: stretch; overflow: hidden }
/*
 * LIFT THE GROUND, DO NOT PIN THE CONTENT. This was a :not() chain naming everything that must
 * stay fixed, and it caught three things in turn — the drawer came out 190px tall, then the
 * settings veil covered the middle of the page instead of all of it, and the cog landed in the
 * top LEFT corner in the document flow. Each time the fix was another :not(), which is a rule
 * that has to be edited every time anybody adds a fixed element and silently breaks it when
 * they forget.
 *
 * The three background layers are the things that need to be behind; so they are the things that
 * are addressed. Everything else is left alone and keeps whatever position it asked for.
 */
.vp > .lpbg, .vp > .lpblobs, .vp > .lpgrain { z-index: 0 }
.vp-stage, .vp-gate { position: relative; z-index: 1 }

/* three rows: the name, then the orb and the words TOGETHER in the optical centre, then the bar.
   Centring the lot as one block is what left a third of the viewport empty under the status. */
/* HEIGHT, not min-height, and a middle row that may be squeezed: with min-height the column grew
   past the viewport the moment the log filled, and the last bubble went under the control bar —
   on a surface whose whole point is that nothing scrolls. Measured: 965px of content in 900. */
.vp-stage { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr);
  justify-items: center; align-items: center; width: 100%; max-width: 680px; height: 100dvh;
  margin: 0 auto; padding: 32px 16px calc(140px + env(safe-area-inset-bottom, 0px)); text-align: center }
/* and when there is a box to type in, the footer is taller by exactly that much */
.vp[data-typing='yes'] .vp-stage { padding-bottom: calc(202px + env(safe-area-inset-bottom, 0px)) }
/* FLEX, not grid align-content: as a stretched grid item the middle row kept its children at the
   top and left 192px of nothing under them, which is exactly what made the page read as unfinished.
   Measured, not guessed — the boxes are in the commit message. */
.vp-mid { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 0 }

.vp-eyebrow { margin: 0; min-height: 1.2em; font-family: var(--fm, inherit); font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3) }

/* the orb, and the glow that breathes behind it */
.vp-orb { position: relative; display: grid; place-items: center; width: clamp(150px, min(34vmin, 28vh), 300px); aspect-ratio: 1; flex: 0 0 auto }
.vp-orb :deep(.cv) { max-width: none }
.vp-halo { position: absolute; inset: -18%; border-radius: 50%; background: var(--accent); filter: blur(60px); opacity: .1; transition: opacity .6s var(--ease), transform .6s var(--ease) }
.vp[data-phase='speaking'] .vp-halo { opacity: .3; transform: scale(1.08) }
.vp[data-phase='listening'] .vp-halo { opacity: .14 }
.vp[data-phase='thinking'] .vp-halo { opacity: .2 }

.vp-status { display: inline-flex; align-items: center; gap: 8px; margin: clamp(14px, 4vh, 34px) 0 0; padding: 6px 14px 6px 11px; border-radius: 999px; border: 1px solid var(--hair); background: var(--card2); color: var(--ink3); font-size: 13px }
.vp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink3) }
.vp[data-phase='listening'] .vp-dot { background: var(--accent) }
.vp[data-phase='speaking'] .vp-dot { background: var(--accent2, var(--accent)) }
@media (prefers-reduced-motion: no-preference) {
  .vp[data-phase='thinking'] .vp-dot { animation: vp-pulse 1.1s var(--ease) infinite }
}
@keyframes vp-pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }

/*
 * THE LIVE LINE. It keeps its height whether or not it holds anything, so the orb above it and
 * the log below it do not jump every time a sentence is answered — the surface has to be still
 * while the words move, not the other way round.
 */
.vp-line { margin: clamp(14px, 3vh, 26px) 0 0; min-height: 2.6em; max-width: 34ch;
  font-family: var(--fd, inherit); font-size: clamp(20px, 3.2vw, 28px); line-height: 1.4;
  text-wrap: balance; color: var(--ink); opacity: 0; transform: translateY(5px);
  transition: opacity .32s var(--ease), transform .32s var(--ease) }
.vp-line.is-held { opacity: 1; transform: none }

/* the whole conversation, for afterwards */
/* Collapsed with an explicit height rather than max-height, so there is nothing for a stray
   inherited padding to grow back into. The 192px it used to stand at while closed was the global
   `section` rule, not this box — see the element it is written on. */
.vp-log { width: 100%; align-self: end; height: 0; min-height: 0; overflow: hidden; opacity: 0;
  transition: height .42s var(--ease), opacity .3s var(--ease), margin-top .42s var(--ease) }
.vp-log.is-clipped { mask-image: linear-gradient(to bottom, transparent, #000 32px) }
.vp-log.is-open { height: auto; max-height: min(38vh, 340px); overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: thin; opacity: 1; margin-top: clamp(12px, 3vh, 28px) }
.vp-roll { list-style: none; margin: 0; padding: 4px 0 2px; display: grid; gap: 8px; text-align: left }
.vp-log li { display: flex }
.vp-log li[data-who='me'] { justify-content: flex-end }
.vp-log span { max-width: 80%; padding: 9px 14px; border-radius: 16px; font-size: 15px; line-height: 1.45; background: var(--card2); border: 1px solid var(--hair); color: var(--ink) }
.vp-log li[data-who='me'] span { background: transparent; color: var(--ink3) }

/*
 * A LINE ARRIVES, it does not appear. The answer is already being spoken by the time its bubble
 * lands, so the two have to feel like one event; the person's own line slides in from their side
 * of the column and the assistant's from the other, which is the only cue a glance needs.
 */
.vp-msg-enter-active { transition: opacity .34s var(--ease), transform .34s var(--ease) }
.vp-msg-move { transition: transform .34s var(--ease) }
.vp-msg-enter-from { opacity: 0; transform: translate3d(-10px, 8px, 0) }
li[data-who='me'].vp-msg-enter-from { transform: translate3d(10px, 8px, 0) }
/* the controls, at the edge where they can be ignored */
.vp-foot { position: fixed; z-index: 1; left: 50%; bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%); display: grid; justify-items: center; gap: 12px; width: min(560px, calc(100vw - 32px)) }
.vp-bar { display: flex; gap: 12px; padding: 10px; border-radius: 999px; border: 1px solid var(--hair); background: var(--card2); backdrop-filter: blur(10px) }
.vp-btn { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--hair); background: transparent; color: var(--ink); cursor: pointer; transition: background .25s var(--ease), color .25s var(--ease), border-color .25s var(--ease) }
.vp-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round }
.vp-btn:hover { background: var(--accentbg) }
/*
 * TWO WEIGHTS, BECAUSE THE STATES ARE NOT WORTH THE SAME. Every pressed control wore the same
 * solid fill, so a drawer open and a transcript open and a muted microphone put three white
 * discs in a row of five and the bar read as an alarm. Opening a panel is housekeeping and takes
 * a tint; a shut microphone has consequences and keeps the fill, which is now the only one.
 */
.vp-btn.is-on { background: var(--accentbg); border-color: var(--accentbg) }
.vp-btn.is-off { background: var(--ink); color: var(--paper); border-color: var(--ink) }
.vp-btn-wide { width: auto; padding: 0 26px; border-radius: 999px; background: var(--ink); color: var(--paper); border-color: var(--ink) }
.vp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%) }

/* ---------- the way in when there is no voice ---------- */
/* it belongs to the conversation rather than to the controls, so it sits with the words and
   wears the same pill the bar does rather than a form's square box */
.vp-say { display: flex; gap: 8px; width: 100%;
  padding: 6px 6px 6px 18px; border-radius: 999px; border: 1px solid var(--hair);
  background: var(--card2); backdrop-filter: blur(10px) }
.vp-say-in { flex: 1 1 auto; min-width: 0; border: 0; background: none; color: var(--ink);
  font: inherit; font-size: 15px; outline: none }
.vp-say-in::placeholder { color: var(--ink3) }
.vp-say-go { flex: 0 0 auto; display: grid; place-items: center; width: 38px; height: 38px;
  border: 0; border-radius: 50%; background: var(--ink); color: var(--paper); cursor: pointer;
  transition: opacity .25s var(--ease) }
.vp-say-go:disabled { opacity: .35; cursor: default }
.vp-say-go svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round }

/* ---------- the conversations from before ---------- */
/* OFF-CANVAS, not display:none: a drawer that is not in the layout cannot be animated, and this
   one slides because it is reached for mid-conversation and a panel that appears is a jolt. */
.vp-past { position: fixed; z-index: 3; top: 0; bottom: 0; left: 0; width: min(320px, 86vw);
  display: flex; flex-direction: column; gap: 4px;
  padding: calc(20px + env(safe-area-inset-top, 0px)) 14px calc(20px + env(safe-area-inset-bottom, 0px));
  border-right: 1px solid var(--hair); background: var(--card2); backdrop-filter: blur(16px);
  transform: translateX(-102%); visibility: hidden;
  transition: transform .42s var(--ease), visibility .42s var(--ease) }
.vp-past.is-open { transform: none; visibility: visible }
.vp-past-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 0 8px 8px }
.vp-past-head { margin: 0; font-family: var(--fm, inherit); font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3) }
.vp-past-tabs { display: flex; gap: 6px; padding: 0 8px 8px }
.vp-past-tabs button { padding: 5px 10px; border: 1px solid var(--hair); border-radius: 999px; background: none; color: var(--ink3); font: inherit; font-size: 12px; cursor: pointer }
.vp-past-tabs button.is-selected { border-color: var(--accentbg); background: var(--accentbg); color: var(--ink) }
.vp-past-new { padding: 4px 10px; border: 1px solid var(--hair); border-radius: 999px; background: none; color: var(--ink); font: inherit; font-size: 13px; cursor: pointer }
.vp-past-new:hover { background: var(--accentbg) }
.vp-past-none { margin: 10px 8px; color: var(--ink3); font-size: 14px; line-height: 1.5 }
.vp-telemetry-alert { position: fixed; z-index: 20; bottom: 1rem; left: 50%; width: min(90vw, 32rem); transform: translateX(-50%); margin: 0; padding: .8rem 1rem; border: 1px solid var(--hair); border-radius: .8rem; background: var(--paper); color: var(--ink); box-shadow: 0 12px 40px -20px #0008; font-size: .85rem; }
.vp-past-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: grid; gap: 2px; align-content: start }
.vp-past-list li { display: flex; align-items: center; gap: 2px; border-radius: 10px }
.vp-past-list li:hover, .vp-past-list li.is-here { background: var(--accentbg) }
.vp-past-one { flex: 1 1 auto; min-width: 0; display: grid; gap: 1px; padding: 9px 10px; border: 0; background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer }
/* one line, cut with an ellipsis: a title that wraps to three lines turns a list into a page */
.vp-past-title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px }
.vp-memory-said { overflow-wrap: anywhere; font-size: 14px; line-height: 1.45 }
.vp-memory-list li { align-items: flex-start; border-bottom: 1px solid var(--hair); border-radius: 0; padding: 5px 0 }
.vp-past-when { font-size: 12px; color: var(--ink3) }
.vp-past-x { flex: 0 0 auto; display: grid; place-items: center; width: 28px; height: 28px; margin-right: 6px; border: 0; border-radius: 50%; background: none; color: var(--ink3); cursor: pointer; opacity: 0; transition: opacity .2s var(--ease) }
.vp-past-list li:hover .vp-past-x, .vp-past-x:focus-visible { opacity: 1 }
.vp-past-x svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round }
.vp-past-yes, .vp-past-no { flex: 0 0 auto; margin-right: 4px; padding: 3px 9px; border: 1px solid var(--hair); border-radius: 999px; background: none; font: inherit; font-size: 12px; cursor: pointer }
.vp-past-yes { color: var(--accent); border-color: var(--accentbg) }
.vp-past-no { color: var(--ink3) }
.vp-past-yes:disabled, .vp-past-no:disabled, .vp-past-x:disabled { cursor: wait; opacity: .55 }
/* the drawer is reached for mid-conversation, so the way out is anywhere else */
.vp-veil { position: fixed; z-index: 2; inset: 0 }

/* the corners: present, quiet, and never over the conversation */
.vp-corner { position: fixed; z-index: 4; top: calc(18px + env(safe-area-inset-top, 0px));
  display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid transparent; background: none; color: var(--ink3); cursor: pointer;
  transition: color .25s var(--ease), border-color .25s var(--ease), background .25s var(--ease) }
.vp-corner:hover { color: var(--ink); border-color: var(--hair) }
.vp-corner.is-on { color: var(--ink); background: var(--accentbg) }
.vp-corner svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round }
.vp-rail { left: 18px }
.vp-cog { right: 18px }

/* held: the microphone is open because somebody is holding it open, which is a state worth
   seeing from across the room */
.vp-btn.is-held { background: var(--accent); color: var(--paper); border-color: var(--accent) }

.vp-gate { display: grid; justify-items: center; gap: 18px; padding: 24px; text-align: center }
.vp-gate-say { margin: 0; max-width: 32ch; color: var(--ink3); font-size: 16px; line-height: 1.5 }

@media (max-width: 480px) {
  .vp-stage { padding-bottom: 128px }
  .vp-log.is-open { max-height: 34vh }
}
@media (hover: none) {
  .vp-past-x { opacity: 1 }
}
@media (prefers-reduced-motion: reduce) {
  .vp-halo, .vp-line, .vp-log, .vp-msg-enter-active, .vp-msg-move, .vp-past,
  .vp-past-x, .vp-btn, .vp-say-go, .vp-corner { transition: none }
  .vp-msg-enter-from { transform: none }
}
</style>
