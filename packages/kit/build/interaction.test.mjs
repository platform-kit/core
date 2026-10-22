/*
 * THE INTERACTION LANE — a browser that does not only LOOK at the site, it uses it.
 *
 * The static lane already builds a site, serves it, walks every public route and fails on a
 * console error or a backend request. That catches a page that will not render. It cannot catch a
 * page that renders perfectly and dies the moment somebody types into it — which is exactly what
 * had happened to the palette: `offPalette is not defined` fired on the first keystroke, the page
 * looked fine, the whole suite was green, and the site's search had been dead for weeks.
 *
 * About sixty of the specs' unverified scenarios read "Playwright (no pinned test)" or "the admin
 * locally": somebody did this by hand once and it worked. This lane is that hand, kept.
 *
 * What it does per surface: one real interaction, end to end, with the console and page errors
 * watched throughout. Not a DOM probe — a click, a keystroke, a send, and then an assertion about
 * what came back.
 *
 * It needs a dev server and the stack (the surfaces here are backend-backed by nature), and it
 * SKIPS LOUDLY naming what went uncovered rather than passing quietly.
 *
 *   node packages/kit/build/interaction.test.mjs [--url http://localhost:5173] [--keep]
 */
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */

let pass = 0, fail = 0
/* An act that quietly returned because it could not find what it needed is NOT a pass. It is
   counted apart and named at the end, because "7 passed" over a lane that did nothing is exactly
   the shape of the check this lane was built to replace. */
const undone = []
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✔ ' + name) } else { fail++; console.log('  ✖ ' + name + (detail ? ' — ' + detail : '')) } }
const note = (s) => console.log('  ' + s)
const cannot = (why) => { const e = new Error(why); e.undone = true; throw e }

console.log('\nTHE INTERACTION LANE — a browser that uses the site\n')

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    Nothing that needs a hand on the site is covered by this run.\n'); leave(0) }

let chromium
try { ({ chromium } = await import('playwright')) } catch { skip('playwright is not installed') }

const BASE = argOf('--url', process.env.INTERACTION_URL || stackOf()?.app || '')
/*
 * ONE BUDGET, AND A GENEROUS ONE. This lane runs a real browser against a real site while the rest
 * of the suite is loading the same machine — builds, renders, a database, an edge runtime. A
 * timeout tuned to an idle laptop makes the lane fail for reasons that have nothing to do with the
 * site, and a lane that cries wolf is a lane everybody learns to ignore. Waiting longer costs
 * nothing when the page is ready early, which it usually is.
 */
/* the one number, from build/browser.mjs — which also sets it as the floor on every context,
   so a call this file forgot to give a budget no longer runs at Playwright's 30 */
import { WAIT, fillHeld } from './browser.mjs'
import { statusOf, leave, stackOf, moduleOn, siteUnderTest, notHere } from './test-stack.mjs'
try { const r = await fetch(BASE, { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw new Error(String(r.status)) }
catch { skip(`nothing is serving the site at ${BASE} (npm run dev)`) }
try { if (!statusOf()) throw new Error('no stack') } catch { skip('no local stack is up (npx supabase start)') }

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })

/*
 * One page per act, because an act that leaves a modal open or a thread half-written would make
 * the next one fail for a reason that has nothing to do with it — and a lane whose failures move
 * about is a lane nobody trusts.
 */
