/*
 * SETTING A BOOK IN PRINT, WITH NO MACHINE ANYWHERE.
 *
 * On a site with a build box `npm run print` does this. A site whose whole backend is Supabase has
 * no build box and, until this, could not put a book in print at all — the one thing the platform
 * did that had no cloud answer.
 *
 * WHAT MAKES IT POSSIBLE is that the typesetter was already pure: build/print/typeset.mjs takes a
 * book and a companion and returns Typst source, with no filesystem in it. So what had to move was
 * not the typesetting but the three things around it — the compiler (WASM, behind the seam), the
 * templates (compiled in beside this function) and the type (fetched from the bucket once per
 * worker).
 *
 * WHAT IT DOES NOT DO, and says so rather than pretending:
 *
 *   THE PAGE PICTURES for the listing need pdf.js in a headless Chromium. There is none here. A
 *   cloud-only site gets the book and no page pictures — a listing nicety, and the edition id is
 *   the same with or without them.
 *
 * A BOOK IS COMPILED IN RUNS where one call cannot hold it. The measurements are in
 * openspec/changes/print-on-demand/design.md: warm, the largest book is 111 ms against a 2000 ms
 * budget; cold it is 3.8 s and 472 MB against 256. So a run is at most PAGES_PER_RUN pages, a run
 * is one call, and the runs are a loop — there is no job row and no lease, because a call that
 * takes half a second does not need to survive anything.
 *
 * POST { book, contents } — an administrator's JWT. Answers what it set, or why it could not.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cors, json, preflight, getUser, isServiceBearer } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { typeset } from '../_shared/print/typeset.js'
import { planRuns, PAGES_PER_RUN, padFor } from '../_shared/print/plan-pieces.js'
import { coverSource, coverName, foilName, coversOf } from '../_shared/print/cover-source.js'
import { printedOf, candidatesOf, chooseProvider, reachableToPrinter } from '../_shared/print/provider.js'
import { editionFor, pictureId, partsOf } from '../_shared/print/edition.js'
import { mergeIndex, mergeRegistry, readIndex, writeIndex, registryOf, withTitles, titleKey } from '../_shared/print/index-io.js'
import { sizePicture, MAX_HEIGHT } from '../_shared/print/picture.js'
import { makeEpub } from '../_shared/print/epub.js'
import { printers, FORMATS_PRINTED } from '../_shared/suppliers/index.js'
import { create as wasmCompiler } from '../_shared/print/wasm-compiler.js'
import { readback } from '../_shared/print/readback.js'
import TEMPLATES from '../_shared/print/templates.json' with { type: 'json' }
import { toEntry } from '../_shared/pipe/src/lib/entry.js'
import { renderer } from '../_shared/pipe/src/lib/markdown.js'
import { rowsStore } from '../_shared/pipe/build/store/rows.mjs'
import { pathOfAddress } from '../_shared/pipe/build/assets.mjs'
import { printWords, SPINE_EDITION } from '../_shared/pipe/build/print/words.mjs'
import { spineWords, costUsd, printSpec } from '../_shared/pipe/src/lib/print-offers.js'
import THEME from '../_shared/pipe/theme-strings.json' with { type: 'json' }

const url = Deno.env.get('SUPABASE_URL') ?? ''
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const admin = createClient(url, key)
const BUCKET = 'print'
/*
 * AND THE ONE THE STORE CAN SEE. The print bucket is private on purpose — it holds the files a
 * printer is sent, and an interior anybody could fetch is the book given away. But the LISTING's
 * art is meant to be looked at by everybody: the cover as an SVG that Book3D wears, and the page
 * pictures. On a machine those are files under public/ that the site build ships; in cloud mode
 * there is no site build, so they go to content-assets, which is the public bucket cloud mode
 * already keeps its uploads and covers in, under the same path shape.
 */
const ART_BUCKET = 'content-assets'
const artAt = (at: string) => `${url}/storage/v1/object/public/${ART_BUCKET}/${at}`
/* the printers read their keys through a function, not an object; bound once, for every call */
type Bound = { providersFor: (f: string) => any[]; printer: (id: string) => any; costUsd: (q: unknown) => number | null }
const { providersFor, printer } = printers((k: string) => Deno.env.get(k) ?? '')
const bound: Bound = { providersFor, printer, costUsd } as Bound
const FONT_PREFIX = '_type'

