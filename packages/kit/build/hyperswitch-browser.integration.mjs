/*
 * Real-browser end-to-end test of the Hyperswitch checkout against a local V2 Router, Card Vault,
 * self-hosted Web SDK, and the fake processor (a test double; it says nothing about Stripe).
 *
 *   node build/hyperswitch-browser.integration.mjs /path/to/private.json
 *
 * The private JSON names the running stack and never leaves the machine:
 *   HYPERSWITCH_BASE_URL          loopback origin the browser and the adapter use for the Router. The SDK
 *                                 only allows certain loopback origins in its policy, e.g. http://127.0.0.1:8080
 *   HYPERSWITCH_API_KEY, HYPERSWITCH_PROFILE_ID, HYPERSWITCH_PUBLISHABLE_KEY, HYPERSWITCH_WEBHOOK_SECRET
 *   HYPERSWITCH_CLIENT_URL        the self-hosted SDK base URL
 *   HYPERSWITCH_PAYMENT_METHODS_PREFIX   optional, v1 by default; must match the Router
 *   SITE_URL                      optional running site; otherwise the built demo is served on a free port
 *   FAKE_PROCESSOR_PORT           optional, 12111
 * The profile's Stripe connector must point at the fake processor from the Router's side
 * (`stripe.base_url`, e.g. http://host.docker.internal:12111/ for a Dockerised Router).
 *
 * It pays a card entered in the SDK fields, retrieves the payment as paid, checks the one-time card was
 * deleted, refunds it, and then checks that a declined card leaves the checkout on screen with its
 * error. It also asserts that no request to the site carried the card number.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startFakeProcessor } from './hyperswitch-fake-processor.mjs'

const [configFile] = process.argv.slice(2)
if (!configFile) {
  throw new Error('Usage: node build/hyperswitch-browser.integration.mjs /path/to/private.json')
}
const configuration = JSON.parse(readFileSync(path.resolve(configFile), 'utf8'))
for (const name of [
  'HYPERSWITCH_BASE_URL', 'HYPERSWITCH_API_KEY', 'HYPERSWITCH_PROFILE_ID',
  'HYPERSWITCH_PUBLISHABLE_KEY', 'HYPERSWITCH_WEBHOOK_SECRET', 'HYPERSWITCH_CLIENT_URL',
]) {
  if (typeof configuration[name] !== 'string' || !configuration[name]) {
    throw new Error(`The browser test configuration is missing ${name}.`)
  }
}
const router = new URL(configuration.HYPERSWITCH_BASE_URL)
if (router.protocol !== 'http:' || router.hostname !== '127.0.0.1') {
  throw new Error('The browser test accepts only a loopback HTTP Router origin at 127.0.0.1.')
}

const here = path.dirname(fileURLToPath(import.meta.url))
const demoDir = path.resolve(here, '../../../sites/demo')
const stepsFile = path.join(here, 'hyperswitch-browser.steps.ts')
const PAN = '4242424242424242'
const DECLINED_PAN = '4000000000000002'
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const fake = await startFakeProcessor(Number(configuration.FAKE_PROCESSOR_PORT || 12111))
let preview
let siteUrl = configuration.SITE_URL
if (!siteUrl) {
  const port = 5190 + Math.floor(Math.random() * 500)
  preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: demoDir, stdio: 'ignore',
  })
  siteUrl = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(siteUrl)).ok) break } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
const siteOrigin = new URL(siteUrl).origin

const deno = (args) => {
  const result = spawnSync('deno', [
    'run', '--allow-net', '--allow-env', stepsFile, ...args,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...Object.fromEntries(Object.entries(configuration).filter(([, value]) => typeof value === 'string')),
      SITE_URL: siteOrigin,
    },
  })
  if (result.status !== 0) throw new Error(`deno step failed: ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout.trim().split('\n').pop())
}

const { launch, context: browserContext } = await import('./browser.mjs')
const browser = await launch()

async function checkout(card) {
  const seeded = deno(['seed'])
  const context = await browserContext(browser)
  const page = await context.newPage()
  const siteBodies = []
  context.on('request', (request) => {
    if (new URL(request.url()).origin === siteOrigin) siteBodies.push(`${request.url()} ${request.postData() ?? ''}`)
  })
  await page.goto(siteUrl, { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), {
    key: `platformkit:hyperswitch-checkout:${seeded.checkoutId}`,
    value: {
      ...seeded.client,
      expiresAt: Date.now() + 10 * 60 * 1000,
      summary: {
        mode: 'payment', currency: 'USD', amountTotalMinor: 100, amountDueMinor: 100,
        items: [{ name: 'Browser end-to-end test', quantity: 1, unitAmountMinor: 100, amountMinor: 100, billing: 'once' }],
      },
    },
  })
  await page.goto(`${siteUrl}/checkout/hyperswitch?session=${encodeURIComponent(seeded.checkoutId)}`, { waitUntil: 'domcontentloaded' })
  const fields = page.frameLocator('iframe').first().frameLocator('iframe').first()
  const type = async (name, text) => {
    const box = fields.getByRole('textbox', { name })
    await box.click({ timeout: 30000 })
    await box.pressSequentially(text, { delay: 25 })
  }
  await type(/Card Number/, card)
  await type(/Expiry/, '1230')
  await type(/CVC/, '123')
  await page.getByRole('button', { name: 'Pay securely' }).click()
  return { seeded, context, page, siteBodies }
}

try {
  const paid = await checkout(PAN)
  let reachedSuccess = false
  try {
    await paid.page.waitForURL(/\/thanks/, { timeout: 45000 })
    reachedSuccess = true
  } catch { /* reported below */ }
  check('a paid card returns to the success page', reachedSuccess, paid.page.url())
  check('no request to the site carried the card number', !paid.siteBodies.some((body) => body.includes(PAN)))
  const finished = deno(['finish', paid.seeded.checkoutId, paid.seeded.customerId])
  check('retrieval reports the payment paid', finished.paymentState === 'paid', String(finished.paymentState))
  check('the one-time card was deleted', finished.savedMethods === 0, `${finished.savedMethods} saved`)
  check('the refund succeeded', finished.refundStatus === 'succeeded', String(finished.refundStatus))
  await paid.context.close()

  const declined = await checkout(DECLINED_PAN)
  let alertText = ''
  try {
    alertText = await declined.page.getByRole('alert').first().innerText({ timeout: 45000 })
  } catch { /* reported below */ }
  check('a declined card shows the checkout error', /could not be completed/i.test(alertText), alertText)
  check('a declined card stays on the checkout', declined.page.url().includes('/checkout/hyperswitch'))
  check('no request to the site carried the declined card number', !declined.siteBodies.some((body) => body.includes(DECLINED_PAN)))
  await declined.context.close()
} finally {
  await browser.close()
  await fake.stop()
  preview?.kill()
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nhyperswitch browser test: all checks passed')
process.exitCode = failures.length ? 1 : 0
