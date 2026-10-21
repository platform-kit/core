/*
 * The phone probe — the verifier for the design-rules spec's phone scenarios: every public route
 * (build/routes.mjs) at 390px, and with --as <email> the signed-in pages too. For each page it
 * reports
 *   - horizontal overflow (the document wider than the screen)
 *   - a card at the edge: a rounded box (radius ≥ 6px) at least 40% of the width that touches the
 *     screen's edge — a card that is the measure itself, with no gutter
 *   - text at the edge: an element with text of its own closer than 10px to either side
 * Fixed elements, the landing's decorative blobs and glows, and a horizontal rail's cards leaving
 * the page are not faults and are left out by name. Exit 1 when anything is found.
 *
 *   node build/phone-probe.mjs                              against http://localhost:5173
 *   node build/phone-probe.mjs --url http://localhost:5199 --as member@example.com
 *   node build/phone-probe.mjs --routes /store,/content     a few pages only
 */
import { chromium } from 'playwright'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d }
const URL = (arg('--url', 'http://localhost:5173')).replace(/\/+$/, '')
const AS = arg('--as', '')
const ONLY = arg('--routes', '')
const PASSWORD = arg('--password', 'password123')
/* what may run to the edge on purpose: the theme's manifest says (theme.js probe.allow), and
   probe.rails names the scrollers whose cards may leave on the RIGHT and come back with a swipe —
   which is not the same permission. A rail still keeps its left gutter, and saying so is the whole
   difference between an allowance and a blind spot: a product rail whose snap had scrolled the
   gutter away looked exactly like a rail behaving as intended. */
const { loadSite } = await import('./site.mjs'); const { loadTheme } = await import('./theme.mjs')
const THEME_PROBE = (await loadTheme(await loadSite())).probe
const ALLOWED = THEME_PROBE.allow.join(', ')
const RAILS = (THEME_PROBE.rails || []).join(', ')

const routes = ONLY ? ONLY.split(',') : (await import('./routes.mjs')).publicRoutes().filter((r) => !/^\/content\/(articles|wiki|docs)\/.|^\/store\/products\/(?!the-kybalion-print|one-on-one-session|chat-only-monthly)/.test(r))
if (AS) routes.push('/app', '/app/recommendations', '/app/accomplishments', '/app/coaching', '/app/chat')

const PROBE = ([ALLOWED, RAILS]) => {
  const vw = document.documentElement.clientWidth
  const sel = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '')
  const cards = [], edge = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed' || el.closest(ALLOWED)) continue
    const bx = el.getBoundingClientRect(); if (bx.width < 2 || bx.height < 2) continue
    const r = Math.max(...cs.borderRadius.split(/\s+/).map(parseFloat).filter((n) => !isNaN(n)), 0)
    const rail = !!(RAILS && el.closest(RAILS))   /* may leave on the right; the left gutter still holds */
    if (r >= 6 && bx.width >= vw * 0.4 && bx.height >= 40 && (bx.left <= 2 || (!rail && bx.right >= vw - 2))) cards.push({ el: sel(el.parentElement) + ' > ' + sel(el), l: Math.round(bx.left), r: Math.round(vw - bx.right) })
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)
    if (own && bx.width > 30 && (bx.left < 10 || (!rail && bx.right > vw - 10))) edge.push({ el: sel(el.parentElement) + ' > ' + sel(el), l: Math.round(bx.left), r: Math.round(vw - bx.right), t: el.textContent.trim().slice(0, 40) })
  }
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  return { overflow: sw - vw, cards, edge }
}
const prime = () => document.fonts.ready.then(async () => { const H = document.documentElement.scrollHeight; for (let y = 0; y < H; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)) } window.scrollTo(0, 0) })

const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })
const ctx = await browserContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const g = await ctx.newPage()
if (AS) {
  await g.goto(URL + '/content', { waitUntil: 'load' }); await g.waitForTimeout(1200)
  await g.click('.sitemenu-btn'); await g.waitForTimeout(400); await g.click('.navmodal-link.siteauth:not(.navmodal-theme)'); await g.waitForTimeout(500)
  await g.fill('.au-card input[type=email]', AS); await g.fill('.au-card input[type=password]', PASSWORD); await g.click('.au-submit')
  await g.waitForSelector('.siteacct', { timeout: 15000 })
}
let faults = 0
for (const r of routes) {
  await g.goto(URL + r, { waitUntil: 'load' }); await g.waitForTimeout(1500)
  await g.evaluate(prime); await g.waitForTimeout(300)
  const p = await g.evaluate(PROBE, [ALLOWED, RAILS])
  const cards = p.cards, edge = p.edge
  const bad = p.overflow > 0 || cards.length || edge.length
  if (bad) faults++
  console.log(`${bad ? '✖' : '✔'} ${r}${p.overflow > 0 ? `  overflow ${p.overflow}px` : ''}`)
  for (const c of cards) console.log(`     card at the edge  left ${c.l}  right ${c.r}  ${c.el}`)
  for (const e of edge) console.log(`     text at the edge  left ${e.l}  right ${e.r}  ${e.el}  "${e.t}"`)
}
await b.close()
console.log(faults ? `\n✖ ${faults} page${faults === 1 ? '' : 's'} with a fault at 390px` : `\n✔ ${routes.length} pages clean at 390px`)
process.exit(faults ? 1 : 0)
