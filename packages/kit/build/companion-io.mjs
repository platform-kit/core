/*
 * A book's companion, read into a plain shape and written back. One file per
 * book (content/companions/<slug>.md): frontmatter carries the book, the
 * insight, the premise statement and its area/level; the body carries one
 * `# <chapter title>` per book chapter, each with `## Summary` (prose),
 * `## Essence` (a list) and `## Quiz` (numbered questions, four `- [ ]`
 * options with one `- [x]`, an optional `> why`). Chapters are matched to the
 * book by title, never by position.
 *
 * Used by velite's transform, the admin server (validation and normalising a
 * save), and the generation script. The body's grammar itself lives in
 * src/lib/companion-body.js (pure), shared with the admin's companion editor.
 * A statement area the diagnostics no longer declare is not an error here: the
 * companion still builds, its premise simply left out until it is re-filed.
 */
import matter from 'gray-matter'
import { createHash } from 'node:crypto'

const DUMP = { lineWidth: -1 }
import { areaKeys } from './quiz-io.mjs'
/* the area keys are whatever the diagnostic files declare, read when asked */
const AREAS = { get list() { return areaKeys() }, includes(k) { return areaKeys().includes(k) }, join(s) { return areaKeys().join(s) } }
const LEVELS = ['L1', 'L2', 'L3']
export { AREAS, LEVELS }

/* the body's grammar — the reader's chapter split, the parser and the serialiser — is
   src/lib/companion-body.js, pure, so the admin's companion editor runs the same code */
import { bookChapterTitles, parseCompanionBody, serialiseCompanionBody } from '../src/lib/companion-body.js'
export { bookChapterTitles, parseCompanionBody }

/* a chapter's source, hashed with the prompt version, so a rerun knows what changed */
export function chapterHash(md, promptVersion = 'v1') {
  return createHash('sha1').update(promptVersion + '\n' + String(md || '').trim()).digest('hex').slice(0, 12)
}

export function parseCompanion(raw) {
  const fm = matter(raw)
  const { chapters, issues } = parseCompanionBody(fm.content)
  return { data: fm.data, chapters, issues }
}

/* one canonical text */
export function serialiseCompanion({ data, chapters }) {
  return matter.stringify('\n' + serialiseCompanionBody(chapters) + '\n', data, DUMP)
}

/* the checks the admin and the test share: [{ path, message }] */
export function validateCompanion({ data, chapters, issues }, bookTitles) {
  const out = []
  if (!data.book) out.push({ path: 'book', message: 'names no book' })
  if (!data.insight || !String(data.insight).trim()) out.push({ path: 'insight', message: 'the insight is empty' })
  /* the premise is the instrument's: a site with one asks for it whole (the test does, behind the instrument switch); a site without writes none */
  const premise = data.statement !== undefined || data.statementArea !== undefined || data.statementLevel !== undefined
  if (premise && (!data.statement || !String(data.statement).trim())) out.push({ path: 'statement', message: 'the premise statement is empty' })
  if (data.statementLevel && !LEVELS.includes(data.statementLevel)) out.push({ path: 'statementLevel', message: `"${data.statementLevel}" is not L1, L2 or L3` })
  if (Array.isArray(bookTitles)) {
    const seen = new Set()
    for (const c of chapters) {
      if (!bookTitles.includes(c.title)) out.push({ path: 'chapter', message: `"${c.title}" is not a chapter of this book` })
      if (seen.has(c.title)) out.push({ path: 'chapter', message: `"${c.title}" appears twice` })
      seen.add(c.title)
    }
  }
  for (const i of issues || []) out.push({ path: 'quiz', message: i.chapter + ': ' + i.message })
  return out
}