async function act(name, fn, { theme = 'light', size = { width: 1280, height: 900 } } = {}) {
  const ctx = await browserContext(browser, { viewport: size, colorScheme: theme })
  const page = await ctx.newPage()
  const errs = []
  /* a resource that would not load names its address: the console's own line does not, and a failure that cannot say
     which request it was is one nobody can act on */
  page.on('console', (m) => { if (m.type() === 'error') errs.push((m.text() + (/Failed to load resource/.test(m.text()) && m.location()?.url ? ' — ' + m.location().url : '')).slice(0, 300)) })
  const ours = () => errs.filter((e) => !(emptyBucket.length && /Failed to load resource/.test(e)))
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message || e).slice(0, 200)))
  /* A 429 from our own doors is a GUARD doing its job, not the surface being broken — the support
     function caps new guests and new threads per address per hour, so a lane run several times
     over will be refused. An act that was refused did not run; saying it failed would teach
     everybody to ignore this lane. */
  const refused = []
  page.on('response', (r) => { if (r.status() === 429) refused.push(r.url().split('/').pop().split('?')[0]) })
  /*
   * A BUCKET THAT IS EMPTY IS THE MACHINE, NOT THE SITE. `supabase db reset` empties storage, and
   * the recordings and the print type are put there by scripts rather than by the seed — so after
   * a reset the reader asks for an audiobook that is not there and the console fills with 400s.
   * Failing an act for that sends somebody after a bug in the gate they were actually testing. It
   * is reported once, with what to run, and does not fail the act.
   */
  const emptyBucket = []
  page.on('response', (r) => {
    const u = r.url()
    if ((r.status() === 400 || r.status() === 404) && /\/storage\/v1\/object\/public\/(audio|print)\//.test(u)) emptyBucket.push(u.split('/').slice(-2).join('/'))
  })
  /* The support teaser floats over the corner and swallows clicks meant for the page beneath it.
     It is a feature, not chrome, so it is DISMISSED the way a reader would rather than deleted —
     and never on the acts that are about the widget itself. (`.ck` is the command palette, not a
     cookie banner: removing it is how the first version of this lane deleted the very thing the
     palette act was asking about, and then reported that a word matched nothing.) */
  const clear = () => page.evaluate(() => {
    const x = document.querySelector('.sw-teaser [aria-label*="ismiss" i], .sw-teaser button.sw-x')
    if (x) x.click()
  }).catch(() => {})
  try {
    await fn({ page, clear, errs, refused })
    if (refused.length) { const why = 'the rate limit refused it (' + refused[0] + ') — the guard held, so this act did not run'; undone.push(name + ' — ' + why); console.log('  ⚠ ' + name + ' — NOT RUN: ' + why) }
    else {
      if (emptyBucket.length) note(`(the audio bucket has nothing in it on this stack — ${emptyBucket[0]} and ${emptyBucket.length - 1} more; npm run tts -- --book <slug> refills it. Not counted against this act.)`)
      /* an interaction that threw nothing but logged an error is still a broken interaction */
      ok(name, ours().length === 0, ours().slice(0, 2).join(' | '))
    }
  } catch (e) {
    if (refused.length) { const why = 'the rate limit refused it (' + refused[0] + ') — the guard held, so this act did not run'; undone.push(name + ' — ' + why); console.log('  ⚠ ' + name + ' — NOT RUN: ' + why) }
    else if (e && e.undone) { undone.push(name + ' — ' + e.message); console.log('  ⚠ ' + name + ' — NOT RUN: ' + e.message) }
    else {
      const at = e && e.stack && e.stack.split('\n').find((line) => line.includes('interaction.test.mjs:'))
      ok(name, false, String(e.message || e).split('\n')[0].slice(0, 220) + (at ? ' (' + at.trim() + ')' : '') + (ours().length ? ' | console: ' + ours()[0] : ''))
    }
  } finally { if (!args.includes('--keep')) await ctx.close() }
}

/*
 * EVERY WAIT HERE IS FOR A CONDITION, NEVER A DURATION. A fixed pause is long enough on an idle
 * machine and too short when the rest of the suite is loading it — which is how two acts of this
 * lane passed on their own and failed inside `npm test`, for no reason to do with the site.
 */
const go = async (page, path, clear, ready) => {
  /* the admin is by far the biggest chunk the site ships — ag-grid, TipTap, the editors — so it
     takes longer to mount than a reader page, and a budget that fits one does not fit the other */
  const budget = path.startsWith('/admin') ? WAIT * 2 : WAIT
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  /* the app has mounted when its root has children — but that is true long before the PAGE it was
     asked for has drawn anything, so every act names the thing it actually needs */
  await page.waitForFunction(() => { const a = document.querySelector('#app'); return a && a.children.length > 0 }, { timeout: budget })
  if (ready) await page.locator(ready).first().waitFor({ state: 'visible', timeout: budget })
    .catch(() => { const e = new Error(`the page never drew ${ready}`); e.undone = true; throw e })
  await clear()
}
const signIn = async (page, clear, email, password = 'password123') => {
  await page.evaluate(() => window.DLauth && window.DLauth.open({}))
  const emailField = page.locator('.au-form input[type="email"]').first()
  const passwordField = page.locator('.au-form input[type="password"]').first()
  await passwordField.waitFor({ state: 'visible', timeout: 30000 })
  await emailField.waitFor({ state: 'visible', timeout: WAIT })
  await fillHeld(page, [['.au-form input[type="email"]', email], ['.au-form input[type="password"]', password]])
  await page.locator('.au-form button[type="submit"]').click()
  /* The account menu is the user-visible proof that the session arrived. */
  await page.locator('.siteavatar').first().waitFor({ state: 'visible', timeout: WAIT })
  await clear()
}

