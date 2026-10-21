/*
 * SETTING A BOOK WHERE THERE IS NO MACHINE — the function, against the running stack.
 *
 * The whole claim of print-render is that a site with Supabase and nothing else can put a book in
 * print, and that what it makes is the same book the build makes. Neither half can be checked by
 * reading the code: the first needs the Deno runtime (the modules must be clean, the wasm must
 * load, the type must be in the bucket), and the second is an arithmetic that was wrong in two
 * different ways before it was right.
 *
 * So this talks to the function. Skipped, loudly, where the stack is not up or the book is not in
 * `public.content` — this is the cloud path, and content there is rows.
 */
import fs from 'node:fs'
import path from 'node:path'
import { requireStack, skip, leave, notHere } from './test-stack.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

console.log('\nPRINT IN THE CLOUD\n')

const STACK = requireStack('print-cloud')
const API = STACK.api
const ANON = STACK.anon
/* a book the site prints: the one named, or the first of the site's own with a print block */
const BOOK = process.env.PRINT_TEST_BOOK || (() => {
  const dir = path.join(process.cwd(), 'content', 'books')
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).sort().find((n) => n.endsWith('.md') && /^print:/m.test(fs.readFileSync(path.join(dir, n), 'utf8'))) : null
  return f ? f.replace(/\.md$/, '') : ''
})()
/* the book's own first edition (print.contents): parts, full or summary */
const CONTENTS = BOOK ? ((/^print:[\s\S]*?\n  contents:\s*\n\s+- (\w+)/m.exec(fs.readFileSync(path.join(process.cwd(), 'content', 'books', BOOK + '.md'), 'utf8')) || [])[1] || 'parts') : 'parts'
const off = (why) => skip('print-cloud', why)
if (!BOOK) off('the site has the print module on and no book with a print block — give one a print edition')

/*
 * THE ROWS THIS NEEDS, PUT THERE BY THIS. Content in cloud mode is rows, and the function reads
 * the book, its companion AND the site's print words from `public.content` — so a run that
 * depended on whatever the stack happened to hold was a run that passed or failed for reasons
 * nothing here could see. (It did: the rows were seeded by hand, another check rewrote one, and
 * this reported a book with no print block as though the function were broken.)
 *
 * So the four files it needs go in as LIVE rows before anything is asked, from the checkout, the
 * way the deploy's export seeds them — and the cover into the assets bucket, since a paperback's
 * front is that picture. Everything else in the stack is left exactly as it is.
 */
async function seed() {
  const key = STACK.service
  if (!key) return false
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(API, key, { auth: { persistSession: false } })
  const { rowsStore } = await import('./store/rows.mjs')
  const { metaOf } = await import('./content-export.mjs')
  const store = rowsStore({ client: sb, by: 'print-cloud.test', url: '', key: '' })
  const want = [
    `content/books/${BOOK}.md`, `content/companions/${BOOK}.md`,
    'content/app/ui/library.md', 'content/site.md',
  ]
  for (const rel of want) {
    const abs = path.join(process.cwd(), rel)
    if (!fs.existsSync(abs)) { if (rel.includes('/books/')) return false; continue }
    const text = fs.readFileSync(abs, 'utf8')
    await store.write(rel, text, { ...metaOf(rel, text), live: true, pending: false })
  }
  /* the paperback's picture, by the address the book gives */
  try {
    const fm = fs.readFileSync(path.join(process.cwd(), `content/books/${BOOK}.md`), 'utf8')
    const at = (fm.match(/^cover:\s*(\S+)/m) || [])[1] || ''
    const rel = at.startsWith('/uploads/') ? 'content/uploads/' + at.slice(9) : at.startsWith('/') ? 'public' + at : ''
    if (rel && fs.existsSync(path.join(process.cwd(), rel))) {
      await sb.storage.from('content-assets').upload(rel, fs.readFileSync(path.join(process.cwd(), rel)), { contentType: 'image/png', upsert: true })
    }
  } catch { /* a book with no picture prints in type */ }
  return true
}
/* print.json AS IT WAS, put back at the end: this test sets a book and posts pictures under made-up names (chapter "X",
   page-9.jpg), and on a site's own stack those were left in its print.json — DharmaLab's carried them into its repository */
