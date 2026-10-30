/*
 * The printed editions of a book: markdown → Typst → PDFs (and an EPUB), checked with the
 * printer, kept in the bucket.
 *
 *   node build/print.mjs --book <slug>      one book (its `print` block says what is sold)
 *   node build/print.mjs --all              every book with a print block and a rights line
 *   --local                                 render only: no printer, no bucket (a look at the pages)
 *   --force                                 render even when the bucket already holds these editions
 *   --typ                                   keep the Typst source beside the PDFs
 *   --contents parts|full|summary           one of the book's editions alone
 *   --proofs                                only say which set editions have not been proofed as they are
 *
 * A book's block (src/lib/print-offers.js reads it) says which contents a buyer may
 * choose — parts, full, summary — and each is an EDITION of its own: the text and its
 * companion typeset by build/print/typeset.mjs into build/print/book.typ, the page count
 * read, then for every binding the block sells (linen — a jacket per cloth × foil the
 * buyer may pick; casewrap; softcover) a cover to the printer's dimensions for that page
 * count (build/print/cover.typ), a quote per binding, and an EPUB when one is sold or
 * included (build/print/epub.mjs). An edition is named by the hash of its Typst source,
 * the templates and what it prints, so nothing is set twice: the bucket is asked for
 * `<slug>/<edition>/manifest.json` first. The files go up as
 * `<slug>/<edition>/{interior.pdf, cover-<binding>[-cloth-foil].pdf, book.epub, manifest.json}`;
 * content/store/print.json indexes every book's editions by contents (pages, pods, costs,
 * covers) for the store and the functions. Locally, with no Lulu keys, the printer is mocked
 * (supabase/functions/_shared/suppliers) and the bucket is the local stack's.
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveAsset } from './assets.mjs'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { typesetter, readback } from './print/typeset/compiler.js'
import { typeset, str } from './print/typeset.mjs'
import { coverSource, opening, coverKey, coverName, foilName, coversOf } from './print/cover-source.mjs'
import { printedOf, candidatesOf, chooseProvider, reachableToPrinter } from './print/provider.mjs'
import { editionFor, editionId, pictureId, partsOf } from './print/edition.mjs'
import { mergeIndex, mergeRegistry, registryOf as registryIn, withTitles, titleKey } from './print/index-io.mjs'
import { sizePicture, MAX_HEIGHT } from './print/picture.js'
import { padFor, bindingFor } from './print/plan-pieces.mjs'
import { printWords, SPINE_EDITION } from './print/words.mjs'
import { spineWords, SPINE_MAX, printSpec, PRINTED, costUsd, proofState } from '../src/lib/print-offers.js'
import { parseCompanion } from './companion-io.mjs'
import { printer, providersFor } from './print/suppliers.mjs'
import { createHash } from 'node:crypto'
import { makeEpub } from './print/epub.mjs'
import { choose, pageOf } from './print/pages.mjs'
import { raster } from './print/raster.mjs'
import { bucket } from './tts/storage.mjs'
import { commitAndPush } from './git-push.mjs'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const has = (k) => args.includes(k)
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const WORK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'print')   /* the templates and fonts travel with the kit (the theme's, in phase 2) */
const BUCKET = 'print'
/* the covers as art for the store's book (public/print/<slug>/<edition>/cover-<key>.svg): the
   same Typst compiled to SVG, its glyphs paths, so the page draws the real jacket with no fonts;
   gitignored, written by every render (deploy's included, before the site is built) */
const ART = path.join(ROOT, 'public/print')

/* the edition's own words: `## print / ### book` in the library scope, the theme's under the site's */
const words = () => printWords(ROOT)

