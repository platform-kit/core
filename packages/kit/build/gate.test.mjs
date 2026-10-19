/* What of a record a reader is sent (_shared/gate.js): the chapters each class may read, a bought book's
   lift, the teaser that is never the whole chapter, and the public record of a book, a page and a
   companion — the rule the build, the cloud loader and reader-content all apply. Pinned by npm test. */
import { chapterAllowance, readableChapters, splitChapters, bookTextFor, teaserOf, publicBook, publicPage, publicCompanion, isGatedPage } from '../supabase/functions/_shared/gate.js'

let pass = 0, fail = 0
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg) } }

const para = (word, n = 40) => Array.from({ length: n }, (_, i) => `${word} sentence ${i}.`).join(' ')
const raw = `# One\n\n${para('alpha')}\n\n# Two\n\n${para('bravo')}\n\n# Three\n\n${para('charlie')}\n\n# Four\n\nDelta is short and private.\n`
const book = { slug: 'probe', raw, canAccess: ['subscribed'], guestChapters: 1, authenticatedChapters: 2 }
const open = { slug: 'open', raw, guestChapters: 1, authenticatedChapters: 2, paidChapters: 3 }

/* the allowance, class by class */
ok('a guest reads one chapter of an open book', readableChapters(open, 'guest') === 1)
ok('a signed-in reader reads two', readableChapters(open, 'authenticated') === 2)
ok('a paying reader reads three', readableChapters(open, 'paid') === 3)
ok('a member reads every chapter', readableChapters(open, 'subscribed') === Infinity)
ok('a higher class never reads fewer', chapterAllowance({ guestChapters: 3, authenticatedChapters: 1, paidChapters: 1 }, 'paid') === 3)
ok('an unset allowance is the whole book', chapterAllowance({ guestChapters: 1 }, 'authenticated') === Infinity)
ok('a members-only book is closed to a guest', readableChapters(book, 'guest') === 0)
ok('…and to a signed-in reader', readableChapters(book, 'authenticated') === 0)
ok('…and open to a member', readableChapters(book, 'subscribed') === Infinity)
ok('a bought book lifts its buyer to paid', readableChapters(open, 'authenticated', { owned: true }) === 3)
ok('a bought book opens a paid bar', readableChapters({ ...open, canAccess: ['paid'] }, 'authenticated', { owned: true }) === 3)
ok('a bought book does not open a members-only bar', readableChapters(book, 'authenticated', { owned: true }) === 0)

/* the text cut to n chapters */
ok('the reader\'s split', splitChapters(raw).length === 4)
const one = bookTextFor(raw, 1)
ok('the free chapter whole', one.includes(para('alpha')))
ok('every chapter title kept', splitChapters(one).map((p) => p.split('\n')[0]).join() === '# One,# Two,# Three,# Four')
ok('no locked sentence past its teaser', !/bravo sentence 39|charlie sentence 39/.test(one))
ok('a short locked chapter is never whole', !one.includes('Delta is short and private.'))
ok('the whole text when nothing is locked', bookTextFor(raw, Infinity) === raw && bookTextFor(raw, 4) === raw)
const t = teaserOf(splitChapters(raw)[1])
ok('a teaser starts with its heading', t.startsWith('# Two\n'))
ok('a teaser is at most half its chapter', t.length - '# Two\n\n'.length <= Math.ceil(para('bravo').length / 2) + 1)
ok('a teaser covers what the paywall shows', t.replace(/[#*_=`{}]/g, '').replace(/\s+/g, ' ').trim().length >= 260)

/* the public records */
const pb = publicBook(open)
ok('a book is published as a guest may read it', pb.gatedFrom === 1 && !pb.raw.includes('bravo sentence 39'))
const whole = { slug: 'x', raw }
ok('a book with nothing gated is unchanged', publicBook(whole) === whole)
ok('a members-only book publishes no chapter', publicBook(book).gatedFrom === 0 && !publicBook(book).raw.includes('alpha sentence 39'))
const page = { id: 'p', title: 'T', description: 'D', excerpt: 'E', canAccess: ['paid'], body: '<p>secret</p>', raw: 'secret', toc: [{ t: 'h' }] }
const pp = publicPage(page)
ok('a gated page keeps its hero and excerpt', pp.title === 'T' && pp.description === 'D' && pp.excerpt === 'E' && pp.gated === true)
ok('…and loses its body, raw text and contents', pp.body === '' && pp.raw === '' && pp.toc.length === 0)
const openPage = { ...page, canAccess: [] }
ok('an open page is unchanged', publicPage(openPage) === openPage)
ok('an open page keeps its body', publicPage({ ...page, canAccess: [] }).body === '<p>secret</p>' && !isGatedPage({ canAccess: ['guest'] }))
const comp = { book: 'open', chapters: [
  { title: 'One', summaryMd: 'a', quiz: [{ q: 1 }] }, { title: 'Two', summaryMd: 'b', essence: ['e'], quiz: [{ q: 1 }] }, { title: 'Three', summaryMd: 'c' }] }
const pc = publicCompanion(comp, open)
ok('a companion keeps the chapters a guest may read', pc.chapters[0].summaryMd === 'a')
ok('…and only the titles of the rest', !('summaryMd' in pc.chapters[1]) && !('essence' in pc.chapters[1]) && !('quiz' in pc.chapters[1]))
ok('…saying which have a quiz, so mastery counts them', pc.chapters[1].hasQuiz === true && pc.chapters[2].hasQuiz === false)

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed (what a reader is sent)`)
process.exit(fail ? 1 : 0)
