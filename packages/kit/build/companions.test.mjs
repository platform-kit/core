/*
 * Every companion names a hosted book, once; every chapter it carries is a
 * chapter of that book; every quiz question has four options and one answer.
 * Optional premise fields are checked by validateCompanion when present.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { parseCompanion, validateCompanion, bookChapterTitles } from './companion-io.mjs'

const DIR = 'content/companions'
let fails = 0
const fail = (m) => { fails++; console.log('FAIL ' + m) }
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.md')) : []
const seen = new Set()
for (const f of files) {
  const c = parseCompanion(readFileSync(DIR + '/' + f, 'utf8'))
  const bookFile = 'content/books/' + c.data.book + '.md'
  if (!existsSync(bookFile)) { fail(`${f}: no book "${c.data.book}"`); continue }
  if (seen.has(c.data.book)) fail(`${f}: a second companion for ${c.data.book}`)
  seen.add(c.data.book)
  const titles = bookChapterTitles(readFileSync(bookFile, 'utf8').replace(/^---[\s\S]*?\n---\n?/, ''))
  for (const i of validateCompanion(c, titles)) fail(`${f}: ${i.path}: ${i.message}`)
  const withQuiz = c.chapters.filter((ch) => ch.quiz.length).length
  console.log(`ok   ${c.data.book}: ${c.chapters.length} chapters, ${withQuiz} with a quiz, of ${titles.length} in the book`)
}
console.log(fails ? `${fails} problem(s)` : `companions: ${files.length} file(s), all sound`)
process.exit(fails ? 1 : 0)
