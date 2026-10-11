/*
 * HOW A SPOKEN ANSWER IS CUT UP, FOR A CONVERSATION RATHER THAN FOR A CHAPTER.
 *
 * The audiobook's chunker packs sentences together up to 300 characters, which is right for a
 * chapter: fewer, longer pieces are less overhead per word and nobody is waiting, because the
 * whole chapter is made before anybody presses play. In a conversation the opposite is true —
 * MEASURED, on an M2 Max at the default eight steps: a four-sentence answer is one 219-character
 * piece and takes 3.7 seconds to synthesise, so the person sits in silence for 3.7 seconds. The
 * same answer cut at its first sentence speaks after 1.07s, and at three steps after 0.49s.
 *
 * So the first piece is made as small as it can be WITHOUT SOUNDING CUT, and the rest are packed
 * normally — by the time the first is playing (three seconds of speech) the others are long made.
 * Latency is only ever paid on the first piece, so that is the only one worth spoiling.
 *
 * NEVER MID-PHRASE. "Every sentence, or N words, whichever is shorter" is right until the first
 * sentence is forty words long, when it cuts in the middle of a noun phrase and the voice drops
 * as though it had finished. So the short cut is taken at a CLAUSE boundary — a comma, a
 * semicolon, a colon, a dash — at or before N words, and where there is none the whole sentence
 * is spoken. A slower start is better than a sentence that sounds broken.
 *
 * Pure: no imports, no environment. The worker uses it and `copilot.test.mjs` pins it.
 */

/* the audiobook chunker's own sentence split, abbreviation-aware, kept identical on purpose */
const SENTENCE = /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/

export const FIRST_WORDS = 12     /* how short the opening piece tries to be */
export const PACK = 300           /* and how long the rest may run, as the audiobook packs them */

const words = (s) => s.trim().split(/\s+/).filter(Boolean)

/*
 * The opening piece: the first sentence, or its first clause when the sentence runs longer than
 * `n` words and there is a boundary to stop at. Answers [head, rest].
 */
export function openingCut(sentence, n = FIRST_WORDS) {
  const s = String(sentence || '').trim()
  if (!s) return ['', '']
  if (words(s).length <= n) return [s, '']
  /* every clause boundary, with the punctuation kept on the head where it belongs */
  const marks = /[,;:—–]|\s-\s/g
  let best = null, m
  while ((m = marks.exec(s))) {
    const head = s.slice(0, m.index + m[0].length).trim()
    if (words(head).length > n) break
    /* two words is not a clause, it is a stumble */
    if (words(head).length >= 3) best = head
  }
  if (!best) return [s, '']                /* nothing to stop at: say the sentence whole */
  return [best, s.slice(best.length).trim()]
}

/* the rest, packed as the audiobook packs them */
function pack(sentences, max) {
  const out = []
  let cur = ''
  for (const s of sentences) {
    if (!s) continue
    if (cur.length + s.length + 1 <= max) cur += (cur ? ' ' : '') + s
    else { if (cur) out.push(cur.trim()); cur = s }
  }
  if (cur) out.push(cur.trim())
  return out
}

/*
 * THE WHOLE ANSWER, CUT FOR SPEAKING. The first piece is short; everything after it is packed.
 * `first: false` gives the audiobook's own behaviour, so one function serves both.
 */
export function talkPieces(text, { first = FIRST_WORDS, max = PACK } = {}) {
  const paragraphs = String(text || '').trim().split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
  const sentences = []
  for (const p of paragraphs) for (const s of p.split(SENTENCE)) if (s.trim()) sentences.push(s.trim())
  if (!sentences.length) return []
  if (!first) return pack(sentences, max)

  const [head, tail] = openingCut(sentences[0], first)
  const rest = (tail ? [tail] : []).concat(sentences.slice(1))
  return [head].concat(pack(rest, max))
}

/*
 * HOW MANY STEPS EACH PIECE GETS. The solver's step count is very nearly linear in time —
 * measured: one sentence took 329ms at two steps, 576ms at four, 1077ms at eight — so the opening
 * piece can be made cheaply and everything after it at full quality, because only the first is
 * ever waited for. A site that wants one quality throughout sets them equal.
 */
export function stepsFor(i, { steps = 8, opening = steps } = {}) {
  return i === 0 ? opening : steps
}

/*
 * WHAT A CONVERSATION ASKS OF THE ENGINE, as against what a chapter asks.
 *
 * A chapter is made before anybody presses play, so it is made at full quality throughout and
 * paced like a book: 0.45s of quiet between pieces reads as a paragraph break. A conversation is
 * waited for and the pauses are between sentences, where half a second is a drawl. These are the
 * defaults the voice surface uses; a bot's `voice:` block overrides any of them.
 *
 * `opening` IS THE SAME AS `steps` ON PURPOSE. Lowering it does cut the wait — three steps
 * halve it, measured — but it is the one change here that touches how the voice SOUNDS, and a
 * voice that arrives sooner and sounds worse is a bad trade in a product whose whole proposition
 * is that the free voice is good enough. Nearly all of the saving comes from the cut and from
 * handing pieces over as they are made, neither of which alters a sample: a four-sentence answer
 * went from 4,200ms to 1,254ms with the quality untouched, against 501ms at three steps.
 *
 * So it is a field with a conservative default rather than a cheap default with a field, and a
 * site that would rather have the speed sets `opening: 3` in the bot's own voice block.
 */
export const TALK = Object.freeze({ steps: 8, opening: 8, gap: 0.12, first: FIRST_WORDS })
