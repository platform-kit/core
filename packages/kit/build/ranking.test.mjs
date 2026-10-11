/*
 * FIND YOUR BOOK — the ranking, against the real index.
 *
 * The spec said "probed under node once (no pinned test)", which is the shape of claim this whole
 * pass exists to remove: somebody ran it, it looked sensible, and nothing has looked since. It
 * matters more than most, because a ranking cannot fail visibly. It always returns three books.
 * If the words half stopped contributing, or the pace lean started outweighing what somebody
 * wrote, every reader would still get three books and nobody would ever know they were the wrong
 * three.
 *
 * So what is pinned here is not "these three books come back" — that would break every time a
 * companion is edited, and would be a test of the library rather than of the arithmetic. It is the
 * PROPERTIES the ranking is built on, each of which is a decision somebody made and wrote down:
 *
 *   the two best chapters, never the plain best — or a book of eighty-one chapters wins every
 *     sentence by having eighty-one tries
 *   both halves count — meaning and words, each normalised so the scales match
 *   the pace is a LEAN — at most 0.15 on a score of 0..1, so it reorders near-ties and never
 *     outweighs what was written
 *   the weights are relative, so they do not have to sum to one
 *
 * The lexical half is run over the site's real search rows where they are built, so BM25 is
 * exercised against real prose rather than a fixture that flatters it.
 *
 * Run alone:  node packages/kit/build/ranking.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tokens, lexicalIndex, bm25, semantic, normalise, sentenceScores, combine, paceLean, PACE, cosine } from '../src/lib/finding-score.js'

const ROOT = process.cwd()
let n = 0, bad = 0
const t = (name, fn) => { n++; try { fn() } catch (e) { bad++; console.log('  FAIL', name, '\n   ', String(e.message || e).split('\n').slice(0, 5).join('\n    ')) } }

/* ─── words ─── */

t('tokens drop the stop words, the short ones and the plural', () => {
  assert.deepEqual(tokens('The money and my savings are in it'), ['money', 'saving'])
})
t('tokens keep a possessive\'s stem and fold -ies', () => {
  assert.deepEqual(tokens("a reader's anxieties"), ['reader', 'anxiety'])
})

const ROWS = [
  { slug: 'money', text: 'money wealth prosperity abundance money money income earning' },
  { slug: 'fear', text: 'fear anxiety worry dread fear fear courage' },
  { slug: 'both', text: 'money and fear together, wealth and worry, in one book about money and dread' },
]
const IDX = lexicalIndex(ROWS)

t('BM25 puts the book that talks about a word above the ones that do not', () => {
  const s = bm25(IDX, 'money')
  assert.ok(s.money > s.fear, `money ${s.money} vs fear ${s.fear}`)
  assert.equal(s.fear, 0, 'a book with none of the query words scores nothing')
})
/* this is the case the whole lexical half exists for: one plain word whose embedding is too faint */
t('a one-word query still separates the shelf', () => {
  const s = bm25(IDX, 'dread')
  assert.ok(s.both > 0 && s.money === 0)
})
t('a query of nothing but stop words separates nothing', () => {
  assert.deepEqual(Object.values(bm25(IDX, 'the and of it')), [0, 0, 0])
})

/* ─── meaning ─── */

const v = (...xs) => { const len = Math.hypot(...xs) || 1; return xs.map((x) => x / len) }
const Q = v(1, 0, 0)

t('a book is half its head piece and half its two best chapters', () => {
  const pieces = [
    { book: 'x', key: 'insight', vec: v(1, 0, 0) },      /* head: cosine 1 */
    { book: 'x', key: 'c1', vec: v(1, 0, 0) },           /* 1 */
    { book: 'x', key: 'c2', vec: v(0, 1, 0) },           /* 0 */
  ]
  /* head 1, top two chapters (1 + 0) / 2 = 0.5 → 0.5*1 + 0.5*0.5 */
  assert.ok(Math.abs(semantic(pieces, Q).x - 0.75) < 1e-9, String(semantic(pieces, Q).x))
})
/* THE ONE THAT MATTERS: eighty-one tries must not beat two good ones */
t('a book of many chapters does not win by having many tries', () => {
  const head = { key: 'insight', vec: v(0, 1, 0) }                 /* both heads miss equally */
  const many = [{ book: 'many', ...head }, ...Array.from({ length: 81 }, (_, i) => ({ book: 'many', key: 'c' + i, vec: i === 0 ? v(1, 0, 0) : v(0, 1, 0) }))]
  const few = [{ book: 'few', ...head }, { book: 'few', key: 'c0', vec: v(1, 0, 0) }, { book: 'few', key: 'c1', vec: v(1, 0, 0) }]
  const s = semantic([...many, ...few], Q)
  assert.ok(s.few > s.many, `few ${s.few} should beat many ${s.many}`)
})
t('a book with one chapter is not punished for having one', () => {
  const one = [{ book: 'one', key: 'insight', vec: v(1, 0, 0) }, { book: 'one', key: 'c0', vec: v(1, 0, 0) }]
  assert.ok(Math.abs(semantic(one, Q).one - 1) < 1e-9)
})
t('a book with no chapters at all falls back to its head', () => {
  assert.ok(Math.abs(semantic([{ book: 'bare', key: 'insight', vec: v(1, 0, 0) }], Q).bare - 1) < 1e-9)
})

/* ─── the two halves together ─── */

