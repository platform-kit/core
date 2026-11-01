/*
 * Find your book: a reader's own words, matched against the books. Two sentences
 * finished in the round (the problem they would solve at a snap, the thing that
 * has frustrated them most lately) are embedded in the browser (the same model
 * the palette and the hub use) and scored by meaning against the teachings
 * index the build wrote (.velite/teachings.json, build/embed-content.mjs) and by
 * words against the books' own text (the palette's search rows) — the arithmetic
 * is src/lib/finding-score.js. The sentences are weighted, the problem a little
 * more than the frustration, and the top three are the recommendation. There is
 * no empty answer: every reader gets three books, however they wrote.
 */
import TEACHINGS from '#content/teachings.json'
import { corpus } from './search-index.js'
import { books as BOOKS } from '#content'
import { embedText } from './content.js'
import { lexicalIndex, sentenceScores, combine, paceLean } from './finding-score.js'

/* the sentences, in the order asked, and the weight each carries; what they are
   looking for is the lightest — a kind of book, not a problem of theirs */
export const PROMPTS = [
  { key: 'problem', weight: 0.45 },
  { key: 'frustration', weight: 0.35 },
  { key: 'looking', weight: 0.2 },
]
/* the books that can be found: those the index knows */
export const FIND_BOOKS = [...new Set((TEACHINGS as any).map((t: any) => t.book))].filter((slug) => (BOOKS || []).some((b: any) => b.slug === slug))

let index: any = null
const lexical: any = async () => index || (index = lexicalIndex((await corpus()).filter((r: any) => r.kind === 'book' && FIND_BOOKS.includes(r.id)).map((r: any) => ({ slug: r.id, text: r.text }))))

/* answers: { problem: 'text', frustration: 'text' } (either may be empty) → [{ slug, score }], best first */
/* the looking-for choice as words to match: the choice's own line (quiz.md
   `teachings.find` <choice>-text), or what was written for "other" */
export function lookingText(answers: any, words: any = {}) {
  const c = String(answers.looking || '').trim()
  if (!c) return ''
  if (c === 'other') return String(answers.looking_text || '').trim()
  return String(words[c + '-text'] || c)
}
export async function rankBooks(answers: any, words = {}) {
  const asked = PROMPTS.map((p) => ({ ...p, text: p.key === 'looking' ? lookingText(answers, words) : String(answers[p.key] || '').trim() })).filter((p) => p.text)
  if (!asked.length) return []
  const vecs = await Promise.all(asked.map((p) => embedText(p.text)))
  const lex = await lexical()
  const per = asked.map((p, i) => sentenceScores(FIND_BOOKS, TEACHINGS, lex, vecs[i], p.text))
  /* then the lean toward short or long reads, from the books' own lengths */
  const wordsOf = Object.fromEntries((BOOKS || []).map((b: any) => [b.slug, (b.metadata && b.metadata.wordCount) || 0]))
  const lean = paceLean(FIND_BOOKS, wordsOf, answers.pace)
  return combine(FIND_BOOKS, per, asked.map((p) => p.weight)).map((r: any) => ({ slug: r.slug, score: r.score + lean[r.slug] })).sort((a: any, b: any) => b.score - a.score)
}

/* the round's rows — what was written and what was found — are read by finding-rows.js */
export { findingAnswers, findingResult } from './finding-rows.js'
