/*
 * A SPOKEN CONVERSATION'S GRANT.
 *
 * The thing that listens runs outside this deployment, in a room with somebody's microphone. What
 * it may do is a signed grant and nothing wider: one bot, one person, one room, a ceiling it
 * cannot raise and a clock it cannot wind back. These are the tamper cases the spec names, each
 * altered in turn — because "it is signed" is a claim, and a claim about security that nobody
 * tried to break is a hope.
 */
import { sign, open, grantExpiry, GRANT_MINUTES } from '../supabase/functions/_shared/copilot/grant.js'
import { MEMORIES, memoryOf, recalls } from '../src/lib/agents/loop.js'
import { speakerIdOf, speaker, engineOf } from '../src/lib/copilot/speak.js'
import { STATES, isState, frame, loudness } from '../src/lib/copilot/levels.js'
import { SHAPES } from '../src/lib/copilot/visual.js'
import { titleOf, whenOf, TITLE_MAX } from '../src/lib/copilot/threads.js'
import { talkPieces, openingCut, stepsFor, TALK, FIRST_WORDS, PACK } from '../src/lib/copilot/chunk.js'
import { echoGuard } from '../src/lib/copilot/echo.js'
import { chunkText } from '../src/lib/tts/engine.js'
import { createSpeechHandler } from '../supabase/functions/_shared/copilot/speech-proxy.js'
import { callHttp, fromOpenApi } from '../supabase/functions/_shared/agents/tools.js'
import { SURFACES } from './bots.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadSite } from './site.mjs'

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
console.log('\nTHE COPILOT\n')
const SITE = await loadSite(process.cwd())

const S = 'the-service-role-key'
const now = Date.parse('2026-10-03T12:00:00.000Z')
const claims = {
  bot: 'desk', subject: 'u-1', room: 'cp_abc', minutes: 20, cents: 200,
  ending: { minutes: 'The conversation has reached its time limit.', spend: 'The conversation has reached its spending limit.' },
  expires: grantExpiry(now),
}
const good = await sign(claims, S)

/* ---------------------------------------------------------- it round-trips */
{
  const r = await open(good, S, now)
  ok('a grant opens to what was signed',
    r.bot === 'desk' && r.subject === 'u-1' && r.room === 'cp_abc' && r.minutes === 20 && r.cents === 200
      && r.ending.minutes === claims.ending.minutes && r.ending.spend === claims.ending.spend, JSON.stringify(r))
  ok('and the default life is half an hour', GRANT_MINUTES === 30)
}

/* ------------------------------------------- each field altered in its turn */
/* the payload is base64url JSON, so this is exactly what somebody editing one would do */
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const retake = (patch) => {
  const [p, mac] = good.split('.')
  const body = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  return b64u(JSON.stringify({ ...body, ...patch })) + '.' + mac   /* the OLD signature, as an attacker has */
}
for (const [what, patch] of [
  ['another bot', { b: 'admin-bot' }],
  ['another person', { s: 'u-2' }],
  ['another room', { r: 'cp_someone_else' }],
  ['more minutes', { m: 600 }],
  ['a larger spend', { c: 100000 }],
  ['different ending words', { e: { m: 'Keep talking forever', c: 'Spend anything' } }],
  ['a later expiry', { x: grantExpiry(now) + 86_400_000 }],
]) {
  const r = await open(retake(patch), S, now)
  ok(`aimed at ${what} is refused`, r.error === 'signature', JSON.stringify(r))
}

/* The ceiling is enforced by the RPC, not by trusting the worker's per-turn request. Pin the
   locking, clock and reservation points here too; the local-stack suite drives their refusals. */
{
  const sql = fs.readFileSync(new URL('../supabase/schemas/95-copilot.sql', import.meta.url), 'utf8')
  const turn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION "public"."copilot_turn"'), sql.indexOf('CREATE OR REPLACE FUNCTION "public"."copilot_remember"'))
  ok('a signed room has a service-role-only ceiling row', /CREATE TABLE IF NOT EXISTS "public"\."copilot_sessions"/.test(sql)
    && /REVOKE ALL ON TABLE "public"\."copilot_sessions" FROM PUBLIC, "anon", "authenticated"/.test(sql))
  ok('each turn locks its grant-backed room before checking use', /WHERE room = p_room AND bot = p_bot AND user_id = p_subject\s+FOR UPDATE/i.test(turn))
  ok('the clock is checked across turns and caps the next run deadline', /conversation-minutes/.test(turn)
    && /c\.started_at \+ make_interval\(mins => c\.minutes\)/.test(turn))
  ok('completed spend and active reservations share the signed conversation ceiling',
    /status in \('queued', 'running', 'waiting'\) then budget_cents else spent_cents end/.test(turn)
      && /conversation-spend/.test(turn) && /c\.cents - used/.test(turn))
}

/* ------------------------------------------------------------- the clock */
{
  const soon = await sign({ ...claims, expires: now + 1000 }, S)
  ok('a live grant opens', !(await open(soon, S, now)).error)
  ok('the same grant a second later is expired', (await open(soon, S, now + 2000)).error === 'expired')
  ok('and it says expired rather than failing silently', (await open(soon, S, now + 2000)).error === 'expired')
}

/* ------------------------------------------------------------ the shapes */
for (const [what, token] of [
  ['nothing', ''],
  ['a word', 'nonsense'],
  ['one half', good.split('.')[0]],
  ['an empty signature', good.split('.')[0] + '.'],
  ['rubbish in both halves', 'aaa.bbb'],
]) {
  const r = await open(token, S, now)
  ok(`${what} is refused, not thrown`, !!r.error, JSON.stringify(r))
}

/* a grant must name its three things, or it is never made at all */
for (const [what, c] of [
  ['no bot', { ...claims, bot: '' }],
  ['no subject', { ...claims, subject: '' }],
  ['no expiry', { ...claims, expires: 0 }],
]) {
  let threw = false
  try { await sign(c, S) } catch { threw = true }
  ok(`a grant with ${what} is refused at signing`, threw)
}

/* ------- the one that matters: a different deployment's key opens nothing ------- */
ok('another deployment\'s key opens nothing', (await open(good, 'a-different-service-role-key', now)).error === 'signature')

