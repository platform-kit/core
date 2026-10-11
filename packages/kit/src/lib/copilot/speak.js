/*
 * HOW AN ASSISTANT IS HEARD — one shape, two providers, chosen the way the video rooms are.
 *
 * THE BASE CASE NEEDS NO ACCOUNT AND NO SERVICE. A one-to-one conversation has no second human in
 * it, so it needs no media server, no peer and nothing to join: the microphone and the speaker are
 * both in the page already. The voice is the kit's own Supertonic engine, which this project ships
 * for the audiobooks — the same worker, the same cached weights — asked for one sentence at a time
 * instead of a chapter.
 *
 * That matters beyond tidiness: a site can have a spoken assistant with no voice account, no
 * container, no per-minute cost and no audio leaving the machine, exactly as a video room with no
 * LiveKit account is still a video room. A business should not have to buy an account to find out
 * whether it wants the feature.
 *
 *   browser    the kit's own engine, in the page. No account, no key, no egress. The floor.
 *   endpoint   an OpenAI-shaped /v1/audio/speech the site names. The KEY NEVER REACHES THE
 *              BROWSER: the site names it and the platform's own function calls it, which is the
 *              only reason this is a provider rather than a url in the config.
 *
 * IT STREAMS, AND THAT IS NOT AN OPTIMISATION. Waiting for a whole sentence to be synthesised
 * before any of it is heard is the difference between a conversation and a transaction — a second
 * of silence after every turn is what makes a voice assistant feel like a form. So `say` does not
 * return audio: it is handed an `onChunk` and feeds it as the bytes arrive, and the platform's
 * proxy passes the body through without buffering it. The browser engine streams too, by its own
 * pieces, so the two providers behave the same way and the surface above cannot tell them apart.
 *
 * Pure but for the fetch and the worker it is handed, so the choosing, the ordering and the
 * cancelling are all testable under node.
 */

/* which provider a site gets: what it declared, where that can actually work */
export function speakerIdOf({ voice = {}, haveEndpoint = false } = {}) {
  const asked = String(voice.by || '').trim().toLowerCase()
  if (asked === 'browser') return 'browser'
  /* an endpoint asked for and not configured falls back rather than going silent: an assistant
     that sounds ordinary is better than one that says nothing */
  if (asked === 'endpoint') return haveEndpoint ? 'endpoint' : 'browser'
  return haveEndpoint ? 'endpoint' : 'browser'
}

/*
 * ONE UTTERANCE AT A TIME, AND THE LAST ONE WINS. A conversation is not a chapter: when somebody
 * interrupts, what was being said stops and what is being said now takes its place. Every
 * utterance carries an id, `cancel` abandons it, and a chunk that arrives for a cancelled one is
 * dropped rather than played over whatever replaced it.
 */
/*
 * AND A VOICE THAT STOPS WORKING FALLS BACK, which is not the same promise as a voice that was
 * never configured. The second was handled from the start; the first was not, and it is the one
 * that actually happens: a key expires, an account runs out of credit, a provider has an hour of
 * trouble. The endpoint then answered 502 to every utterance, `say` resolved with nothing, and
 * the assistant was SILENT — no error, no fallback, no sign that anything was wrong. An
 * assistant that sounds ordinary is better than one that says nothing, and that has to hold at
 * run time or it is not a promise, it is a comment.
 *
 * It falls back ONCE and stays fallen: retrying a dead endpoint every turn pays a round-trip per
 * sentence to learn the same thing. The worker is made only if it is needed, so a deployment
 * whose endpoint works never builds one.
 */
export function speaker({ id = 'browser', worker = null, post = null, voice = {}, onState = () => {} } = {}) {
  const own = () => browserSpeaker({ worker: typeof worker === 'function' ? worker() : worker, voice, onState })
  if (id !== 'endpoint') return own()
  return failover({ first: endpointSpeaker({ post, voice }), own })
}

function failover({ first, own }) {
  let fallen = null          /* the kit's own voice, once we have had to reach for it */
  let n = 0
  const live = new Map()     /* our utterance id → whichever speaker is carrying it */
  return {
    get id() { return fallen ? 'browser' : 'endpoint' },
    say(text, onChunk = () => {}) {
      const utterance = 'say-' + (++n)
      const p = (async () => {
        if (!fallen) {
          live.set(utterance, first)
          let got = null, failed = false
          /* the endpoint hands over raw bytes; those are the endpoint's own shape, and the page
             is told which speaker made them by what it is handed */
          try { got = await first.say(text, (c) => onChunk(c)).catch?.(() => { failed = true; return null }) }
          catch { failed = true }
          if (!live.has(utterance)) return null          /* cancelled while it was trying */
          if (got) { live.delete(utterance); return got }
          /* null without a cancel is a dead endpoint, whether it threw or answered badly */
          if (!failed && got === null) failed = true
          if (!failed) { live.delete(utterance); return null }
          fallen = own()
        }
        live.set(utterance, fallen)
        try { return await fallen.say(text, onChunk) } finally { live.delete(utterance) }
      })()
      return Object.assign(p, { utterance })
    },
    cancel(utterance) {
      const who = live.get(utterance)
      live.delete(utterance)
      /* the child made its own id; it has exactly one in flight, so cancelling its latest is
         cancelling this one */
      if (who && who.cancelLatest) who.cancelLatest()
      else if (who) who.cancel(who.latest)
    },
  }
}

