/*
 * THE GATE ON TEXT — what of a record a reader may be sent, once, for the build, the cloud loader and the
 * server alike (plain JavaScript: no environment, no imports beyond the ladder).
 *
 * The access rule decides what a reader is SHOWN (access.js); this decides what they are SENT. Until it
 * existed the two were one decision taken in the browser: every chapter and every gated page shipped in the
 * bundle and the reader drew a paywall over it, so anyone who opened the bundle read what a member pays for.
 * Now the published record is the PUBLIC record — what a guest may read — and the rest is held on the
 * server and sent to a reader the same rule admits (functions/reader-content).
 *
 * What stays public: titles, descriptions, covers, every chapter's title, the chapters a guest may read,
 * and a short teaser of each locked chapter and gated page (the opening lines the paywall already shows, and
 * a page's excerpt). What does not: the rest of a locked chapter, a gated page's body and its contents list,
 * and a locked chapter's companion (its summary, key points and quiz).
 *
 *   chapterAllowance(fm, cls)          how many chapters a class may read (Infinity = all)
 *   readableChapters(fm, cls, opts)    the same, closed by the book's own bar and raised for an owned book
 *   splitChapters(raw)                 a book's chapters as the reader splits them
 *   bookTextFor(raw, n)                the book's text with every chapter from n on cut to its teaser
 *   isGatedPage(fm)                    whether a guest may not read a page
 *   textWithheld(fm) / titlesOnly(raw) a book whose text is never published (`fullText: false`), and what of it is
 *   sentText(fm, raw, n)               what a reader allowed n chapters is sent of a book
 *   publicBook / publicPage / publicCompanion   the public record of each
 */
import { CLASSES, allowedBy } from './access.js'

const rank = (c) => Math.max(0, CLASSES.indexOf(c))
const KEYS = { guest: 'guestChapters', authenticated: 'authenticatedChapters', paid: 'paidChapters', subscribed: 'subscribedChapters' }

/* how many chapters a class may read before the paywall (Infinity = all); a higher class never gets fewer */
export function chapterAllowance(fm, cls) {
  let best = -1
  for (const c of CLASSES) {
    if (rank(c) > rank(cls)) break
    const v = fm && fm[KEYS[c]]
    best = Math.max(best, typeof v === 'number' ? v : Infinity)
  }
  return best < 0 ? Infinity : best
}

/* what the reader does (BookReader's bookAllowed and effClass): a book bought outright lifts its buyer to paid
   for that book — for its bar and for its chapter allowance alike */
export function readableChapters(fm, cls, { owned = false } = {}) {
  const eff = owned && rank(cls) < rank('paid') ? 'paid' : cls
  if (!allowedBy(fm && fm.canAccess, eff)) return 0
  return chapterAllowance(fm, eff)
}

