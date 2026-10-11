/*
 * THE PRERENDER SIDECAR — one Chrome, two jobs.
 *
 * A deployment with content in rows and the repository out of the cycle never builds again, and two
 * different things break because of it:
 *
 *   THE HEAD. A crawler that runs no JavaScript asks for a page no build ever baked and is served
 *   the shell — the site's default title and picture, for an article published this morning.
 *
 *   THE PICTURE. og:image names a file the build photographed. For a record published since that
 *   build there is no such file, and a link shows nothing at all.
 *
 * A prerenderer answers the first. It takes a browser to answer the second — and a prerenderer IS a
 * browser, already running, so it answers both. Pointing it at the app's own /__share/<kind>/<id>
 * route means the card stays drawn by the site's own components and tokens: there is one card
 * design, and a photograph of it, exactly as the build makes. The alternative — drawing the card
 * again in a CSS subset — is the fallback for hosts that cannot run this, and is second class on
 * purpose (supabase/functions/share-image).
 *
 * Two endpoints, and nothing else:
 *   GET /render?url=<absolute>            the page with its JavaScript run, as html
 *   GET /shot?url=<absolute>&w=&h=        a PNG of it, for the share card
 *
 * Both cached in memory by url, both bounded. It serves one origin — ORIGIN — and refuses any url
 * outside it, because an open renderer is an open proxy.
 */
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const PORT = Number(process.env.PORT || 3000)
/* the site this renders, and the only one it will: an open renderer is an open proxy */
const ORIGIN = String(process.env.ORIGIN || 'http://site').replace(/\/+$/, '')
const TTL = Number(process.env.CACHE_TTL || 3600) * 1000
const MAX = Number(process.env.CACHE_MAX || 500)
const WAIT = String(process.env.WAIT_UNTIL || 'networkidle')
const TIMEOUT = Number(process.env.RENDER_TIMEOUT || 20000)

let browser = null
const launching = (async () => { browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] }); return browser })()

/* a small cache with a ceiling: the oldest goes when it is full, so a crawler walking a big site
   cannot make this grow without end */
const cache = new Map()
const hit = (k) => { const e = cache.get(k); if (!e) return null; if (Date.now() > e.at + TTL) { cache.delete(k); return null } cache.delete(k); cache.set(k, e); return e }
const put = (k, v) => { cache.set(k, { ...v, at: Date.now() }); while (cache.size > MAX) cache.delete(cache.keys().next().value) }

/* a path on this site, and nothing else: the origin is ours to choose, not the caller's */
function target(raw) {
  const p = String(raw || '')
  if (!p.startsWith('/')) return null
  try { return new URL(p, ORIGIN + '/').toString() } catch { return null }
}

async function withPage(fn) {
  await launching
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  try { return await fn(page) } finally { await ctx.close() }
}

async function renderHtml(url) {
  return withPage(async (page) => {
    const res = await page.goto(url, { waitUntil: WAIT, timeout: TIMEOUT })
    const status = res ? res.status() : 502
    /* the app marks a page it has finished with; where it does not, networkidle is the signal */
    await page.waitForSelector('[data-prerendered], #app', { timeout: 2000 }).catch(() => {})
    const html = await page.content()
    return { status, body: Buffer.from(html), type: 'text/html; charset=utf-8' }
  })
}

async function shot(url, w, h) {
  return withPage(async (page) => {
    await page.setViewportSize({ width: w, height: h })
    const res = await page.goto(url, { waitUntil: WAIT, timeout: TIMEOUT })
    const status = res ? res.status() : 502
    if (status >= 400) return { status, body: Buffer.from('not here'), type: 'text/plain' }
    /* THE SAME SIGNAL THE BUILD WAITS FOR (build/share-images.mjs): the card's frame with
       something in it that is not the missing-record placeholder. One readiness rule, so a card
       photographed here and a card photographed by the build are taken at the same moment. */
    await page.waitForSelector('[data-share] > *:not(.sh-missing)', { timeout: 10000 }).catch(() => {})
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } })
    return { status: 200, body: png, type: 'image/png' }
  })
}

createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/healthz') { res.writeHead(200).end('ok'); return }
  const url = target(u.searchParams.get('path'))
  if (!url) { res.writeHead(400, { 'content-type': 'text/plain' }).end('a path on this site, please'); return }

  const isShot = u.pathname === '/shot'
  const w = Math.min(2400, Math.max(16, Number(u.searchParams.get('w') || 1200)))
  const h = Math.min(2400, Math.max(16, Number(u.searchParams.get('h') || 675)))
  const key = (isShot ? `s:${w}x${h}:` : 'r:') + url

  try {
    let out = hit(key)
    if (!out) { out = isShot ? await shot(url, w, h) : await renderHtml(url); if (out.status < 400) put(key, out) }
    res.writeHead(out.status, {
      'content-type': out.type,
      'content-length': out.body.length,
      'cache-control': out.status < 400 ? `public, max-age=${Math.floor(TTL / 1000)}` : 'no-store',
      'x-prerender': hit(key) ? 'hit' : 'miss',
    }).end(out.body)
  } catch (e) {
    /* a render that fails must not take the page down with it: nginx falls back to the app */
    res.writeHead(502, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end(String(e && e.message || e))
  }
}).listen(PORT, () => console.log(`prerender: ${ORIGIN} on :${PORT}`))
