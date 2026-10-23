/*
 * COURSES WITHOUT A DATABASE (openspec: courses): the file grammar and what it refuses, the course builder's form carried
 * to the file and back unchanged, where a lesson that points at something sends the reader, the certificate's PDF, the
 * member card's Courses panel gated by the module, and the module's own declaration. The rules a reader meets — what is
 * open, who gets in, completion — are the database's, and courses-db.test.mjs holds them.
 */
import { parseCourse, bodyParts, lessonHref, KINDS } from './courses-io.mjs'
import model, { courseFile } from './models/core/courses.mjs'
import { certificatePdf } from '../src/lib/certificate-pdf.js'
import { gatesOf } from '../src/lib/member-panels.js'
import { MODULES } from './modules/kit.mjs'
import { coursesOf, communityOf, publicSite } from './site.mjs'
import { forwardOf } from '../src/lib/community/places.js'

let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }

const FILE = `---
title: Writing plainly
access: { free: true, tiers: [member] }
release: drip
every: 2
inOrder: true
certificate: true
lessons:
  - { key: welcome, title: Why plain words, section: Starting out, media: { type: video, src: https://example.com/a.mp4 } }
  - { key: the-first-chapter, title: Read the first chapter, kind: chapter, ref: plain-words#1 }
  - { key: one-page, title: One page, downloads: [{ title: Worksheet, src: /uploads/w.pdf }] }
  - { key: check, title: A short check, kind: form, ref: reading-check }
  - { key: talk, title: Talk it through, kind: session, ref: one-on-one, required: false }
---
What the course is.

## welcome

The welcome's own words.

## one-page

Cross out every word that does not change the meaning.
`