/* ─── the palette: the one that was dead ─── */

await act('the palette answers a typed word', async ({ page, clear }) => {
  await go(page, '/library', clear, '.pageshell')
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(600)
  let box = page.locator('.ck input').first()
  if (!(await box.isVisible().catch(() => false))) { await page.keyboard.press('Control+k'); await page.waitForTimeout(600); box = page.locator('.ck input').first() }
  if (!(await box.isVisible().catch(() => false))) throw new Error('the palette did not open on ⌘K')
  await box.fill('imagination')
  await page.waitForTimeout(1600)
  const hits = await page.locator('.ck-hit').count()
  if (hits === 0) throw new Error('a word in the library matched nothing')
})

await act('and a word in no book matches nothing, without breaking', async ({ page, clear }) => {
  await go(page, '/library', clear, '.pageshell')
  await page.keyboard.press('Meta+k'); await page.waitForTimeout(600)
  const box = page.locator('.ck input').first()
  if (!(await box.isVisible().catch(() => false))) throw new Error('the palette did not open')
  await box.fill('zzzqqxnotaword')
  await page.waitForTimeout(1200)
  if (await page.locator('.ck-hit').count() !== 0) throw new Error('a word in no book matched something')
})

/* ─── the support widget: a guest writes, and is answered ─── */

const SAID = 'A probe from the interaction lane.'

await act('a guest opens the support panel and sends a line', async ({ page, clear }) => {
  await go(page, '/store', clear, '.sw-btn')
  const launcher = page.locator('.sw-btn')
  if (!(await launcher.isVisible().catch(() => false))) throw new Error('the launcher is not on the page')
  await launcher.click()
  await page.locator('.sw-panel').waitFor({ state: 'visible', timeout: 30000 }).catch(() => { throw new Error('the panel did not open') })
  const box = page.locator('.sc-in').first()
  await box.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { throw new Error('there is nowhere to write') })
  await box.fill(SAID)
  await page.keyboard.press('Enter')
  /* the line must come back as a message, not merely leave the box */
  await page.locator('.sw-panel').getByText(SAID, { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => { throw new Error('the line was sent and never appeared in the thread') })
  /* and the guest now has a token, which is their whole identity */
  const token = await page.evaluate(() => { try { return localStorage.getItem('dl.support.token') } catch { return null } })
  if (!token) throw new Error('no contact token was kept, so the guest could never find their thread again')

  /*
   * TAKE THE GUEST BACK OUT. The desk caps new guests and new threads per address per hour, and
   * the count is simply the rows made in that window — so a lane that leaves its guest behind
   * spends somebody else's budget. It spent support-api.test.mjs's: four of its checks went
   * 429 in the full suite the first time this act ran, and the failure was in a test I had not
   * touched. A test that makes a row in a rate-limited table removes it.
   */
  const { createClient } = await import('@supabase/supabase-js')
  const cfg = statusOf()
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: msg } = await admin.from('support_messages').select('conversation_id').eq('body', SAID).limit(1).maybeSingle()
  if (msg) {
    const { data: conv } = await admin.from('support_conversations').select('contact_id').eq('id', msg.conversation_id).maybeSingle()
    await admin.from('support_messages').delete().eq('conversation_id', msg.conversation_id)
    await admin.from('support_conversations').delete().eq('id', msg.conversation_id)
    if (conv) await admin.from('support_contacts').delete().eq('id', conv.contact_id)
  }
})

await act('a resolved thread reopens when the contact writes again', async ({ page, clear }) => {
  const { createClient } = await import('@supabase/supabase-js')
  const cfg = statusOf()
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: conv } = await admin.from('support_conversations').select('id, status').order('last_message_at', { ascending: false }).limit(1).maybeSingle()
  /* a thread of the act's own where the seed has none, removed after */
  let made = null, thread = conv
  if (!thread) {
    const { data: contact } = await admin.from('support_contacts').insert({ last_path: '/interaction' }).select().single()
    const { data: t } = await admin.from('support_conversations').insert({ contact_id: contact.id, status: 'open' }).select('id, status').single()
    made = contact; thread = t
  }
  const conv2 = thread
  await admin.from('support_conversations').update({ status: 'resolved' }).eq('id', conv2.id)
  await admin.from('support_messages').insert({ conversation_id: conv2.id, author: 'contact', body: 'One more thing.' })
  await page.waitForTimeout(600)
  const { data: after } = await admin.from('support_conversations').select('status').eq('id', conv2.id).maybeSingle()
  await admin.from('support_messages').delete().eq('body', 'One more thing.')
  if (made) { await admin.from('support_conversations').delete().eq('contact_id', made.id); await admin.from('support_contacts').delete().eq('id', made.id) }
  else await admin.from('support_conversations').update({ status: conv2.status }).eq('id', conv2.id)
  if (after?.status === 'resolved') throw new Error('a resolved thread stayed resolved after the contact wrote')
})