/*
 * THE TYPE, ONCE PER WORKER. 1.7 MB of it, and a worker serves many requests: re-reading it for
 * each one is most of the budget. A font that will not load is a LOUD failure — a book set in a
 * fallback face is wrong in a way nobody notices until it is printed, which is the expensive
 * moment to find out.
 */
const workerId = crypto.randomUUID().slice(0, 8)
let typeHeld: Promise<Uint8Array[]> | null = null
function theType(): Promise<Uint8Array[]> {
  if (!typeHeld) {
    /* A FAILURE IS NOT HELD. Caching the promise is the point — the type is most of the budget —
       but caching a REJECTED one means a worker that met the bucket a moment too early refuses
       every book after it, for its whole life, with the same stale message. It is forgotten on
       failure so the next call tries again. */
    typeHeld = (async () => {
      const { data, error } = await admin.storage.from(BUCKET).list(FONT_PREFIX)
      if (error) throw new Error(`print: the type could not be listed — ${error.message}`)
      const files = (data ?? []).filter((f) => /\.(ttf|otf)$/i.test(f.name))
      if (!files.length) throw new Error('print: there is no type in the bucket — the deploy uploads it (build/print/templates.mjs --fonts)')
      const out: Uint8Array[] = []
      for (const f of files) {
        const { data: blob, error: e2 } = await admin.storage.from(BUCKET).download(`${FONT_PREFIX}/${f.name}`)
        if (e2 || !blob) throw new Error(`print: a font would not load (${f.name}) — ${e2?.message ?? 'no bytes'}`)
        out.push(new Uint8Array(await blob.arrayBuffer()))
      }
      return out
    })().catch((e) => { typeHeld = null; throw e })
  }
  return typeHeld
}

/*
 * THE BOOK AND ITS COMPANION, AS ROWS — content is rows here, never files.
 *
 * Through toEntry, which is the ONE adapter from a row to the shape velite gives, and not by
 * shaping the row here. A book shaped twice is a book that differs between the two places it is
 * set, and the difference is silent: the first version of this passed the row's fields straight
 * through, the typesetter found no `raw` to split into chapters, and the function cheerfully
 * returned a one-page book.
 */
async function bookOf(slug: string) {
  const { data } = await admin.from('content').select('path, data, body, text').in('path', [
    `content/books/${slug}.md`, `content/companions/${slug}.md`,
  ]).is('deleted_at', null)
  const row = (p: string) => (data ?? []).find((r: Record<string, unknown>) => r.path === p)
  const b = row(`content/books/${slug}.md`)
  if (!b) throw new Error(`print: no book called ${slug}`)
  const c = row(`content/companions/${slug}.md`)
  /* the companion's prose wants rendering; a book's does not, and the typesetter reads the
     markdown itself either way */
  const md = renderer()
  const ctx = { render: (t: string) => md.parse(String(t ?? '')), bundle: {} }
  const book = toEntry('books', b, ctx)
  if (!book) throw new Error(`print: ${slug} is not a book this site can set`)
  return { book: { ...book, slug }, companion: c ? toEntry('companions', c, ctx) : null }
}

/*
 * WHAT WILL BIND THIS BOOK. Every printer that might make one of the formats the block sells, and
 * the LARGEST minimum and step among them — a page count that suits one printer and not another is
 * a page count that fails at the moment of ordering, which is the worst moment to find out.
 *
 * The printers are the same modules the build uses: plain JavaScript on fetch alone, which is why
 * they run here unchanged, and WHICH of them may make a format is the shared rule (provider.js) —
 * the one the block names, and every one with keys only where it says `auto`.
 */
function bindingFor(spec: Record<string, unknown>, bound: Bound) {
  const formats = Object.keys((spec.formats ?? {}) as Record<string, unknown>).filter((f) => FORMATS_PRINTED.includes(f))
  let min = 0, step = 0
  for (const format of formats) {
    for (const p of candidatesOf(spec, format, bound)) {
      const pr = p.product({
        format, trim: String(spec.trim ?? '6x9'), paper: String(spec.paper ?? 'cream'),
        cloth: spec.cloth, foil: spec.foil, options: ((spec.providers ?? {}) as Record<string, unknown>)[p.id] ?? {},
      })
      min = Math.max(min, Number(pr?.minPages) || 0)
      step = Math.max(step, Number(pr?.pageStep) || 0)
    }
  }
  return { min: min || undefined, step: step || undefined }
}

