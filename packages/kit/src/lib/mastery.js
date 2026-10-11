/*
 * Mastery of a book: the chapter quizzes a reader has passed, and the trophy
 * that earns — bronze for the first chapter, silver at half, gold when every
 * chapter with a quiz is passed. Kept in the Loro store under
 * dl.book.<slug>.quiz, apart from the reading state, so it follows a signed-in
 * reader across devices like everything else under dl.*.
 */
import { ref } from 'vue'
import { get as stored, set as store } from './store.js'
import { quizChapters, companions } from './companions.js'

/* a pass is at most one miss: 4 of 5, 3 of 4, 2 of 3 — a short verse carries fewer questions */
export const PASS = 0.8   /* kept for reference; passMark is the rule */
export const passMark = (total) => Math.max(1, total - 1)
const KEY = (slug) => 'dl.book.' + slug + '.quiz'
/* bumps whenever an attempt is recorded, so computed views re-read the store */
export const masteryRev = ref(0)

export function quizState(slug) {
  try { return { v: 1, chapters: {}, mastered: null, ...JSON.parse(stored(KEY(slug)) || '{}') } } catch (e) { return { v: 1, chapters: {}, mastered: null } }
}
const passed = (rec) => !!rec && rec.total > 0 && rec.best >= passMark(rec.total)

export function tierFor(done, total) {
  if (!total || !done) return null
  if (done >= total) return 'gold'
  if (done >= Math.ceil(total / 2)) return 'silver'
  return 'bronze'
}

/* what a book's quizzes add up to */
export function masteryOf(slug) {
  void masteryRev.value
  const titles = quizChapters(slug)
  const s = quizState(slug)
  const done = titles.filter((t) => passed(s.chapters[t])).length
  return { done, total: titles.length, tier: tierFor(done, titles.length), mastered: s.mastered, chapters: s.chapters }
}
export const chapterResult = (slug, title) => (masteryOf(slug).chapters || {})[title] || null

/* an attempt: the best score is kept; the tier before and after come back so a
   caller can say what was just earned */
export function recordAttempt(slug, title, correct, total) {
  const before = masteryOf(slug)
  const s = quizState(slug)
  const prev = s.chapters[title] || { best: 0, total, tries: 0, passedAt: null }
  const rec = { best: Math.max(prev.best, correct), total, tries: (prev.tries || 0) + 1, passedAt: prev.passedAt }
  if (!rec.passedAt && correct >= passMark(total)) rec.passedAt = Date.now()
  s.chapters[title] = rec
  const titles = quizChapters(slug)
  if (!s.mastered && titles.length && titles.every((t) => passed(s.chapters[t]))) s.mastered = Date.now()
  store(KEY(slug), JSON.stringify(s))
  masteryRev.value++
  const after = masteryOf(slug)
  return { passed: correct >= passMark(total), correct, total, tier: after.tier, prevTier: before.tier, earned: after.tier !== before.tier ? after.tier : null, mastered: after.mastered }
}

/* every book with a trophy, gold first */
export function trophies() {
  void masteryRev.value
  const order = { gold: 0, silver: 1, bronze: 2 }
  return companions().map((c) => ({ slug: c.book, ...masteryOf(c.book) })).filter((m) => m.tier)
    .sort((a, b) => order[a.tier] - order[b.tier] || (b.done / b.total) - (a.done / a.total))
}