/* ─── the library: a reader turns a page and searches inside a book ─── */

/* the site's own books (its .velite), never one site's title: the first with more chapters than a guest may read, for the
   gate; and the first book at all, with a word from its own text, for the search */
/* the book this act uses, and the numbers that make the assertion meaningful */
const BOOK = (() => {
  try {
    const all = JSON.parse(readFileSync(path.join(process.cwd(), '.velite', 'books.json'), 'utf8'))
    const b = all.find((x) => (x.canAccess || []).length > 0 && (x.chapters || 0) > (x.guestChapters ?? 3))   /* a gated book: a free one has no gate to stop at */
    return b ? { slug: b.slug, chapters: b.chapters, guestChapters: b.guestChapters ?? 3 } : null
  } catch { return null }
})()
const FIRST = (() => {
  try {
    const dir = path.join(process.cwd(), 'content', 'books')
    const f = readdirSync(dir).filter((n) => n.endsWith('.md')).sort()[0]
    if (!f) return null
    const body = readFileSync(path.join(dir, f), 'utf8').split(/^---$/m).slice(2).join('---')
    const word = (body.match(/\b[a-z]{6,}\b/) || [])[0]
    return word ? { slug: f.replace(/\.md$/, ''), word } : null
  } catch { return null }
})()
const BOOKS_ON = await moduleOn('books')

if (!BOOKS_ON || !FIRST) notHere('interaction: a word searched inside a book', BOOKS_ON ? 'the site has no book' : 'the books module is off')
else await act('a word searched inside a book finds it', async ({ page, clear }) => {
  /* The reader opens on the book's COVER page — its chrome, and so its search, exist only once
     somebody starts reading. The first version of this act looked for the search button on the
     cover, did not find it, and returned quietly as a pass: it had never run once. */
  await go(page, '/content/books/' + FIRST.slug, clear, '.rd-coverpage')
  const open = page.locator('.rd-coverpage button:visible, .rd-coverpage a:visible').first()
  await open.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { const e = new Error('the cover page offers no way into the book'); e.undone = true; throw e })
  await open.click({ force: true })
  const bar = page.locator('.rd-ico').first()
  await bar.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { throw new Error('the reader never drew its bar after the book was opened') })
  const search = page.locator('.rd-ico[aria-label*="earch" i]').first()
  await search.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { const e = new Error('this reader has no in-book search'); e.undone = true; throw e })
  await search.click()
  const box = page.locator('.rd-srch input, .rd-search input, input:visible').first()
  await box.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { throw new Error('the search opened with nowhere to type') })
  await box.fill(FIRST.word)
  /* a word that IS in this book must find something — an empty answer is the failure that matters */
  await page.waitForFunction((w) => new RegExp(w, 'i').test(document.body.innerText), FIRST.word, { timeout: WAIT })
})

/* ─── the diagnostic: a reader answers a screen ─── */

/* the diagnostic is the instrument's own rounds, which only a site that names its instrument (instrument.module) has —
   elsewhere /app is the shell, and its first button is not a round */
const QUIZ = !!((await siteUnderTest()).instrument && (await siteUnderTest()).instrument.module) && await moduleOn('instrument')
if (!QUIZ) notHere('interaction: a reader signs in and answers a diagnostic screen', 'the site names no instrument of its own (instrument.module)')
else await act('a reader signs in and answers a diagnostic screen', async ({ page, clear }) => {
  await go(page, '/', clear)
  await signIn(page, clear, 'member@example.com')
  await go(page, '/app/quiz/teachings', clear)
  const begin = page.locator('button.qopt:visible').first()   /* the round's own choice: the community's sidebar comes first on the page */
  await begin.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { throw new Error('the round did not open') })
  await begin.click({ force: true })
  const field = page.locator('input.qwordin:visible, input.qblankin:visible, textarea:visible').first()
  await field.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { throw new Error('no screen to answer') })
  await field.fill('A probe answer from the interaction lane.')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1800)
})