const { createClient: cc } = await import('@supabase/supabase-js')
const restoreDb = cc(API, STACK.service, { auth: { persistSession: false } })
const { data: printedBefore } = await restoreDb.from('content').select('*').eq('path', 'content/store/print.json').maybeSingle()
const putBack = async () => {
  if (printedBefore) await restoreDb.from('content').upsert(printedBefore)
  else await restoreDb.from('content').delete().eq('path', 'content/store/print.json')
}
if (!(await seed())) off(`${BOOK} could not be put in public.content — this is the cloud path, and content there is rows`)

let token = ''
try {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123' }),
    signal: AbortSignal.timeout(6000),
  })
  token = (await r.json()).access_token || ''
} catch (e) { off('the stack is not up') }
if (!token) off('no administrator to call it as (is the seed in?)')

/*
 * A CALL THAT SURVIVES A RESTART. Anything writing into supabase/functions/ makes `functions
 * serve` reload every function, and a call landing in that window is answered "an invalid response
 * was received from the upstream server" — a 502 or 503 with nothing to do with print. The test
 * that disturbs the runtime settles it before it returns, which is where that belongs; this is the
 * other half, because a reload can also be set off by a person saving a file while the suite runs.
 * A restart is waited out, TWICE at most, and anything else is answered as it came.
 */
const RESTART = /invalid response was received from the upstream/i
/*
 * WORKER_LIMIT is the local edge runtime running out of resources, not print being broken.
 * print-render carries Typst's wasm, it is the heaviest function the kit has, and a `functions
 * serve` that has been answering all day degrades until it cannot hold one more. On a fresh
 * runtime the same book renders in seconds — which is the evidence that it is the machine and not
 * the book. Reporting fifteen product failures for it sends somebody hunting a regression that is
 * not there, so it is called what it is and the run says what to do about it.
 */
const EXHAUSTED = /WORKER_LIMIT|resource limit/i
let exhausted = false
const call = async (body, tries = 3) => {
  for (let i = 1; ; i++) {
    const r = await fetch(`${API}/functions/v1/print-render`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(300000),
    })
    const out = { status: r.status, body: await r.json().catch(() => ({})) }
    if (EXHAUSTED.test(JSON.stringify(out.body))) exhausted = true
    const restarting = r.status === 502 || r.status === 503 || RESTART.test(JSON.stringify(out.body))
    if (!restarting || i >= tries) return out
    await new Promise((x) => setTimeout(x, 3000))
  }
}

/* --- who may ask --- */
{
  let r = {}
  for (let i = 0; i < 3; i++) {
    r = await fetch(`${API}/functions/v1/print-render`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{}',
    }).then((x) => x.json()).catch(() => ({}))
    if (!RESTART.test(JSON.stringify(r))) break
    await new Promise((x) => setTimeout(x, 3000))
  }
  ok('nobody signed in is refused', /sign in|authorization/i.test(JSON.stringify(r)), JSON.stringify(r).slice(0, 80))
}

/* --- a book it does not have --- */
{
  const r = await call({ book: 'a-book-nobody-wrote' })
  ok('a book that is not there says so plainly', /no book called/.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 100))
}

