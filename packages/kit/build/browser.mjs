/*
 * EVERY BROWSER THIS REPOSITORY OPENS, WITH ONE TIMEOUT.
 *
 * Playwright's own default is 30 seconds, and it applies to any call given no explicit budget. So
 * a file that carefully writes `{ timeout: 60000 }` on the waits it thought about still runs every
 * other call at 30 — and under load, which is exactly when a suite is slowest, the ones nobody
 * wrote a number on are the ones that fail. That cost an afternoon: an act of the interaction lane
 * failed at 30s inside `npm test` while every wait written in the file said 60, and the reported
 * failure was of the surface under test rather than of the clock.
 *
 * Two numbers is the fault. There is one here, it is a MINIMUM, and a caller that genuinely needs
 * longer for one call still passes its own `{ timeout }` — this only lifts the floor.
 *
 * `build/manifests.test.mjs` refuses a `newContext` anywhere else, so a file written next year
 * cannot quietly inherit the 30 back.
 */

/* one number, overridable for a slow machine or a CI box, never per file */
export const WAIT = Number(process.env.BROWSER_WAIT_MS || process.env.INTERACTION_WAIT_MS || 60000)

/*
 * A CONTEXT WITH THE FLOOR SET. Both defaults, because navigation has its own and a page that
 * takes 40 seconds to load fails on the navigation timeout before any wait of ours is reached.
 */
export async function context(browser, opts = {}) {
  const ctx = await browser.newContext(opts)
  ctx.setDefaultTimeout(WAIT)
  ctx.setDefaultNavigationTimeout(WAIT)
  return ctx
}

/* and a page straight out of a fresh context, which is what most callers want */
export async function page(browser, opts = {}) {
  const ctx = await context(browser, opts)
  return { ctx, page: await ctx.newPage() }
}

/*
 * THE BROWSER ITSELF, so `PLAYWRIGHT_CHROMIUM_PATH` is read in one place rather than in fourteen —
 * a machine where the bundled build is not installed names its own, and a file that forgot to look
 * simply cannot launch there.
 */
export async function launch(opts = {}) {
  const { chromium } = await import('playwright')
  return chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, ...opts })
}
