/*
 * STOPPING AN ASSISTANT FROM ANSWERING ITSELF.
 *
 * On speakers, the microphone hears the reply. The recogniser transcribes it, the machine takes
 * it for the person, and the assistant answers itself — forever. It reads as a broken agent and
 * it is a broken audio graph.
 *
 * THE FIRST ATTEMPT WAS A GATE AND THE GATE WAS DEFEATED BY THE THING IT GUARDED AGAINST. It
 * compared the microphone against a fixed threshold: loud enough, and the words were taken as
 * the person's. But the echo IS loud — on laptop speakers it clears any threshold worth having —
 * so the leak satisfied the test for "somebody is really talking" and let itself through. A
 * constant cannot separate a person from an echo, because how loud the echo is depends on the
 * room, the speakers and the volume, none of which we know.
 *
 * SO: TWO MEASURES, NEITHER OF THEM A CONSTANT.
 *
 *   1. WHILE THE ASSISTANT IS AUDIBLE, DO NOT LISTEN AT ALL. Not "listen and discard" — the
 *      recogniser is stopped, so there is no transcript to be wrong about. This is the only
 *      measure that cannot leak, and everything else here exists so that stopping it does not
 *      cost the person the ability to interrupt.
 *
 *   2. LEARN HOW LOUD THE ECHO IS, because it is the one thing being measured while nobody is
 *      meant to be speaking. Whatever the microphone reads while the assistant talks and the
 *      person does not IS the echo, so it is tracked as a decaying maximum and a person has to
 *      be clearly above their own room's leak to count. On headphones the floor is near zero and
 *      a whisper interrupts; on speakers it rises and only a real voice does.
 *
 * And a last line that needs no audio at all: a sentence that comes back matching what the
 * assistant just said is the assistant, whatever the levels claim.
 *
 * Pure. No audio, no DOM, no timers — the page feeds it numbers and asks it questions, and
 * `copilot.test.mjs` drives it with recorded ones.
 */

export const QUIET = 0.02       /* below this the output is silence, not sound */
export const TAIL_MS = 320      /* speakers keep ringing, and a room keeps reflecting */
export const FLOOR_MIN = 0.12   /* nobody interrupts by breathing, however quiet the room */
export const OVER = 1.8         /* a person is this much louder than the leak they are over */
/*
 * HOW FAST THE FLOOR LEARNS. An envelope, not an assignment: it has to converge on a steady
 * leak within about a second, and it must NOT be dragged up by the very thing it is there to
 * detect — somebody talking over the top. Rising slowly and falling slowly does both, and a
 * spike of a few frames moves it by a few per cent.
 */
export const ATTACK = 0.012
export const RELEASE = 0.004

export function echoGuard({ quiet = QUIET, tail = TAIL_MS, floorMin = FLOOR_MIN, over = OVER, attack = ATTACK, release = RELEASE } = {}) {
  let floor = 0          /* how loud this room's leak is, learned while the assistant speaks */
  let until = 0          /* when the assistant was last audible, plus the tail */
  let said = ''          /* and what it was saying, for the text check */

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

  return {
    /* every frame: how loud we are playing, how loud the microphone is */
    tick(theirs, mine, now) {
      if (theirs > quiet) {
        until = now + tail
        /*
         * Learned UNCONDITIONALLY, and slowly. Refusing to learn while the microphone is over
         * the bar cannot work: the bar starts below the leak, so the leak is over it from the
         * first frame and is never learned — the guard sits at its floor for ever and lets the
         * echo straight through. The protection against learning from an interruption is the
         * attack rate instead: a steady leak converges in about a second, while two hundred
         * milliseconds of somebody talking over the top moves it a few per cent.
         */
        floor += (mine - floor) * (mine > floor ? attack : release)
      }
    },
    /* is the assistant audible right now, or was it a moment ago? */
    audible(now) { return now < until },
    /* what a person has to clear to be heard over this room's own leak */
    bar() { return Math.max(floorMin, floor * over) },
    /* loud enough, right now, to be a person and not the speakers */
    isPerson(mine, now) { return !this.audible(now) || mine >= this.bar() },
    /* what the assistant is saying, so a transcript can be checked against it */
    speaking(text) { said = norm(text) },
    /*
     * THE LAST LINE, AND IT NEEDS NO MICROPHONE. Whatever the levels said, a sentence that is
     * the assistant's own sentence coming back is the assistant. Checked as containment both
     * ways, because the recogniser hears a fragment of a long reply and sometimes a little more
     * than it (a word of the room, a repeated article).
     */
    isEcho(heard) {
      const h = norm(heard)
      if (!h || !said) return false
      if (h.length < 4) return false
      if (said.includes(h) || h.includes(said)) return true
      /* or most of its words, in a row, which is what a half-heard reply comes back as */
      const w = h.split(' ')
      if (w.length < 3) return false
      let run = 0, best = 0
      for (const word of w) { if (said.includes(word)) { run++; best = Math.max(best, run) } else run = 0 }
      return best >= Math.max(3, Math.ceil(w.length * 0.6))
    },
    /* the assistant has stopped: nothing of its is coming back any more */
    quiet() { said = '' },
    get floor() { return floor },
  }
}