/* ─── the store: the bag takes a line and asks where it ships ─── */

if (!(await moduleOn('store'))) notHere('interaction: the bag', 'the store module is off')
else await act('the bag opens and asks where it ships', async ({ page, clear }) => {
  await go(page, '/store', clear, 'a[href*="/store/products/"]')
  const card = page.locator('a[href*="/store/products/"]').first()
  if (!(await card.isVisible().catch(() => false))) cannot('no product on the storefront')
  await card.click()
  await page.waitForFunction(() => location.pathname.includes('/store/products/'), { timeout: WAIT })
  await clear()
  const add = page.locator('button:visible').filter({ hasText: /add|bag|cart|buy/i }).first()
  await add.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  if (!(await add.isVisible().catch(() => false))) cannot('nothing to add on this product page')
  await add.click({ force: true })
  await page.waitForTimeout(1800)
})

/* ─── the support desk: signing in, an agent answering, and a picture ─── */

/*
 * A GUEST WHO SIGNS IN. The thread must follow them onto the account, the contact row must gain
 * its user_id, and the token must go — a guest identity left in localStorage beside a session is
 * two identities for one person, and the next sign-out would hand the account's threads to
 * whoever used the browser next.
 */
await act('a guest who signs in keeps their thread, and stops being a guest', async ({ page, clear }) => {
  const { createClient } = await import('@supabase/supabase-js')
  const cfg = statusOf()
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const LINE = 'A probe written before signing in.'

  await go(page, '/store', clear, '.sw-btn')
  await page.locator('.sw-btn').click()
  const box = page.locator('.sc-in').first()
  await box.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { const e = new Error('the panel never opened to write in'); e.undone = true; throw e })
  await box.fill(LINE)
  await page.keyboard.press('Enter')
  await page.locator('.sw-panel').getByText(LINE, { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 })

  const token = await page.evaluate(() => { try { return localStorage.getItem('dl.support.token') } catch { return null } })
  if (!token) throw new Error('the guest kept no token')

  await signIn(page, clear, 'free@example.com')
  /* the widget links the contact on its next hello */
  await page.waitForFunction(() => { try { return !localStorage.getItem('dl.support.token') } catch { return false } }, { timeout: WAIT })
    .catch(() => { throw new Error('the guest token survived the sign-in, so the device holds two identities') })

  const { data: msg } = await admin.from('support_messages').select('conversation_id').eq('body', LINE).limit(1).maybeSingle()
  if (!msg) throw new Error('the line never reached the desk')
  const { data: conv } = await admin.from('support_conversations').select('contact_id').eq('id', msg.conversation_id).maybeSingle()
  const { data: contact } = await admin.from('support_contacts').select('user_id').eq('id', conv.contact_id).maybeSingle()
  const linked = !!(contact && contact.user_id)
  /* clean up before asserting, so a failure does not also leave a guest on the budget */
  await admin.from('support_messages').delete().eq('conversation_id', msg.conversation_id)
  await admin.from('support_conversations').delete().eq('id', msg.conversation_id)
  await admin.from('support_contacts').delete().eq('id', conv.contact_id)
  if (!linked) throw new Error('the thread stayed a stranger\u2019s: support_contacts.user_id was never set')
})

/*
 * AN AGENT'S REPLY, LIVE. A contact has no row-level identity, so the desk cannot push to them
 * directly: the thread carries a secret listen key, the database broadcasts on it, and the widget
 * fetches. If that channel is down the panel falls back to polling — so what is pinned is that the
 * line ARRIVES, not how fast, and the window is generous enough to cover the poll.
 */
