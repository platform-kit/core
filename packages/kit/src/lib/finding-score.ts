/*
 * The arithmetic of Find your book — pure, no imports, so the build can probe it
 * under node with the real index. A reader's sentence is matched to a book two
 * ways, then the two are combined:
 *
 *  - by meaning: the sentence's embedding against the book's teaching pieces
 *    (insight + premise as the head piece, each chapter's essence as another).
 *    A book's semantic score is half its head piece and half the mean of its two
 *    best chapters — never the plain best, since a book of eighty-one chapters
 *    would win every sentence by having eighty-one tries;
 *  - by words: BM25 over the book's whole text (the palette's search rows), so
 *    "money" finds the books that talk about money, which a single word's
 *    embedding is too faint to do on its own.
 *
 * Each is min–max normalised across the books for that sentence, so the two
 * scales match, and the sentence's score is 0.5 meaning + 0.5 words. Sentences
 * are weighted (the problem a little more than the frustration) and summed.
 */

export const STOP = new Set('a an and are as at be been but by for from has have how i if in into is it its just me my not of on or our so than that the their them then there these they this to too us very was we what when where which who why will with would you your'.split(' '))

export const tokens = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/)
  .map((w) => w.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2)).replace(/([^s])s$/, '$1'))
  .filter((w) => w.length >= 3 && !STOP.has(w))

/* one BM25 index over the books' texts: { docs: [{ slug, tf, len }], df, avg } */
export function lexicalIndex(rows: any) {
  const docs = rows.map((r: any) => {
    const tf: any = {}; const ws = tokens(r.text)
    for (const w of ws) tf[w] = (tf[w] || 0) + 1
    return { slug: r.slug, tf, len: ws.length }
  })
  const df: any = {}
  for (const d of docs) for (const w of Object.keys(d.tf)) df[w] = (df[w] || 0) + 1
  const avg = docs.reduce((s: any, d: any) => s + d.len, 0) / Math.max(docs.length, 1)
  return { docs, df, avg, n: docs.length }
}
export function bm25(index: any, query: any, k1 = 1.2, b = 0.75) {
  const q = [...new Set(tokens(query))]
  const out: any = {}
  for (const d of index.docs) {
    let s = 0
    for (const w of q) {
      const f = d.tf[w] || 0; if (!f) continue
      const idf = Math.log(1 + (index.n - (index.df[w] || 0) + 0.5) / ((index.df[w] || 0) + 0.5))
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / index.avg))
    }
    out[d.slug] = s
  }
  return out
}

export const cosine = (a: any, b: any) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

/* pieces: [{ book, key, vec }]; qvec: the sentence's embedding → { slug: score } */
export function semantic(pieces: any, qvec: any) {
  const by: any = {}
  for (const p of pieces) (by[p.book] = by[p.book] || { head: 0, ch: [] })[p.key === 'insight' ? 'head' : 'ch'] = p.key === 'insight' ? cosine(p.vec, qvec) : (by[p.book].ch.push(cosine(p.vec, qvec)), by[p.book].ch)
  const out: any = {}
  for (const [slug, v] of Object.entries(by)) {
    const ch = (v as any).ch.slice().sort((x: any, y: any) => y - x)
    const top = ch.length ? (ch[0] + (ch[1] ?? ch[0])) / 2 : (v as any).head
    out[slug] = 0.5 * (v as any).head + 0.5 * top
  }
  return out
}

/* 0..1 across the books, 0 everywhere when nothing separates them */
export function normalise(scores: any) {
  // @ts-expect-error TS2345, from the conversion: Argument of type 'unknown' is not assignable to parameter of type 'number'.
  const vals = Object.values(scores); const lo = Math.min(...vals), hi = Math.max(...vals)
  const out: any = {}
  // @ts-expect-error TS18046, from the conversion: 'v' is of type 'unknown'.
  for (const [k, v] of Object.entries(scores)) out[k] = hi > lo ? (v - lo) / (hi - lo) : 0
  return out
}

/* one sentence: meaning and words, each normalised, halved and summed → { slug: 0..1 } */
export function sentenceScores(slugs: any, pieces: any, index: any, qvec: any, text: any) {
  const sem: any = normalise(Object.fromEntries(slugs.map((s: any) => [s, semantic(pieces, qvec)[s] || 0])))
  const lex: any = normalise(Object.fromEntries(slugs.map((s: any) => [s, bm25(index, text)[s] || 0])))
  return Object.fromEntries(slugs.map((s: any) => [s, 0.5 * sem[s] + 0.5 * lex[s]]))
}

/* several sentences, weighted → [{ slug, score }] best first */
export function combine(slugs: any, perSentence: any, weights: any) {
  const total = weights.reduce((s: any, w: any) => s + w, 0) || 1
  return slugs.map((slug: any) => ({ slug, score: perSentence.reduce((s: any, sc: any, i: any) => s + (weights[i] / total) * (sc[slug] || 0), 0) }))
    .sort((a: any, b: any) => b.score - a.score)
}

/* speed or depth: a lean of at most PACE toward the shorter books ('short') or the longer
   ('long') — books placed 0..1 by the log of their length, so the lean is even across the
   shelf. Added to the sentences' score (itself 0..1), it reorders near-ties and never
   outweighs what was written. */
export const PACE = 0.15
export function paceLean(slugs: any, wordsOf: any, pref: any) {
  if (pref !== 'short' && pref !== 'long') return Object.fromEntries(slugs.map((s: any) => [s, 0]))
  const ln = Object.fromEntries(slugs.map((s: any) => [s, Math.log(Math.max(1, wordsOf[s] || 1))]))
  const pos: any = normalise(ln)
  return Object.fromEntries(slugs.map((s: any) => [s, PACE * (pref === 'short' ? 1 - pos[s] : pos[s])]))
}
