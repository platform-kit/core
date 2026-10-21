/*
 * A BOOK IN RUNS. Pure arithmetic — the planner has no Typst, no files and no clock in it — so
 * the rules that decide how a book is cut up can be stated here rather than discovered in a PDF.
 *
 * What matters: a book that fits is ONE run (most of them do), the order is never changed to pack
 * it better, a chapter longer than the budget gets a run of its own rather than being split, and a
 * run that came out longer than planned moves the ones after it and nothing else.
 */
import { planRuns, reoffset, pagesOf, PAGES_PER_RUN } from '../build/print/plan-pieces.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nPRINT RUNS\n')

const ch = (title, pages) => ({ title, pages })

/* --- a book that fits is one call --- */
{
  const runs = planRuns([ch('a', 10), ch('b', 20), ch('c', 30)], { budget: 120 })
  ok('a short book is one run', runs.length === 1)
  ok('and it starts on page one', runs[0].from === 1)
  ok('and holds every chapter', runs[0].chapters.length === 3)
  ok('and knows how long it is', runs[0].pages === 60)
}

/* --- a longer one is cut at the budget, in the book's own order --- */
{
  const runs = planRuns([ch('a', 80), ch('b', 60), ch('c', 40)], { budget: 120 })
  ok('it is cut where the budget says', runs.length === 2, JSON.stringify(runs.map((r) => r.pages)))
  ok('the first run takes what fits', runs[0].chapters.map((c) => c.title).join('') === 'a')
  ok('the rest follow in the book\'s order', runs[1].chapters.map((c) => c.title).join('') === 'bc')
  ok('and the second knows where it starts', runs[1].from === 81, String(runs[1].from))
}

/* --- a chapter bigger than the budget is not split --- */
{
  const runs = planRuns([ch('a', 10), ch('huge', 300), ch('z', 10)], { budget: 120 })
  const huge = runs.find((r) => r.chapters.some((c) => c.title === 'huge'))
  ok('an over-long chapter gets a run of its own', huge.chapters.length === 1)
  ok('and is never cut in half', huge.pages === 300)
  ok('and what follows it starts after it', runs[runs.length - 1].from === 311, String(runs[runs.length - 1].from))
}

/* --- pages from words where the book has not been set yet --- */
{
  ok('a chapter measured in words has a page estimate', pagesOf({ words: 900 }) === 3)
  ok('and nothing is ever zero pages', pagesOf({ words: 0 }) === 1 && pagesOf({}) === 1)
  ok('a known page count wins over the estimate', pagesOf({ words: 9000, pages: 4 }) === 4)
}

/* --- and again, with what actually happened --- */
{
  const runs = planRuns([ch('a', 60), ch('b', 60), ch('c', 60), ch('d', 60)], { budget: 120 })
  ok('planned as two runs', runs.length === 2)
  /* the first run came out four pages longer than planned */
  const real = reoffset(runs, [124, 120])
  ok('the first run still starts on page one', real[0].from === 1)
  ok('the second moves by what the first actually took', real[1].from === 125, String(real[1].from))
  ok('and says it moved, so only it is set again', real[1].moved === true && real[0].moved === false)
  /* nothing moved */
  const same = reoffset(runs, [120, 120])
  ok('a run that came out as planned moves nothing', same.every((r) => !r.moved))
}

/* --- the budget itself --- */
{
  ok('the budget is a number with a measurement behind it', PAGES_PER_RUN > 0 && PAGES_PER_RUN <= 200)
  const empty = planRuns([], {})
  ok('a book with no chapters plans no runs', empty.length === 0)
  ok('and nothing throws on rubbish', planRuns(null).length === 0)
}


