/*
 * THE TWO MEASUREMENTS A PAGE PICTURE NEEDS, and the crop, in one place.
 *
 * Which pages show a book best is decided by build/print/pages.mjs from what the document says
 * about itself. What it needs first is measured off the PDF: how much text each page holds (so the
 * chapter shown is a page of text and not an opener with two lines and air), and the type area of
 * the WHOLE FILE (one box for every page — a box per page gave every picture a different size).
 *
 * Both are pdf.js over a document in a browser, and there are two browsers: the build's headless
 * Chromium (build/print/raster.mjs, which inlines this file into the page it drives) and the
 * administrator's own, which draws the same pictures at the moment an edition is set where there
 * is no build box to draw them. They have to measure and crop identically or a cloud-set book's
 * listing would not match a machine-set one, so there is one implementation and both use it.
 *
 * Every function takes a pdf.js document. Nothing here reaches for a network, a file or a global.
 */

/* [{ page, items }] — the pieces of text on each page, which is how a full page is told from an
   opener. Not a character count: one long paragraph and one short one both read as text. */
export async function statsOf(doc) {
  const out = []
  for (let i = 1; i <= doc.numPages; i++) {
    const t = await (await doc.getPage(i)).getTextContent()
    out.push({ page: i, items: t.items.filter((x) => x.str && x.str.trim()).length })
  }
  return out
}

/*
 * THE TYPE AREA OF THE WHOLE FILE: the bounds of every piece of text on every page, in points from
 * the sheet's top left. ONE BOX FOR EVERY PAGE is the point of it — measuring each page on its own
 * gave every picture its own size and a gallery of mismatched sheets.
 */
export async function boundsOf(doc) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i), vp = page.getViewport({ scale: 1 })
    const t = await page.getTextContent()
    for (const it of t.items) {
      if (!it.str || !it.str.trim()) continue
      const [, , , , ex, ey] = it.transform
      for (const [px, py] of [[ex, ey], [ex + it.width, ey + it.height]]) {
        const [vx, vy] = vp.convertToViewportPoint(px, py)
        x0 = Math.min(x0, vx); x1 = Math.max(x1, vx); y0 = Math.min(y0, vy); y1 = Math.max(y1, vy)
      }
    }
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null
}

/* one page as a JPEG data url, at `scale` (1 is the sheet's own size), cropped to `box` plus `pad`
   inches of the margin — or the whole sheet where there is no box */
export async function renderPage(doc, n, scale, box, pad) {
  const page = await doc.getPage(n)
  const vp = page.getViewport({ scale })
  const c = document.createElement('canvas')
  c.width = Math.round(vp.width); c.height = Math.round(vp.height)
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
  if (!box) return c.toDataURL('image/jpeg', 0.9)
  const p = pad * 72
  const sx = Math.max(0, Math.floor((box.x0 - p) * scale)), sy = Math.max(0, Math.floor((box.y0 - p) * scale))
  const sw = Math.min(c.width - sx, Math.ceil((box.x1 + p) * scale) - sx)
  const sh = Math.min(c.height - sy, Math.ceil((box.y1 + p) * scale) - sy)
  const o = document.createElement('canvas'); o.width = sw; o.height = sh
  o.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh)
  return o.toDataURL('image/jpeg', 0.9)
}

/* the margin kept around the type area, in inches — the same on both sides of the seam */
export const PAD = 0.3
/* the pictures are drawn at this many dots per inch (72 is the sheet's own size) */
export const DPI = 144
