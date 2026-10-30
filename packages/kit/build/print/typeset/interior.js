/*
 * A BOOK'S INTERIOR, SET WHERE THERE IS NO CPU BUDGET — the administrator's browser, in cloud mode (openspec:
 * print-production, "The interior is set in the administrator's browser").
 *
 * The interior is one Typst compile, because the book is one document: its contents page and its highlights index
 * name every page. An Edge Function has two seconds of CPU per request, and a long book's compile is past that on
 * its own, so print-render does not compile it. It parks the job as `waiting` and hands over everything the compile
 * needs; this module does the compile with the same WebAssembly driver and the same type, puts the PDF where the
 * function said, and gives the job back. The function then checks what it was given and makes the EPUB and the
 * covers, which fit.
 *
 * The same module runs in Node, where the end-to-end tests stand in for the browser: the same driver, so the same
 * pages.
 *
 *   setInterior({ files, fonts, min, step, wasm })           → { pdf, pages, pad, where, marks }
 *   finishWaiting({ job, ask, base, wasm, fetch, onStep })   → print-render's answer once the job has its interior
 *
 * `wasm` is the compiler's .wasm address in a browser bundle (Vite's `?url`); Node finds it beside the module.
 */
import { create } from './wasm-compiler.js'
import { readback } from './readback.js'
import { padFor } from '../plan-pieces.mjs'

/* the pages in a PDF, by its page tree's counts (print-render reads it the same way) */
export const pageCount = (pdf) => {
  const s = new TextDecoder('latin1').decode(pdf)
  const m = s.match(/\/Count\s+(\d+)/g)
  return m ? Math.max(...m.map((x) => Number(x.replace(/\D/g, '')))) : 0
}

/*
 * THE COMPILE, as print-render did it: the book, then blank leaves to the binding (the printers' minimum and step,
 * which the function works out and hands over), then the document's own account of where its chapters open and where
 * its highlights fall. A query that does not answer costs the listing's pictures, never the book.
 */
export async function setInterior({ files, fonts, min, step, wasm }) {
  const c = await create({ files, fonts, wasm })
  let pdf = c.pdf('interior.typ')
  const bare = pageCount(pdf)
  const pad = padFor(bare, { min, step })
  if (pad) {
    c.put('interior.typ', String(files['interior.typ']) + `\n#blank-pages(${pad})\n`)
    pdf = c.pdf('interior.typ')
  }
  let where = [], marks = []
  try { ({ where, marks } = readback(c, 'interior.typ')) } catch { /* the pictures only */ }
  return { pdf, pages: pageCount(pdf), pad, where, marks }
}

/*
 * A WAITING JOB, FINISHED FROM HERE. `ask(body)` posts to print-render and answers its JSON (the browser with the
 * administrator's session, a test with the service key); `base` is the API address this side reaches, which the
 * function's own addresses are joined to, because inside the functions runtime the gateway has a name no browser
 * resolves.
 */
export async function finishWaiting({ job, ask, base, wasm, fetch: get = globalThis.fetch, onStep = () => {} }) {
  const at = (p) => String(base).replace(/\/+$/, '') + p
  onStep('handover')
  const h = await ask({ job, interior: 'handover' })
  if (!h || !h.files || !h.upload) throw new Error('print: the job handed over no interior — ' + JSON.stringify(h).slice(0, 200))
  onStep('type')
  const fonts = []
  for (const p of h.fonts || []) {
    const r = await get(at(p))
    if (!r.ok) throw new Error(`print: a font would not load (HTTP ${r.status})`)
    fonts.push(new Uint8Array(await r.arrayBuffer()))
  }
  onStep('compile')
  const set = await setInterior({ files: h.files, fonts, min: h.min, step: h.step, wasm })
  onStep('upload')
  const up = await get(at(h.upload), { method: 'PUT', headers: { 'content-type': 'application/pdf', 'x-upsert': 'true' }, body: set.pdf })
  if (!up.ok) throw new Error(`print: the interior could not be stored (HTTP ${up.status}) — ${(await up.text().catch(() => '')).slice(0, 160)}`)
  onStep('finish')
  return ask({ job, interior: { edition: h.edition, pages: set.pages, pad: set.pad, where: set.where, marks: set.marks } })
}
