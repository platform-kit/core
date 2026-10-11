/*
 * Pages of a print file as pictures: the PDF itself — the file the printer gets — drawn by pdf.js
 * in the build's headless Chromium (the browser the prerender uses; nothing on the machine) and
 * saved as JPEGs. One browser for a run; the PDF and pdf.js are handed to the page over a
 * made-up origin, so nothing is written to disk or served.
 *
 *   const r = await raster()                 // launches the browser
 *   await r.stats(pdf)                        // → [{ page, items }] how much text each page holds
 *   await r.render(pdf, [12, 13], { dpi, pad }) // → Map(page → JPEG Buffer), each cropped to the
 *                                              //   book's type area — ONE box for every page, the
 *                                              //   bounds of all the text in the file (running head
 *                                              //   to folio) plus `pad` inches — so a page is what is
 *                                              //   printed on it, not its margins, and every page
 *                                              //   comes out the same size
 *   await r.close()
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const PDFJS = path.dirname(require.resolve('pdfjs-dist/package.json'))
const ORIGIN = 'https://print.local'

/*
 * THE PAGE THE BROWSER IS DRIVEN THROUGH. The measurements and the crop are NOT written here: they
 * are src/lib/print/pdf-shots.js, inlined below, because the administrator's browser draws the same
 * pictures when an edition is set with no build box to draw them and the two must measure and crop
 * identically — a cloud-set book's listing has to match a machine-set one.
 */
const SHOTS = fs.readFileSync(fileURLToPath(new URL('../../src/lib/print/pdf-shots.js', import.meta.url)), 'utf8')
  .replace(/^export /gm, '')   /* inlined into a module script: the names are already in scope */

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff"><script type="module">
import * as pdfjs from './pdf.min.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'
${SHOTS}
window.__open = async () => { const r = await fetch('./book.pdf'); const buf = await r.arrayBuffer(); window.__doc = await pdfjs.getDocument({ data: buf }).promise; return window.__doc.numPages }
window.__stats = () => statsOf(window.__doc)
window.__bounds = () => boundsOf(window.__doc)
window.__render = (n, scale, box, pad) => renderPage(window.__doc, n, scale, box, pad)
window.__ready = true
</script></body>`

export async function raster() {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })
  const page = await browser.newPage()
  let pdf = null
  await page.route(ORIGIN + '/**', (route) => {
    const u = new URL(route.request().url()).pathname
    if (u === '/index.html') return route.fulfill({ contentType: 'text/html', body: PAGE })
    if (u === '/book.pdf') return route.fulfill({ contentType: 'application/pdf', body: pdf })
    const f = path.join(PDFJS, 'legacy/build', path.basename(u))
    if (fs.existsSync(f)) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(f) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto(ORIGIN + '/index.html')
  await page.waitForFunction(() => window.__ready)
  const open = async (buf) => { pdf = buf; return page.evaluate(() => window.__open()) }
  return {
    /* [{ page, items }]: how many pieces of text each page holds — a full page against an opener */
    async stats(buf) { await open(buf); return page.evaluate(() => window.__stats()) },
    /* the pages named, as JPEGs at `dpi` (72 is the sheet's own size), each cropped to the file's
       type area plus `pad` inches of the margin — the same box on every page (null: the whole sheet) */
    async render(buf, pages, { dpi = 144, pad = null } = {}) {
      await open(buf)
      const box = pad == null ? null : await page.evaluate(() => window.__bounds())
      const out = new Map()
      for (const n of pages) { const url = await page.evaluate(([n, s, b, p]) => window.__render(n, s, b, p), [n, dpi / 72, box, pad]); out.set(n, Buffer.from(url.split(',')[1], 'base64')) }
      return out
    },
    close: () => browser.close(),
  }
}
