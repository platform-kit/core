/* The print editions: a book's print block (build/print/block.mjs — the block alone, byte for byte around it) and the
   files it makes. Not a file of its own: a view over the books, listed whole (every book with its block, the editions
   set in content/store/print.json, the draft renders kept while the server runs), and actions — save (the block written,
   then rendered), render, quote (what a printer would charge now), proofed (a record, never a gate), set (the real
   thing: bucket, quotes, titles, print.json, the registry committed, the catalog), pdf (a rendered file, streamed). */
import fs from 'node:fs'
import path from 'node:path'
import { Refusal } from '../util.mjs'

const drafts = new Map()   /* the draft renders, by book, while the server runs */
/*
 * WHO ACTUALLY SETS A BOOK. On a machine it is build/print.mjs — Typst's native compiler, sharp,
 * a headless browser for the listing's page pictures. A site whose whole backend is Supabase has
 * none of those, and there it is the `print-render` function, which does the same work with Typst
 * as WASM (see openspec/changes/print-on-demand).
 *
 * The model does not choose between them: the CALLER hands it one. `ctx.editions` — given by the
 * admin's Edge Function and absent on a machine — is `{ render(slug, { draft }), file(book,
 * edition, which) }`. Where it is absent the machine's path runs, as it always has. That is why
 * this file can be part of the pipe the function carries: the module a bundler cannot follow is
 * only imported when nothing else was offered.
 */
const editionsOf = async (ctx, slug, draft) => {
  if (ctx.editions) return ctx.editions.render(slug, { draft })
  return render(ctx.root, slug, draft, ctx.store)
}
/* the editions index is content (content/store/print.json), read through the store; the render's own files under .print are the machine's */
const printIndex = async (store) => { try { const raw = await store.read('content/store/print.json'); return raw == null ? {} : JSON.parse(raw) } catch { return {} } }
/* a render is the machine's (typst, the printers): git mode only. The machine is reached by a name a bundler
   cannot follow, so the function's copy of the pipe carries none of it (the action is refused there first) */