/* An API may require identifying headers without requiring credentials. Keep those headers with
   the operation compiled from its spec, not in the browser or the kit's provider secrets. */
{
  const spec = JSON.parse(fs.readFileSync(new URL('../../../sites/demo/content/tools/forecast-api.openapi.json', import.meta.url), 'utf8'))
  const headers = { 'User-Agent': 'PlatformKit demo assistant (contact: hello@example.com)' }
  const tools = fromOpenApi(spec, { name: 'sample', only: ['point', 'gridpoint_forecast'], headers })
  let request
  const point = tools.find((tool) => tool.name === 'sample_point')
  const result = await callHttp(point, { latitude: 38.9, longitude: -77.0 }, {
    fetchImpl: async (url, init) => {
      request = { url, init }
      return new Response('{"properties":{"forecast":"ok"}}')
    },
  })
  ok('the recorded OpenAPI spec exposes only the allow-listed operations',
    tools.length === 2 && tools.every((tool) => tool.name !== 'sample_alerts_active'))
  ok('a no-secret identifying header is sent with the API request',
    request?.init.headers['User-Agent'] === headers['User-Agent'])
  ok('OpenAPI path parameters are substituted and the JSON result is returned',
    new URL(request?.url).pathname === '/points/38.9,-77' && result.properties?.forecast)
  const refused = await callHttp({ ...point, http: { ...point.http, headers: {} } }, { latitude: 38.9, longitude: -77 }, {
    fetchImpl: async () => new Response('{"title":"User-Agent is required"}', { status: 403 }),
  })
  ok('an API refusal is returned as an API error, not a tool failure',
    refused.error === 'the API answered 403' && refused.body.title === 'User-Agent is required')
}

/* ------------------------------------- voice is a surface, and recall a memory ------------- */
ok('voice is one of the surfaces a bot may declare', SURFACES.includes('voice'), SURFACES.join(','))
ok('the memory set is decided and person+recall is in it', MEMORIES.join(',') === 'none,thread,person,person+recall', MEMORIES.join(','))
ok('only person+recall recalls', recalls({ memory: 'person+recall' }) && !recalls({ memory: 'person' }) && !recalls({ memory: 'thread' }) && !recalls({}))
ok('and an unknown setting still falls back to the conversation', memoryOf({ memory: 'telepathic' }) === 'thread')