/*
 * The kit's own engine, in the worker the audiobooks already use — asked to speak LIVE, which is
 * the one thing a conversation needs that a chapter does not: each piece handed over the moment
 * it exists, as `{ pcm, rate }`, so the opening is heard while the rest is still being made.
 *
 * THE FINISHED MP3 IS NOT PLAYED. It arrives with `done` because the recording cache wants it,
 * and handing it on here would play the whole answer a second time over the pieces.
 */
function browserSpeaker({ worker, voice, onState = () => {} }) {
  let n = 0
  const live = new Map()
  if (worker) {
    worker.addEventListener('message', (e) => {
      const m = e.data || {}
      /*
       * THE VOICE HAS TO BE FETCHED BEFORE IT CAN SPEAK, and it is 400 MB. These three messages
       * carry no audio and belong to no utterance, so they were being dropped — which is how a
       * reader waiting several minutes for a download got a surface that simply said nothing and
       * looked broken. They are not the conversation; they are the reason there is not one yet.
       */
      if (m.type === 'download') return onState({ at: 'fetching', done: m.done, total: m.total })
      if (m.type === 'loading') return onState({ at: 'starting' })
      if (m.type === 'ready') return onState({ at: 'ready' })
      const w = live.get(m.id)
      if (!w) return
      if (m.type === 'piece') w.onChunk({ pcm: m.pcm, rate: m.rate, i: m.i })
      else if (m.type === 'done') { live.delete(m.id); w.resolve({ seconds: m.seconds, blob: m.blob }) }
      else if (m.type === 'error') { live.delete(m.id); m.message === 'cancelled' ? w.resolve(null) : w.reject(new Error(m.message)) }
    })
  }
  return {
    id: 'browser',
    say(text, onChunk = () => {}) {
      if (!worker) return Object.assign(Promise.reject(new Error('no voice worker')), { utterance: null })
      const utterance = 'say-' + (++n)
      const p = new Promise((resolve, reject) => live.set(utterance, { resolve, reject, onChunk }))
      worker.postMessage({ type: 'speak', id: utterance, text, live: true, engine: engineOf(voice) })
      return Object.assign(p, { utterance })
    },
    cancel(utterance) { if (worker && utterance) { live.delete(utterance); worker.postMessage({ type: 'cancel', id: utterance }) } },
    get latest() { return 'say-' + n },
    cancelLatest() { this.cancel('say-' + n) },
  }
}

/*
 * WHAT THE SITE ASKED THE ENGINE FOR, from the bot's own `voice:` block. Only the opening piece
 * is ever waited for, so `opening` is the one worth lowering; `gap` is the pause between pieces,
 * which wants to be far shorter in a conversation than between the paragraphs of a chapter.
 */
export function engineOf(voice = {}) {
  const e = { ...(voice.engine || {}) }
  if (voice.steps) e.steps = voice.steps
  if (voice.opening) e.opening = voice.opening
  if (voice.gap !== undefined) e.gap = voice.gap
  if (voice.words !== undefined) e.first = voice.words
  return Object.keys(e).length ? e : undefined
}

/*
 * AN OPENAI-SHAPED ENDPOINT, THROUGH OUR OWN FUNCTION, READ AS IT ARRIVES.
 *
 * `post` is handed in rather than fetched here, so this module has no idea where the platform
 * lives and a test can drive it with any stream. It must answer with a ReadableStream — the
 * proxy's job is to pass the body through, never to collect it.
 */
function endpointSpeaker({ post, voice }) {
  let n = 0
  const gone = new Set()
  return {
    id: 'endpoint',
    say(text, onChunk = () => {}) {
      const utterance = 'say-' + (++n)
      const p = (async () => {
        const stream = await post({ text, voice: voice.say || undefined, format: voice.format || 'pcm' })
        if (!stream) return null
        const reader = stream.getReader()
        let chunks = 0
        for (;;) {
          const { done, value } = await reader.read()
          /* interrupted: stop pulling and let the rest of the answer go unheard */
          if (gone.has(utterance)) { try { await reader.cancel() } catch { /* already gone */ } return null }
          if (done) break
          if (value && value.length) { chunks++; onChunk(value) }
        }
        return { chunks }
      })()
      return Object.assign(p, { utterance })
    },
    cancel(utterance) { if (utterance) gone.add(utterance) },
    get latest() { return 'say-' + n },
    cancelLatest() { this.cancel('say-' + n) },
  }
}