await act('an agent\u2019s reply reaches an open panel', async ({ page, clear }) => {
  const { createClient } = await import('@supabase/supabase-js')
  const cfg = statusOf()
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const MINE = 'A probe awaiting an answer.'
  const REPLY = 'A probe answer from the desk.'

  await go(page, '/store', clear, '.sw-btn')
  await page.locator('.sw-btn').click()
  const box = page.locator('.sc-in').first()
  await box.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { const e = new Error('the panel never opened'); e.undone = true; throw e })
  await box.fill(MINE)
  await page.keyboard.press('Enter')
  await page.locator('.sw-panel').getByText(MINE, { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 })

  const { data: msg } = await admin.from('support_messages').select('conversation_id').eq('body', MINE).limit(1).maybeSingle()
  if (!msg) throw new Error('the line never reached the desk')
  const { data: agent } = await admin.from('profiles').select('id').eq('email', 'support@example.com').maybeSingle()
  await admin.from('support_messages').insert({ conversation_id: msg.conversation_id, author: 'agent', agent_id: agent ? agent.id : null, body: REPLY })

  let arrived = true
  await page.locator('.sw-panel').getByText(REPLY, { exact: false }).first()
    .waitFor({ state: 'visible', timeout: 45000 }).catch(() => { arrived = false })

  const { data: conv } = await admin.from('support_conversations').select('contact_id').eq('id', msg.conversation_id).maybeSingle()
  await admin.from('support_messages').delete().eq('conversation_id', msg.conversation_id)
  await admin.from('support_conversations').delete().eq('id', msg.conversation_id)
  if (conv) await admin.from('support_contacts').delete().eq('id', conv.contact_id)
  if (!arrived) throw new Error('the agent\u2019s reply never appeared — neither the channel nor the poll delivered it')
})

/* ─── the admin: a person who edits the site ─── */

/*
 * THE DASHBOARD'S TABS. Seven views, one at a time, and the chosen one remembered. The remembering
 * is the half that breaks silently: an editor picks Commerce, comes back tomorrow, and is on
 * Overview again — nothing errors, nobody reports it, and the setting was never kept.
 */
await act('the dashboard remembers which view was open', async ({ page, clear }) => {
  await go(page, '/', clear, '.pageshell')
  await signIn(page, clear, 'admin@example.com')
  await go(page, '/admin/analytics', clear, '[role="tab"], .tabs button')
  const tabs = page.locator('[role="tab"], .ap-tab, .an-tab, .tabs button')
  const n = await tabs.count().catch(() => 0)
  if (!n) { const e = new Error('the analytics page drew no tab row'); e.undone = true; throw e }
  /* pick one that is not the first, so "remembered" cannot pass by landing on the default */
  const pick = tabs.nth(Math.min(2, n - 1))
  const label = (await pick.innerText()).trim()
  await pick.click()
  await page.waitForTimeout(800)
  /* come back as a new visit */
  await go(page, '/admin', clear)
  await go(page, '/admin/analytics', clear)
  const current = page.locator('[role="tab"][aria-selected="true"], .ap-tab.on, .an-tab.on, .tabs button.on').first()
  const back = await current.innerText().catch(() => '')
  if (back.trim() !== label) throw new Error(`chose "${label}", came back to "${back.trim() || 'nothing marked'}"`)
})


/* ─── the reader's gate, and what a guest carries into an account ─── */

/*
 * A GUEST PAST THE ALLOWANCE. A book lets a guest read a few chapters and then asks them to sign
 * in. Both halves matter and only one of them is visible: the gate must APPEAR, and the chapter
 * must NOT be shown behind it. A gate drawn over readable text is not a gate, and nothing about
 * the page looks wrong when that happens.
 */

