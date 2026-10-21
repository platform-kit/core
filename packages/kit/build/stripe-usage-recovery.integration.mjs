/*
 * Real Stripe test-mode coverage of an incremental usage charge's recovery: action required, the
 * customer's 3-D Secure verification, an uncertain retry, and a decline retried as a new attempt.
 *
 *   node build/stripe-usage-recovery.integration.mjs /path/to/private-stripe-test.env
 *
 * The file needs a test-mode STRIPE_SECRET_KEY; anything else is refused before a request is sent.
 * The verification step runs Stripe's test 3-D Secure page in a headless Chromium
 * (build/stripe-3ds-complete.mjs); set PLAYWRIGHT_CHROMIUM_EXECUTABLE when Playwright's own build is
 * not installed.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const buildRoot = path.dirname(fileURLToPath(import.meta.url))
const kitRoot = path.dirname(buildRoot)
const [environmentFile] = process.argv.slice(2)
const configured = environmentFile ? parseEnv(readFileSync(path.resolve(environmentFile), 'utf8')) : process.env
const secretKey = configured.STRIPE_SECRET_KEY
if (!secretKey?.startsWith('sk_test_')) {
  throw new Error('Stripe integration tests require a Stripe test-mode secret key (sk_test_); no request was sent.')
}

const result = spawnSync('deno', [
  'test',
  '--allow-net=api.stripe.com',
  '--allow-env=STRIPE_SECRET_KEY',
  '--allow-read=' + buildRoot,
  '--allow-run=node',
  path.join(buildRoot, 'stripe-usage-recovery.integration.test.ts'),
], {
  cwd: kitRoot,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DENO_DIR: process.env.DENO_DIR,
    TMPDIR: process.env.TMPDIR,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
    ALL_PROXY: process.env.ALL_PROXY,
    NO_PROXY: process.env.NO_PROXY,
    PLAYWRIGHT_CHROMIUM_EXECUTABLE: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_PATH,
    STRIPE_SECRET_KEY: secretKey,
  },
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
