/*
 * Plays the customer on Stripe's test-mode 3-D Secure page: opens the redirect a PaymentIntent's
 * next_action names, presses "Complete" (or "Fail" with --fail) in the test issuer's frame, and waits
 * for the return URL. Used by stripe-usage-recovery.integration.test.ts; it talks only to Stripe's
 * test-mode pages and prints nothing but the outcome.
 *
 *   node build/stripe-3ds-complete.mjs <redirect-url> <return-url-prefix> [--fail]
 *
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE names a Chromium build when Playwright's own is not installed.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const [redirectUrl, returnPrefix, flag] = process.argv.slice(2)
if (!redirectUrl?.startsWith('https://hooks.stripe.com/') || !returnPrefix) {
  throw new Error('Usage: node build/stripe-3ds-complete.mjs <https://hooks.stripe.com/… redirect> <return-url-prefix> [--fail]')
}
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json'))
const { chromium } = require('playwright-core')
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
const browser = await chromium.launch({ executablePath })
try {
  const page = await browser.newPage()
  /* the return URL is the caller's, and need not exist: arriving at it is the outcome, so it is answered here */
  await page.route((url) => url.href.startsWith(returnPrefix), (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'returned' }))
  await page.goto(redirectUrl, { waitUntil: 'networkidle' })
  const button = flag === '--fail' ? '#test-source-fail-3ds' : '#test-source-authorize-3ds'
  let pressed = false
  for (let attempt = 0; attempt < 40 && !pressed; attempt++) {
    for (const frame of page.frames()) {
      if (!frame.url().startsWith('https://testmode-acs.stripe.com/')) continue
      const handle = await frame.$(button)
      if (handle) { await handle.click(); pressed = true; break }
    }
    if (!pressed) await page.waitForTimeout(250)
  }
  if (!pressed) throw new Error('The 3-D Secure test page showed no Complete/Fail button.')
  await page.waitForURL((url) => url.href.startsWith(returnPrefix), { timeout: 30_000 })
  console.log(flag === '--fail' ? 'failed' : 'completed')
} finally {
  await browser.close()
}