const MACHINE = '../../print' + '.mjs'
async function render(root, slug, local = true, store = null) {
  const { printBook, writePrintIndex } = await import(MACHINE)
  const { asStore } = await import('../../store/index.mjs'); store = asStore(store || root)
  const t0 = Date.now()
  const ms = await printBook(slug, { local })
  if (!local) await writePrintIndex(ms)
  /* the drafts: one per contents, each with its covers and their dimensions for the preview's crops */
  const editions = Object.fromEntries(ms.map((m) => [m.contents, { edition: m.edition, pages: m.pages, covers: m.covers, epub: !!m.epub, printers: m.printers || {}, dims: Object.fromEntries(Object.entries(m.dims || {}).map(([k, d]) => [k, { width: d.width, height: d.height, spine: d.spine, bleed: d.bleed, flap: d.flap || 0, trim: m.trim }])) }]))
  const draft = { editions, ms: Date.now() - t0, at: new Date().toISOString() }
  drafts.set(slug, draft)
  /* every save renders new edition folders; only the set editions and these drafts are kept */
  const set = ((await printIndex(store))[slug] || {}).editions || {}
  const keep = new Set([...ms.map((m) => m.edition), ...Object.values(set).map((e) => e.edition)].filter(Boolean))
  const dir = path.join(root, '.print', slug)
  for (const ed of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (!keep.has(ed)) fs.rmSync(path.join(dir, ed), { recursive: true, force: true })
  return draft
}
async function view(root, slug, store) { const { readBlock } = await import('../../print/block.mjs'); const { asStore } = await import('../../store/index.mjs'); store = asStore(store || root); const b = await readBlock(store, slug); return { slug, ...b, edition: (await printIndex(store))[slug] || null, draft: drafts.get(slug) || null } }
async function bookOf(payload, ctx) { const { bookSlugs } = await import('../../print/block.mjs'); const slug = String(payload.book || ''); if (!(await bookSlugs(ctx.store)).includes(slug)) throw new Refusal(404, 'no such book'); return slug }

export default {
  key: 'print', name: 'Print editions', dir: 'content/books', title: 'title', module: 'print', editor: 'PrintAdmin',
  names: async (ctx) => { const { bookSlugs } = await import('../../print/block.mjs'); return bookSlugs(ctx.store) },
  read: (name, ctx) => view(ctx.root, name, ctx.store),
  /* the whole view: every book, the choices, the printers as the tab draws them (who is configured, what each makes, its options per format) */
  list: async (ctx) => {
    const { bookSlugs, CHOICES } = await import('../../print/block.mjs')
    const { PRINTERS, PRINTER_IDS } = await import('../../print/suppliers.mjs')
    const books = []; for (const s of await bookSlugs(ctx.store)) books.push(await view(ctx.root, s, ctx.store))
    const printers = Object.fromEntries(PRINTER_IDS.map((id) => { const p = PRINTERS[id]; return [id, { id, name: p.name, formats: p.formats, stateful: !!p.stateful, configured: p.configured(), mock: p.mock(), options: Object.fromEntries(p.formats.map((f) => [f, p.options(f)])) }] }))
    return { books, choices: CHOICES, printers }
  },
  grammar: { parse: () => ({ data: {}, content: '' }), serialise: () => { throw new Refusal(400, 'a print block is written by its actions') } },
  actions: {
    save: async (payload, ctx) => {
      const slug = await bookOf(payload, ctx)
      const { readBlock, writeBlock, validateBlock } = await import('../../print/block.mjs')
      const pr = payload.print && typeof payload.print === 'object' ? payload.print : null
      if (pr) { const issues = validateBlock(ctx.root, (await readBlock(ctx.store, slug)).title, pr); if (issues.length) throw new Refusal(422, 'validation', { issues }) }
      await writeBlock(ctx.store, slug, pr)
      const draft = pr ? await editionsOf(ctx, slug, true) : null
      return { ok: true, book: await view(ctx.root, slug, ctx.store), draft }
    },
    render: async (payload, ctx) => { const slug = await bookOf(payload, ctx); return { ok: true, draft: await editionsOf(ctx, slug, true), book: await view(ctx.root, slug, ctx.store) } },
    quote: async (payload, ctx) => {
      /* a live quote for one printed format at one printer, as the admin sets its options: for the draft's page count (or the set edition's), one copy to the US */
      const slug = await bookOf(payload, ctx)
      const { readBlock } = await import('../../print/block.mjs')
      const { PRINTERS, FORMATS_PRINTED } = await import('../../print/suppliers.mjs')
      const p = PRINTERS[payload.provider]
      if (!p || !FORMATS_PRINTED.includes(payload.format)) throw new Refusal(400, 'unknown printer or format')
      const { printSpec } = await import('../../../src/lib/print-offers.js')
      const spec = printSpec(payload.print || (await readBlock(ctx.store, slug)).print || {})
      const contents = payload.contents || spec.contents[0]
      const d = (drafts.get(slug) || {}).editions || {}, e = d[contents] || (((await printIndex(ctx.store))[slug] || {}).editions || {})[contents]
      const pages = e ? e.pages : 120
      const product = p.product({ chosen: { format: payload.format, trim: spec.trim, paper: spec.paper, cloth: spec.cloth, foil: spec.foil }, options: payload.options || {} })
      const q = await p.quote({ product, artefacts: { pages: Math.max(pages, product.minPages || 24) }, country: payload.country || 'US' })
      return { ok: true, pages, product, quote: q, mock: p.mock(), configured: p.configured() }
    },
    proofed: async (payload, ctx) => {
      const slug = await bookOf(payload, ctx)
      const { readBlock, writeBlock } = await import('../../print/block.mjs')
      const contents = String(payload.contents || '')
      const e = (((await printIndex(ctx.store))[slug] || {}).editions || {})[contents]
      if (!e || !e.edition) throw new Refusal(404, 'no set edition of those contents — set the editions first')
      const pr = (await readBlock(ctx.store, slug)).print
      if (!pr) throw new Refusal(404, 'the book has no print block')
      await writeBlock(ctx.store, slug, { ...pr, proofed: { ...(pr.proofed && typeof pr.proofed === 'object' ? pr.proofed : {}), [contents]: e.edition } })
      return { ok: true, book: await view(ctx.root, slug, ctx.store) }
    },
    set: async (payload, ctx) => {
      const slug = await bookOf(payload, ctx)
      const set = await editionsOf(ctx, slug, false)
      /* the registry into the repository, and the catalog to the store — both the machine's: in
         the cloud the registry is already in the bucket and in print.json (the two places that
         matter), and the catalog follows the publish */
      if (!ctx.editions) { const { commitRegistry } = await import(MACHINE); commitRegistry(); await ctx.script('catalog.mjs') }
      return { ok: true, set, book: await view(ctx.root, slug, ctx.store) }
    },
    /*
     * THE LISTING'S PICTURES, DRAWN BY THE ADMINISTRATOR'S BROWSER AND SENT HERE.
     *
     * Only in the cloud. On a machine the build draws them itself as part of setting the editions,
     * out of the same compile — there is nothing for a browser to do and this would be a second,
     * worse source of the same pictures. So it is refused with the reason rather than quietly
     * ignored: a button that does nothing is worse than one that says why.
     */
    listing: async (payload, ctx) => {
      const slug = await bookOf(payload, ctx)
      if (!ctx.editions || !ctx.editions.listing) throw new Refusal(400, 'the build draws the listing\'s pictures here — this is for a site with no build')
      return ctx.editions.listing({ book: slug, contents: String(payload.contents || ''), edition: String(payload.edition || ''), pictures: payload.pictures || {}, shots: payload.shots || null, art: payload.art || null })
    },
    /* a rendered file, streamed: interior | cover-<key> | epub of a draft or a set edition */
    pdf: async (payload, ctx) => {
      const book = String(payload.book || ''), edition = String(payload.edition || ''), which = String(payload.file || 'interior')
      if (!/^[a-z0-9-]+$/.test(book) || !/^[0-9a-f]{16}$/.test(edition) || !/^(interior|cover-[a-z-]+|epub)$/.test(which)) throw new Refusal(400, 'bad request')
      const name = which === 'epub' ? 'book.epub' : which + '.pdf'
      const type = which === 'epub' ? 'application/epub+zip' : 'application/pdf'
      /* in the cloud the rendered files are in the print bucket, not under .print on a disk */
      if (ctx.editions) { const bytes = await ctx.editions.file(book, edition, name); if (!bytes) throw new Refusal(404, 'not rendered'); return { bytes, type } }
      const f = path.join(ctx.root, '.print', book, edition, name)
      if (!fs.existsSync(f)) throw new Refusal(404, 'not rendered')
      return { stream: fs.createReadStream(f), type, size: fs.statSync(f).size }
    },
  },
}
