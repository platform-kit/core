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
export function useCompanion(slug: any, md: string|null) {
  if (md == null) { sent.delete(slug); return }
  const base = (ALL || []).find((c: { book: any; }) => c.book === slug) || { book: slug }
  const { chapters } = parseCompanionBody(md)
  sent.set(slug, { ...base, chapters: chapters.map((c: { summaryMd: any; }) => ({ ...c, summaryMd: c.summaryMd || '' })) })
}
export const forgetCompanions = () => sent.clear()

export const companions = () => (ALL || []).map((c: { book: any; }) => sent.get(c.book) || c)
export const companionFor = (slug: any) => sent.get(slug) || companions().find((c: { book: any; }) => c.book === slug) || null
export const chapterCompanion = (slug: any, title: any) => {
  const c = companionFor(slug)
  return c ? c.chapters.find((ch: { title: any; }) => ch.title === title) || null : null
}
export const insightFor = (slug: any) => (companionFor(slug) || {}).insight || ''
/* the book's core ideas in plain words: every chapter's essence lines, in order — the
   bottom line of the whole book, for wherever one book is put forward */
export const coreIdeas = (slug: any) => ((companionFor(slug) || {}).chapters || []).flatMap((ch: { essence: any; }) => ch.essence || [])
/* the chapters that carry a quiz — what mastery is measured over; a locked chapter says
   whether it has one without carrying the questions */
export const quizChapters = (slug: any) => ((companionFor(slug) || {}).chapters || []).filter((ch: { quiz: string|any[]; hasQuiz: any; }) => (ch.quiz && ch.quiz.length) || ch.hasQuiz).map((ch: { title: any; }) => ch.title)
export const summaryTime = (slug: any) => (companionFor(slug) || {}).summaryReadingTime || 0
