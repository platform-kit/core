/*
 * A PDF's pages as images, for the print editor's preview: pdf.js renders each page to a
 * canvas at a chosen width and hands back an object url. Pages are rendered in order, a
 * few at a time, into a reactive list the flipbook reads — so the first spread is up in
 * a moment and the rest fill in behind it — and every url is revoked when the document
 * is let go. The worker is pdf.js's own, bundled by vite.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/* a blank leaf in the paper's colour, shown until a page is rendered */
const BLANK = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#f7f4ec'; g.fillRect(0, 0, w, h); return c.toDataURL('image/png') }

/* `crop`: { x, y, w, h } in the page's points — only that region is drawn (a panel of a jacket) */
export function openPdf(url, { width = 720, onPage, onCount, crop = null } = {}) {
  let task = null, doc = null, urls = [], stopped = false
  const run = (async () => {
    task = pdfjs.getDocument({ url })
    doc = await task.promise
    const n = doc.numPages
    const first = await doc.getPage(1)
    const vp0 = first.getViewport({ scale: 1 })
    const cw = crop ? crop.w : vp0.width, ch = crop ? crop.h : vp0.height
    const scale = width / cw
    const blank = BLANK(Math.round(cw * scale), Math.round(ch * scale))
    urls = Array.from({ length: n }, () => blank)
    if (onCount) onCount(n, urls)
    for (let i = 1; i <= n && !stopped; i++) {
      const page = i === 1 ? first : await doc.getPage(i)
      /* a crop shifts the page so the region's corner is the canvas's, and the canvas is the region's size */
      const vp = crop ? page.getViewport({ scale, offsetX: -crop.x * scale, offsetY: -crop.y * scale }) : page.getViewport({ scale })
      const canvas = document.createElement('canvas'); canvas.width = Math.round(cw * scale); canvas.height = Math.round(ch * scale)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86))
      if (stopped) break
      const u = URL.createObjectURL(blob); urls[i - 1] = u
      if (onPage) onPage(i, u)
      if (i !== 1) page.cleanup()
    }
  })()
  return {
    done: run,
    close() { stopped = true; for (const u of urls) if (u.startsWith('blob:')) URL.revokeObjectURL(u); urls = []; if (task) task.destroy().catch(() => {}) },
  }
}

/*
 * THE LISTING'S PAGE PICTURES, DRAWN HERE because there is no build box to draw them.
 *
 * On a machine `build/print/raster.mjs` photographs three pages of the print file into
 * public/print/… at the moment an edition is set. A cloud-only deployment has no machine and never
 * will — but the administrator pressing "Set the editions" has a browser with the interior PDF
 * already in hand (it is what the page-flip preview reads), which is the same insight the prerender
 * sidecar rests on: draw it where there IS a browser.
 *
 * The measuring and the crop are NOT written again here. They are the kit's own
 * `lib/print/pdf-shots.js`, which the build's headless Chromium inlines into the page it drives, so
 * a cloud-set book's listing is cropped by the same rule as a machine-set one — otherwise the two
 * would differ by a few points and a gallery would show it.
 *
 *   url    the interior PDF (a signed url from the print bucket, or a blob)
 *   where  [{ kind, title, page }] the openers the document reports
 *   marks  [{ page }] the highlights
 *   → { shots: [{ page, kind, jpeg }], chapter, marksPage }  jpeg is a data url
 */
export async function shotsOf(url, { where = [], marks = [], dpi, pad, other = null } = {}) {
  const { statsOf, boundsOf, renderPage, PAD, DPI } = await import('@platform-kit/kit/lib/print/pdf-shots.js')
  const { choose, pageOf } = await import('@platform-kit/kit/build/print/pages.mjs')
  const doc = await pdfjs.getDocument({ url }).promise
  const all = await statsOf(doc)
  const pick = choose(where, marks, all)
  const box = await boundsOf(doc)
  const scale = (dpi || DPI) / 72
  const p = pad == null ? PAD : pad

  const want = []
  if (pick.chapter) want.push({ page: pick.chapter.page, kind: 'chapter', title: pick.chapter.title })
  if (pick.marks) want.push({ page: pick.marks.page, kind: 'marks' })
  /*
   * AND THE SAME CHAPTER IN THE OTHER TEXT — the gallery's third page, which is the whole argument
   * of a two-part edition: here is the chapter rewritten, and here it is in the original.
   *
   * In a book printed in two parts both are in THIS document, so it is the chapter's SECOND opening
   * and needs nothing else. `contents: 'full'` because that is what the second part is, and the
   * gallery's caption says so. Where the two texts are separate editions the caller passes the other
   * document's own account of itself, and that page is drawn from that document by a second call.
   */
  if (pick.chapter) {
    const twice = (where || []).filter((w) => w.kind === 'chapter' && w.title === pick.chapter.title)
      .map((w) => w.page).filter((n) => n !== pick.chapter.page)
    if (twice.length) want.push({ page: twice[0], kind: 'other', contents: 'full', title: pick.chapter.title })
    else if (other) {
      const n = pageOf(other.where || [], pick.chapter.title)
      if (n) want.push({ page: n, kind: 'other', title: pick.chapter.title, from: 'other' })
    }
  }

  const shots = []
  for (const w of want) {
    if (w.from === 'other') continue   /* drawn from the other document by a second call */
    shots.push({ ...w, jpeg: await renderPage(doc, w.page, scale, box, p) })
  }
  return { shots, chapter: pick.chapter, marksPage: pick.marks ? pick.marks.page : null }
}

/*
 * THE COVER AS A PICTURE THE STORE CAN WEAR.
 *
 * On a machine the printer's PDF and the store's picture come out of the same Typst compile, because
 * Typst writes SVG with every glyph as a path. THE WASM COMPILER CANNOT — `svg` is on the seam and
 * the web build answers `Unsupported fmt`, since SVG in typst.ts belongs to the renderer rather than
 * the compiler. So where a book is set in the cloud, the cover is rastered here from the PDF the
 * function made, like the pages beside it.
 *
 * It is THE WHOLE SHEET, not the front panel, because that is what a machine's SVG is: Book3D takes
 * `art` and positions it by the edition's `dims`, so a browser's raster and a machine's sheet are
 * the same object to everything downstream. Cropping to the front here would put the spine on the
 * cover of every book in the shop.
 *
 *   url    the cover PDF (a signed url from the print bucket, or a blob)
 *   width  the picture's width in pixels — the sheet is about 12in wide, so 1600 is ~133dpi
 *   → a JPEG data url
 */
export async function coverArtOf(url, { width = 1600 } = {}) {
  const { renderPage } = await import('@platform-kit/kit/lib/print/pdf-shots.js')
  const doc = await pdfjs.getDocument({ url }).promise
  try {
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 })
    return await renderPage(doc, 1, width / vp.width, null, 0)
  } finally { doc.destroy().catch(() => {}) }
}