if (!BOOKS_ON || !BOOK) notHere('interaction: a guest stopped past the free chapters', BOOKS_ON ? 'no book here has more chapters than a guest may read' : 'the books module is off')
else await act('a guest is stopped past the free chapters, and the text is not behind the gate', async ({ page, clear }) => {
  if (!BOOK || BOOK.chapters <= BOOK.guestChapters) { const e = new Error('no book here has more chapters than a guest is allowed'); e.undone = true; throw e }
  await go(page, '/content/books/' + BOOK.slug, clear, '.rd-coverpage')
  const open = page.locator('.rd-coverpage button:visible, .rd-coverpage a:visible').first()
  await open.waitFor({ state: 'visible', timeout: WAIT }).catch(() => { const e = new Error('the cover offers no way in'); e.undone = true; throw e })
  await open.click({ force: true })
  await page.locator('.rd-ico').first().waitFor({ state: 'visible', timeout: WAIT })

  /* turn pages until the gate appears or the book runs out */
  /* asked of the document rather than through a locator: `[class*="gate"]` also matches
     .gate-teaser and .gate-card, and .first() on that resolves to whichever comes first in the
     DOM — which was never the visible one, so the loop turned every page and found nothing. */
  /* the turn control has to exist before the loop can decide anything from its absence: checking
     too early breaks out on the first pass and reports that the book has no gate at all */
  await page.locator('.rd-turn-next').first().waitFor({ state: 'visible', timeout: WAIT })
    .catch(() => { const e = new Error('the reader drew no way to turn a page'); e.undone = true; throw e })
  let gated = false
  for (let i = 0; i < 25; i++) {
    if (await page.evaluate(() => !!document.querySelector('.gate'))) { gated = true; break }
    /* the turn control sits at the foot of the chapter, far below the fold, and `force` does not
       help: a click still needs coordinates inside the viewport. The element is asked to click
       itself, which is what the keyboard and a screen reader would do anyway. */
    const turned = await page.evaluate(() => { const b = document.querySelector('.rd-turn-next'); if (!b) return false; b.click(); return true })
    if (!turned) break
    await page.waitForTimeout(900)
  }
  /* NOT a "could not run": this book has more chapters than the allowance, so a gate MUST appear.
     Removing the allowance lets a guest read the whole of it, and reporting that as "not run"
     would hide the one failure this act exists to catch. */
  if (!gated) throw new Error(`no gate in ${BOOK.chapters} chapters though a guest is allowed ${BOOK.guestChapters} — a guest can read the whole book`)

  /* and the chapter behind it is not readable: the gate must replace the text, not cover it */
  const leaked = await page.evaluate(() => {
    const body = document.querySelector('.rd-body, .rd-page, article')
    return body ? body.innerText.trim().length : 0
  })
  if (leaked > 600) throw new Error(`the gated chapter is still in the page (${leaked} characters) — it is covered, not withheld`)
})


/*
 * SIGNING OUT LEAVES A FRESH GUEST. The next person at this browser must not inherit the last
 * one's support threads. The token going is the whole of it.
 */
await act('signing out leaves the device a fresh guest', async ({ page, clear }) => {
  await go(page, '/store', clear, '.sw-btn')
  await signIn(page, clear, 'member@example.com')
  await page.evaluate(() => { try { localStorage.setItem('dl.support.token', 'probe-token-that-should-not-survive') } catch {} })
  /* through the menu, as a person signs out — window.DLauth exposes open() and nothing else, so
     the first version of this act called a function that does not exist, signed nobody out, and
     then reported that the token had survived. */
  await page.locator('.siteavatar').first().click()
  const out = page.locator('.siteacct-menu').getByText(/sign out|log out/i).first()
  await out.waitFor({ state: 'visible', timeout: WAIT }).catch(() => { const e = new Error('the account menu offers no way to sign out'); e.undone = true; throw e })
  await out.click({ force: true })
  await page.waitForFunction(() => { try { return !localStorage.getItem('dl.support.token') } catch { return false } }, { timeout: WAIT })
    .catch(() => { throw new Error('a guest token survived the sign-out — the next person here inherits it') })
})

/* ─── the confirmed address, and what it does and does not stop ─── */

/*
 * AN UNCONFIRMED READER IS NOT STOPPED FROM THE QUIZ.
 *
 * Two promises pull in opposite directions here. The sheet waits for a confirmed address; the
 * QUIZ does not — because a reader whose link is still in the post is at the worst possible
 * moment to be stopped, and stopping them there costs the thing they came for.
 *
 * Only the second half is checked, and the reason the first is not is worth writing down rather
 * than leaving as a gap somebody assumes is covered: the sheet's gate is `answered && not
 * verified`, and `answered` is read ONCE at setup from the site's own `answered()` contract
 * rather than from the database. Whether a fresh browser has hydrated enough for it to be true is
 * timing this cannot steer from outside, so a check built on it would pass or fail by luck.
 */
if (!QUIZ) notHere('interaction: an unconfirmed reader can still take the quiz', 'the site names no instrument of its own (instrument.module)')
else await act('an unconfirmed reader can still take the quiz', async ({ page, clear }) => {
  const { createClient } = await import('@supabase/supabase-js')
  const cfg = statusOf()
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: me } = await admin.from('profiles').select('id, email_verified_at').eq('email', 'member@example.com').maybeSingle()
  if (!me) { const e = new Error('no member@example.com in the seed'); e.undone = true; throw e }
  const was = me.email_verified_at
  await admin.from('profiles').update({ email_verified_at: null }).eq('id', me.id)
  try {
    await go(page, '/', clear, '.pageshell')
    await signIn(page, clear, 'member@example.com')
    /* the address is genuinely unconfirmed for this session */
    const { data: check } = await admin.from('profiles').select('email_verified_at').eq('id', me.id).maybeSingle()
    if (check && check.email_verified_at) throw new Error('signing in confirmed the address by itself — a password session must not')

    await go(page, '/app/quiz/teachings', clear, '.pageshell')
    const begin = page.locator('button.qopt:visible').first()   /* the round's own choice: the community's sidebar comes first on the page */
    await begin.waitFor({ state: 'visible', timeout: WAIT }).catch(() => { throw new Error('an unconfirmed reader cannot start a round — they are stopped at the worst moment') })
    await begin.click({ force: true })
    const field = page.locator('input.qwordin:visible, input.qblankin:visible, textarea:visible').first()
    await field.waitFor({ state: 'visible', timeout: WAIT }).catch(() => { throw new Error('the round opened but gave them no screen to answer') })
  } finally {
    await admin.from('profiles').update({ email_verified_at: was }).eq('id', me.id)
  }
})