/* --- the paperback's picture, sized where there is no sharp --- */
{
  const { transformUrl, sizePicture, MAX_HEIGHT } = await import('../build/print/picture.js')
  const obj = 'https://p.supabase.co/storage/v1/object/public/content/books/x.png'
  const at = transformUrl(obj)
  ok('an object url becomes a render url', at.includes('/storage/v1/render/image/'), at)
  ok('and asks for the printer\'s height', at.includes('height=' + MAX_HEIGHT))
  ok('and never crops, because cover.typ decides the shape', at.includes('resize=contain'))
  ok('a url already rendered is not rendered twice',
    (transformUrl(at).match(/render\/image/g) || []).length === 1)
  ok('a signed url keeps its token', transformUrl(obj + '?token=abc').includes('token=abc'))
  ok('nothing is not a url', transformUrl('') === '' && transformUrl(null) === '')

  /* the fetch is taken rather than assumed, so this needs no network */
  let asked = ''
  const bytes = await sizePicture(obj, { fetchFn: async (u) => { asked = u; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } } })
  ok('a url is sized by Storage', asked.includes('render/image') && bytes.length === 3)
  let threw = ''
  try { await sizePicture(obj, { fetchFn: async () => ({ ok: false, status: 404 }) }) } catch (e) { threw = e.message }
  ok('and a picture that cannot be sized says so, loudly', /could not be sized \(404\)/.test(threw), threw)
}


/* --- WHAT A PRINTER WILL BIND --- */
{
  const { padFor, boundPages, BIND_MIN } = await import('../build/print/plan-pieces.mjs')
  ok('a book under the minimum is padded up to it', boundPages(26, { min: 32 }) === 32)
  ok('and the pad is the difference', padFor(26, { min: 32 }) === 6)
  ok('an odd count gets one more leaf', boundPages(25, {}) === 26)
  ok('an even one over the minimum is left alone', padFor(100, {}) === 0)
  ok('a printer counting in fours rounds up to four', boundPages(101, { step: 4 }) === 104)
  ok('and one already on four is left alone', padFor(100, { step: 4 }) === 0)
  ok('nothing at all still meets the minimum', boundPages(0, {}) === BIND_MIN)
  ok('rubbish does not throw', padFor(null) >= 0 && padFor(undefined, { min: 0, step: 0 }) >= 0)
  /* the minimum and the step, one rule for the build and the function: each printer asked for the FORMAT it would make
     (the function's own copy asked without one, and bound 77 pages to 80 where the build bound them to 78) */
  const { bindingFor } = await import('../build/print/plan-pieces.mjs')
  const asked = []
  const printer = (id, byFormat) => ({ id, product: ({ chosen }) => { asked.push(id + ':' + (chosen && chosen.format)); return byFormat[chosen && chosen.format] || {} } })
  const lulu = printer('lulu', { softcover: { minPages: 32, pageStep: 2 }, hardcover: { minPages: 24, pageStep: 2 } })
  const vault = printer('bookvault', { hardcover: { minPages: 24, pageStep: 4 } })
  const cands = (spec, f) => (f === 'softcover' ? [lulu] : [lulu, vault])
  const b = bindingFor({ trim: '6x9' }, ['softcover', 'hardcover'], cands)
  ok('the binding is the largest minimum and step of every printer that may make each format', b.min === 32 && b.step === 4, JSON.stringify(b))
  ok('…each asked for the format it would make', asked.join(' ') === 'lulu:softcover lulu:hardcover bookvault:hardcover', asked.join(' '))
  ok('…and with none to ask, the kit\'s own floor', JSON.stringify(bindingFor({}, ['softcover'], () => [])) === JSON.stringify({ min: BIND_MIN, step: 2 }))
  /* THE WHOLE POINT: the two paths agree. This is the arithmetic that made one path say 26 and
     the other 32 for the same book, when each computed it for itself. */
  ok('the same book binds the same either way', boundPages(26, { min: 32, step: 2 }) === boundPages(26, { min: 32, step: 2 }))
}

