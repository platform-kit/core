/*
 * SIGNED IN AS EACH KIND OF PERSON, IN A REAL BROWSER — what they SEE and what they can DO.
 *
 * `who-can.test.mjs` asks the database what each kind of person may do. This asks the SITE, and the
 * two can disagree in both directions, each costing something different.
 *
 *   THE DOOR OPEN AND THE BUTTON HIDDEN — a leak. Nothing in the interface offers it, so nobody
 *   notices, and it is reachable by typing the address. That is the shape the `is_staff()` leak
 *   had. So every "must not reach" below is a DIRECT NAVIGATION, never a look at the nav: a
 *   missing link proves nothing about a missing lock.
 *
 *   THE DOOR SHUT AND THE BUTTON SHOWN — a person clicking something that then refuses them. Less
 *   dangerous, more insulting, and invisible to a policy test, because the policy is right; it is
 *   the page that is wrong.
 *
 * THE PROPERTY THIS PINS. The admin is one shell of many sections, and a person who asks for a
 * section they may not have is DIVERTED to the first section they may — never shown the one they
 * asked for, never shown an empty frame, never shown a blank page. So for each person, every
 * section address is visited and the section actually SHOWN is read off the page; what is asserted
 * is the SET they can land on. A leak is a section in somebody's set that should not be there, and
 * that is one assertion rather than a list of forbidden strings.
 *
 * And each of them then DOES the thing their role is for, in the interface, with a control or a
 * row that has to actually be there — because a section that renders its title and nothing else
 * would pass every check above.
 *
 * It needs a dev server and the local stack, and skips loudly rather than passing quietly.
 *
 *   node packages/kit/build/signed-in-as.test.mjs
 */
import { execSync } from 'node:child_process'
import { launch, context as browserContext, WAIT } from './browser.mjs'
import { statusOf, leave, stackOf } from './test-stack.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✔ ' + name) } else { fail++; console.log('  ✖ ' + name + (detail ? '\n      ' + detail : '')) } }

console.log('\nSIGNED IN AS EACH KIND OF PERSON\n')

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const skip = (why) => { console.log('  ⚠ SKIPPED — ' + why + '\n    What each kind of person SEES AND DOES in the site is NOT covered by this run.\n'); leave(0) }

const BASE = argOf('--url', process.env.INTERACTION_URL || stackOf()?.app || '')
try { const r = await fetch(BASE, { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw new Error(String(r.status)) }
catch { skip(`nothing is serving the site at ${BASE} (npm run dev)`) }
try { if (!statusOf()) throw new Error('no stack') } catch { skip('no local stack is up (npx supabase start)') }

/* the addresses a staff member might type. `people` is an administrator's alone; `notifications`
   every staff member's, which is what makes a diversion visible rather than a refusal */
const SECTIONS = ['/admin/support', '/admin/analytics', '/admin/articles', '/admin/people', '/admin/notifications']

const browser = await launch()
const open = async () => {
  const ctx = await browserContext(browser, { viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 160)))
  return { ctx, page, errs }
}
const ready = async (page, path) => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0, { timeout: WAIT })
}
const signIn = async (page, email) => {
  await page.evaluate(() => window.DLauth && window.DLauth.open({}))
  await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: WAIT })
  /* each value taken by Vue before the next is typed, as interaction.test.mjs does: filled back to back under load, the
     form went up with the email still empty and the password field never left (a minute's wait, then a failure) */
  await page.locator('input[type="email"]').first().fill(email)
  await page.waitForFunction((v) => document.querySelector('input[type="email"]')?.value === v, email, { timeout: WAIT })
  await page.locator('input[type="password"]').first().fill('password123')
  await page.waitForFunction(() => document.querySelector('input[type="password"]')?.value === 'password123', null, { timeout: WAIT })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: WAIT })
}
/*
 * WHICH SECTION THE SHELL ACTUALLY SHOWED. The rail is no use — its groups collapse, so a section
 * a person HAS can be absent from the rail's words. The page says it itself: the shell's own body
 * opens with the section's title, right after the rail's last item.
 */
const landed = async (page, path) => {
  await ready(page, path)
  await page.waitForFunction(() => /Back to site/.test(document.body.innerText), { timeout: WAIT }).catch(() => {})
  await page.waitForTimeout(2600)
  return page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, ' ')
    if (/not on the staff|for the team only/i.test(t)) return 'refused'
    const m = t.match(/Back to site\s+(.{0,40})/)
    const head = (m ? m[1] : '').trim()
    for (const s of ['Support', 'Content analytics', 'Analytics', 'Articles', 'People', 'Pages', 'Notifications'])
      if (head.startsWith(s)) return s === 'Content analytics' ? 'Analytics' : s
    return 'unknown:' + head.slice(0, 24)
  })
}

/*
 * THE PEOPLE. `sees` is the whole set of admin sections they may land on across every address
 * above — so a section missing from it is asserted unreachable BY ADDRESS, which is the leak
 * question. `does` is one thing their role exists for, carried out in the interface.
 */
