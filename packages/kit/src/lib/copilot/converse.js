/*
 * A SPOKEN CONVERSATION, as a state machine over three things that already exist.
 *
 * It owns no transport, no model and no voice: it listens with whatever the page gives it, asks
 * the one endpoint, and speaks through the seam. What it owns is the TURN — whose it is, when it
 * changed, and what happens when somebody takes it back.
 *
 * BARGE-IN IS THE WHOLE REASON THIS IS A MACHINE and not three awaits in a row. A person
 * interrupting is not an error path; it is how conversations work, and the test of a voice
 * assistant is what it does in the half-second after somebody starts talking over it. So speech
 * from the person at ANY point cancels the utterance, drops the answer being waited for, and
 * returns the turn — without that it is a kiosk that happens to use a microphone.
 *
 * The four states are `lib/copilot/levels.js`'s, by name, because the visualizers draw from the
 * same words.
 */
import { reactive } from 'vue'

export function conversation({ ask, speaker, listen, onSaid = () => {} } = {}) {
  /* what the page renders from: one object, no events to subscribe to */
  const state = reactive({
    phase: 'connecting',     /* connecting · listening · thinking · speaking */
    turn: null,              /* 'me' | 'them' | null — whose it is right now */
    said: [],                /* the conversation as text, which is also the accessible form of it */
    error: null,
  })

  let utterance = null
  let abandoned = 0          /* every interruption invalidates the answer being waited for */

  const go = (phase, turn = null) => { state.phase = phase; state.turn = turn }

  /* THE PERSON TOOK THE TURN BACK. Called the moment speech is detected, not when it ends. */
  function interrupt() {
    abandoned++
    if (utterance) { speaker.cancel(utterance); utterance = null }
    go('listening', 'me')
  }

  async function say(text) {
    if (!text || !text.trim()) return
    const mine = ++abandoned
    state.said.push({ who: 'me', text })
    onSaid({ who: 'me', text })
    go('thinking')

    let answer = ''
    try {
      answer = await ask(text)
    } catch (e) {
      /* a conversation that breaks says so out loud rather than going quiet, because silence is
         indistinguishable from "it is still thinking" and somebody waits forever */
      state.error = String(e && e.message || e)
      go('listening', 'me')
      return
    }
    /* they spoke while it was thinking: that answer is no longer the answer to anything */
    if (mine !== abandoned) return

    state.said.push({ who: 'them', text: answer })
    onSaid({ who: 'them', text: answer })
    go('speaking', 'them')
    const u = speaker.say(answer, () => {})
    utterance = u.utterance
    try { await u } catch { /* cancelled or failed: either way the turn comes back */ }
    utterance = null
    if (mine === abandoned) go('listening', 'me')
  }

  return {
    state,
    say,
    interrupt,
    /* the page tells it the microphone is live; until then it is connecting, not listening */
    ready() { go('listening', 'me') },
    /*
     * A CONVERSATION FROM EARLIER, put back. The page may reopen a kept session, and what it
     * reopens has to go through here rather than into `state.said` from outside: the turn is
     * this machine's and nobody else may be holding a pen. Loading abandons whatever was in
     * flight, for the same reason an interruption does — an answer to the previous conversation
     * must not arrive in this one.
     */
    load(lines) {
      abandoned++
      if (utterance) { speaker.cancel(utterance); utterance = null }
      state.said.splice(0, state.said.length, ...(lines || []).map((l) => ({ who: l.who, text: l.text })))
      state.error = null
      go('listening', 'me')
    },
    stop() { if (utterance) speaker.cancel(utterance); abandoned++; go('connecting') },
  }
}
