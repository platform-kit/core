/*
 * How long each reading still needs.
 *
 * Locked cards used to say "answer a set of the either-or pairs to unlock this",
 * which describes our machinery and answers the wrong question. What somebody
 * wants to know is how long it will take, and the honest answer changes as they
 * answer — three sentences in, it is half what it was.
 *
 * So it is worked out rather than written down, from the thresholds the code
 * actually uses and a measured guess at the pace of each kind of question.
 *
 * THE THRESHOLDS are real and come from the engine:
 *   sentences  prescribe() returns nothing under six answers
 *   words      waCompute() needs six rows, four of them ordinary words
 *   pairs      one round is twenty-four, and a type needs a round to mean much
 *
 * THE PACE is an estimate and marked as one. A spoken sentence is three moves —
 * say it, is it true, what came back — so it runs long. A pair is a glance and a
 * key. A word carries its own second pass later, which is folded into its figure
 * rather than hidden.
 */
import { us } from '../../lib/strings.js';
/* the duration phrasing, from content/app/ui/pages.md (the number is the data) */
const PHRASE = (us('pages').time || {}).phrase || {};

export const NEEDS = { domain: 6, pairs: 24, words: 14, books: 2 };

/* seconds per answer, including anything that answer drags along with it */
const PACE = { domain: 12, pairs: 5, words: 9, books: 25 };   /* a sentence written in one's own words */

/* Seconds still to go for one reading, or 0 when it already has enough. Seconds
   rather than minutes because rounding to minutes first and then phrasing said
   "under a minute" for seventy-two seconds. */
export function secondsFor(kind, answered) {
  const left = Math.max(0, NEEDS[kind] - (answered || 0));
  return left * PACE[kind];
}

/* Just the duration, lower case, so a template can put it after "Takes". The
   card says how long and nothing else — how many questions that is, and what kind
   of questions, is our business. */
export function timeText(sec) {
  if (!sec) return '';
  if (sec < 60) return PHRASE.under;
  const m = Math.round(sec / 60);
  return m === 1 ? PHRASE.one : PHRASE['many-pre'] + ' ' + m + ' ' + PHRASE['many-post'];
}

/* How long a full round takes, for a reading somebody has not started. A round is
   worth quoting rather than the bare minimum, because stopping at the minimum
   gives a thin reading and the number should not undersell what it takes to get a
   good one. */
export const ROUND = { domain: 24, pairs: 24, words: 14, books: 2 };

/* `count` is the round's size when it is not the fixed one — an area's round is
   as long as its markdown says (data/tests.js roundSize) */
export function roundSeconds(kind, count) { return (count || ROUND[kind]) * PACE[kind]; }
