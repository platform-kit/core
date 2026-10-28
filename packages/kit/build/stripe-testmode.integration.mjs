import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const buildRoot = path.dirname(fileURLToPath(import.meta.url))
const kitRoot = path.dirname(buildRoot)
const [environmentFile] = process.argv.slice(2)
const configured = environmentFile
  ? parseEnv(readFileSync(path.resolve(environmentFile), 'utf8'))
  : process.env
const secretKey = configured.STRIPE_SECRET_KEY
if (!secretKey?.startsWith('sk_test_')) {
  throw new Error('Stripe integration tests require a Stripe test-mode secret key (sk_test_); no request was sent.')
}

const testFile = path.join(buildRoot, 'stripe-testmode.integration.test.ts')
const result = spawnSync('deno', [
  'test',
  '--node-modules-dir=false', // npm: imports from Deno's own cache: Deno 2 otherwise looks for them in the package's node_modules
  '--no-lock', // and writes no deno.lock into the checkout
  '--allow-net=api.stripe.com',
  '--allow-env=STRIPE_SECRET_KEY',
  testFile,
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
    /* where the browser is, for the step that opens one (build/stripe-3ds-complete.mjs) */
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
    PLAYWRIGHT_CHROMIUM_PATH: process.env.PLAYWRIGHT_CHROMIUM_PATH,
    STRIPE_SECRET_KEY: secretKey,
  },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
