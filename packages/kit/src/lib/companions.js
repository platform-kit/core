/*
 * A book's companion: the chapter summaries and essences, the chapter quizzes,
 * the one-line insight shown wherever the book is recommended, and the
 * premise statement the teachings test asks. Compiled by velite from
 * content/companions/<slug>.md; looked up here by the book's slug.
 *
 * The compiled companion is the one a guest may read (_shared/gate.js): a locked
 * chapter is its title and whether it has a quiz. A reader with access is sent the
 * rest by reader-content, and `useCompanion` puts what they were sent in front.
 */
import { companions as ALL } from '#content'
import { parseCompanionBody } from './companion-body.js'

/* what a reader with access was sent, by book: it stands over the compiled companion */
const sent = new Map()
export function useCompanion(slug, md) {
  if (md == null) { sent.delete(slug); return }
  const base = (ALL || []).find((c) => c.book === slug) || { book: slug }
  const { chapters } = parseCompanionBody(md)
  sent.set(slug, { ...base, chapters: chapters.map((c) => ({ ...c, summaryMd: c.summaryMd || '' })) })
}
export const forgetCompanions = () => sent.clear()

export const companions = () => (ALL || []).map((c) => sent.get(c.book) || c)
export const companionFor = (slug) => sent.get(slug) || companions().find((c) => c.book === slug) || null
export const chapterCompanion = (slug, title) => {
  const c = companionFor(slug)
  return c ? c.chapters.find((ch) => ch.title === title) || null : null
}
export const insightFor = (slug) => (companionFor(slug) || {}).insight || ''
/* the book's core ideas in plain words: every chapter's essence lines, in order — the
   bottom line of the whole book, for wherever one book is put forward */
export const coreIdeas = (slug) => ((companionFor(slug) || {}).chapters || []).flatMap((ch) => ch.essence || [])
/* the chapters that carry a quiz — what mastery is measured over; a locked chapter says
   whether it has one without carrying the questions */
export const quizChapters = (slug) => ((companionFor(slug) || {}).chapters || []).filter((ch) => (ch.quiz && ch.quiz.length) || ch.hasQuiz).map((ch) => ch.title)
export const summaryTime = (slug) => (companionFor(slug) || {}).summaryReadingTime || 0