t('normalise puts the shelf on 0..1, and flattens when nothing separates it', () => {
  assert.deepEqual(normalise({ a: 2, b: 4, c: 6 }), { a: 0, b: 0.5, c: 1 })
  assert.deepEqual(normalise({ a: 3, b: 3 }), { a: 0, b: 0 })
})
t('both halves count: a book that wins only on words still scores', () => {
  const slugs = ['money', 'fear', 'both']
  const pieces = slugs.map((s) => ({ book: s, key: 'insight', vec: s === 'fear' ? v(1, 0, 0) : v(0, 1, 0) }))
  const s = sentenceScores(slugs, pieces, IDX, Q, 'money')
  assert.ok(s.money > 0, 'the words half contributed nothing')
  assert.ok(s.fear > 0, 'the meaning half contributed nothing')
})
t('a sentence\'s score never leaves 0..1', () => {
  const slugs = ['money', 'fear', 'both']
  const pieces = slugs.map((s) => ({ book: s, key: 'insight', vec: v(1, 0, 0) }))
  for (const x of Object.values(sentenceScores(slugs, pieces, IDX, Q, 'money and fear'))) {
    assert.ok(x >= 0 && x <= 1, String(x))
  }
})
t('the weights are relative, so they need not sum to one', () => {
  const slugs = ['a', 'b']
  const per = [{ a: 1, b: 0 }, { a: 0, b: 1 }]
  const even = combine(slugs, per, [1, 1])
  assert.equal(even[0].score, even[1].score, 'equal weights should tie')
  const tilted = combine(slugs, per, [45, 35])           /* the real weights: problem, frustration */
  assert.equal(tilted[0].slug, 'a')
})
t('combine returns the best first', () => {
  const out = combine(['a', 'b', 'c'], [{ a: 0.1, b: 0.9, c: 0.5 }], [1])
  assert.deepEqual(out.map((x) => x.slug), ['b', 'c', 'a'])
})

/* ─── the pace: a lean, not a verdict ─── */

const WORDS = { tiny: 5000, mid: 40000, huge: 200000 }
const SLUGS = Object.keys(WORDS)

t('no preference leans nothing', () => {
  assert.deepEqual(paceLean(SLUGS, WORDS, undefined), { tiny: 0, mid: 0, huge: 0 })
  assert.deepEqual(paceLean(SLUGS, WORDS, 'whatever'), { tiny: 0, mid: 0, huge: 0 })
})
t('short leans toward the short book, long toward the long one', () => {
  const s = paceLean(SLUGS, WORDS, 'short'), l = paceLean(SLUGS, WORDS, 'long')
  assert.ok(s.tiny > s.mid && s.mid > s.huge)
  assert.ok(l.huge > l.mid && l.mid > l.tiny)
})
/* the promise in the comment, and the thing most likely to be broken by a "small" change */
t('the lean never exceeds PACE, which is a fraction of a sentence\'s score', () => {
  for (const pref of ['short', 'long']) {
    for (const x of Object.values(paceLean(SLUGS, WORDS, pref))) assert.ok(x >= 0 && x <= PACE, `${pref}: ${x}`)
  }
  assert.ok(PACE < 0.5, 'the pace would outweigh what somebody wrote')
})
t('a book that was written about beats a shorter book that was not', () => {
  /* the sentence says 0.6 for the long book and 0.3 for the short: the lean must not flip it */
  const written = { huge: 0.6, tiny: 0.3 }
  const lean = paceLean(['huge', 'tiny'], WORDS, 'short')
  assert.ok(written.huge + lean.huge > written.tiny + lean.tiny, 'the pace outweighed the sentence')
})
t('the length is placed by its logarithm, so the shelf is spread evenly', () => {
  const lean = paceLean(SLUGS, WORDS, 'long')
  /* by raw length, mid (40k) would sit a fifth of the way up; by log it sits near the middle */
  assert.ok(lean.mid / PACE > 0.4 && lean.mid / PACE < 0.8, String(lean.mid / PACE))
})

/* ─── against the site's own index, where it is built ─── */

const SEARCH = path.join(ROOT, '.velite', 'search.json')
if (!fs.existsSync(SEARCH)) console.log('  ⚠ .velite/search.json is not built — BM25 is not exercised against real prose in this run')
else {
  const rows = JSON.parse(fs.readFileSync(SEARCH, 'utf8')).filter((r) => r.kind === 'book').map((r) => ({ slug: r.id, text: r.text }))
  if (rows.length < 2) console.log('  ⚠ fewer than two books in the index — the real-prose checks are skipped')
  else {
    const real = lexicalIndex(rows)
    t('the real index separates the shelf on an ordinary word', () => {
      const s = bm25(real, 'money')
      const vals = Object.values(s)
      assert.ok(vals.some((x) => x > 0), 'no book scored on "money"')
      assert.ok(new Set(vals).size > 1, 'every book scored the same — the index is not discriminating')
    })
    t('and a word in no book scores nothing anywhere', () => {
      assert.ok(Object.values(bm25(real, 'zzzqqxnotaword')).every((x) => x === 0))
    })
    t('the average document length is a real number, not NaN', () => {
      assert.ok(Number.isFinite(real.avg) && real.avg > 0, String(real.avg))
    })
  }
}

console.log(bad ? `ranking: ${n - bad} passed, ${bad} failed` : `ranking: ${n} passed, 0 failed`)
process.exit(bad ? 1 : 0)