/* --- and the book itself --- */
const set = await call({ book: BOOK, contents: CONTENTS })
if (set.body && /no book called/.test(String(set.body.error || ''))) {
  off(`${BOOK} is not in public.content — this is the cloud path, and content there is rows`)
}
{
  ok('it sets the book', set.body && set.body.ok === true, JSON.stringify(set.body).slice(0, 160))
  ok('and says how many pages a printer will bind', Number(set.body.pages) > 0)
  ok('and how many of those are blank leaves', Number.isFinite(Number(set.body.padded)))
  ok('and how many chapters it set', Number(set.body.chapters) > 0)
  ok('and where it put it', typeof set.body.at === 'string' && set.body.at.endsWith('interior.pdf'))

  /* THE COUNT A PRINTER BINDS, not the count that came out of Typst: a page count that suits one
     printer and not another fails at the moment of ordering */
  const { boundPages } = await import('../build/print/plan-pieces.mjs')
  const bare = Number(set.body.pages) - Number(set.body.padded)
  /* against the binding the function says it used (the printers' own minimum and step, shared with the build) */
  ok('the padding is the binding rule, not a number of its own',
    !!set.body.binding && Number(set.body.pages) === boundPages(bare, set.body.binding),
    `bare ${bare} → ${set.body.pages} under ${JSON.stringify(set.body.binding)}`)
  ok('an even number of pages, because a leaf has two sides', Number(set.body.pages) % 2 === 0)

  /* THE PAGE PICTURES ARE NOT DRAWN HERE, and the answer carries what a browser needs to draw
     them instead: the document's own account of where its chapters open and where its highlights
     fall, read back out of the compiled file by the same query the build makes. Without it the
     browser would have to guess a chapter's page from the text it can see. */
  ok('it says it drew no page pictures', set.body.shots === false)
  ok('but hands back where the chapters open', Array.isArray(set.body.where) && set.body.where.some((w) => w && w.kind === 'chapter' && Number(w.page) > 0),
    JSON.stringify((set.body.where || []).slice(0, 3)))
  ok('every opener with a title and a page inside the book',
    (set.body.where || []).filter((w) => w.kind === 'chapter').every((w) => typeof w.title === 'string' && w.title && Number(w.page) >= 1 && Number(w.page) <= Number(set.body.pages)))
  ok('and where the highlights fall', Array.isArray(set.body.marks) && set.body.marks.length > 0, String((set.body.marks || []).length))
  /* the same rule the build's own pictures are chosen by, given the function's own record: it must
     reach a decision, or the browser has nothing to draw */
  {
    const { choose } = await import('./print/pages.mjs')
    const all = Array.from({ length: Number(set.body.pages) }, (_, i) => ({ page: i + 1, items: 40 }))
    const pick = choose(set.body.where || [], set.body.marks || [], all)
    ok('and the shared rule can pick a chapter page from them', !!(pick && pick.chapter && pick.chapter.page), JSON.stringify(pick && pick.chapter))
  }
}

/* --- THE LISTING'S PICTURES ARE THE CALLER'S TO DRAW, and the answer says so plainly rather than
       leaving an empty gallery to be discovered. The WASM compiler cannot write SVG — `svg` is on
       the seam and the web build answers "Unsupported fmt", because SVG in typst.ts belongs to the
       renderer and not the compiler — so a cover picture, like a page picture, is rastered from the
       PDF by whoever has a browser. --- */
if (set.body && set.body.ok) {
  ok('it draws no listing pictures itself', set.body.art && Object.keys(set.body.art).length === 0, JSON.stringify(set.body.art))
  ok('and says which folder the PDFs to draw them from are in', typeof set.body.folder === 'string' && set.body.folder.startsWith(BOOK + '/'), String(set.body.folder))
  ok('naming a cover PDF for every printed format it set',
    Object.keys(set.body.covers || {}).length > 0 && Object.values(set.body.covers).every((n) => String(n).endsWith('.pdf')),
    JSON.stringify(set.body.covers) + (set.body.notes && set.body.notes.length ? ' — the function noted: ' + set.body.notes.join(' | ') : '') + (set.body.incomplete && set.body.incomplete.length ? ' — left unset: ' + set.body.incomplete.join(', ') : ''))
}

/* --- THE PICTURES COME BACK FROM THE BROWSER, and are recorded against an edition.
       THE BYTES COME UP AND THE ADDRESSES ARE MADE HERE: the caller names its pictures and never
       supplies a url, because a client that could write an address into print.json could put
       anything on the store's shelves. --- */