const pageCount = (pdf: Uint8Array) => {
  const s = new TextDecoder('latin1').decode(pdf)
  const m = s.match(/\/Count\s+(\d+)/g)
  return m ? Math.max(...m.map((x) => Number(x.replace(/\D/g, '')))) : 0
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'POST' }, 405)

  /*
   * WHO MAY SET A BOOK: an administrator, or the service key. The second is how the ADMIN function
   * asks — Set the editions in the live admin is answered there, and setting a book is most of a
   * CPU budget, so it is handed to this function rather than run inside the one answering the rest
   * of the admin. It is the same bearer the deploy's own calls use.
   */
  const service = await isServiceBearer(req)   /* it is async: unawaited, the Promise is truthy and everybody is the service */
  const user = service ? null : await getUser(req)
  if (!service) {
    if (!user) return json({ error: 'sign in' }, 401)
    if (!isAdmin(await rolesOf(user.id))) return json({ error: 'not allowed' }, 403)
  }

  let call: Record<string, unknown> = {}
  try { call = await req.json() } catch { return json({ error: 'bad json' }, 400) }
  const slug = String(call.book ?? '')
  const contents = String(call.contents ?? 'parts')
  /* a draft: the files and the quotes, nothing bought and nothing published (see below) */
  const draft = !!call.draft
  if (!slug) return json({ error: 'which book?' }, 400)

  const began = Date.now()

  /*
   * A SHOTS-ONLY CALL: { book, contents, edition, shots }. The three page pictures a listing shows
   * are drawn by whoever HAS A BROWSER, and that is never this function — it has Typst and no
   * Chromium. So the administrator's own browser draws them from the interior this function just
   * made, uploads them to the public bucket, and posts them back here to be recorded.
   *
   * IT IS RECORDED AGAINST AN EDITION, NOT A BOOK. A page number means nothing without the exact
   * text it was taken from: a word changed is a new edition, its openers fall on different pages,
   * and a picture of page 41 of the old one is a picture of the wrong page. So the call names the
   * edition it drew from and is refused if that is not the edition print.json now holds — which is
   * what happens when somebody presses Save & render between the set and the draw.
   */
  if (call.pictures && !call.render) {
    const asked = String(call.edition ?? '')
    if (!asked) return json({ error: 'which edition were these drawn from?' }, 400)
    try {
      const store = rowsStore({ client: admin, by: user ? user.id : 'print-render', url: '', key: '' })
      const idx = await readIndex(store)
      const had = ((idx as Record<string, Record<string, Record<string, Record<string, unknown>>>>)[slug]?.editions ?? {})[contents]
      if (!had) return json({ error: `print: ${slug} has no ${contents} edition set — there is nothing to record these against`, book: slug, contents }, 409)
      if (had.edition !== asked) {
        return json({ error: 'these were drawn from another edition', book: slug, contents, drew: asked, set: had.edition, ms: Date.now() - began }, 409)
      }

      /*
       * THE BYTES COME UP, THE ADDRESSES ARE MADE HERE. The caller sends pictures by NAME and names
       * them in `shots` and `art`; nothing it sends becomes an address. Letting a client write a url
       * into print.json would put whatever it liked on the store's shelves, and only an administrator
       * can call this, which is a reason to be careful rather than a reason not to be.
       */
      const pics = call.pictures as Record<string, string>
      const written: Record<string, string> = {}
      for (const [name, b64] of Object.entries(pics)) {
        if (!/^[a-z0-9][a-z0-9.:-]{0,80}\.(jpe?g|png)$/i.test(name)) return json({ error: `print: "${name}" is not a picture name` }, 400)
        const bin = Uint8Array.from(atob(String(b64).replace(/^data:[^,]*,/, '')), (ch) => ch.charCodeAt(0))
        const at = `print/${slug}/${asked}/${name}`
        const { error } = await admin.storage.from(ART_BUCKET)
          .upload(at, bin, { contentType: name.endsWith('.png') ? 'image/png' : 'image/jpeg', upsert: true })
        if (error) throw new Error(`${name} could not be stored — ${error.message}`)
        written[name] = artAt(at)
      }
      /* a name the caller sent, as the address it was stored at — and nothing else */
      const addr = (name: unknown) => written[String(name)] ?? null

      if (call.shots) {
        const sh = JSON.parse(JSON.stringify(call.shots)) as Record<string, Record<string, unknown>>
        for (const k of ['edition', 'other', 'marks']) if (sh[k]) sh[k].art = addr(sh[k].art)
        had.shots = sh
      }
      /* the covers, by the same cover key the dimensions and the printers use, so coverFor() finds a
         browser's raster exactly as it finds a machine-drawn sheet */
      if (call.art) {
        const out: Record<string, string> = { ...(had.art as Record<string, string> ?? {}) }
        for (const [k, name] of Object.entries(call.art as Record<string, unknown>)) { const u = addr(name); if (u) out[k] = u }
        had.art = out
      }
      await writeIndex(store, idx, { live: true, pending: true, published: true })
      return json({ ok: true, book: slug, contents, edition: asked, pictures: Object.keys(written).length,
        shots: Object.keys((had.shots ?? {}) as Record<string, unknown>).length,
        art: Object.keys((had.art ?? {}) as Record<string, unknown>).length, ms: Date.now() - began })
    } catch (e) {
      return json({ error: String((e as Error).message ?? e), book: slug, contents, ms: Date.now() - began }, 500)
    }
  }

  try {
    const { book, companion } = await bookOf(slug)
    /* whether this worker already had the type: the thing that makes a second call cheap, and the
       only honest way to say so — the wall clock of a whole call is mostly the printers' quotes */
    const warm = typeHeld !== null
    const fonts = await theType()
    const notes: string[] = [], incomplete: string[] = []
    /*
     * THE PRINT BLOCK, READ THE WAY THE STORE READS IT — printSpec, so the defaults (trim, paper,
     * cloth, foil, contents, who prints what) are the same defaults the build and the offers use.
     * It answers null for a book with no block, or with the print module off, and that is a plain
     * refusal rather than a property error twenty lines later: a book nobody put in print is not a
     * bug, it is a book nobody put in print.
     */
    const spec = printSpec((book as Record<string, unknown>).print) as Record<string, unknown> | null
    if (!spec) return json({ error: `print: ${slug} has no print block — nothing says what is sold or who makes it`, book: slug, contents }, 400)

    const store = rowsStore({ client: admin, by: user ? user.id : 'print-render', url: '', key: '' })
    const W0 = await printWords(store, { theme: THEME })
    const W = { ...W0, 'edition-line': W0['edition-line-' + contents] || W0['edition-line'] || '' }
    const spine = spineWords(String((book as Record<string, unknown>).title ?? ''), spec.spine, SPINE_EDITION(W0))
    const trim = String(spec.trim ?? '6x9'), paper = String(spec.paper ?? 'cream')
    const { formats: printedFormats, combos } = printedOf(spec, FORMATS_PRINTED)

    /*
     * A PAPERBACK'S FRONT IS THE E-BOOK'S OWN PICTURE, and there is no disk to read it off: it is
     * sized through Storage's image transform (picture.js, the same pixels sharp gives) and mapped
     * into the compiler as bytes once there is one. A picture that will not load is said out loud
     * rather than quietly dropped — a paperback with a blank front is not a cover anybody prints.
     *
     * Its BYTES are part of the edition, which is why it is fetched before anything is typeset: a
     * sharper picture dropped beside the book is a new edition and is set.
     */
    let picture = '', pictureHash = '', pictureBytes: Uint8Array | null = null
    /* the adapter gives a cover as the sized object the components render, or as the plain address
       where the build never sized one; the printer wants the address either way */
    const held = (book as Record<string, unknown>).cover
    const cover = String((typeof held === 'object' && held ? (held as Record<string, unknown>).src : held) ?? '')
    if (printedFormats.includes('softcover') && cover) {
      try {
        const rel = pathOfAddress(cover)
        const at = /^https?:\/\//i.test(cover) ? cover : (rel ? store.assetUrl(rel) : '')
        if (!at) throw new Error(`the address "${cover}" is not one the library holds`)
        /*
         * THE HASH IS OF THE ORIGINAL, not of what comes back sized. The build hashes the file as
         * it sits in the library; sharp and Storage's transform take a picture to the same PIXELS
         * but not to the same BYTES — two PNG encoders never agree — so hashing the sized copy
         * would give this path a different edition id for the same book. The picture is therefore
         * fetched twice: once as it is, for the identity, and once through the transform, for the
         * cover.
         */
        const raw = await fetch(at)
        if (!raw.ok) throw new Error(`HTTP ${raw.status}`)
        pictureHash = pictureId(new Uint8Array(await raw.arrayBuffer()))
        pictureBytes = await sizePicture(at, { driver: 'storage', height: MAX_HEIGHT })
        picture = '/picture.png'
      } catch (e) { notes.push(`the paperback's picture could not be read — ${(e as Error).message}`) }
    }

    /* THE SOURCE IS THE SAME SOURCE. typeset() is the build's own, unchanged — it was already pure,
       which is the whole reason this function is small. */
    /* typeset answers { source, chapters, marks } — the source AND what the document will say about
       itself. Taking the whole object for the source writes "[object Object]" into the .typ, which
       Typst compiles quite happily into one page: the first version of this returned a one-page
       book and said ok. */
    const { source, chapters } = typeset({ book, companion, trim, contents,
      /* the note was written for the two-part edition ("this edition prints the book twice"); the
         text alone and the edition alone open without it */
      note: contents === 'parts' ? String(spec.note ?? '') : '', words: W })

    const files: Record<string, string> = { ...TEMPLATES, 'interior.typ': source }
    const c = await wasmCompiler({ files, fonts })
    if (pictureBytes) c.bytes(picture, pictureBytes)
    let pdf = c.pdf('interior.typ')
    let pages = pageCount(pdf)

    /*
     * WHAT A PRINTER WILL BIND. A printer binds nothing under its minimum and a book has an even
     * number of pages, so a short one gets blank leaves at the end. The rule is padFor, shared
     * with the build — computing it here for itself is how this path said 26 pages where the
     * native one said 32 for the same book, with nothing to say which was right.
     *
     * The minimum belongs to whoever might make the book: the printer the block names, or every
     * one with keys where it says `auto` — the shared rule, so this path and the build pad alike.
     */
    const { min, step } = bindingFor(spec, bound)
    const pad = padFor(pages, { min, step })
    let compiled = source
    if (pad) {
      compiled = source + `\n#blank-pages(${pad})\n`
      c.put('interior.typ', compiled)
      pdf = c.pdf('interior.typ')
      pages = pageCount(pdf)
    }

    /*
     * WHAT THE DOCUMENT SAYS ABOUT ITSELF — its openers and its highlights, read back out of the
     * compiled file by the same query the build makes (readback, in the shared compiler seam).
     *
     * IT IS READ HERE BECAUSE THIS IS WHERE THE COMPILER IS. The pictures are drawn by the
     * administrator's browser, which has the PDF but not Typst, and the alternative is asking it to
     * guess which page a chapter opens on from the text it can see. So the answer carries the
     * record and the browser is told rather than left to infer.
     *
     * It is never a reason to fail: a query that does not answer costs the pictures, not the book.
     */
    let where: unknown[] = [], marks: unknown[] = []
    try { const me = readback(c, 'interior.typ'); where = me.where; marks = me.marks }
    catch (e) { notes.push(`the document's own openers could not be read, so the listing gets no page pictures — ${(e as Error).message}`) }

    /* WHERE IT GOES. The same place and the same name the native path uses, so a book set here and
       a book set on a machine are interchangeable to everything downstream. */
    const dims: Record<string, unknown> = {}
    /*
     * THE LISTING'S ART IS NOT DRAWN HERE, and it took a real attempt to find out why. A cover is a
     * PDF for the printer and a picture for the store, and on a machine both come out of the same
     * compile: Typst writes SVG with every glyph as a path, so the page needs no fonts and a browser
     * can wear it. The WASM compiler cannot. `svg` is on the seam and the web build answers
     * `Unsupported fmt` — SVG in typst.ts is the RENDERER's job, from a vector artifact, and that is
     * a second wasm module and a second megabyte in a function that is already fetching the type.
     *
     * So the pictures a listing needs — the covers and the three pages of the interior — are all
     * drawn by the administrator's browser from the PDFs this function made, and posted back. One
     * mechanism for all of them rather than two, and the browser is the only party in cloud mode
     * that can raster a page at all.
     */
    const art: Record<string, string> = {}
    /*
     * WHICH EDITION THIS IS, by the shared rule (edition.js) — the same sixteen characters the
     * build would give the same book, so a book set here and a book set on a machine land in the
     * same folder and `print.json` can say which is which.
     */
    const editionInputs = {
      templates: [TEMPLATES['book.typ'] ?? '', TEMPLATES['cover.typ'] ?? ''], source, trim, paper, spec,
      printed: printedFormats, combos,
      epub: !!(spec.formats as Record<string, unknown>).epub || ((spec.includes as string[]) ?? []).includes('epub'),
      insight: String((companion as Record<string, unknown> | null)?.insight ?? ''),
      description: String((book as Record<string, unknown>).description ?? ''), picture: pictureHash,
    }
    const edition = editionFor(editionInputs)
    const at0 = `${slug}/${edition}`
    const put = async (at: string, bytes: Uint8Array, type: string) => {
      const { error } = await admin.storage.from(BUCKET).upload(at, bytes, { contentType: type, upsert: true })
      if (error) throw new Error(`print: ${at} could not be stored — ${error.message}`)
    }
    await put(`${at0}/interior.pdf`, pdf, 'application/pdf')

    /*
     * THE EPUB, from the same words — the same module the build uses, which needed one change to
     * run here: it looked for the cover picture on the disk itself, and there is no disk. It takes
     * the bytes now, which this already has (it sized them for the paperback).
     */
    const wantEpub = !!(spec.formats as Record<string, unknown>).epub || ((spec.includes as string[]) ?? []).includes('epub')
    if (wantEpub) {
      try {
        const art = pictureBytes ? { name: 'cover.png', data: pictureBytes, type: 'image/png' } : null
        const epub = await makeEpub({ book, companion, contents, note: contents === 'parts' ? String(spec.note ?? '') : '', words: W, art })
        await put(`${at0}/book.epub`, epub, 'application/epub+zip')
      } catch (e) { notes.push(`the EPUB could not be made — ${(e as Error).message}`); incomplete.push('epub') }
    }
    /* `typ: true` keeps the Typst source beside the book, as `--typ` does on a machine: it is what
       somebody reads when this path and that one disagree about a book — so it is the source that
       was COMPILED, blank leaves and all, not the one before the padding */
    if (call.typ) await put(`${at0}/interior.typ`, new TextEncoder().encode(compiled), 'text/plain')

    /*
     * THE COVERS. One per printed format, and for a linen one per cloth × foil the buyer may pick
     * — each drawn to the dimensions of the printer that will actually make it, because a wrap
     * is a different sheet at every press.
     *
     * The source is the SHARED one (cover-source.js) and so is the choice of printer
     * (provider.js): a cover set here and a cover set on a machine are the same sheet under the
     * same name, or `print.json` would point a printer at a file that is not the book's.
     */
    const covers: Record<string, string> = {}, foils: Record<string, string> = {}
    const printersOut: Record<string, unknown> = {}
    for (const format of printedFormats) {
      const { provider, quotes } = await chooseProvider(spec, format, pages, trim, paper, bound)
      const p = printer(provider)
      const options = ((spec.providers ?? {}) as Record<string, Record<string, unknown>>)[provider] ?? {}
      const product = p.product({ chosen: { format, trim, paper, cloth: spec.cloth, foil: spec.foil }, options })
      const variants = coversOf({ format, provider, product, combos, spec, trim, paper, options, printerOf: (a: unknown) => p.product(a) })
      const keys: Record<string, unknown> = {}
      /*
       * A PAPERBACK WITH NO PICTURE IS NOT DRAWN. Its front IS the e-book's picture, so a cover
       * set without one would be a different sheet under the same edition id as the build's —
       * which is the one thing this whole path exists to make impossible. The format is left
       * unset and said so; the hardcover, which is set in type, goes on regardless.
       */
      if (format === 'softcover' && !picture) {
        incomplete.push(format)
        printersOut[format] = { provider, product, quotes, options, covers: {}, foils: {}, key: null, minPages: product.minPages || 24, note: product.note || '' }
        continue
      }
      for (const v of variants) {
        const d = await p.measure({ product: v.product, artefacts: { pages } })
        const draw = async (foilOnly: boolean) => {
          const name = foilOnly ? foilName(v.key) : coverName(v.key)
          const typ = '/' + name.replace(/\.pdf$/, '.typ')
          const src = coverSource({
            d, trim, cloth: v.cloth, foil: v.foil, foilOnly, paperback: format === 'softcover',
            picture, book, companion, spec, words: W, spine,
          })
          c.put(typ, src)
          const pdf = c.pdf(typ)
          await put(`${at0}/${name}`, pdf, 'application/pdf')
          if (call.typ) await put(`${at0}${typ}`, new TextEncoder().encode(src), 'text/plain')
          if (foilOnly) foils[v.key] = name; else covers[v.key] = name

        }
        await draw(false)
        if (v.product.artFoil) await draw(true)
        keys[v.key] = v.product
        dims[v.key] = d
      }
      printersOut[format] = {
        provider, product, quotes, options,
        covers: Object.fromEntries(Object.keys(keys).map((k) => [k, covers[k]])),
        foils: Object.fromEntries(Object.keys(keys).filter((k) => foils[k]).map((k) => [k, foils[k]])),
        key: Object.keys(keys)[0], minPages: product.minPages || 24, note: product.note || '',
      }
    }


    /*
     * CHECKED BY THE PRINTERS, FROM THE BUCKET. A printer fetches the files itself, so a local
     * stack's bucket (127.0.0.1) is out of its reach: there the files are kept and costed and the
     * check waits for a bucket it can see. That is the same rule the build follows, and it is why
     * a book set against a local stack is never submitted as though it had been approved.
     */
    const signed = async (name: string) => {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(`${at0}/${name}`, 7 * 86400)
      if (error || !data) throw new Error(`print: ${name} could not be signed — ${error?.message ?? 'no url'}`)
      return data.signedUrl
    }
    const interiorUrl = await signed('interior.pdf')
    const reachable = reachableToPrinter(interiorUrl)
    if (!reachable) notes.push('the bucket is not one a printer can reach from here, so nothing was checked or given a title')

    /*
     * THE TITLES A PRINTER KEEPS, which must never be made twice. Bookvault keeps one per book,
     * contents and format, made once for a fee; Lulu keeps none. It is read from BOTH places
     * before any is made — the bucket's registry (the truth where a checkout may lag) and
     * print.json's `titles` — and written to both the moment one is made, because a setup fee paid
     * twice is money gone for nothing. A register the bucket cannot record is refused rather than
     * left unrecorded: an unrecorded title is one nothing will find again, and the next run buys
     * another.
     */
    const idx = await readIndex(store)
    let fromBucket: Record<string, unknown> | null = null
    try {
      const { data } = await admin.storage.from(BUCKET).download(`${slug}/registry.json`)
      if (data) fromBucket = JSON.parse(await data.text())
    } catch { /* none yet */ }
    const titles = mergeRegistry(registryOf(idx, slug), fromBucket).titles as Record<string, Record<string, unknown>>

    let validated = true, seen = pages, madeTitle = false
    for (const [format, x] of Object.entries(printersOut as Record<string, Record<string, unknown>>)) {
      const p = printer(String(x.provider))
      const coverAt = (x.covers as Record<string, string>)[String(x.key)]
      if ((reachable || p.mock()) && coverAt) {
        const v = await p.validate({ product: x.product, pages, files: { interior: interiorUrl, cover: await signed(coverAt) } })
        if (!v.ok) throw new Error(`print: ${p.name} refused the ${format} — ${JSON.stringify(v.errors)}`)
        if (v.pages) seen = v.pages
        x.validated = !p.mock() && !v.deferred
      } else x.validated = false
      validated = validated && !!x.validated

      const q = await p.quote({ product: x.product, pages: seen, country: 'US' }).catch((e: Error) => ({ error: String(e.message ?? e) }))
      if (typeof q.print === 'number') { x.cost = q.print; x.currency = q.currency ?? 'USD'; x.shipping = q.shipping ?? null; x.days = q.days ?? null; x.from = q.from ?? null }
      else x.error = q.error

      /*
       * A DRAFT NEVER BUYS ANYTHING. The admin renders on every save so the editor can turn the
       * pages, and a title at a printer that keeps one costs a setup fee: asking for one on a
       * keystroke is how somebody pays for a book they were still writing the blurb for. The files
       * and the quotes are made either way; the title and the index wait for Set the editions.
       */
      if (p.stateful && coverAt && (reachable || p.mock()) && !draft) {
        const sku = `dl-${slug}-${contents}-${format}`
        const had = (titles[String(x.provider)] ?? {})[titleKey(contents, format)] ?? null
        const foilAt = (x.foils as Record<string, string>)?.[String(x.key)]
        const r = await p.register({
          product: x.product, pages: seen, title: String((book as Record<string, unknown>).title ?? ''), sku, existing: had,
          files: { interior: interiorUrl, cover: await signed(coverAt), jacket: (x.product as Record<string, unknown>)?.jacket ? await signed(coverAt) : null, foil: foilAt ? await signed(foilAt) : null },
        })
        if (r) {
          x.ref = r.ref; x.registered = !!r.paid; x.validated = !!r.validated
          /* a mocked title is nobody's: never in the registry */
          if (!r.mock) {
            titles[String(x.provider)] = titles[String(x.provider)] ?? {}
            titles[String(x.provider)][titleKey(contents, format)] = { ref: r.ref, sku, isbn: r.isbn ?? null, edition, paid: !!r.paid, validated: !!r.validated, made: (had as Record<string, unknown>)?.made ?? new Date().toISOString() }
            const { error } = await admin.storage.from(BUCKET).upload(`${slug}/registry.json`, new TextEncoder().encode(JSON.stringify({ titles }, null, 2)), { contentType: 'application/json', upsert: true })
            if (error) throw new Error(`print: the registry could not be written to the bucket — ${error.message}`)
            madeTitle = madeTitle || !had
          }
        }
      }
    }

    /*
     * AND `print.json`, through the STORE — a file in a checkout, a row of public.content here,
     * and the code does not know which. The merge is the shared one, so an index written in the
     * cloud and one written on a machine are the same index; a cloud render carries forward the
     * store art and the page pictures a machine made for this same edition rather than emptying a
     * gallery it cannot draw itself.
     */
    const manifest = {
      slug, contents, edition, pages: seen, trim, paper, cloth: spec.cloth, foil: spec.foil,
      printers: printersOut, covers, dims, art, shots: {}, epub: wantEpub && !incomplete.includes('epub'), validated,
      foilStamp: Object.values(printersOut as Record<string, Record<string, unknown>>).some((x) => (x.product as Record<string, unknown>)?.jacket) ? { title: spine.title, author: spine.edition } : null,
      title: (book as Record<string, unknown>).title, author: (book as Record<string, unknown>).author ?? '',
      made: new Date().toISOString(), sells: spec.contents,
    }
    await put(`${at0}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), 'application/json')
    /* a draft is not what the store sells: the files are in the bucket to be looked at, and
       print.json still says whatever was last SET */
    if (!draft) await writeIndex(store, withTitles(mergeIndex(idx, [manifest]), slug, titles), { live: true, pending: true, published: true })

    return json({
      ok: true, book: slug, contents, pages: seen, padded: pad, validated, /* typeset counts them; it does not hand back a list */
      chapters: Number(chapters) || 0, edition, draft, epub: manifest.epub, at: `${at0}/interior.pdf`, ms: Date.now() - began, warm, worker: workerId,
      printers: printersOut, covers, foils, dims, spine,
      /* WHAT THE CALLER MUST DRAW. Empty from here — see the note above the declaration: the WASM
         compiler cannot write SVG, so the listing's pictures are drawn by the browser from these
         PDFs and posted back to the shots branch. `at` is the folder they are all in. */
      art, folder: at0,
      /* asked for when a book comes out as a different edition here than on a machine: each part
         of the hash on its own, so the one that moved is named rather than hunted for */
      parts: call.parts ? partsOf(editionInputs) : undefined,
      /* a format whose cover could not be drawn — never left for a caller to notice by its absence */
      incomplete,
      /* NOT DRAWN HERE, AND NOT IMPOSSIBLE. This function has no browser; the caller has one, and
         `where` and `marks` are what it needs to draw the same three pages the build would. It
         sends them back with `shots` once it has. */
      shots: false, where, marks,
      notes,
      runs: planRuns([{ title: 'whole', pages }], { budget: PAGES_PER_RUN }).length,
    })

  } catch (e) {
    return json({ error: String((e as Error).message ?? e), book: slug, contents, ms: Date.now() - began }, 500)
  }
})