const PEOPLE = [
  { who: 'free', email: 'free@example.com', sees: ['refused'],
    why: 'somebody with no role must be told plainly, at every address, not shown an empty desk' },
  { who: 'provider', email: 'coach@example.com', sees: ['Pages', 'Notifications'],
    does: { at: '/admin/notifications', find: null, text: /the moment/i, what: 'a switch to be told things by' },
    why: 'a provider sells their time and keeps the page that sells it; the desk, the figures and the rest of the writing are not theirs' },
  { who: 'editor', email: 'editor@example.com', sees: ['Articles', 'Notifications'],
    does: { at: '/admin/articles', find: '.ag-row', least: 2, what: 'the articles to edit' },
    why: 'an editor writes; the desk and the figures are not theirs' },
  { who: 'analyst', email: 'analyst@example.com', sees: ['Analytics', 'Notifications'],
    does: { at: '/admin/analytics', find: null, text: /on the site/i, what: 'a figure' },
    why: 'the analyst exists for the figures and nothing else' },
  { who: 'support', email: 'support@example.com', sees: ['Support', 'Notifications'],
    does: { at: '/admin/support', find: '.su-list', least: 1, what: 'the people who have written in' },
    why: 'the desk is theirs; the figures and the writing are not' },
  { who: 'admin', email: 'admin@example.com', sees: ['Support', 'Analytics', 'Articles', 'People', 'Notifications'],
    does: { at: '/admin/support', find: '.su-list', least: 1, what: 'the desk, like anybody on it' },
    why: 'an administrator reaches every section' },
]

for (const p of PEOPLE) {
  const { ctx, page, errs } = await open()
  try {
    await ready(page, '/')
    await signIn(page, p.email)

    /* every address in turn, and what the shell actually put in front of them */
    const got = []
    for (const s of SECTIONS) got.push(await landed(page, s))
    const set = [...new Set(got)].sort()

    ok(`${p.who}: reaches exactly ${p.sees.join(' · ')}`, set.join('|') === [...p.sees].sort().join('|'),
      `it reached ${set.join(' · ')} — ${p.why}\n      (by address: ${SECTIONS.map((s, i) => s.replace('/admin/', '') + '→' + got[i]).join(', ')})`)

    /* nothing unknown and nothing blank: a diversion must land on a real section */
    ok(`${p.who}: every address lands on a real section`, !set.some((s) => s.startsWith('unknown')), set.join(' · '))

    /* AND DOES the thing their role is for */
    if (p.does) {
      await ready(page, p.does.at)
      await page.waitForTimeout(3200)
      const done = p.does.find
        ? await page.evaluate((sel) => document.querySelectorAll(sel).length, p.does.find).then((n) => n >= (p.does.least ?? 1))
        : p.does.text.test(await page.evaluate(() => document.body.innerText))
      ok(`${p.who}: and is given ${p.does.what}`, done, `${p.does.at} drew none`)
    }

    /* whoever they are, they are still a reader: the site itself works for them */
    await ready(page, '/content')
    /* the library's own links, as the guest's check below reads it: an Everything tab is drawn only where a site has several collections */
    await page.waitForFunction(() => document.querySelectorAll('a[href*="/content/"]').length > 0, { timeout: WAIT }).catch(() => {})
    ok(`${p.who}: can still read the library`, await page.evaluate(() => document.querySelectorAll('a[href*="/content/"]').length > 0))

    ok(`${p.who}: nothing threw while they used the site`, errs.length === 0, errs.slice(0, 2).join(' | '))
  } catch (e) {
    fail++; console.log(`  ✖ ${p.who} — ${String(e.message || e).split('\n')[0].slice(0, 200)}`)
  } finally { await ctx.close() }
}

/* ─── and a guest, who has no session at all ─── */
{
  const { ctx, page, errs } = await open()
  try {
    const got = []
    for (const s of SECTIONS) got.push(await landed(page, s))
    ok('guest: the admin shows nobody a section', ![...new Set(got)].some((x) => /^(Support|Analytics|Articles|People|Notifications)$/.test(x)),
      [...new Set(got)].join(' · '))
    await ready(page, '/content')
    await page.waitForFunction(() => /Everything/i.test(document.body.innerText), { timeout: WAIT }).catch(() => {})
    ok('guest: can still read the library', await page.evaluate(() => document.querySelectorAll('a[href*="/content/"]').length > 0))
    ok('guest: nothing threw', errs.length === 0, errs.slice(0, 2).join(' | '))
  } catch (e) {
    fail++; console.log(`  ✖ guest — ${String(e.message || e).split('\n')[0].slice(0, 200)}`)
  } finally { await ctx.close() }
}

await browser.close()
console.log(`\n  ${pass} passed, ${fail} failed — ${PEOPLE.length + 1} kinds of person, in a browser\n`)
process.exit(fail ? 1 : 0)