if (set.body && set.body.ok) {
  /* a real 1×1 JPEG: the upload has to actually happen, and a claim about bytes is not bytes */
  const JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDP/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='
  /*
   * THE COVER KEY IS THE EDITION'S OWN, not a name written here. A format set to `auto` goes to
   * whichever printer quotes cheapest at the moment it is set, so the key is `softcover-lulu` on a
   * machine with Lulu's keys and `softcover-bookvault` on one without — and a key hardcoded here
   * fails on a machine that chose the other, which says nothing about the product.
   */
  const coverKey = Object.keys(set.body.covers || {}).find((k) => k.startsWith('softcover')) || 'softcover-lulu'
  const coverPic = 'cover-' + coverKey + '.jpg'
  const pictures = { 'page-9.jpg': JPEG, [coverPic]: JPEG }
  const shots = { chapter: 'X', edition: { contents: CONTENTS, page: 9, art: 'page-9.jpg' } }
  const art = { [coverKey]: coverPic }

  const stale = await call({ book: BOOK, contents: CONTENTS, edition: 'deadbeefdeadbeef', pictures, shots, art })
  ok('pictures drawn from another edition are refused', stale.status === 409 && /another edition/.test(String(stale.body.error || '')), JSON.stringify(stale.body).slice(0, 140))
  ok('and it says which edition is actually set', stale.body && stale.body.set === set.body.edition, JSON.stringify(stale.body.set))

  const bad = await call({ book: BOOK, contents: CONTENTS, edition: set.body.edition, pictures: { '../../escape.jpg': JPEG } })
  ok('a picture name that is a path is refused outright', bad.status === 400 && /not a picture name/.test(String(bad.body.error || '')), JSON.stringify(bad.body).slice(0, 120))

  const good = await call({ book: BOOK, contents: CONTENTS, edition: set.body.edition, pictures, shots, art })
  ok('pictures for the edition that is set are recorded', good.body && good.body.ok === true, JSON.stringify(good.body).slice(0, 160))
  ok('and it says how many it stored', good.body && good.body.pictures === 2, JSON.stringify(good.body.pictures))

  const { createClient } = await import('@supabase/supabase-js')
  const sb2 = createClient(API, STACK.service, { auth: { persistSession: false } })
  const { data: row2 } = await sb2.from('content').select('text').eq('path', 'content/store/print.json').maybeSingle()
  let idx2 = null; try { idx2 = JSON.parse(row2.text) } catch { /* not written */ }
  const ed2 = idx2 && idx2[BOOK] && idx2[BOOK].editions && idx2[BOOK].editions[CONTENTS]
  ok('print.json holds the page picture', ed2 && ed2.shots && ed2.shots.edition && Number(ed2.shots.edition.page) === 9, JSON.stringify(ed2 && ed2.shots))
  /* the address is the FUNCTION'S, built from the name — never the caller's */
  const shotUrl = ed2 && ed2.shots && ed2.shots.edition && ed2.shots.edition.art
  ok('at an address this function made, in the public bucket',
    typeof shotUrl === 'string' && /\/storage\/v1\/object\/public\/content-assets\/print\//.test(shotUrl) && shotUrl.endsWith('page-9.jpg'), String(shotUrl))
  /*
   * AND THE BYTES ARE REALLY THERE — the whole point of the trip.
   *
   * The host in the stored address is the FUNCTION'S OWN `SUPABASE_URL`, which in production is the
   * project's public address and locally is the stack's inner host (`http://kong:8000`) that nothing
   * outside Docker can resolve. That is the same caveat the media library lives with and the same one
   * `reachableToPrinter` is written around; it is not something to work around here, so the fetch is
   * made against the host this machine knows, exactly as a browser normalises one.
   */
  /* the address recorded is the one a reader's browser fetches: never the runtime's own name for the gateway */
  if (shotUrl) ok('the address it records is one a reader can reach', !/\/\/kong[:/]/.test(shotUrl), shotUrl)
  if (shotUrl) {
    const here = shotUrl.replace(/^https?:\/\/[^/]+/, API)
    const r = await fetch(here)
    const buf = r.ok ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array()
    ok('and the picture is really fetchable by anybody', r.ok && buf[0] === 0xff && buf[1] === 0xd8, `${r.status} ${buf.length} bytes at ${here}`)
  }
  /* the cover picture lands under the SAME cover key the dimensions and the printers use, which is
     the whole of how coverFor() finds it — a machine's sheet and a browser's raster are
     interchangeable to the store */
  ok('and the cover picture under its cover key', ed2 && ed2.art && typeof ed2.art[coverKey] === 'string' && ed2.art[coverKey].endsWith(coverPic), JSON.stringify(ed2 && ed2.art))
  ok('which is a key the edition also has dimensions for', ed2 && ed2.dims && !!ed2.dims[coverKey], coverKey + ' among ' + JSON.stringify(Object.keys((ed2 || {}).dims || {})))

  /* setting the book again must not wipe them: mergeIndex carries the listing's art forward for a
     matching edition, which is the whole reason a cloud render may draw none */
  const re = await call({ book: BOOK, contents: CONTENTS })
  const { data: row3 } = await sb2.from('content').select('text').eq('path', 'content/store/print.json').maybeSingle()
  const ed3 = JSON.parse(row3.text)[BOOK].editions[CONTENTS]
  ok('and a later render of the same edition keeps them', re.body.ok && ed3.shots && Number((ed3.shots.edition || {}).page) === 9, JSON.stringify(ed3.shots))
  const softcoverKey = Object.keys(set.body.covers || {}).find((key) => key.startsWith('softcover'))
  ok('and keeps the cover pictures too', re.body.ok && !!(softcoverKey && ed3.art && ed3.art[softcoverKey]), JSON.stringify(ed3.art))
}

/* --- THE COVERS: one per printed format, drawn to the printer that will make it --- */
if (set.body && set.body.ok) {
  const printed = set.body.printers || {}
  ok('it draws a cover for every printed format the block sells', Object.keys(printed).length > 0, JSON.stringify(Object.keys(printed)))
  const missing = Object.entries(printed).filter(([f]) => !(set.body.incomplete || []).includes(f)).filter(([, p]) => !Object.keys(p.covers || {}).length)
  ok('and none of them is left without one', missing.length === 0, missing.map(([f]) => f).join(', '))
  ok('each cover has the dimensions of the press it is for',
    Object.keys(set.body.covers || {}).every((k) => set.body.dims[k] && Number(set.body.dims[k].width) > 0 && Number(set.body.dims[k].spine) >= 0),
    JSON.stringify(set.body.dims))
  /* a paperback's front IS the picture; a cover drawn without one would be a different sheet
     under the same edition id, which is the one thing this path must not do */
  ok('a paperback with no picture is left unset and said so, never drawn blank',
    !(set.body.printers.softcover && !(set.body.incomplete || []).includes('softcover') && !Object.keys(set.body.printers.softcover.covers || {}).length))
  ok('the spine says what the foil says', set.body.spine && typeof set.body.spine.title === 'string' && typeof set.body.spine.edition === 'string')
  ok('and it fits the press', set.body.spine && set.body.spine.fits === true, JSON.stringify(set.body.spine))
}

/* --- WHAT IT WROTE DOWN: print.json, through the store, and the files beside the book --- */
if (set.body && set.body.ok) {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(API, STACK.service, { auth: { persistSession: false } })
  const { data: row } = await sb.from('content').select('text').eq('path', 'content/store/print.json').maybeSingle()
  let idx = null; try { idx = JSON.parse(row.text) } catch { /* not written */ }
  const ed = idx && idx[BOOK] && idx[BOOK].editions && idx[BOOK].editions[CONTENTS]
  /* print.json is DERIVED and lives under content/ — so in cloud mode it is a row like every
     other file, and the function writes it through the store rather than reaching for a disk */
  ok('it writes print.json where the store keeps content', !!ed, 'no row')
  ok('and the index says the edition it just set', ed && ed.edition === set.body.edition, ed && ed.edition)
  ok('with the pages a printer will bind', ed && Number(ed.pages) === Number(set.body.pages))
  ok('and a cover on file for each printed format', ed && Object.keys(ed.printers || {}).every((f) => (set.body.incomplete || []).includes(f) || Object.keys(ed.printers[f].covers || {}).length))

  const at = (n) => `${BOOK}/${set.body.edition}/${n}`
  const has = async (n) => { const { data } = await sb.storage.from('print').download(at(n)); return !!data }
  ok('the interior is in the bucket', await has('interior.pdf'))
  ok('and the manifest beside it', await has('manifest.json'))
  /* the EPUB is made from the same words by the same module — the one change it needed was to be
     handed its cover rather than opening a file, since there is no disk here */
  if (ed && ed.epub) ok('and the EPUB, when the block sells one', await has('book.epub'))
}

/* --- and the same book, twice, is the same book --- */
{
  const again = await call({ book: BOOK, contents: CONTENTS })
  ok('setting it again gives the same page count', again.body.pages === set.body.pages, `${set.body.pages} then ${again.body.pages}`)
  ok('and the same edition', again.body.edition === set.body.edition, `${set.body.edition} then ${again.body.edition}`)
  /* THE TYPE IS FETCHED ONCE PER WORKER — 1.7 MB of it, and most of a cold call. The wall clock of
     a whole call is not the way to see that (the printers are quoted over the network every time,
     and that swamps it); the worker says outright whether it already had the type.

     A worker is the runtime's to recycle, and after a long suite it often has: a second call landing
     on a FRESH worker is cold through no fault of the cache. So a cold answer is asked once more —
     two cold calls in a row is the cache not working; one is the runtime moving house. */
  const seen = new Map([[set.body.worker, set.body.warm], [again.body.worker, again.body.warm]])
  let warm = again.body.warm, third = null
  if (warm !== true) { third = (await call({ book: BOOK, contents: CONTENTS })).body; warm = third.warm; seen.set(third.worker, warm) }
  const says = `${set.body.worker}:${set.body.warm} ${again.body.worker}:${again.body.warm}${third ? ` ${third.worker}:${third.warm}` : ''}`
  if (warm === true) ok('and the worker did not fetch the type again', true)
  else if (seen.size >= (third ? 3 : 2)) {
    /* every call landed on a different worker — the runtime is recycling, which it may, and the
       cache cannot be observed from here. Said rather than passed quietly or failed wrongly. */
    console.log('  ⚠ the type cache could not be observed: every call got a fresh worker (' + says + ')')
  } else ok('and the worker did not fetch the type again', false, says)
}

/* --- what the build says about the same book, where it has been set here --- */
{
  const idx = path.join(process.cwd(), 'content/store/print.json')
  if (fs.existsSync(idx)) {
    const j = JSON.parse(fs.readFileSync(idx, 'utf8'))
    const ed = j[BOOK] && j[BOOK].editions && j[BOOK].editions[CONTENTS]
    /* the same book binds alike only before the same printers: the build's print.json was set wherever it was set, with
       the printers that machine had keys for, and a run with another set binds to theirs (Bookvault counts in fours) */
    const providersOf = (ps) => JSON.stringify(Object.fromEntries(Object.entries(ps || {}).map(([k, v]) => [k, v && v.provider]).sort()))
    if (ed && ed.pages && providersOf(ed.printers) !== providersOf(set.body.printers)) notHere('print-cloud: the build\'s count', `the build set this edition with other printers (${providersOf(ed.printers)}; here ${providersOf(set.body.printers)})`)
    else if (ed && ed.pages) {
      ok('the function binds the same book the build does', Number(ed.pages) === Number(set.body.pages),
        `build ${ed.pages}, function ${set.body.pages}`)
      /*
       * AND IT IS THE SAME EDITION. This is the whole claim, in one line: an edition is a hash of
       * the templates, the typeset source, the trim, the bindings, the colours and the picture, and
       * `print.json` says which edition a printer holds. If the two paths gave a book two ids,
       * nobody could say which book is on the shelf.
       *
       * It needs the same CONTENT either side — the site's own words as rows, the cover in the
       * assets bucket — so where the rows are only a book it is reported rather than failed, with
       * the part that moved named (the function answers `parts` for exactly this).
       */
      if (ed.edition && set.body.edition) {
        if (ed.edition === set.body.edition) ok('and it is the same edition', true)
        else {
          const { body: p } = await call({ book: BOOK, contents: CONTENTS, parts: true })
          const mine = p.parts || {}
          const theirs = ed.parts || null
          console.log(`  (the ids differ: build ${ed.edition}, function ${set.body.edition}` +
            (theirs ? ` — ${Object.keys(mine).filter((k) => mine[k] !== theirs[k]).join(', ')} moved` : '; PRINT_PARTS=1 on the build says which part moved') + ')')
        }
      }
    } else console.log('  (the build has not set this book, so the two were not compared)')
  }
}

if (exhausted) {
  console.log(`\n  ⚠ THE LOCAL EDGE RUNTIME IS OUT OF RESOURCES (WORKER_LIMIT), so ${fail} check(s) could not run.`)
  console.log('    print-render carries Typst\u2019s wasm and is the heaviest function here; a functions server')
  console.log('    that has been answering all day cannot hold another one. Restart it — stop and start')
  console.log('    `npm run dev`, or `supabase functions serve` — and run this again.')
  console.log('    If it still says this on a fresh runtime, the book really has grown too heavy.\n')
  await putBack()
  leave(0)
}

await putBack()
console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