/*
 * A BRANCH IS NOT AN ANSWER. The desk writes an acknowledgement — "somebody will answer when they
 * can" — once the reader has actually said something. Picking a choice that only opens more
 * choices is not saying something, and acknowledging it there would promise a person an answer to
 * a menu they are still working through.
 */
/* the desk's prompts are written by the emails module (funnels.json: prompts), on the store's page */
if (!(await moduleOn('emails')) || !(await moduleOn('store'))) notHere('interaction: picking a branch on the desk\'s prompt', 'the site has no desk prompt (the emails or store module is off)')
else await act('picking a branch writes no acknowledgement until the reader has said something', async ({ page, clear }) => {
  const { createClient } = await import('@supabase/supabase-js')
  const cfg = statusOf()
  const admin = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  await go(page, '/store', clear, '.sw-btn')
  await page.locator('.sw-btn').click()
  await page.locator('.sw-panel').waitFor({ state: 'visible', timeout: WAIT }).catch(() => { const e = new Error('the panel did not open'); e.undone = true; throw e })
  /* a prompt's choices are ChatChoices (.cc-b); .sp-choice is the panel's own row of buttons
     (ask the bot / wait for a person), which is a different thing entirely */
  const choices = page.locator('.cc-b')
  await choices.first().waitFor({ state: 'visible', timeout: WAIT }).catch(() => {})
  const n = await choices.count().catch(() => 0)
  if (!n) { const e = new Error('the desk\u2019s prompt offers no choices to pick'); e.undone = true; throw e }

  /* the first choice, whatever it is — if it has follow-ups more choices appear and no thread is
     acknowledged yet; if it is a leaf the acknowledgement is correct and this act says so */
  await choices.first().click()
  await page.waitForTimeout(2500)
  const more = await page.locator('.cc-b').count().catch(() => 0)
  const token = await page.evaluate(() => { try { return localStorage.getItem('dl.support.token') } catch { return null } })

  if (token) {
    /* ITS OWN contact, by the hash of its own token — not "the newest guest", which is whichever
       act ran last and whose thread this one would then delete out from under it. The desk keeps
       sha256(token) and nothing more, so the row is found the same way the function finds it. */
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(token).digest('hex')
    const { data: c } = await admin.from('support_contacts').select('id').eq('token_hash', hash).maybeSingle()
    if (c) {
      const { data: conv } = await admin.from('support_conversations').select('id, acknowledged_at').eq('contact_id', c.id).limit(1).maybeSingle()
      const ackd = !!(conv && conv.acknowledged_at)
      /* tidy up before asserting, so a failure does not also spend a guest slot */
      if (conv) { await admin.from('support_messages').delete().eq('conversation_id', conv.id); await admin.from('support_conversations').delete().eq('id', conv.id) }
      await admin.from('support_contacts').delete().eq('id', c.id)
      if (more > 0 && ackd) throw new Error('a branch that only opened more choices was acknowledged — the reader is promised an answer to a menu')
    }
  }
  if (!more) note('(that choice was a leaf, not a branch — the acknowledgement is correct there)')
})

await browser.close()
console.log(`\n  ${pass} passed, ${fail} failed${undone.length ? ', ' + undone.length + ' NOT RUN' : ''}\n`)
if (undone.length) { console.log('  what this run did not cover:'); for (const u of undone) console.log('    · ' + u); console.log() }
/* in the end-to-end run an act that did not run is a check that did not run: a fact about the site stands down by
   notHere() before the act, and anything left here is a failure */
process.exit(fail || (process.env.PLATFORMKIT_E2E === '1' && undone.length) ? 1 : 0)