/* the reader's own split (lib/speech.js bookChapters): a chapter starts at a level-one heading */
export const splitChapters = (raw) => String(raw || '').split(/^(?=# )/m).filter((s) => s.trim())

/* the opening the paywall shows: the heading and the first lines of the chapter, cut at a word.
   Longer than the 260 characters the reader shows once its marks are stripped, so the teaser it draws
   is the same as before — and never more than half the chapter, because a short chapter whose teaser
   was the whole of it would be a locked chapter anyone could read. */
export const TEASER_CHARS = 400
export function teaserOf(part) {
  const m = /^# .*$/m.exec(part)
  const head = m ? m[0] : ''
  const rest = part.slice(m ? m.index + m[0].length : 0).trim()
  const limit = Math.min(TEASER_CHARS, Math.floor(rest.length / 2))
  const cut = rest.slice(0, limit).replace(/\s+\S*$/, '')
  return (head ? head + '\n\n' : '') + cut + '\n'
}

/* the book's text with chapters from n on cut to their teasers; the whole text when n reaches the end */
export function bookTextFor(raw, n) {
  const parts = splitChapters(raw)
  if (!(n < parts.length)) return String(raw || '')
  return parts.map((p, i) => (i < n ? (p.endsWith('\n') ? p : p + '\n') : teaserOf(p))).join('\n')
}

export const isGatedPage = (fm) => !allowedBy(fm && fm.canAccess, 'guest')

/* A BOOK WHOSE TEXT IS NEVER PUBLISHED (`fullText: false`): its summaries are, its chapters' text is not — to
   nobody, of any class, bought or not. What leaves is each chapter's title alone, so the reader still splits it
   into chapters and the companion still finds its own. The file may hold the text while the summaries are written. */
export const textWithheld = (fm) => !!fm && fm.fullText === false
export const titlesOnly = (raw) => splitChapters(raw).map((p) => { const m = /^# .*$/m.exec(p); return m ? m[0] + '\n' : '' }).filter(Boolean).join('\n')
export const holdsText = (raw) => splitChapters(raw).some((p) => p.replace(/^# .*$/m, '').trim())
/* the text a reader allowed n chapters is sent: the chapters' titles alone for a book whose text is withheld */
export const sentText = (fm, raw, n) => (textWithheld(fm) ? titlesOnly(raw) : bookTextFor(raw, n))

/* a book as a guest may have it */
export function publicBook(book) {
  if (!book || typeof book.raw !== 'string') return book
  if (textWithheld(book)) return { ...book, raw: titlesOnly(book.raw) }
  const n = readableChapters(book, 'guest')
  if (!(n < splitChapters(book.raw).length)) return book
  return { ...book, raw: bookTextFor(book.raw, n), gatedFrom: n }
}

/* an article, wiki or docs page as a guest may have it: the hero and the excerpt, no body */
export function publicPage(rec) {
  if (!rec || !isGatedPage(rec)) return rec
  const out = { ...rec, gated: true, body: '' }
  if ('raw' in out) out.raw = ''
  if ('toc' in out) out.toc = []
  return out
}

/* a book's companion as a guest may have it: the chapters a guest may read, and the titles of the rest —
   with whether each has a quiz, because mastery is counted over every quizzed chapter and a trophy must not
   be won over the free ones alone */
export function publicCompanion(comp, book) {
  if (!comp || !Array.isArray(comp.chapters) || !book) return comp
  const n = readableChapters(book, 'guest')
  if (!(n < comp.chapters.length)) return comp
  return { ...comp, chapters: comp.chapters.map((c, i) => (i < n ? c : { title: c.title, gated: true, hasQuiz: !!(c.quiz && c.quiz.length) })) }
}

/*
 * CLOUD ROWS AS A GUEST MAY HAVE THEM — what reader-content sends the live loader (lib/content-live.js), and
 * what build/entry.test.mjs feeds the adapter. The companion grammar is passed in, because the functions and
 * the kit read it from different places ({ parseCompanionBody, serialiseCompanionBody }).
 *
 *   companionTextFor(md, n, lib)       a companion's body with every chapter from n on cut to its title
 *   publicRow(row, books, lib)         a row of public.content as a guest may read it; `books` is slug → frontmatter
 */
export function companionTextFor(md, n, lib) {
  const { chapters } = lib.parseCompanionBody(md || '')
  if (!(n < chapters.length)) return md || ''
  return lib.serialiseCompanionBody(chapters.map((c, i) => (i < n ? c : { ...c, summaryMd: '', essence: [], quiz: [] })))
}

/* the frontmatter part of a file, kept, with a new body after it */
function withBody(text, body, next) {
  const t = String(text == null ? '' : text), b = String(body == null ? '' : body)
  return b && t.endsWith(b) ? t.slice(0, t.length - b.length) + next : t.replace(/^(---[\s\S]*?\n---\n?)[\s\S]*$/, '$1') + next
}

const PAGE_ROWS = new Set(['articles', 'wiki', 'docs'])
export function publicRow(row, books, lib) {
  const fm = row.data || {}
  if (row.collection === 'books') {
    const pub = publicBook({ ...fm, raw: row.body || '' })
    if (pub.raw === (row.body || '')) return row
    if (textWithheld(fm)) return { ...row, body: pub.raw, text: withBody(row.text, row.body, pub.raw) }
    /* where the cut starts, as velite writes it: the reader asks for the rest from there */
    return { ...row, data: { ...fm, gatedFrom: pub.gatedFrom }, body: pub.raw, text: withBody(row.text, row.body, pub.raw) }
  }
  if (PAGE_ROWS.has(row.collection) && isGatedPage(fm)) return { ...row, body: '', text: withBody(row.text, row.body, '') }
  if (row.collection === 'companions') {
    const book = books.get(fm.book)
    if (!book) return row
    const n = readableChapters(book, 'guest')
    const cut = companionTextFor(row.body || '', n, lib)
    if (cut === (row.body || '')) return row
    /* what the cut would lose that is not text: which chapters have a quiz (mastery is counted over all of
       them) and how long the whole summary reads (lib/entry.js reads both back) */
    const { chapters } = lib.parseCompanionBody(row.body || '')
    const quizzed = chapters.filter((c) => c.quiz && c.quiz.length).map((c) => c.title)
    const summaryWords = chapters.reduce((n, c) => n + String(c.summaryMd || '').split(/\s+/).filter(Boolean).length, 0)
    return { ...row, data: { ...fm, gatedFrom: n, quizzed, summaryWords }, body: cut, text: withBody(row.text, row.body, cut) }
  }
  return row
}