export { editionId }
const DRY = () => process.argv.includes('--dry')
const INDEX = path.join(ROOT, 'content/store/print.json')
const readIndex = () => { try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')) } catch (e) { return {} } }

/* ---- the registry: what a printer holds for us, and must never be made twice ----
   A stateful printer (Bookvault) keeps a title per book and contents and format, made once for a
   fee. Every title we make is written in two places the moment it is made — the bucket's
   <slug>/registry.json (the truth on a box whose checkout may lag) and content/store/print.json
   (committed, and pushed when PRINT_COMMIT says) — and read from both before any is made, the
   printer itself asked by our SKU besides. */
const registered = []   /* what this run made or found, for the commit at the end */
export const registryOf = registryIn   /* the shared rule; print-render keeps the same registry */
async function readRegistry(st, slug) {
  let fromBucket = null
  try { const { data } = await st.download(`${slug}/registry.json`); if (data) fromBucket = JSON.parse(await data.text()) } catch (e) { /* none yet */ }
  return { [slug]: mergeRegistry(registryOf(readIndex(), slug), fromBucket) }
}
async function writeRegistry(st, slug, reg) {
  const { error } = await st.upload(`${slug}/registry.json`, Buffer.from(JSON.stringify(reg, null, 2)), { contentType: 'application/json', upsert: true })
  if (error) throw new Error('the registry could not be written to the bucket: ' + error.message)
  fs.writeFileSync(INDEX, JSON.stringify(withTitles(readIndex(), slug, reg.titles), null, 2) + '\n')
}
/* the registry into the repository, when asked (PRINT_COMMIT=1 pushes, =local commits) */
export function commitRegistry() {
  if (!registered.some((r) => r.made)) return false
  return commitAndPush({ paths: ['content/store/print.json'], message: `print: the registry — ${registered.filter((r) => r.made).map((r) => `${r.provider} title ${r.ref} for ${r.slug} (${r.sku})`).join(', ')}\n\nMade by build/print.mjs: a title a printer keeps for us, recorded so it is never made twice.`, mode: process.env.PRINT_COMMIT, prefix: 'PRINT' })
}
/* Typst is behind one seam (print/typeset/compiler.js) so the same book can be set by the native
   compiler on a machine and by the WASM one in an Edge Function, where a cloud-only site has
   nothing else. An edition must be the same edition either way. */
/* WHICH COMPILER. Node on a machine; PRINT_DRIVER=wasm to prove the other one sets the same
   edition, which build/print-parity.test.mjs does. The function names its own. */
const PRINT_DRIVER = process.env.PRINT_DRIVER || 'node'
/* nothing to photograph a page with: an Edge Function, or a machine told not to. The pictures are
   a listing nicety, so their absence degrades the listing and never the book. */
const NO_BROWSER = process.env.PRINT_NO_SHOTS === '1' || PRINT_DRIVER === 'wasm'
const compiler = () => typesetter({ driver: PRINT_DRIVER, workspace: ROOT, fonts: path.join(WORK, 'fonts') })
const compile = (c, file) => c.pdf(file)
/* one browser for a run's pictures, opened when the first is needed */
let rasterizer = null
const pictures = async () => rasterizer || (rasterizer = await raster())
export async function closePictures() { if (rasterizer) { await rasterizer.close(); rasterizer = null } }
const pageCount = (pdf) => { const m = pdf.toString('latin1').match(/\/Count\s+(\d+)/g); return m ? Math.max(...m.map((x) => Number(x.replace(/\D/g, '')))) : 0 }
export { coverKey }   /* the naming is the shared one; print.json and the order function read it */

/* who prints a format: the block's word, or the cheapest of the printers with keys (every
   one quoted for a sample copy; a mocked printer counts only when no real one is there) */
/* the printers a format may go to, and which of them prints it — the shared rule, bound to this
   machine's keys (build/print/provider.mjs says why it is not written twice) */
const bound = { providersFor, printer, costUsd }
const candidates = (spec, format) => candidatesOf(spec, format, bound)
const chooseFor = (spec, format, pages, trim, paper) => chooseProvider(spec, format, pages, trim, paper, bound)

/* one book: every edition its block asks for. Returns the manifests, one per contents */
export async function printBook(slug, { local = false, force = false, keepTyp = false, only = null } = {}) {
  const bookFile = path.join(ROOT, 'content/books', slug + '.md')
  const fm = matter(fs.readFileSync(bookFile, 'utf8'))
  /* the slug travels ON the book: the EPUB's unique identifier is a hash of it, and without
     it every book in the library went out under the same dc:identifier — one uuid for the whole
     shelf, which is exactly what that field exists not to be */
  const book = { ...fm.data, raw: fm.content, slug }
  /* a book whose text is withheld is set as its summaries and never as its text */
  if (book.fullText === false) {
    const asked = (printSpec(book.print) || { contents: [] }).contents.filter((c) => c !== 'summary')
    if (asked.length || (only && only !== 'summary')) throw new Error(`${slug}: fullText is false, so the book has only a summary edition — not ${[...new Set([...asked, ...(only && only !== 'summary' ? [only] : [])])].join(', ')}`)
  }
  const spec = printSpec(book.print, book) || printSpec({})
  /* nothing is sent to a printer without a line saying on what footing the text is printed and
     sold; a local render (a look at the pages) needs none */
  if (!local && !spec.rights) throw new Error(`${slug}: the print block needs rights: — on what footing the text is printed and sold`)
  const trim = arg('--trim') || spec.trim, paper = spec.paper
  const { formats: printed, combos } = printedOf(spec, PRINTED)
  const wantEpub = !!spec.formats.epub || spec.includes.includes('epub')
  const compFile = path.join(ROOT, 'content/companions', slug + '.md')
  let companion = null
  if (fs.existsSync(compFile)) { const c = parseCompanion(fs.readFileSync(compFile, 'utf8')); companion = { ...c.data, chapters: c.chapters } }
  const W0 = await words()
  const bookTpl = fs.readFileSync(path.join(WORK, 'book.typ'), 'utf8'), coverTpl = fs.readFileSync(path.join(WORK, 'cover.typ'), 'utf8')
  /* the paperback wears the e-book's picture, so a new picture (a sharper one, say) is a new edition */
  const pictureId = await pictureHash(bookFile, book.cover)
  const spine = spineWords(book.title, spec.spine, SPINE_EDITION(W0))
  if (!spine.fits) throw new Error(`${slug}: the spine holds ${SPINE_MAX} characters of title and "${spine.edition}" together — "${spine.title}" leaves it ${spine.title.length + spine.edition.length}; give the print block a shorter spine:`)
  const st = local ? null : await bucket(BUCKET)
  const c = await compiler()
  const out = []
  for (const contents of only ? [only] : spec.contents) {
    /* the edition line says what this edition holds */
    const W = { ...W0, 'edition-line': W0['edition-line-' + contents] || W0['edition-line'] || '' }
    /* the note was written for the two-part edition ("this edition prints the book twice"); the
       text alone and the modern edition alone open without it */
    const note = contents === 'parts' ? spec.note : ''
    const { source, chapters, marks } = typeset({ book, companion, trim, contents, note, words: W })
    const editionInputs = { templates: [bookTpl, coverTpl], source, trim, paper, spec, printed, combos, epub: wantEpub, insight: (companion && companion.insight) || '', description: book.description, picture: pictureId }
    const edition = editionFor(editionInputs)
    /* PRINT_PARTS=1 says what the hash is made of, part by part — the one way to answer "why is
       this a different edition in the cloud?" without diffing a typeset source by eye */
    if (process.env.PRINT_PARTS) console.log(slug, contents, JSON.stringify(partsOf(editionInputs)))
    const outDir = path.join(ROOT, '.print', slug, edition)
    fs.mkdirSync(outDir, { recursive: true })

    /* already in the bucket: nothing to set — but the store's art (the covers as SVG, the pages
       as JPEGs under public/print) lives on this machine alone, so a box that has never rendered
       the edition (a deploy) draws it again from the same source, and sends nothing */
    const artDir = path.join(ART, slug, edition)
    let have = null
    if (!local && !force) {
      const { data } = await st.download(`${slug}/${edition}/manifest.json`)
      if (data) {
        const m = JSON.parse(await data.text())
        const drawn = [...Object.values(m.art || {}), ...Object.values(m.shots || {}).map((x) => x && x.art).filter(Boolean)]
        if (drawn.length && drawn.every((p) => fs.existsSync(path.join(ART, path.relative('/print', p))))) { console.log(`${slug} (${contents}): edition ${edition} is in the bucket (${m.pages} pages) — nothing to set`); out.push({ ...m, skipped: true }); continue }
        console.log(`${slug} (${contents}): edition ${edition} is in the bucket (${m.pages} pages) — drawing the store's art`)
        have = m
      }
    }

    /* the interior */
    const t0 = Date.now()
    const mainTyp = path.join(WORK, '_' + slug + '.typ')
    fs.writeFileSync(mainTyp, source)
    let interior, pages
    try {
      interior = compile(c, mainTyp); pages = pageCount(interior)
      /* the printer binds nothing under its minimum (the paperback's is higher): a short book
         gets blank leaves at the end; and a book has an even number of pages, so an odd count
         gets one more blank */
      /* every printer that may make a format binds a minimum, and some count in fours */
      const { min, step } = bindingFor(spec, printed, candidates, { trim, paper })
      const pad = padFor(pages, { min, step })
      if (pad) { fs.writeFileSync(mainTyp, source + `\n#blank-pages(${pad})\n`); interior = compile(c, mainTyp); pages = pageCount(interior) }
    } finally { if (keepTyp) fs.copyFileSync(mainTyp, path.join(outDir, 'interior.typ')); fs.unlinkSync(mainTyp) }
    fs.writeFileSync(path.join(outDir, 'interior.pdf'), interior)

    /* pages to show the book by, as JPEGs of the print file itself (pdf.js in the build's
       browser): the chapter whose first page is fullest, the same chapter in the other edition
       (the full text beside the modern edition, or the other way; in two parts, its second
       opening), and the page with the most highlights — into public/print beside the covers */
    const SHOT_PAD = 0.3   /* inches of margin kept round the type: the page is what is printed on it */
    fs.mkdirSync(artDir, { recursive: true })
    const shots = {}
    /*
     * THE PAGES ON THE LISTING ARE BEST-EFFORT, and this is the one place that decides it.
     *
     * They are photographed from the printer's own PDF by pdf.js in a headless Chromium. There is
     * no Chromium in an Edge Function and no way to put one there, so a cloud-only site gets the
     * book and the EPUB and no page pictures — a listing nicety, not a book. Saying so here, once
     * and deliberately, is the difference between a degradation and a bug: without it the same
     * absence arrives as a warning nobody can act on.
     *
     * A machine that HAS a browser and still cannot photograph a page is a fault and is warned
     * about, because there the pictures were expected.
     */
    try {
      if (NO_BROWSER) throw Object.assign(new Error('no browser here'), { expected: true })
      fs.writeFileSync(mainTyp, source)
      const me = readback(c, mainTyp)
      const pics = await pictures()
      const all = await pics.stats(interior)
      const pick = choose(me.where, me.marks, all)
      const keep = async (pdf, page, name) => { const jpg = (await pics.render(pdf, [page], { pad: SHOT_PAD })).get(page); fs.writeFileSync(path.join(artDir, name), jpg); return `/print/${slug}/${edition}/${name}` }
      if (pick.chapter) {
        shots.chapter = pick.chapter.title
        shots.edition = { contents, page: pick.chapter.page, art: await keep(interior, pick.chapter.page, `page-${pick.chapter.page}.jpg`) }
        if (contents === 'parts') {
          const twice = me.where.filter((w) => w.kind === 'chapter' && w.title === pick.chapter.title).map((w) => w.page).filter((p) => p !== pick.chapter.page)
          if (twice.length) shots.other = { contents: 'full', page: twice[0], art: await keep(interior, twice[0], `page-${twice[0]}.jpg`) }
        } else if (book.fullText !== false) {
          /* the other edition, set for this alone — its print file is not kept; a book whose text is withheld has none */
          const otherContents = contents === 'full' ? 'summary' : 'full'
          const other = typeset({ book, companion, trim, contents: otherContents, note: '', words: W })
          fs.writeFileSync(mainTyp, other.source)
          const it = readback(c, mainTyp)
          const p = pageOf(it.where, pick.chapter.title)
          if (p) shots.other = { contents: otherContents, page: p, art: await keep(compile(c, mainTyp), p, `page-${otherContents}-${p}.jpg`) }
        }
      }
      if (pick.marks) shots.marks = { page: pick.marks.page, count: pick.marks.count, art: await keep(interior, pick.marks.page, `page-${pick.marks.page}.jpg`) }
    } catch (e) {
      /* expected where there is no browser to photograph with; a fault anywhere else */
      if (e && e.expected) console.log(`${slug} (${contents}): the book and the EPUB, without page pictures — there is no browser here to photograph them with`)
      else console.warn(`${slug} (${contents}): no pages photographed — ${e.message}`)
    }
    finally { if (fs.existsSync(mainTyp)) fs.unlinkSync(mainTyp) }

    /* the printers: for every printed format the block sells, who makes it (named, or the
       cheapest quoted), its product there, a cover to that printer's dimensions for this page
       count — the linen's jacket per cloth and foil — its quote, and where a printer keeps a
       title of its own, the title (found by our SKU before it is ever made) */
    const covers = {}, dims = have ? { ...have.dims } : {}, files = {}, art = {}, printersOut = {}, foils = {}
    /* the cover — and, for a format stamped with our own foil artwork, the foil layer alone: the
       same design with only what is stamped, black on white (the printer's foil file, the
       store's mask) */
    /* a paperback's front is the e-book's own cover (the picture beside the book's markdown), the
       mark and the edition line over it; a hardcover's is set in type */
    const picture = await coverPicture(slug, bookFile, book.cover)
    const drawCover = async (key, d, cloth, foil, foilLayer = false, paperback = false) => {
      /* the source is the SHARED one: a cover set here and a cover set in the function are the
         same bytes, or an edition would mean two different books */
      const src = coverSource({ d, trim, cloth, foil, foilOnly: foilLayer, paperback, picture, book, companion, spec, words: W, spine })
      const name = foilLayer ? foilName(key) : coverName(key)
      const coverTyp = path.join(WORK, '_cover_' + slug + '.typ')
      fs.writeFileSync(coverTyp, src)
      let pdf, svg
      try { pdf = compile(c, coverTyp); svg = c.svg(coverTyp) } finally { if (keepTyp) fs.copyFileSync(coverTyp, path.join(outDir, name.replace(/\.pdf$/, '.typ'))); fs.unlinkSync(coverTyp) }
      fs.writeFileSync(path.join(outDir, name), pdf)
      fs.writeFileSync(path.join(artDir, name.replace(/\.pdf$/, '.svg')), svg)
      if (foilLayer) { foils[key] = name; art['foil:' + key] = `/print/${slug}/${edition}/${name.replace(/\.pdf$/, '.svg')}` }
      else { art[key] = `/print/${slug}/${edition}/${name.replace(/\.pdf$/, '.svg')}`; covers[key] = name }
      files[name] = pdf
    }
    for (const f of printed) {
      const kept = have && have.printers && have.printers[f]
      const { provider, quotes } = kept ? { provider: kept.provider, quotes: kept.quotes || {} } : await chooseFor(spec, f, pages, trim, paper)
      const p = printer(provider)
      const options = spec.providers[provider] || {}
      const product = p.product({ chosen: { format: f, trim, paper, cloth: spec.cloth, foil: spec.foil }, options })
      /* a linen at Lulu: a jacket per cloth × foil the buyer may pick; every other cover is one */
      const variants = coversOf({ format: f, provider, product, combos, spec, trim, paper, options, printerOf: (a) => p.product(a) })
      const keys = {}
      for (const v of variants) {
        const key = v.key
        const d = dims[key] || (dims[key] = (kept && kept.dims && kept.dims[key]) || await p.measure({ product: v.product, artefacts: { pages } }))
        await drawCover(key, d, v.cloth, v.foil, false, f === 'softcover')
        if (v.product.artFoil) await drawCover(key, d, v.cloth, v.foil, true)
        keys[key] = v.product
      }
      printersOut[f] = { provider, product, covers: Object.fromEntries(Object.keys(keys).map((k) => [k, covers[k]])), foils: Object.fromEntries(Object.keys(keys).filter((k) => foils[k]).map((k) => [k, foils[k]])), key: Object.keys(keys)[0], products: Object.keys(keys).length > 1 ? Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.pod || v])) : undefined, quotes, options, minPages: product.minPages || 24, note: product.note || '' }
    }
    if (have) { out.push({ ...have, art, shots, skipped: true }); continue }
    /* the EPUB, from the same words */
    let epub = null
    if (wantEpub) {
      /*
       * THE COVER IS HANDED IN, the same bytes the paperback's front is drawn from. It used to be
       * looked for beside the book's markdown — the old way — and no book has been written that
       * way for a long time, so every EPUB the build made went out with NO COVER and nothing said
       * so. It is also what makes the build's EPUB and the function's the same file.
       */
      const art = picture ? { name: 'cover.png', data: fs.readFileSync(path.join(ROOT, picture.replace(/^\//, ''))), type: 'image/png' } : null
      epub = await makeEpub({ book, companion, contents, note, words: W, root: ROOT, art })
      fs.writeFileSync(path.join(outDir, 'book.epub'), epub)
    }
    const jacket = Object.values(printersOut).some((x) => x.product && x.product.jacket)
    const anyMock = Object.values(printersOut).some((x) => printer(x.provider).mock())
    console.log(`${slug} (${contents}): ${chapters} chapters, ${marks} marked lines → ${pages} pages, ${printed.map((f) => `${f} at ${printersOut[f].provider}`).join(' + ')}${wantEpub ? ' + epub' : ''}, ${Object.keys(dims).map((k) => `${k} ${(dims[k].width / 72).toFixed(2)}×${(dims[k].height / 72).toFixed(2)}in (spine ${(dims[k].spine / 72).toFixed(2)}in)`).join(', ')}, ${Date.now() - t0} ms · edition ${edition}${anyMock ? ' · printer mocked' : ''}`)
    const manifest = { slug, contents, edition, pages, trim, paper, cloth: spec.cloth, foil: spec.foil, printers: printersOut, covers, dims, art, shots, epub: wantEpub, foilStamp: jacket ? { title: spine.title, author: spine.edition } : null, title: book.title, author: book.author || '', made: new Date().toISOString(), mock: anyMock, sells: spec.contents }
    if (local) { out.push({ ...manifest, local: true }); continue }
    if (DRY()) {
      for (const [f, x] of Object.entries(printersOut)) console.log(`  ${f}: ${x.provider}${printer(x.provider).stateful ? ` — would ${(registryOf(readIndex(), slug).titles?.[x.provider]?.[titleKey(contents, f)]) ? 'update the title it keeps' : 'CREATE A TITLE there (a setup fee)'}` : ''}`)
      out.push({ ...manifest, local: true }); continue
    }

    /* to the bucket, then checked by the printers from there */
    const put = async (name, body, type) => { const { error } = await st.upload(`${slug}/${edition}/${name}`, body, { contentType: type, upsert: true }); if (error) throw new Error('upload ' + name + ': ' + error.message) }
    await put('interior.pdf', interior, 'application/pdf')
    for (const [name, pdf] of Object.entries(files)) await put(name, pdf, 'application/pdf')
    if (epub) await put('book.epub', epub, 'application/epub+zip')
    const signed = async (name) => { const { data, error } = await st.createSignedUrl(`${slug}/${edition}/${name}`, 7 * 86400); if (error) throw new Error('sign ' + name + ': ' + error.message); return data.signedUrl }
    /* a printer fetches the files itself, so a local stack's bucket (127.0.0.1) is out of its
       reach: the files are kept and costed, and the check waits for a bucket it can see (deploy) */
    const url = await signed('interior.pdf')
    const reachable = reachableToPrinter(url)
    let validated = true, seen = pages
    for (const [f, x] of Object.entries(printersOut)) {
      const p = printer(x.provider)
      if (reachable || p.mock()) {
        const v = await p.validate({ product: x.product, artefacts: { pages, files: { interior: url, cover: await signed(x.covers[x.key]) } } })
        if (!v.ok) { console.error(`${slug}: ${p.name} refused the ${f} —`, v.errors); throw new Error(`${f} refused`) }
        if (v.pages) seen = v.pages
        x.validated = !p.mock() && !v.deferred
      } else x.validated = false
      validated = validated && !!x.validated
      /* the quote for one copy, in the printer's currency */
      const q = await p.quote({ product: x.product, artefacts: { pages: seen }, country: 'US' }).catch((e) => ({ error: String(e.message || e) }))
      if (typeof q.print === 'number') { x.cost = q.print; x.currency = q.currency || 'USD'; x.shipping = q.shipping ?? null; x.days = q.days ?? null; x.from = q.from || null } else x.error = q.error
      /* a printer that keeps a title: found by our SKU or made — recorded before anything else happens */
      if (p.stateful) {
        const sku = `dl-${slug}-${contents}-${f}`
        const reg = registryOf(await readRegistry(st, slug), slug)
        const existing = reg.titles?.[x.provider]?.[titleKey(contents, f)] || null
        const r = await p.register({ product: x.product, artefacts: { pages: seen, files: { interior: url, cover: await signed(x.covers[x.key]), jacket: x.product.jacket ? await signed(x.covers[x.key]) : null, foil: x.foils && x.foils[x.key] ? await signed(x.foils[x.key]) : null } }, title: book.title, sku, existing })
        if (r) {
          x.ref = r.ref; x.registered = !!r.paid; x.validated = !!r.validated
          if (r.mock) continue   /* a mocked title is nobody's: never in the registry */
          reg.titles = reg.titles || {}; reg.titles[x.provider] = reg.titles[x.provider] || {}
          reg.titles[x.provider][titleKey(contents, f)] = { ref: r.ref, sku, isbn: r.isbn || null, edition, paid: !!r.paid, validated: !!r.validated, made: existing?.made || new Date().toISOString() }
          await writeRegistry(st, slug, reg)
          registered.push({ slug, provider: x.provider, ref: r.ref, sku, made: !existing })
        }
      }
    }
    Object.assign(manifest, { pages: seen, validated })
    await put('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json')
    console.log(`${slug} (${contents}): ${!validated && !anyMock ? 'NOT validated by every printer yet' : 'validated' + (anyMock ? ' (mock)' : '')}, in the bucket as ${slug}/${edition} · ${Object.entries(printersOut).map(([f, x]) => `${f} ${x.currency === 'GBP' ? '£' : '$'}${x.cost}`).join(', ')}`)
    out.push(manifest)
  }
  return out
}

/* the e-book's cover as a PNG Typst can read, for a paperback's front: the file the book's cover address
   names (a PNG, a JPEG or a WebP under any name), decoded and written once per book as .print/<slug>/picture.png */
/* the picture's bytes, hashed, for the edition id; '' when there is none */
async function pictureHash(bookFile, cover) {
  if (!cover) return ''
  const src = await resolveAsset(cover, { root: ROOT, fromFile: bookFile })
  return src ? pictureId(fs.readFileSync(src)) : ''
}

async function coverPicture(slug, bookFile, cover) {
  if (!cover) return ''
  const src = await resolveAsset(cover, { root: ROOT, fromFile: bookFile })   /* by its address (build/assets.mjs), never looked for beside the markdown */
  if (!src) return ''
  const out = path.join(ROOT, '.print', slug, 'picture.png')
  try {
    if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(src).mtimeMs) {
      fs.mkdirSync(path.dirname(out), { recursive: true })
      /* the picture is decoded as it is; cover.typ crops it to the page's shape (fit: "cover"), as the
         site's shelves do — never extended, never letterboxed. print/picture.js is sharp here and
         Storage's own image transform in a function, which has no sharp and no way to get one. */
      fs.writeFileSync(out, await sizePicture(src, { height: MAX_HEIGHT }))
    }
    return '/' + path.relative(ROOT, out)   /* a root path: Typst reads it from the workspace */
  } catch (e) { console.warn(`${slug}: the cover picture could not be read for the paperback — ${e.message}`); return '' }
}

/* the editions set for every book, written where the site can read it — by book, by contents */
export async function writePrintIndex(manifests) {
  const file = path.join(ROOT, 'content/store/print.json')
  /* the merge is the shared one (print/index-io.mjs): print-render writes the same index in the
     cloud, and two ways of merging it is two indexes for one library */
  const idx = mergeIndex(readIndex(), manifests)
  fs.writeFileSync(file, JSON.stringify(idx, null, 2) + '\n')
  return idx
}

/* the proofs: `proofed.<contents>: <edition>` on the book's block says which edition a printed
   copy was read and passed at (marked in the admin's Print editions). A set edition that is not
   the proofed one — never proofed, or set again since (a changed word is a new edition) — is
   still sold; this only says which those are, after every set and on deploy, so a copy can be
   ordered and read. */
export function proofReport(idx = readIndex()) {
  const out = []
  for (const slug of Object.keys(idx).sort()) {
    let spec = null
    try { const d = matter(fs.readFileSync(path.join(ROOT, 'content/books', slug + '.md'), 'utf8')).data; spec = printSpec(d.print, d) } catch (e) { continue }
    if (!spec) continue
    for (const c of spec.contents) { const st = proofState(spec, idx[slug], c); if (st === 'never' || st === 'stale') out.push({ slug, contents: c, edition: idx[slug].editions[c].edition, state: st, was: spec.proofed[c] || null }) }
  }
  return out
}
export function printProofReport(list = proofReport()) {
  if (!list.length) { console.log('✔ proofs: every set edition has been proofed as it is'); return }
  console.log(`• proofs: ${list.length} set edition${list.length === 1 ? '' : 's'} not yet proofed as set — order a copy and mark it under admin → Print editions:`)
  for (const p of list) console.log(`  ${p.slug} (${p.contents}) ${p.edition} — ${p.state === 'stale' ? 'changed since the proof of ' + p.was : 'never proofed'}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (has('--proofs')) { const l = proofReport(); printProofReport(l); process.exit(0) }
  const slugs = has('--all')
    ? fs.readdirSync(path.join(ROOT, 'content/books')).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).filter((s) => { const p = matter(fs.readFileSync(path.join(ROOT, 'content/books', s + '.md'), 'utf8')).data.print; return p && String(p.rights || '').trim() })
    : arg('--book') ? [arg('--book')] : []
  if (!slugs.length) { console.error('usage: node build/print.mjs --book <slug> | --all  [--local] [--force] [--dry] [--typ] [--trim 6x9] [--contents parts|full|summary]'); process.exit(1) }
  const out = []
  for (const s of slugs) { try { out.push(...await printBook(s, { local: has('--local'), force: has('--force'), keepTyp: has('--typ'), only: arg('--contents') })) } catch (e) { console.error(`${s}: ${e.message}`); process.exitCode = 1 } }
  await closePictures()
  if (!has('--local') && !has('--dry')) { await writePrintIndex(out); commitRegistry(); printProofReport() }
}