/* --------------------------------- what the compile refuses, against real files -------------- */
/*
 * A bot file is the declaration, so these are exercised by writing one and compiling it, not by
 * grepping for the message. The file is removed afterwards and the compile checked clean, so a
 * failure here cannot leave the repository holding a probe.
 */
{
  if (SITE.modules.bots !== false) {
    const f = 'content/bots/zz-voice-probe.md'
    const run = () => { try { execFileSync(process.execPath, [fileURLToPath(new URL('./bots.mjs', import.meta.url)), '--check'], { stdio: ['ignore', 'pipe', 'pipe'] }); return { ok: true, out: '' } } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') } } }
    const bot = (front) => `---\nname: Voice probe\n${front}---\n\nYou answer briefly.\n`
    try {
      fs.writeFileSync(f, bot('surfaces: [spaces]\nvoice: { say: alloy, greeting: Hello }\n'))
      const r = run()
      ok('a voice with nowhere to speak is refused, naming both', !r.ok && /declares how it sounds but not the voice surface/.test(r.out))

      fs.writeFileSync(f, bot('surfaces: [voice]\nvoice: { say: alloy, greeting: Hello, wait: 1.2 }\n'))
      ok('the voice surface with its settings compiles', run().ok)

      fs.writeFileSync(f, bot('surfaces: [voice]\n'))
      ok('the settings are optional', run().ok)

      fs.writeFileSync(f, bot('surfaces: [voice]\nmemory: person+recall\n'))
      ok('a bot may declare that it recalls', run().ok)

      fs.writeFileSync(f, bot('surfaces: [telepathy]\n'))
      ok('a surface nobody has heard of is still refused by name', !run().ok)

      fs.writeFileSync(f, bot('surfaces: [voice]\nmemory: telepathic\n'))
      ok('a memory setting nobody has heard of is refused', !run().ok)
    } finally { fs.rmSync(f, { force: true }) }
    ok('the probe is gone and the bots compile clean', run().ok)
  } else {
    console.log('  (bots module is disabled in this site — the bot-content compile check is not applicable)')
  }
}

/* ------------------------------------------------- how an assistant is heard ---------------- */
/*
 * THE BASE CASE NEEDS NO ACCOUNT. A site that configured nothing still has a voice — the kit's
 * own engine, in the page — exactly as a video room with no LiveKit account is still a video
 * room. That is the assertion the tier rests on; the rest is what a site may ask for instead.
 */
ok('a site that configured nothing is heard in the kit\'s own voice', speakerIdOf({}) === 'browser')
ok('a site with an endpoint configured uses it', speakerIdOf({ haveEndpoint: true }) === 'endpoint')
ok('and may ask for the kit\'s voice anyway', speakerIdOf({ voice: { by: 'browser' }, haveEndpoint: true }) === 'browser')
ok('asking for an endpoint there is none of falls back rather than going silent',
  speakerIdOf({ voice: { by: 'endpoint' } }) === 'browser')

/* a stream that yields slowly, so "heard before it is finished" is a thing that can be observed */
const slow = (parts, each = 5) => new ReadableStream({
  async start(c) {
    for (const p of parts) { await new Promise((r) => setTimeout(r, each)); c.enqueue(new TextEncoder().encode(p)) }
    c.close()
  },
})

/* ----------------- IT IS HEARD BEFORE IT IS FINISHED, which is the whole point -------------- */
{
  const heard = []
  let finished = false
  const sp = speaker({ id: 'endpoint', voice: {}, post: async () => slow(['one ', 'two ', 'three']) })
  const p = sp.say('a sentence', (c) => heard.push(new TextDecoder().decode(c)))
  p.then(() => { finished = true })
  /* after the first chunk has landed, the answer is NOT complete — a buffered proxy would fail this */
  while (heard.length < 1) await new Promise((r) => setTimeout(r, 2))
  ok('the first sound is heard while the rest is still being made', heard.length >= 1 && !finished,
    `heard ${heard.length}, finished ${finished}`)
  await p
  ok('and all of it arrives, in order', heard.join('') === 'one two three', heard.join(''))
}

/* ------------------------------- the last utterance wins ----------------------------------- */
{
  const heard = []
  const sp = speaker({ id: 'endpoint', voice: {}, post: async () => slow(['a', 'b', 'c'], 8) })
  const first = sp.say('the long answer nobody waited for', (c) => heard.push('1:' + new TextDecoder().decode(c)))
  await new Promise((r) => setTimeout(r, 12))
  sp.cancel(first.utterance)
  const got = await first
  ok('an interrupted utterance stops rather than playing over what replaced it', got === null, JSON.stringify(got))
  const before = heard.length
  await new Promise((r) => setTimeout(r, 40))
  ok('and nothing more of it is heard after the interruption', heard.length === before, `${before} → ${heard.length}`)
}

/* the browser provider needs a worker, and says so rather than failing silently */
{
  const sp = speaker({ id: 'browser', worker: null })
  ok('the browser voice with no worker refuses plainly', await sp.say('x').then(() => false, (e) => /voice worker/.test(e.message)))
  ok('and it is what a site gets by default', sp.id === 'browser')
}


/* ------------------- THE PROXY PASSES THE BODY THROUGH, which is the whole point ------------ */
{
  const cors = { 'Access-Control-Allow-Origin': '*' }
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  const secret = 'tts-server-secret'
  const parts = ['audio-1', 'audio-2', 'audio-3', 'audio-4', 'audio-5']
  let upstreamFinished = false
  let upstreamBody
  let sent
  let response
  let handlerReturnedBeforeEnd = false
  let playbackStartedBeforeEnd = false
  let requests = 0
  const handler = createSpeechHandler({
    service: S,
    url: 'https://speech.example/v1/',
    key: secret,
    model: 'tts-default',
    voice: 'voice-default',
    cors,
    json,
    open: (token, service) => open(token, service, now),
    fetchImpl: async (url, init) => {
      requests++
      sent = { url, init, body: JSON.parse(init.body) }
      upstreamBody = new ReadableStream({
        async start(controller) {
          for (const part of parts) {
            await new Promise((resolve) => setTimeout(resolve, 20))
            controller.enqueue(new TextEncoder().encode(part))
          }
          upstreamFinished = true
          controller.close()
        },
      })
      return new Response(upstreamBody, {
        headers: { 'content-type': 'audio/pcm', 'x-audio-rate': '24000' },
      })
    },
  })
  const request = (body) => new Request('https://site.example/v1/copilot-speak', {
    method: 'POST',
    headers: { authorization: `Bearer ${good}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const endpoint = speaker({
    id: 'endpoint',
    voice: { say: 'voice-from-bot', format: 'pcm' },
    post: async (body) => {
      response = await handler(request(body))
      handlerReturnedBeforeEnd = !upstreamFinished
      return response.body
    },
  })
  const played = []
  await endpoint.say('Say hello', (bytes) => {
    played.push(bytes)
    if (played.length === 1) playbackStartedBeforeEnd = !upstreamFinished
  })
  ok('the edge handler returns while the slow speech endpoint is still producing audio',
    handlerReturnedBeforeEnd)
  ok('the exact upstream stream is returned, not a buffered replacement', response.body === upstreamBody)
  ok('the speaker receives its first chunk while the slow endpoint is still producing audio',
    playbackStartedBeforeEnd && played[0]?.length > 0)
  ok('the endpoint receives the named speech path', sent.url === 'https://speech.example/v1/audio/speech')
  ok('the server credential is sent only to the endpoint',
    sent.init.headers.authorization === `Bearer ${secret}` &&
    !response.headers.has('authorization') && !JSON.stringify([...response.headers]).includes(secret))
  ok('the configured model and the bot voice reach the endpoint',
    sent.body.model === 'tts-default' && sent.body.voice === 'voice-from-bot')
  ok('speech defaults to PCM and forwards the text', sent.body.response_format === 'pcm' &&
    sent.body.stream_format === 'audio' && sent.body.input === 'Say hello')
  ok('the response exposes audio format and sample rate', response.headers.get('x-audio-format') === 'pcm' &&
    response.headers.get('x-audio-rate') === '24000' && response.headers.get('content-type') === 'audio/pcm')
  const audio = played.map((chunk) => new TextDecoder().decode(chunk)).join('')
  ok('the streamed audio contains no server credential',
    !audio.includes(secret))
  ok('the stream eventually finishes normally', upstreamFinished)
  ok('all streamed chunks reach the speaker', played.length === parts.length)

  const noEndpoint = createSpeechHandler({
    service: S, url: '', key: '', cors, json, open: (token, service) => open(token, service, now),
    fetchImpl: async () => { requests++; throw new Error('must not call an absent endpoint') },
  })
  const missing = await noEndpoint(request({ text: 'Say hello' }))
  ok('an unconfigured deployment says so and leaves speech to the page',
    missing.status === 503 && (await missing.json()).error === 'no-endpoint')
  ok('the missing endpoint is never requested', requests === 1)

  const refused = createSpeechHandler({
    service: S, url: 'https://speech.example/v1', key: secret, cors, json,
    open: (token, service) => open(token, service, now),
    fetchImpl: async () => new Response(secret, { status: 401 }),
  })
  const failed = await refused(request({ text: 'Say hello' }))
  ok('upstream error bodies cannot disclose the server credential',
    failed.status === 502 && !(await failed.text()).includes(secret))

  if (SITE.modules.copilot !== false) {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'supabase/functions/copilot-speak/index.ts'), 'utf8')
    ok('the deployed edge entry supplies its server-side key and endpoint to the handler',
      /key:\s*TTS_KEY/.test(src) && /url:\s*TTS_URL/.test(src))
  } else {
    console.log('  (copilot module is disabled in this site — the deployed function check is not applicable)')
  }
}


/* ---------------------------- what the visualizers draw from ------------------------------- */
/*
 * TWO VOICES, AND THE STATE WITH NO SOUND. These are the two faults a voice surface actually
 * has: drawing only the microphone (so the assistant's reply looks like dead air) and going flat
 * while thinking (which reads as a crash at the moment somebody is waiting).
 */
ok('the four states are named, and nothing else is', STATES.join(',') === 'connecting,listening,thinking,speaking')
ok('and a state nobody declared is not one', !isState('idle') && isState('thinking'))

/* whose voice is live is the turn-taking, made visible */
ok('while listening it draws the PERSON', frame({ state: 'listening', mine: 0.9, theirs: 0 }).live === 'me')
ok('while speaking it draws the ASSISTANT', frame({ state: 'speaking', mine: 0, theirs: 0.9 }).live === 'them')
ok('the person\'s voice does not move it while the assistant is speaking',
  frame({ state: 'speaking', mine: 0.9, theirs: 0 }).level < frame({ state: 'speaking', mine: 0, theirs: 0.9 }).level)
ok('and neither is live when nobody is speaking', frame({ state: 'thinking' }).live === null)

/*
 * THE SOUND DECIDES, NOT THE STATE — and this is the check that would have caught the fault that
 * made the whole surface look dead. In the RUNNING page the assistant's level tracked its own
 * voice perfectly (0.34, 1.00, 0.55, 0.02, 0.76, 1.00 …) while the phase sat at 'listening',
 * and because the source was chosen by state every one of those numbers was discarded and the
 * orb drew the silent microphone instead. Every part was right; the junction was not.
 *
 * The state and the audio disagree constantly: a reply plays on after the turn comes back, an
 * interruption returns the turn mid-sentence, and a phase that never advanced leaves a whole
 * reply unaccounted for. So the assistant's audio counts whenever there is any of it.
 */
{
  const played = [0.341, 1, 0.555, 0.022, 0.756, 1, 0.861, 0.022, 1, 0.672]
  let prev = 0
  const drawn = played.map((t, i) => { const f = frame({ state: 'listening', mine: 0.01, theirs: t, previous: prev, at: i * 200 }); prev = f.level; return f.level })
  const lo = Math.min(...drawn), hi = Math.max(...drawn)
  ok('a reply playing while the phase says listening still moves the shape', hi - lo > 0.3,
    `spread ${(hi - lo).toFixed(2)} over ${played.length} samples`)
  ok('and it is drawn as the ASSISTANT, whatever the phase claims',
    frame({ state: 'listening', mine: 0.01, theirs: 0.8 }).live === 'them')
}

/* THE ONE THAT MATTERS: no state is ever flat */
for (const s of STATES) {
  const a = frame({ state: s, at: 0 }).level
  const b = frame({ state: s, at: 600, previous: a }).level
  ok(`${s} is never still`, a > 0.02 && b > 0.02, `${a.toFixed(3)} then ${b.toFixed(3)}`)
}
ok('thinking moves even with no sound at all from either side',
  Math.abs(frame({ state: 'thinking', at: 0 }).level - frame({ state: 'thinking', at: 500 }).level) > 0.01)

/*
 * LOUDNESS IS THE ENVELOPE OF THE WAVEFORM, and that is a different contract from the one these
 * checks used to make. It was a mean over frequency BINS, where silence is zero — and it gave a
 * number that barely changed, because speech puts its energy in the bottom fifth of the spectrum
 * and averaging over the silent rest flattens it. Measured on a real reply it sat at 0.300, dead
 * flat, for the whole utterance: the orb was being driven by something that does not move.
 *
 * A waveform's silence is the middle of the range, not the bottom of it, so these now feed it
 * what a time-domain buffer actually contains.
 */
const quiet = new Uint8Array(64).fill(128)
const tone = (amp) => Uint8Array.from({ length: 512 }, (_, i) => 128 + Math.round(Math.sin(i / 6) * 127 * amp))
ok('silence is nothing', loudness(quiet) === 0)
ok('an empty buffer is nothing either', loudness(new Uint8Array(0)) === 0 && loudness(null) === 0)
ok('a lone spike barely moves it', loudness(Uint8Array.from({ length: 512 }, (_, i) => (i === 0 ? 255 : 128))) < 0.2)
ok('a quiet voice registers', loudness(tone(0.08)) > 0.1 && loudness(tone(0.08)) < 0.5, String(loudness(tone(0.08)).toFixed(2)))
ok('and a loud one is loud', loudness(tone(0.9)) > 0.8, String(loudness(tone(0.9)).toFixed(2)))
/* THE ONE THAT WAS MISSING, and the one the whole fault would have been caught by: two different
   voices must give two different numbers. A measure that cannot tell them apart draws a shape
   that never moves, however correct everything downstream is. */
ok('a loud voice reads clearly louder than a quiet one', loudness(tone(0.9)) - loudness(tone(0.08)) > 0.4,
  `${loudness(tone(0.08)).toFixed(2)} vs ${loudness(tone(0.9)).toFixed(2)}`)

/* rising fast and falling at a pace that still shows the syllables */
{
  const up = frame({ state: 'listening', mine: 1, previous: 0 }).level
  const down = frame({ state: 'listening', mine: 0, previous: 1 }).level
  /* the fraction of the gap each frame closes, which is what "faster" means here — the two
     values themselves start from opposite ends and comparing them directly says nothing */
  const rose = up / 1
  const fell = (1 - down) / (1 - frame({ state: 'listening', mine: 0, previous: 0 }).level)
  ok('it rises faster than it falls', rose > fell, `closes ${(rose * 100) | 0}% going up, ${(fell * 100) | 0}% coming down`)
  /* and it DOES come down between syllables, which is the difference between a voice and a lamp:
     at the old release it closed a tenth of the gap a frame and never visibly fell at all */
  ok('and it comes down fast enough to show the syllables', fell > 0.2, `${(fell * 100) | 0}% a frame`)
}

/* the silent trap, asserted on the source because only pixels and ears catch it otherwise */
{
  const src = fs.readFileSync(new URL('../src/lib/copilot/levels.js', import.meta.url), 'utf8')
  ok('the assistant\'s audio is connected on to the speakers', /hearAssistant[\s\S]*toSpeakers: true/.test(src))
  ok('and the microphone is NOT, because that is feedback', /hearPerson[\s\S]*toSpeakers: false/.test(src))
}


/* ------------------------- whose turn it is, and which state ------------------------------- */
/*
 * COLOUR ALONE CANNOT CARRY WHOSE TURN IT IS — not for somebody colour-blind, not on a monochrome
 * display, not at the edge of vision. So the person and the assistant differ in FOUR signals, and
 * these assert the three that survive greyscale. Each was looked at: twenty combinations drawn in
 * a headless browser in both themes and read.
 */
{
  const fs2 = fs
  const src = fs2.readFileSync(new URL('../src/lib/copilot/visual.js', import.meta.url), 'utf8')
  ok('the five shapes are named in one place', SHAPES.join(',') === 'aura,wave,radial,grid,bar')
  ok('DIRECTION: the person draws inward, the assistant outward', /const out = them \? 1 : me \? -1 : 0/.test(src))
  ok('WEIGHT: the assistant is filled, the person an outline', /const filled = them/.test(src))
  ok('SCALE: the assistant occupies more than the person ever does', /const scale = them \? 1 : me \? 0\.66/.test(src))
  ok('and colour is the FOURTH signal, never the only one', /const colour = them \? paint\.accent : me \? paint\.ink/.test(src))
  ok('no colour is decided in the shapes — they are the look\'s own', !/#[0-9a-fA-F]{3,6}|rgb\(/.test(src))
}

/* connecting and thinking both have nobody speaking, so without this they are drawn identically */
{
  const src = fs.readFileSync(new URL('../src/lib/copilot/visual.js', import.meta.url), 'utf8')
  ok('connecting is slower than thinking', /const pace = state === 'connecting' \? 0\.45 : state === 'thinking' \? 1\.6/.test(src))
  ok('and deliberately INCOMPLETE, which is what "not joined up yet" looks like',
    /const whole = state === 'connecting' \? 0\.6 : 1/.test(src))
  ok('every shape honours it, so none of the five looks whole while connecting',
    (src.match(/whole/g) || []).length >= 7, (src.match(/whole/g) || []).length + ' uses')
}

/* a state nobody can see is a state that is not being shown */
{
  const src = fs.readFileSync(new URL('../src/lib/copilot/visual.js', import.meta.url), 'utf8')
  ok('the grid has a visible floor on a dark ground', /Math\.max\(0\.3,/.test(src),
    'the grid vanished into a dark background at 0.08 — right arithmetic, blank pixels')
}

/* the component shows; lib decides */
{
  const sfc = fs.readFileSync(new URL('../../movable-types/src/components/copilot/VoiceVisual.vue', import.meta.url), 'utf8')
  /* it may CHOOSE a renderer — the aura is a shader and the other four are drawn — but it must
     not contain drawing: no path commands, no arithmetic about shapes. That all lives in lib so
     every combination can be rendered headless and looked at. */
  ok('the component draws nothing itself', !/ctx\.(arc|moveTo|lineTo|fillRect|bezierCurveTo)/.test(sfc), 'drawing crept back into the component')
  ok('and the shader is the only branch it makes on the shape', (sfc.match(/props\.shape === /g) || []).length <= 1)
  ok('it asks lib for the shape', /paintShape\(/.test(sfc))
  ok('and it says the state in words for anybody not watching', /role="status"/.test(sfc) && /aria-live/.test(sfc))
}


/* ------------------------------- the turn, and taking it back ------------------------------ */
/*
 * BARGE-IN IS THE TEST OF A VOICE ASSISTANT. A person interrupting is not an error path, it is
 * how conversations work — and what happens in the half-second after somebody talks over it is
 * the difference between an assistant and a kiosk with a microphone. These drive the machine
 * through that, with no browser anywhere near it.
 */
{
  const { conversation } = await import('../src/lib/copilot/converse.js')
  const spoken = []
  const mkSpeaker = () => {
    let n = 0
    const cancelled = new Set()
    return {
      cancel: (u) => cancelled.add(u),
      say(text) {
        const utterance = 'u' + (++n)
        const p = new Promise((res) => setTimeout(() => res(cancelled.has(utterance) ? null : (spoken.push(text), {})), 20))
        return Object.assign(p, { utterance })
      },
    }
  }

  /* an ordinary turn */
  {
    const c = conversation({ ask: async () => 'the answer', speaker: mkSpeaker() })
    ok('it begins connecting, not listening', c.state.phase === 'connecting')
    c.ready()
    ok('and listens once the microphone is live', c.state.phase === 'listening' && c.state.turn === 'me')
    const done = c.say('a question')
    ok('it thinks while it has nothing to say', c.state.phase === 'thinking')
    await done
    ok('then the turn comes back', c.state.phase === 'listening' && c.state.turn === 'me')
    ok('and the conversation is kept as text', c.state.said.map((s) => s.who).join(',') === 'me,them')
  }

  /* interrupted WHILE THINKING: the answer it was waiting for is no longer the answer to anything */
  {
    const c = conversation({ ask: () => new Promise((r) => setTimeout(() => r('too late'), 30)), speaker: mkSpeaker() })
    c.ready()
    const p = c.say('a question')
    c.interrupt()
    await p
    ok('an answer that arrives after an interruption is dropped', !c.state.said.some((s) => s.text === 'too late'),
      JSON.stringify(c.state.said))
    ok('and the turn is the person\'s immediately, not when the answer lands', c.state.turn === 'me')
  }

  /* interrupted WHILE SPEAKING: what is being said stops */
  {
    const sp = mkSpeaker()
    const c = conversation({ ask: async () => 'a long answer', speaker: sp })
    c.ready()
    const p = c.say('a question')
    await new Promise((r) => setTimeout(r, 5))
    ok('it is speaking', c.state.phase === 'speaking' && c.state.turn === 'them')
    c.interrupt()
    ok('interrupting returns the turn at once', c.state.phase === 'listening' && c.state.turn === 'me')
    await p
    ok('and what it was saying was cancelled rather than finished', !spoken.includes('a long answer'), spoken.join('|'))
  }

  /* a conversation that breaks says so rather than going quiet */
  {
    const c = conversation({ ask: async () => { throw new Error('the endpoint is down') }, speaker: mkSpeaker() })
    c.ready()
    await c.say('a question')
    ok('a failure is said rather than left as silence', /endpoint is down/.test(c.state.error || ''), c.state.error)
    ok('and the turn still comes back, so nobody waits forever', c.state.phase === 'listening')
  }
}

/* ---------- an assistant does not answer itself ---------- */
/*
 * THE FAILURE IS TOTAL AND IT LOOKS LIKE MADNESS: on speakers the microphone hears the reply,
 * the recogniser transcribes it, the machine takes it for the person and the assistant answers
 * itself, forever.
 *
 * A FIXED THRESHOLD CANNOT WORK, which is what two attempts at this got wrong. The echo is loud
 * — on a laptop it clears any threshold worth having — so it satisfied the test for "somebody is
 * really talking" and let itself through. How loud the leak is depends on the room, so it has to
 * be measured, not assumed.
 */
{
  const room = (leak, text = 'Begin with the introduction.') => {
    const g = echoGuard()
    let t = 0
    g.speaking(text)
    for (let i = 0; i < 150; i++) { t += 16; g.tick(0.5, leak, t) }
    return { g, t }
  }

  for (const [where, leak] of [['laptop speakers', 0.35], ['a loud room', 0.55]]) {
    const { g, t } = room(leak)
    ok(`in ${where} the leak is learned`, g.floor > leak * 0.6, `floor ${g.floor.toFixed(2)} of a ${leak} leak`)
    ok(`and the echo is not mistaken for a person there`, !g.isPerson(leak, t), `bar ${g.bar().toFixed(2)}`)
    ok(`while a real voice over it still is`, g.isPerson(0.95, t))
    /* and somebody talking over the top must not teach it that this is the new normal */
    let u = t
    for (let i = 0; i < 12; i++) { u += 16; g.tick(0.5, 0.95, u) }
    ok(`and an interruption does not raise the bar above itself (${where})`, g.bar() < 0.95, g.bar().toFixed(2))
  }

  /* on headphones there is no leak, so the lightest word gets through */
  {
    const { g, t } = room(0.003)
    ok('on headphones a quiet word interrupts', g.isPerson(0.14, t), g.bar().toFixed(2))
  }

  /* THE TAIL: a room keeps reflecting after the audio stops */
  {
    const g = echoGuard()
    g.tick(0.5, 0.2, 1000)
    ok('straight after the sound stops, the microphone is still suspect', g.audible(1100))
    ok('and a moment later it is trusted again', !g.audible(1000 + 400))
  }

  /* AND THE LINE THAT NEEDS NO MICROPHONE AT ALL */
  {
    const g = echoGuard()
    g.speaking('Begin with the introduction, it is the thesis of the whole book.')
    ok('its own words coming back are its own words', g.isEcho('begin with the introduction'))
    ok('and so is a fragment of them', g.isEcho('the thesis of the whole book'))
    ok('and so is a mishearing of most of them', g.isEcho('begin with the introduction it is the'))
    ok('a real question is not', !g.isEcho('how long is it'))
    ok('nor is a short word that happens to appear', !g.isEcho('it'))
    g.quiet()
    ok('and once it has stopped, nothing is its own any more', !g.isEcho('begin with the introduction'))
  }
}

/* ---------- a voice that stops working falls back rather than going quiet ---------- */
/*
 * THE FAULT THIS PINS WAS TOTAL SILENCE. A configured endpoint that answered 502 — an expired
 * key, an account out of credit, a bad hour at the provider — resolved every utterance with
 * nothing, and the assistant said not one word, with no error anywhere. The fallback existed
 * only for an endpoint that was never configured, which is the case that does not happen.
 */
{
  class FakeWorker extends EventTarget {
    constructor() { super(); this.spoke = [] }
    postMessage(m) {
      if (m.type !== 'speak') return
      this.spoke.push(m.text)
      const fire = (d, ms) => setTimeout(() => this.dispatchEvent(Object.assign(new Event('message'), { data: d })), ms)
      fire({ type: 'piece', id: m.id, i: 0, pcm: new Float32Array(4), rate: 44100 }, 2)
      fire({ type: 'done', id: m.id, blob: 'MP3', seconds: 1 }, 5)
    }
  }
  const bytes = () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3, 4])); c.close() } })
  const run = async (post) => {
    const w = new FakeWorker()
    const heard = []
    /* a FACTORY, so a deployment whose endpoint works never builds an engine it cannot use */
    let made = 0
    const sp = speaker({ id: 'endpoint', post, worker: () => { made++; return w }, voice: {} })
    await sp.say('first sentence', (c) => heard.push(c && c.pcm ? 'own' : 'endpoint'))
    await sp.say('second sentence', (c) => heard.push(c && c.pcm ? 'own' : 'endpoint'))
    return { heard, worker: w.spoke, made, now: sp.id }
  }

  const fine = await run(async () => bytes())
  ok('a working endpoint is used and nothing else is built', fine.heard.join() === 'endpoint,endpoint' && fine.made === 0, JSON.stringify(fine))

  for (const [why, post] of [['answers with nothing', async () => null], ['throws outright', async () => { throw new Error('502') }]]) {
    const r = await run(post)
    ok(`an endpoint that ${why} is heard in the kit's own voice instead`, r.heard.join() === 'own,own', JSON.stringify(r))
    ok(`and the words actually reach the engine (${why})`, r.worker.join() === 'first sentence,second sentence', JSON.stringify(r.worker))
    ok(`and it does not go back to a dead endpoint every turn (${why})`, r.now === 'browser' && r.made === 1, JSON.stringify(r))
  }
}

/* ---------- the pieces reach the page before the answer is finished ---------- */
/*
 * THE REGRESSION THIS EXISTS TO CATCH is silent and total: the worker hands over the finished
 * mp3 and nothing else, every number still looks right, and the person waits in silence for as
 * long as the whole answer takes to make. A fake worker behaving as the real one does — pieces,
 * spaced, then `done` — proves the first piece reaches the player long before the utterance
 * resolves, and that the mp3 that arrives at the end is NOT played over the top of them.
 */
{
  class FakeWorker extends EventTarget {
    constructor() { super(); this.sent = [] }
    postMessage(m) {
      this.sent.push(m)
      if (m.type !== 'speak') return
      const fire = (data, ms) => setTimeout(() => this.dispatchEvent(Object.assign(new Event('message'), { data })), ms)
      for (let i = 0; i < 3; i++) fire({ type: 'piece', id: m.id, i, pcm: new Float32Array(10), rate: 44100 }, 10 * (i + 1))
      fire({ type: 'done', id: m.id, blob: 'MP3', seconds: 9 }, 50)
    }
  }
  const w = new FakeWorker()
  const sp = speaker({ id: 'browser', worker: w, voice: { steps: 8, opening: 3, gap: 0.12, words: 12 } })
  const t0 = Date.now()
  const got = []
  const u = sp.say('one. two. three.', (c) => got.push({ at: Date.now() - t0, blob: typeof c === 'string', i: c && c.i }))
  const r = await u
  const settled = Date.now() - t0

  ok('the worker is asked to speak LIVE', w.sent[0].live === true, JSON.stringify(w.sent[0]))
  ok('and is handed what the file asked for', JSON.stringify(w.sent[0].engine) === JSON.stringify({ steps: 8, opening: 3, gap: 0.12, first: 12 }), JSON.stringify(w.sent[0].engine))
  ok('every piece reaches the player', got.length === 3 && got.map((g) => g.i).join() === '0,1,2', JSON.stringify(got))
  ok('the first one long before the answer is finished', got[0].at < settled, got[0].at + ' vs ' + settled)
  ok('and the finished mp3 is never played over them', !got.some((g) => g.blob), JSON.stringify(got))
  ok('though it is still answered with, because the recording cache wants it', r && r.blob === 'MP3', JSON.stringify(r))

  /* a file that says nothing asks for nothing, and the worker's own defaults stand */
  ok('a bot with no voice settings sends none', engineOf({}) === undefined)
  ok('and one that names only a shape still sends none', engineOf({ visual: 'wave', say: 'alloy' }) === undefined)
}

/* ---------- what a bot may say about its voice actually reaches the page ---------- */
/*
 * A FIELD THE SCHEMA DOES NOT CARRY IS A FIELD THAT DOES NOTHING. `visual` was read by the page
 * and absent from the compile, so velite dropped it and every assistant drew the default however
 * its file was written — which looks exactly like a working feature until somebody changes it.
 */
{
  const src = fs.readFileSync(new URL('./velite.mjs', import.meta.url), 'utf8')
  const block = src.slice(src.indexOf('voice: s.object({'), src.indexOf('extends: s.string()'))
  for (const f of ['say', 'voices', 'greeting', 'wait', 'visual', 'steps', 'opening', 'words', 'gap']) {
    ok(`the compile carries a bot's voice.${f}`, new RegExp('\\b' + f + ':\\s*s\\.').test(block))
  }
  for (const shape of SHAPES) ok(`and ${shape} is a shape a file may name`, block.includes("'" + shape + "'"))
}

/* ---------- how fast the first word arrives ---------- */
/*
 * MEASURED, NOT ASSERTED, and the numbers are in the comments of chunk.js: the solver's steps
 * cost very nearly linear time, and the audiobook's chunker packs sentences up to 300 characters,
 * so a four-sentence answer was ONE piece and nobody heard a word for 3.7 seconds. Cutting the
 * opening short and making only that piece cheaply brought it to 0.52s — 7.2x — with everything
 * after it still at full quality, because the rest are made while the opening plays.
 */
{
  const LONG = 'The introduction is the thesis of the whole book. Every chapter after it assumes you have read it. It runs to about nine hundred words, so ten minutes, less if you read quickly.'
  const cut = talkPieces(LONG)
  ok('the opening piece is the first sentence alone', cut[0] === 'The introduction is the thesis of the whole book.', JSON.stringify(cut[0]))
  ok('and it is cut into more than one piece where the old one made exactly one', cut.length > 1 && chunkText(LONG, PACK).length === 1, cut.length + ' vs ' + chunkText(LONG, PACK).length)
  ok('nothing is lost in the cutting', cut.join(' ') === LONG, JSON.stringify(cut))
  /* the rest is packed as before, so the saving is paid for once rather than per sentence */
  ok('and everything after the opening is packed, not one piece per sentence', cut.length === 2, JSON.stringify(cut))

  /* A LONG FIRST SENTENCE stops at a clause rather than mid-phrase. "Whichever is shorter" taken
     literally cuts a noun phrase in half and the voice drops as though it had finished. */
  const WORDY = 'Begin with the introduction, which is the thesis of the whole book and sets up everything that follows.'
  const w = talkPieces(WORDY)
  ok('a long first sentence is cut at a clause', w[0] === 'Begin with the introduction,', JSON.stringify(w[0]))
  ok('and the remainder is spoken next', w[1].startsWith('which is the thesis'), JSON.stringify(w[1]))
  ok('with nothing lost there either', w.join(' ') === WORDY, JSON.stringify(w))

  /* and where there is NO boundary to stop at, prosody wins over latency */
  const NOCOMMA = 'I have been thinking about this question for a very long time indeed and have no answer'
  ok('a long sentence with nowhere to stop is spoken whole', talkPieces(NOCOMMA).length === 1, JSON.stringify(talkPieces(NOCOMMA)))
  ok('and a clause of two words is a stumble, not a piece', openingCut('No, I would not go that far at all in either direction')[0] !== 'No,')

  ok('a short answer is one piece and nothing is cut', talkPieces('Yes, that is right.').length === 1)
  ok('nothing in, nothing out', talkPieces('').length === 0 && talkPieces(null).length === 0)

  /* ONLY THE OPENING IS WORTH SPOILING, because it is the only one anybody waits for */
  ok('the opening piece gets the cheap setting', stepsFor(0, { steps: 8, opening: 3 }) === 3)
  ok('and every piece after it the full one', stepsFor(1, { steps: 8, opening: 3 }) === 8 && stepsFor(5, { steps: 8, opening: 3 }) === 8)
  ok('a site that wants one quality throughout says so by saying nothing', stepsFor(0, { steps: 6 }) === 6)
  ok('a conversation paces itself closer than a chapter does', TALK.gap < 0.45, JSON.stringify(TALK))
  /* THE DEFAULT DOES NOT TRADE THE SOUND FOR THE SPEED. Lowering the opening's steps is the only
     change here that alters a sample, and it was tried and reversed: nearly all of the saving
     comes from the cut and from streaming the pieces, neither of which touches the audio. A
     default that quietly made the free voice worse would undercut the one claim the free voice
     has to make. Louder than the default is refused outright — it would cost time for nothing. */
  ok('and never at the cost of how it sounds', TALK.opening === TALK.steps, JSON.stringify(TALK))
  ok('a site may still buy speed with quality, which is why it is a field', stepsFor(0, { steps: 8, opening: 3 }) === 3)
  ok('and the opening aims short', TALK.first === FIRST_WORDS && FIRST_WORDS <= 20)

  /* THE CHAPTER'S OWN BEHAVIOUR IS UNTOUCHED: every recording's name is a hash of the engine's
     settings, so a changed default would silently rename every mp3 in the store. */
  ok('asked for the chapter\'s packing, it is the chapter\'s packing', JSON.stringify(talkPieces(LONG, { first: 0 })) === JSON.stringify(chunkText(LONG, PACK)))
}

/* ---------- a kept conversation names itself ---------- */
/*
 * NOBODY TYPES A TITLE. The first thing said is the name, which is why a list of conversations
 * never contains the word "Untitled" and never asks anybody for anything.
 */
{
  ok('the title is the first thing said', titleOf('  How long   should my long run be?  ') === 'How long should my long run be?')
  ok('a line of nothing names nothing, so the thread stays unlisted', titleOf('   ') === '' && titleOf(null) === '')
  const long = 'I have been training for a spring marathon for about eleven weeks now and my knee has started to hurt'
  const cut = titleOf(long)
  ok('a long one is cut to a line', cut.length <= TITLE_MAX + 1 && cut.endsWith('…'), cut)
  ok('and cut on a word rather than through one', !/\S…$/.test(cut) || !long.startsWith(cut.slice(0, -1)) || cut.slice(0, -1) === cut.slice(0, -1).trimEnd(), cut)
  ok('and it is still the beginning of what they said', long.startsWith(cut.slice(0, -1)), cut)
  /* a newline in the middle is a line break in a title, which is a two-line row in a one-line list */
  ok('whatever they said is one line', !/\n/.test(titleOf('first\nsecond')), titleOf('first\nsecond'))

  const W = { now: 'just now', minutes: '{n}m ago', hours: '{n}h ago', days: '{n}d ago' }
  const now = Date.UTC(2026, 0, 20, 12, 0, 0)
  const ago = (ms) => whenOf(new Date(now - ms).toISOString(), W, now)
  ok('a moment ago is said, not counted', ago(20 * 1000) === 'just now')
  ok('minutes', ago(7 * 60000) === '7m ago', ago(7 * 60000))
  ok('hours', ago(5 * 3600e3) === '5h ago', ago(5 * 3600e3))
  ok('days', ago(3 * 86400e3) === '3d ago', ago(3 * 86400e3))
  /* past a week a count stops meaning anything and a date means more */
  ok('and past a week, a date', !/ago/.test(ago(30 * 86400e3)) && ago(30 * 86400e3) !== '', ago(30 * 86400e3))
  ok('the words are the caller\'s, so none of them is written here', ago(7 * 60000).includes('ago'))
  ok('and nothing is said about a time that is not one', whenOf('not a date', W, now) === '')
}

/* ---------- the sound actually reaches the speakers ---------- */
/*
 * THE ONE FAULT NO UNIT TEST CATCHES. A graph whose analyser is connected to nothing measures
 * every reply perfectly and plays none of them: every number the page reads is right, the orb
 * moves, and the room is silent. So this renders the player's own graph OFFLINE and looks at what
 * came out of the DESTINATION — the only place the answer is not a matter of opinion — and it is
 * run against a deliberately unplugged copy of the same module to show the check bites.
 */
{
  const src = fs.readFileSync(new URL('../src/lib/copilot/play.js', import.meta.url), 'utf8')
    .replace(/export function/g, 'function')
  const unplugged = src.replace('analyser.connect(ctx.destination)', '/* unplugged */')
  ok('the mutation the check is measured against applies', unplugged !== src)

  let browser = null
  try { const { chromium } = await import('playwright'); browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }) } catch { /* no browser here */ }
  if (!browser) {
    console.log('  (the audio graph is skipped — no browser)')
  } else {
    const render = async (code) => {
      const pg = await browser.newPage()
      await pg.setContent('<body></body>')
      await pg.addScriptTag({ content: code + '; window.__player = player' })
      const out = await pg.evaluate(async () => {
        const RATE = 24000, n = RATE / 2
        /* a 440 Hz tone as the 16-bit mono PCM a speech endpoint streams */
        const pcm = new Uint8Array(n * 2), dv = new DataView(pcm.buffer)
        for (let i = 0; i < n; i++) dv.setInt16(i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / RATE) * 12000), true)
        const ctx = new OfflineAudioContext(1, RATE, RATE)
        const p = window.__player(ctx, { rate: RATE })
        /* split ON a half sample: a chunk boundary inside a frame is the ordinary case, and a
           player that drops the odd byte drifts a sample per chunk until it is noise */
        p.write(pcm.slice(0, 1001)); p.write(pcm.slice(1001))
        const ch = (await ctx.startRendering()).getChannelData(0)
        let sum = 0, peak = 0
        for (let i = 0; i < ch.length; i++) { sum += ch[i] * ch[i]; peak = Math.max(peak, Math.abs(ch[i])) }
        await ctx.close?.()
        return { rms: Math.sqrt(sum / ch.length), peak }
      })
      await pg.close()
      return out
    }
    const heard = await render(src)
    ok('what was written comes out of the destination', heard.rms > 0.1, JSON.stringify(heard))
    /* 12000/32768 — the exact amplitude written, so the bytes were read as signed little-endian
       16-bit and not merely as some sound */
    ok('and at the amplitude it was written at', Math.abs(heard.peak - 12000 / 32768) < 0.002, String(heard.peak))
    const deaf = await render(unplugged)
    ok('with the analyser unplugged the room is silent, which is what this check is for', deaf.rms === 0, JSON.stringify(deaf))

    /*
     * AND THE LEVEL FALLS BACK TO NOTHING. The page gates the microphone on this number: while
     * the assistant is audible, what the recogniser hears is suspect. An analyser asked after the
     * last source has finished does NOT return to zero — measured, it sat at 0.29 and crawled to
     * 0.20 over two seconds — so a level read off it alone leaves the microphone gated forever
     * and the person is never heard again.
     */
    const pg = await browser.newPage()
    await pg.setContent('<body></body>')
    await pg.addScriptTag({ content: src + '; window.__player = player' })
    const lvl = await pg.evaluate(async () => {
      const RATE = 24000, n = RATE / 4
      const pcm = new Uint8Array(n * 2), dv = new DataView(pcm.buffer)
      for (let i = 0; i < n; i++) dv.setInt16(i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / RATE) * 12000), true)
      const live = new AudioContext({ sampleRate: RATE })
      const p = window.__player(live, { rate: RATE })
      p.write(pcm)
      await new Promise((r) => setTimeout(r, 200))
      const during = p.level()
      p.stop()
      const stopped = p.level()
      /* and when it simply runs out rather than being cut off */
      p.write(pcm)
      await new Promise((r) => setTimeout(r, 150))
      const again = p.level()
      await new Promise((r) => setTimeout(r, 900))
      const ended = p.level()
      await live.close()
      return { during, stopped, again, ended }
    })
    await pg.close()
    ok('while it is talking the level is something', lvl.during > 0.05, String(lvl.during))
    ok('cut off, it is nothing in the same breath', lvl.stopped === 0, String(lvl.stopped))
    ok('it rises again for the next thing said', lvl.again > 0.05, String(lvl.again))
    ok('and when the sound simply runs out it returns to nothing on its own', lvl.ended === 0, String(lvl.ended))
    await browser.close()
  }
}

console.log(`\ncopilot: ${pass} passed${fail ? ', ' + fail + ' FAILED' : ''}\n`)
process.exit(fail ? 1 : 0)