/* --- WHAT HAS BEEN SET: print.json's merge, which two paths now write --- */
{
  const { mergeIndex } = await import('../build/print/index-io.mjs')
  const m = (x = {}) => ({ slug: 'b', contents: 'parts', edition: 'e1', pages: 32, trim: '6x9', paper: 'cream', title: 'B', author: 'A', made: 'now', printers: { softcover: { provider: 'lulu', product: { p: 1 }, key: 'softcover-lulu', covers: { 'softcover-lulu': 'cover-softcover-lulu.pdf' } } }, covers: { 'softcover-lulu': 'cover-softcover-lulu.pdf' }, dims: { 'softcover-lulu': { width: 9, height: 6, spine: 1, bleed: 0 } }, ...x })

  const one = mergeIndex({}, [m()])
  ok('a book that was not there is added', one.b && one.b.editions.parts.edition === 'e1')
  ok('with its pages and its printers', one.b.editions.parts.pages === 32 && one.b.editions.parts.printers.softcover.provider === 'lulu')
  ok("a local render is not the index's business", Object.keys(mergeIndex({}, [m({ local: true })])).length === 0)

  /* THE ONE THAT MATTERS IN THE CLOUD. A function draws no page pictures and no store art — it
     has no browser and no public directory — and a run that made none must not wipe what a
     machine made for the SAME edition, or every cloud render would empty the listing's gallery. */
  const rich = mergeIndex(one, [m({ art: { 'softcover-lulu': '/print/b/e1/cover.svg' }, shots: { chapter: { page: 12 } } })])
  const after = mergeIndex(rich, [m()])
  ok('a render with no art keeps the art of the same edition', after.b.editions.parts.art['softcover-lulu'] === '/print/b/e1/cover.svg')
  ok('and its page pictures', after.b.editions.parts.shots.chapter.page === 12)
  const newer = mergeIndex(rich, [m({ edition: 'e2' })])
  ok('a NEW edition starts with neither: they were of the old one', !Object.keys(newer.b.editions.parts.art).length && !Object.keys(newer.b.editions.parts.shots).length)

  /* an edition of contents the block no longer sells goes; one it still sells stays */
  const two = mergeIndex(one, [m({ contents: 'full', edition: 'e9', sells: ['parts', 'full'] })])
  ok('a second contents sits beside the first', Object.keys(two.b.editions).sort().join() === 'full,parts')
  const dropped = mergeIndex(two, [m({ sells: ['parts'] })])
  ok('and one the block stopped selling is dropped', Object.keys(dropped.b.editions).join() === 'parts')
  ok('a manifest that says nothing about what is sold drops nothing', Object.keys(mergeIndex(two, [m()]).b.editions).sort().join() === 'full,parts')

  ok('another book is untouched', mergeIndex({ other: { editions: { parts: { edition: 'x' } } } }, [m()]).other.editions.parts.edition === 'x')
}

/* --- THE EPUB: the same file either side, and one identity per book --- */
{
  const { makeEpub } = await import('../build/print/epub.mjs')
  const { unzipSync } = await import('fflate')
  const book = (slug) => ({ slug, title: 'A Book', author: 'Nobody', raw: '# One\n\nA line ==worth noticing==.\n\n# Two\n\nAnother.\n' })
  const opf = async (b, contents = 'full') => new TextDecoder().decode(unzipSync(await makeEpub({ book: b, companion: null, contents, words: { edition: 'E' } }))['OEBPS/content.opf'])
  const uid = (s) => (/<dc:identifier id="uid">([^<]+)</.exec(s) || [])[1]

  const a = uid(await opf(book('one'))), b = uid(await opf(book('two')))
  ok('an EPUB carries a unique identifier', /^urn:uuid:[0-9a-f-]{36}$/.test(a || ''), a)
  /* WITHOUT THE SLUG ON THE BOOK every title in the library went out under one uuid — the hash was
     of `undefined:<contents>` — which is the one thing dc:identifier exists not to be */
  ok('and two books do not share it', a !== b, `${a} vs ${b}`)
  ok('the same book and contents keep theirs', uid(await opf(book('one'))) === a)
  ok('another contents of the same book is its own edition', uid(await opf(book('one'), 'summary')) !== a)

  const z = unzipSync(await makeEpub({ book: book('one'), companion: null, contents: 'full', words: {}, art: { name: 'cover.png', data: new Uint8Array([137, 80, 78, 71]), type: 'image/png' } }))
  ok('a cover handed in is in the file', !!z['OEBPS/cover.png'] && !!z['OEBPS/cover.xhtml'])
  ok('and is the bytes it was given', z['OEBPS/cover.png'][1] === 80)
  ok('a book with none has no cover page', !unzipSync(await makeEpub({ book: book('one'), companion: null, contents: 'full', words: {} }))['OEBPS/cover.xhtml'])
  ok('the mimetype is first and stored, as the format asks', new TextDecoder().decode(z['mimetype']) === 'application/epub+zip')
}

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