/* the grammar */
{
  const c = parseCourse('writing-plainly', FILE)
  ok('a well-formed course has no problems', !c.problems.length, c.problems.join('; '))
  ok('its settings are read', c.release === 'drip' && c.every_days === 2 && c.in_order && c.certificate && c.access.free && c.access.tiers[0] === 'member')
  ok('the body before the first lesson is what it is about', c.about === 'What the course is.')
  ok('a text lesson takes its own section of the body', c.lessons[0].body === 'The welcome\'s own words.' && c.lessons[2].body.startsWith('Cross out'))
  ok('a lesson that points elsewhere has no text of its own', c.lessons[1].body === null && c.lessons[1].ref === 'plain-words#1')
  ok('lessons keep their order and sections', c.lessons.map((l) => l.position).join() === '1,2,3,4,5' && c.lessons[0].section === 'Starting out')
  ok('media and downloads are kept together', c.lessons[0].media[0].type === 'video' && c.lessons[2].media[0].type === 'file' && c.lessons[2].media[0].title === 'Worksheet')
  ok('a lesson is required unless it says not', c.lessons[3].required && !c.lessons[4].required)
  ok('every kind is one the database accepts', KINDS.join() === 'text,chapter,article,form,session')
}
{
  const bad = parseCourse('Bad Slug', `---\nrelease: weekly\naccess: {}\nlessons:\n  - { key: a, kind: chapter, ref: the-book }\n  - { key: a, kind: form }\n---\n`)
  const p = bad.problems.join(' | ')
  ok('an address that is not one is named', /not a course address/.test(p), p)
  ok('a missing title is named', /no title/.test(p), p)
  ok('an unknown release is named', /release is weekly/.test(p), p)
  ok('a course nobody may take is refused', /access says nobody/.test(p), p)
  ok('a chapter that is not <book>#<n> is named', /a chapter is <book>#<n>/.test(p), p)
  ok('a lesson there twice is named', /lesson a is there twice/.test(p), p)
  ok('a form lesson naming no form is named', /is a form and names none/.test(p), p)
  ok('a cohort course with no cohorts is refused', /no cohorts/.test(parseCourse('c', `---\ntitle: C\naccess: { free: true }\nrelease: cohort\nlessons: [{ key: a }]\n---\n`).problems.join()))
  ok('the body splits on its lesson headings only', JSON.stringify(bodyParts('About.\n\n## a\n\nOne.\n\n### not a lesson\n\nStill one.\n\n## b\n\nTwo.').texts) === JSON.stringify({ a: 'One.\n\n### not a lesson\n\nStill one.', b: 'Two.' }))
}

/* the course builder's form, to the file and back */
{
  const p = model.grammar.parse(FILE)
  ok('the form is flat: who gets in is three fields', p.data.free === true && p.data.tiers[0] === 'member' && !('access' in p.data))
  ok('each lesson carries its own text in its row', p.data.lessons[0].text === 'The welcome\'s own words.' && p.data.lessons[0].video === 'https://example.com/a.mp4')
  const back = model.grammar.serialise({ data: p.data, content: p.content })
  ok('a save writes the same course', JSON.stringify(parseCourse('writing-plainly', back)) === JSON.stringify(parseCourse('writing-plainly', FILE)), back)
  ok('…and the form reads it back the same', JSON.stringify(model.grammar.parse(back).data) === JSON.stringify(p.data))
  const checks = model.checks[0]({ data: { ...p.data, title: '' }, content: '' }, { name: 'writing-plainly.md' })
  ok('the builder refuses what the grammar refuses, on the field', checks.some((c) => c.path === 'title' && /no title/.test(c.message)), JSON.stringify(checks))
  ok('a new course from an empty form is refused, not written half-made', parseCourse('x', courseFile({}, '')).problems.length > 0)
  const many = FILE.replace('media: { type: video, src: https://example.com/a.mp4 } }', 'media: [{ type: video, src: https://example.com/a.mp4, title: A film }, { type: audio, src: https://example.com/b.mp3 }], downloads: [{ title: One, src: /1.pdf }, { title: Two, src: /2.pdf }] }')
  const pm = model.grammar.parse(many)
  ok('a save keeps a track\'s title, and every track and download beyond the one the form edits', JSON.stringify(parseCourse('writing-plainly', model.grammar.serialise({ data: pm.data, content: pm.content }))) === JSON.stringify(parseCourse('writing-plainly', many)))
}

/* where a lesson sends the reader */
ok('a chapter lesson opens the book at its chapter', lessonHref({ kind: 'chapter', ref: 'plain-words#3' }) === '/content/books/plain-words?chapter=3')
ok('an article, a form and a session open their own pages', lessonHref({ kind: 'article', ref: 'a' }) === '/content/articles/a' && lessonHref({ kind: 'form', ref: 'f' }) === '/form/f' && lessonHref({ kind: 'session', ref: 's' }) === '/book/s')

/* the certificate's PDF */
{
  const bytes = certificatePdf({ name: 'Zoë Ng (test)', course: 'Writing plainly', date: '22 October 2026', url: 'https://example.com/certificates/abc' })
  const text = String.fromCharCode(...bytes)
  ok('the certificate is a PDF', text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'))
  const xref = Number(/startxref\n(\d+)/.exec(text)[1])
  ok('its cross-reference table is where it says', text.slice(xref, xref + 4) === 'xref')
  const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
  ok('every object is where the table says', offsets.length === 6 && offsets.every((o, i) => text.slice(o).startsWith(`${i + 1} 0 obj`)), JSON.stringify(offsets))
  ok('a name with an accent is written, and brackets are escaped', text.includes('Zoë Ng \\(test\\)'))
  ok('a character outside Latin-1 is written as ?, not a broken file', String.fromCharCode(...certificatePdf({ name: '王' })).includes('(?)'))
}

/* the member card, and the module */
ok('the Courses panel is drawn where the module is on', gatesOf({ modules: { courses: true } }).courses === true && gatesOf({ modules: { courses: false } }).courses === false)
const mod = MODULES.find((m) => m.key === 'courses')
ok('courses is a module with no static shape', !!mod && mod.static === false && mod.git === true && mod.cloud === true)
ok('…owning its schema, its push, its function, its routes and its sweep', mod && mod.owns.schema.includes('46-courses.sql') && mod.owns.steps.includes('courses-push') && mod.owns.functions.includes('course-notify') && mod.owns.routes.includes('/courses') && mod.owns.cron.some((c) => /run_course_notices/.test(c.command)))

/* where the courses live: their own pages, or a place of the community */
{
  const plain = { name: 'x', modules: {} }
  ok('by default the courses have pages of their own', coursesOf(plain).where === 'standalone' && !communityOf(plain).places.some((p) => p.key === 'courses'))
  const social = { name: 'x', modules: {}, courses: { where: 'community' }, community: { layout: 'social' } }
  const place = communityOf(social).places.find((p) => p.key === 'courses')
  ok('in the community they are one of its places, as a site\'s own would be', !!place && place.claims.includes('/courses') && place.wide && place.shows === 'everyone')
  ok('…its page named by package, so no path of the build machine reaches the browser', place && place.component === 'platformkit/theme/components/courses/CoursesPlace.vue' && !JSON.stringify(publicSite({ ...social, looks: {} })).includes(process.cwd()))
  ok('…and /courses and everything under it forward there', forwardOf('/courses/writing-plainly/welcome', [place], '/feed') === '/feed/courses/writing-plainly/welcome')
  let refused = ''
  try { coursesOf({ modules: { network: false }, courses: { where: 'community' } }) } catch (e) { refused = e.message }
  ok('the community needs the spaces and the network, and says so', /needs the spaces and network modules/.test(refused), refused)
  try { coursesOf({ modules: {}, courses: { where: 'everywhere' } }); refused = '' } catch (e) { refused = e.message }
  ok('a place that is neither is refused', /standalone or community/.test(refused))
  ok('with the module off they are nowhere', coursesOf({ modules: { courses: false }, courses: { where: 'community' } }).where === 'standalone' && !communityOf({ modules: { courses: false }, courses: { where: 'community' } }).places.length)
  let taken = ''
  try { communityOf({ modules: {}, community: { places: [{ key: 'courses', word: 'x', component: './x.vue' }] } }) } catch (e) { taken = e.message }
  ok('a site cannot register a place of its own called courses', /already has/.test(taken), taken)
}

console.log(fail ? `courses: ${fail} failed, ${pass} passed` : `courses: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
