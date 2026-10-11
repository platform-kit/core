/*
 * What a transcript is made of, with no imports and no browser, so the surface and the tests
 * (build/transcript.test.mjs) read the same rules.
 *
 * Speech recognition hands back the same sentence again and again as it makes up its mind: a run of
 * interim guesses, then one final result, then the next run. Putting that on screen naively makes
 * the text flicker and repeat itself, and storing it naively keeps every guess. These four
 * functions are the whole of the arithmetic: what to show while somebody is still speaking, what to
 * keep once they have stopped, and how to say it in a sentence rather than a stream of lowercase.
 */

/* the pieces a recognition event carries, reduced to the two things worth having */
export function readResults(results = [], from = 0) {
  let done = '', saying = ''
  for (let i = from; i < results.length; i++) {
    const r = results[i]
    const said = (r && r[0] && r[0].transcript) || ''
    if (r && r.isFinal) done += said
    else saying += said
  }
  return { done, saying }
}

/* what is on screen while somebody is speaking: what has been settled, then what is still a guess */
export const showing = (kept, saying) => tidy([String(kept || ''), String(saying || '')].join(' '))

/* one space between words, none at the ends, and never a space before a full stop */
export function tidy(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
}

/* a transcript as a person would write it: tidied, opened with a capital, closed with a full stop.
   It is never punctuated beyond that — inventing punctuation somebody did not say is putting words
   in their mouth, and this text is shown as theirs. */
export function asSentence(s) {
  const t = tidy(s)
  if (!t) return ''
  const opened = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?…]$/.test(opened) ? opened : opened + '.'
}

/* a caption is the last of what was said, short enough to read in one glance */
export function caption(s, words = 14) {
  const parts = tidy(s).split(' ').filter(Boolean)
  return parts.slice(Math.max(0, parts.length - words)).join(' ')
}
