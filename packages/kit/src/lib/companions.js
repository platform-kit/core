/*
 * A book's companion: the chapter summaries and essences, the chapter quizzes,
 * the one-line insight shown wherever the book is recommended, and the
 * premise statement the teachings test asks. Compiled by velite from
 * content/companions/<slug>.md; looked up here by the book's slug.
 */
import { companions as ALL } from '#content'

export const companions = () => ALL || []
export const companionFor = (slug) => companions().find((c) => c.book === slug) || null
export const chapterCompanion = (slug, title) => {
  const c = companionFor(slug)
  return c ? c.chapters.find((ch) => ch.title === title) || null : null
}
export const insightFor = (slug) => (companionFor(slug) || {}).insight || ''
/* the book's core ideas in plain words: every chapter's essence lines, in order — the
   bottom line of the whole book, for wherever one book is put forward */
export const coreIdeas = (slug) => ((companionFor(slug) || {}).chapters || []).flatMap((ch) => ch.essence || [])
/* the chapters that carry a quiz — what mastery is measured over */
export const quizChapters = (slug) => ((companionFor(slug) || {}).chapters || []).filter((ch) => ch.quiz && ch.quiz.length).map((ch) => ch.title)
export const summaryTime = (slug) => (companionFor(slug) || {}).summaryReadingTime || 0
