#!/usr/bin/env node
/*
 * Static route generation. After `vite build`, serve dist, open every public
 * route in a headless browser, and write the rendered document to
 * dist/<route>/index.html — so a crawler (or a reader with a slow connection)
 * gets the page's real markup, title and meta tags, not an empty shell. The app
 * still boots on top and takes over. Also writes sitemap.xml and points
 * robots.txt at it when the site knows its public address (content/site.md).
 *
 * Photographs the share cards first (build/share-images.mjs) on the same
 * browser, so every page's og:image exists before the page is baked.
 *
 * Installs and drives Playwright's Chromium during the build. If it cannot
 * launch, it warns and leaves the SPA build as is;
 * PRERENDER=0 skips it on purpose, PRERENDER=strict makes a missing browser fail.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { preview } from 'vite'
import { publicRoutes } from './routes.mjs'
import { renderShareImages } from './share-images.mjs'
import { site as SITE, forms as FORMS } from './content-node.mjs'
import { FORMS_ON } from './routes.mjs'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */

const DIST = path.resolve('dist')
const S = Array.isArray(SITE) ? SITE[0] : SITE
const BASE = String((S && S.url) || process.env.SITE_URL || '').replace(/\/+$/, '')
const strict = process.env.PRERENDER === 'strict'
const log = (m) => console.log('[prerender] ' + m)

async function writeSitemap(routes) {
  if (!BASE) { log('no public address in content/site.md — sitemap skipped'); return }
  const today = new Date().toISOString().slice(0, 10)
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...routes.map((r) => `  <url><loc>${BASE}${r === '/' ? '/' : r}</loc><lastmod>${today}</lastmod></url>`), '</urlset>', ''].join('\n')
  await fs.writeFile(path.join(DIST, 'sitemap.xml'), xml)
  const robots = path.join(DIST, 'robots.txt')
  let txt = ''
  try { txt = await fs.readFile(robots, 'utf8') } catch { txt = 'User-agent: *\nAllow: /\n' }
  if (!/^Sitemap:/m.test(txt)) await fs.writeFile(robots, txt.replace(/\n+$/, '') + `\n\nSitemap: ${BASE}/sitemap.xml\n`)
  log('sitemap.xml with ' + routes.length + ' urls')
}

/* every published form's document and its model beside its page — dist/form/<slug>/form.md, the forms.md document
   as written, and form.json, the model the runner reads — for anyone who wants the form as a file */
async function writeForms() {
  if (!FORMS_ON) return
  let n = 0
  for (const f of FORMS || []) {
    if (f.published === false) continue
    const dir = path.join(DIST, 'form', f.slug)
    await fs.mkdir(dir, { recursive: true })
    try { await fs.copyFile(path.resolve('content/forms', f.slug + '.md'), path.join(dir, 'form.md')) } catch { /* the document is the collection's */ }
    await fs.writeFile(path.join(dir, 'form.json'), JSON.stringify({ slug: f.slug, title: f.title, model: f.model }))
    n++
  }
  if (n) log(n + ' form(s) written beside their pages')
}

async function main() {
  if (process.env.PRERENDER === '0') { log('skipped (PRERENDER=0)'); return }
  try { await fs.access(path.join(DIST, 'index.html')) } catch { throw new Error('dist/index.html missing — run vite build first') }
  const routes = publicRoutes()
  await writeSitemap(routes)
  await writeForms()

  let chromium
  try { ({ chromium } = await import('playwright')) } catch { if (strict) throw new Error('playwright missing'); log('playwright not installed — pages left as the SPA shell'); return }
  let browser
  /* PLAYWRIGHT_CHROMIUM_PATH points at a browser when the bundled one is not installed (a dev machine) */
  try { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined }) }
  catch (e) { if (strict) throw new Error('bundled Chromium unavailable: ' + (e.message || e)); log('bundled Chromium unavailable — pages left as the SPA shell'); return }

  const server = await preview({ root: process.cwd(), preview: { port: 0, host: '127.0.0.1', open: false }, logLevel: 'silent' })
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
  /* the share images first: the pages baked below point their og:image at them */
  if (process.env.SHARE_IMAGES === '0') log('share images skipped (SHARE_IMAGES=0)')
  else { const bad = await renderShareImages({ browser, origin, dist: DIST }); if (bad.length && strict) { await browser.close(); await server.close(); process.exit(1) } }
  const ctx = await browserContext(browser, { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) PlatformKitPrerender/1.0', viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const failures = []
  let n = 0
  for (const r of routes) {
    try {
      await page.goto(origin + r, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForFunction(() => { const a = document.querySelector('#app'); return a && a.children.length > 0 }, null, { timeout: 15000 })
      await page.waitForTimeout(150)   /* a tick for fonts and the head to settle */
      await page.evaluate((route) => {
        document.documentElement.setAttribute('data-prerendered', route)
        /* the landing's reveal-on-scroll blocks are baked revealed: the static page
           must never hide its own content behind a script that may not run */
        document.querySelectorAll('.lprv').forEach((n) => n.classList.add('lpin'))
      }, r)
      const html = await page.content()
      const out = r === '/' ? path.join(DIST, 'index.html') : path.join(DIST, r.replace(/^\//, ''), 'index.html')
      await fs.mkdir(path.dirname(out), { recursive: true })
      await fs.writeFile(out, html.startsWith('<!') ? html : '<!doctype html>\n' + html)
      n++
    } catch (e) { failures.push(r + ': ' + (e.message || e).split('\n')[0]) }
  }
  await browser.close()
  await server.close()
  log(`${n} of ${routes.length} routes written`)
  if (failures.length) { log('failed:\n  ' + failures.join('\n  ')); if (strict) process.exit(1) }
}

main().catch((e) => { console.error('[prerender] ' + (e.message || e)); process.exit(1) })
