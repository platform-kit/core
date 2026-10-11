#!/usr/bin/env node
/*
 * The share images: one 1200 × 675 PNG per page that has a card, photographed
 * from the built app's own /__share routes (src/pages/SharePage.vue) and written
 * under dist/share/, where src/lib/seo.js points each page's og:image:
 *
 *   dist/share/default.png          the default landing page's opening — the
 *                                   image for every page that sets none of its own
 *   dist/share/articles/<id>.png    an article's title over its cover or gradient
 *   dist/share/books/<slug>.png     a book's cover, author and title
 *   dist/icons/icon-<n>.png         the favicon at every size index.html links
 *                                   (the mark on the light-mode gradient)
 *
 * build/prerender.mjs runs this first, on the same browser and preview server it
 * uses for the routes, so `npm run build` makes the pictures before it bakes the
 * pages that reference them. Run on its own (`node build/share-images.mjs`) it
 * serves dist itself. SHARE_IMAGES=0 skips it; a page or book with its own
 * `share` field is still photographed (the file is cheap) but not referenced.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { articles, books } from './content-node.mjs'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */

export const WIDTH = 1200, HEIGHT = 675
/* the favicon sizes: the two the tab uses, Android's, Apple's touch icon, and a large one */
export const ICON_SIZES = [16, 32, 48, 180, 192, 512]
const log = (m) => console.log('[share] ' + m)

/* every card the build photographs: the route to open and the file to write */
export function shareTargets() {
  const out = [{ route: '/__share/default', file: 'default.png' }]
  for (const a of articles || []) out.push({ route: '/__share/articles/' + a.id, file: 'articles/' + a.id + '.png' })
  for (const b of books || []) if (b.published !== false && (b.slug || b.id)) out.push({ route: '/__share/books/' + (b.slug || b.id), file: 'books/' + (b.slug || b.id) + '.png' })
  return out
}

/* photograph every card into <dist>/share and every icon size into <dist>/icons; returns the failures */
export async function renderShareImages({ browser, origin, dist }) {
  const failures = []
  /* the icons: one context per size, so each is drawn at its own pixel size rather than scaled */
  let icons = 0
  for (const size of ICON_SIZES) {
    const ictx = await browserContext(browser, { viewport: { width: size, height: size }, deviceScaleFactor: 1, colorScheme: 'light' })
    const ipage = await ictx.newPage()
    try {
      await ipage.goto(origin + '/__share/icon?size=' + size, { waitUntil: 'networkidle', timeout: 30000 })
      await ipage.waitForSelector('[data-share] .sh-icon', { timeout: 15000 })
      const out = path.join(dist, 'icons', 'icon-' + size + '.png')
      await fs.mkdir(path.dirname(out), { recursive: true })
      await ipage.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false })
      icons++
    } catch (e) { failures.push('icon ' + size + ': ' + (e.message || e).split('\n')[0]) }
    await ictx.close()
  }
  log(`${icons} of ${ICON_SIZES.length} icons written`)

  const ctx = await browserContext(browser, { viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, colorScheme: 'light' })
  const page = await ctx.newPage()
  let n = 0
  for (const t of shareTargets()) {
    try {
      await page.goto(origin + t.route, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForSelector('[data-share] > *:not(.sh-missing)', { timeout: 15000 })
      await page.evaluate(() => document.fonts && document.fonts.ready)
      await page.waitForTimeout(250)   /* the blobs, the glow and the images settle */
      const out = path.join(dist, 'share', t.file)
      await fs.mkdir(path.dirname(out), { recursive: true })
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
      n++
    } catch (e) { failures.push(t.route + ': ' + (e.message || e).split('\n')[0]) }
  }
  await ctx.close()
  log(`${n} of ${shareTargets().length} images written`)
  if (failures.length) log('failed:\n  ' + failures.join('\n  '))
  return failures
}

/* standalone: serve dist and photograph */
async function main() {
  if (process.env.SHARE_IMAGES === '0') { log('skipped (SHARE_IMAGES=0)'); return }
  const dist = path.resolve('dist')
  try { await fs.access(path.join(dist, 'index.html')) } catch { throw new Error('dist/index.html missing — run vite build first') }
  const { chromium } = await import('playwright')
  const { preview } = await import('vite')
  const PORT = 4181
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })
  const server = await preview({ root: process.cwd(), preview: { port: PORT, host: '127.0.0.1', open: false, strictPort: true }, logLevel: 'silent' })
  try { await renderShareImages({ browser, origin: 'http://127.0.0.1:' + PORT, dist }) }
  finally { await browser.close(); await server.close() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => { console.error('[share] ' + (e.message || e)); process.exit(1) })
}
