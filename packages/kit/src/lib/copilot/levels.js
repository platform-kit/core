/*
 * WHAT THE VISUALIZERS DRAW FROM — one source of numbers, two voices, four states.
 *
 * A spoken conversation has TWO people making sound in it, and which of them is making it is not
 * a detail: it is the turn-taking, made visible. A surface that only draws the microphone leaves
 * the assistant's reply looking like dead air; one that only draws the reply leaves somebody
 * wondering whether they are being heard at all. So there is one level source and either side can
 * feed it, and the visualizers never learn which did.
 *
 * AND THE STATE THAT HAS NO SOUND IS THE ONE THAT MATTERS MOST. While the assistant is thinking,
 * neither side is making any — and a visualizer driven only by a signal goes flat at exactly the
 * moment somebody is waiting, which reads as a crash. So `state` is what the five animate from,
 * and the levels only feed the two states that have any.
 */

/* the four, by their names. A surface with no visible state is the thing that feels broken. */
export const STATES = ['connecting', 'listening', 'thinking', 'speaking']
export const isState = (s) => STATES.includes(s)

/*
 * HOW LOUD, 0..1 — FROM THE WAVEFORM, NOT FROM THE SPECTRUM.
 *
 * This took the root-mean-square across every frequency bin, and the result was a number that
 * hardly moved: speech puts nearly all its energy in the bottom fifth of the spectrum, so
 * averaging over 256 bins divides that energy by the silent four fifths and lands on a small,
 * steady figure. Stacked with the analyser's own smoothing and the smoothing in `frame`, the
 * visualizer sat at a constant — measured at 0.300, flat, for a whole reply. It was not that the
 * orb was not being driven; it was being driven by something that does not change.
 *
 * The envelope of a voice is a TIME-DOMAIN measurement: how far the waveform swings from the
 * middle, right now. That rises and falls with every syllable, which is the thing being drawn.
 */
export function loudness(wave) {
  if (!wave || !wave.length) return 0
  let sum = 0
  for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; sum += v * v }
  /* speech sits around 0.1 RMS; x4 puts an ordinary voice in the middle of the range */
  return Math.min(1, Math.sqrt(sum / wave.length) * 4)
}

/*
 * WHAT A VISUALIZER IS GIVEN, whatever is happening. Pure: the smoothing, the floor under each
 * state and the decision about which voice is live are all arithmetic, so they are testable
 * without a browser and identical in all five components.
 *
 * `floor` is why thinking never goes flat: each state has a minimum liveliness, so the shape is
 * still moving when there is nothing to measure.
 */
const FLOOR = { connecting: 0.18, listening: 0.06, thinking: 0.22, speaking: 0.10 }

/*
 * DRAW WHAT IS ACTUALLY MAKING A SOUND, not whose turn the machine believes it is.
 *
 * This chose its source from the STATE: in 'speaking' it read the assistant's level and in
 * 'listening' the microphone's. That is correct exactly as long as the state and the audio never
 * disagree — and they disagree constantly. The reply keeps playing for a moment after the turn
 * has come back; an interruption returns the turn while the speakers are still going; a state
 * that never advanced to 'speaking' at all leaves a whole reply unaccounted for.
 *
 * MEASURED IN THE RUNNING PAGE: the assistant's level tracked its own voice perfectly —
 * 0.34, 1.00, 0.55, 0.02, 0.76, 1.00 — while the phase sat at 'listening', so every one of those
 * numbers was thrown away and the orb drew the microphone instead. Silent, flawless, and
 * completely invisible.
 *
 * So the sound decides. Whoever is louder is the one being drawn, and the assistant's own audio
 * counts whenever it is audible, whatever anything else claims. The state still sets the mood —
 * the floor, the rhythm, the pace — which is what it is actually good for.
 */
export function frame({ state = 'listening', mine = 0, theirs = 0, previous = 0, at = 0 } = {}) {
  /* the microphone is only the person while somebody is meant to be listening to them; the
     assistant's output is the assistant whenever there is any of it */
  /* and while the assistant is audible the microphone is not drawn AT ALL — it is hearing the
     reply through the speakers, and an orb that wobbled to its own echo would be lying twice */
  /*
   * The microphone is NEVER what is drawn during the assistant's turn, nor while its audio is
   * audible in any state. It is hearing the reply through the speakers, and an orb that wobbled
   * to its own echo would be lying twice over — once about who is talking and once about how
   * loud they are. Streaming leaves real gaps between pieces, and those gaps are exactly when
   * the echo would win.
   */
  const ours = (state === 'connecting' || state === 'speaking' || theirs > 0.03) ? 0 : mine
  const heard = Math.max(theirs, ours)
  const live = theirs > 0.03 && theirs >= ours ? 'them' : ours > 0.03 ? 'me' : null
  const floor = FLOOR[state] ?? 0.1
  /* a breathing shape under the floor so thinking and connecting are visibly alive */
  const idle = floor * (0.72 + 0.28 * Math.sin(at / 320))
  const target = Math.max(idle, heard)
  /*
   * Rise fast, fall at a pace that still shows the syllables. The release was 0.12 — about a
   * second to fall — which on top of two other smoothers meant the shape never came back down
   * between words and so never appeared to move at all.
   */
  const smoothed = target > previous ? previous + (target - previous) * 0.6 : previous + (target - previous) * 0.3
  return { level: Math.max(0, Math.min(1, smoothed)), live, state }
}

/*
 * THE TWO WIRINGS. Both end in an AnalyserNode, so a visualizer never knows where its numbers
 * came from — which is what lets the same five work whether the assistant's audio is the kit's
 * own engine in this page or a track arriving from somewhere else.
 *
 * THE TRAP, and it is silent: a MediaElementAudioSourceNode REROUTES that element's audio into
 * the graph. Connect the analyser to nothing and the reply is measured perfectly and nobody hears
 * it. So this always connects on to the destination, and the test for the speaking state has to
 * be that sound actually comes out — no amount of correct-looking waveform proves it.
 */
export function listenTo(ctx, source, { toSpeakers = false } = {}) {
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  /* light smoothing only: the envelope is smoothed once, in `frame`, and smoothing it three
     times over is what flattened it */
  analyser.smoothingTimeConstant = 0.2
  source.connect(analyser)
  /* the microphone must NOT go to the speakers (that is feedback); the reply must */
  if (toSpeakers) analyser.connect(ctx.destination)
  const wave = new Uint8Array(analyser.fftSize)
  return {
    analyser,
    read() { analyser.getByteTimeDomainData(wave); return loudness(wave) },
    stop() { try { source.disconnect() } catch { /* already gone */ } try { analyser.disconnect() } catch { /* gone */ } },
  }
}

/* the person: never to the speakers */
export const hearPerson = (ctx, stream) => listenTo(ctx, ctx.createMediaStreamSource(stream), { toSpeakers: false })
/* the assistant, playing through an element: always to the speakers, or it is silent */
export const hearAssistant = (ctx, el) => listenTo(ctx, ctx.createMediaElementSource(el), { toSpeakers: true })
/* the assistant, arriving as a track: the page plays it itself, so this only measures */
export const hearTrack = (ctx, stream) => listenTo(ctx, ctx.createMediaStreamSource(stream), { toSpeakers: false })
