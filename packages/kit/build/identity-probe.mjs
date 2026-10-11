#!/usr/bin/env node
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */
/*
 * SIGNING IN ON A PAGE GIVES YOU THE PAGE YOU WOULD HAVE GOT BY RELOADING IT.
 *
 * That sentence is the whole of the reactive-identity change, and it cannot be checked by reading
 * the code: half a dozen modules each hold a slice of what a person may see, and the question is
 * whether every one of them heard that the person changed. A module that did not is invisible —
 * the page simply shows a little less than it should, and only somebody who reloads finds out.
 *
 * So this opens each surface twice.
 *
 *   IN PLACE   land as a guest, sign in on the page, wait, and read the surface.
 *   RELOADED   reload the same route as the same person, wait, and read it again.
 *
 * The two readings must match. A reading is deliberately COARSE — how many rooms are in the rail,
 * how many threads in the list, whether the account menu is there — because the fine detail is
 * timing and the coarse detail is the bug: a rail with no rooms in it, a chat list that is empty,
 * a header that still says Sign in.
 *
 * And the other way: sign OUT in place and compare with a guest's own load, because a module that
 * keeps what it loaded is worse than one that loads nothing — it shows one person another's.
 *
 * Needs the dev server and the stack, and a browser. `IDENTITY_PROBE=0` skips it. It is not in
 * `npm test` by default: it wants two minutes and a browser, and it is the check you run when you
 * have touched what a module does on arrival.
 */

const APP = process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:5173'
const WHO = process.env.IDENTITY_PROBE_USER || 'member@example.com'
const PASS = process.env.IDENTITY_PROBE_PASS || 'password123'
const WAIT = Number(process.env.IDENTITY_PROBE_WAIT || 6000)

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')) } }
const off = (why) => { console.log(`  ${why} — skipped\n`); process.exit(0) }

console.log('\nWHO IS HERE, TOLD ONCE\n')
if (process.env.IDENTITY_PROBE === '0') off('IDENTITY_PROBE=0')

try { if (!(await fetch(APP, { signal: AbortSignal.timeout(2500) })).ok) throw new Error('no') }
catch (e) { off(`no dev server on ${APP}`) }

let chromium
try { ({ chromium } = await import('playwright')) } catch (e) { off('playwright is not installed here') }

/*
 * WHAT A SURFACE LOOKS LIKE, in numbers.
 *
 * Every reading is coarse on purpose. The fine detail of a page is timing — which row painted
 * first — and the coarse detail is the bug: a rail with nothing in it, a header that still says
 * Sign in, a page with half the controls it should have. `controls` is every link and button on
 * the page, which is a blunt but honest proxy for how much of it loaded; the rest are the parts
 * that belong to a particular module, so a module that was not told who arrived shows up by name.
 *
 * The selectors here were read off the running app rather than guessed: `.sp-nav` is the spaces
 * rail (a member sees six entries, an administrator eleven), `.siteacct` is the header's account
 * menu, `.tab-bar .tab` the sheet's tabs.
 */
const READ = `({
  controls: document.querySelectorAll('a, button').length,
  account: !!document.querySelector('.siteacct'),
  rail: document.querySelectorAll('.sp-nav a, .sp-nav button').length,
  rooms: document.querySelectorAll('.sp-chan').length,
  tabs: document.querySelectorAll('.tab-bar .tab').length,
  threads: document.querySelectorAll('.cl-row').length,
})`
const ROUTES = (process.env.IDENTITY_PROBE_ROUTES || '/spaces,/app,/app/chat,/content,/store').split(',').filter(Boolean)

const browser = await chromium.launch()
const fresh = async () => (await browserContext(browser, { viewport: { width: 1280, height: 900 } })).newPage()

/*
 * SIGN IN ON THE PAGE AS IT IS.
 *
 * A route may send the browser somewhere else as it settles — `/app` lands a guest on
 * `/app/diagnostics` — and a modal opened before that happens is closed by the navigation, which
 * looks exactly like a sign-in that did not work. So the address is allowed to stop moving first,
 * and the modal is opened again if it went.
 */
/*
 * THE ADDRESS HAS STOPPED MOVING — after three unchanged samples, not one. A redirect that has not
 * fired yet looks exactly like an address that will not move, so the first version returned before
 * `/app` had become `/app/diagnostics`, the modal opened, and the navigation closed it under the
 * probe's hands. It read as a sign-in that silently failed.
 */
async function settled(page) {
  let was = page.url(), still = 0
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300)
    const now = page.url()
    if (now === was) { if (++still >= 3) return now } else { still = 0; was = now }
  }
  return page.url()
}
async function signIn(page) {
  await page.waitForFunction(() => !!window.DLauth, null, { timeout: 30000 })
  await settled(page)
  /*
   * OPENED, FILLED AND PRESSED — and tried again if nothing came of it. The modal is a live
   * component on a page that may still be settling, and a press that lands a frame before a
   * re-render does nothing at all; a probe that reported that as "the sign-in failed" would send
   * somebody after a bug in the app that is not there.
   *
   * The fields are SCOPED to the modal: a bare `input[type=password]` takes the first one on the
   * page, and a surface may have one of its own — this put the email in the modal and the password
   * somewhere else, and said the sign-in had failed.
   */
  const card = page.locator('.au-card')
  const token = () => page.evaluate(() => Object.keys(localStorage).some((k) => k.includes('auth-token')))
  for (let tries = 0; tries < 3; tries++) {
    await page.evaluate(() => window.DLauth.open({}))
    if (!(await page.waitForSelector('.au-card input[type=email]', { timeout: 6000 }).then(() => true).catch(() => false))) continue
    await card.locator('input[type=email]').fill(WHO)
    await card.locator('input[type=password]').fill(PASS)
    await card.locator('.au-submit').click().catch(() => {})
    for (let i = 0; i < 40; i++) { if (await token()) return; await page.waitForTimeout(250) }
  }
  /* three goes and nothing: say WHY, with the modal's own words — a bare timeout here reads as
     "the probe is broken" and sends somebody after the wrong thing */
  const said = await page.evaluate(() => { const c = document.querySelector('.au-card'); return c ? c.innerText.replace(/\s+/g, ' ').slice(0, 200) : '(the modal is not open)' })
  throw new Error(`could not sign in as ${WHO} on ${page.url()} — the modal says: ${said}`)
}
const read = (page) => page.evaluate(READ)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const say = (a, b) => `in place ${JSON.stringify(a)}\n        reloaded ${JSON.stringify(b)}`

try {
  for (const route of ROUTES) {
    /* IN PLACE: a guest on the page who signs in there */
    const page = await fresh()
    await page.goto(APP + route, { waitUntil: 'domcontentloaded' })
    await signIn(page)
    await page.waitForTimeout(WAIT)
    const inPlace = await read(page)

    /* RELOADED: the same person, the same route, loaded whole */
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settled(page)
    await page.waitForTimeout(WAIT)
    const reloaded = await read(page)
    ok(`${route}: signing in on the page gives what reloading it gives`, same(inPlace, reloaded), say(inPlace, reloaded))
    await page.context().close()
  }
} finally { await browser.close() }

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
