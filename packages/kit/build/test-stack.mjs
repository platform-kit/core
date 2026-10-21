/*
 * THE STACK A TEST RUNS AGAINST, as the end-to-end runner gave it (build/e2e.mjs) — never the stack the
 * folder a test was started in happens to name (`supabase status`), and never a fixed port.
 *
 * Under the runner (PLATFORMKIT_E2E=1) every address is the run's own: the site's app, its API, its keys,
 * its database, its functions and its mail catcher. Outside it, a test run by hand reads the same names
 * from the environment it was given (the dev run's .env.dev, say), and answers "no stack" when there is
 * none — and then the test skips with a note, as it always has.
 *
 * A SKIP IN THE END-TO-END RUN IS A FAILURE. `skip()` exits non-zero there, naming what was missing: a
 * check that cannot run is not a check that passed.
 */
import { LOCAL_SERVICE_KEY } from './tts/storage.mjs'

export const isE2E = () => process.env.PLATFORMKIT_E2E === '1'
const env = (k) => (process.env[k] || '').trim()
const trim = (u) => u.replace(/\/+$/, '')
const isLocal = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/.test(trim(u))

/* the site's stack, or null */
export function stackOf() {
  const api = trim(env('PLATFORMKIT_TEST_API_URL') || env('SUPABASE_URL') || env('VITE_SUPABASE_URL'))
  if (!api || !isLocal(api)) return null
  const anon = env('PLATFORMKIT_TEST_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY')
  if (!anon) return null
  const port = Number(new URL(api).port || 54321)
  return {
    site: env('PLATFORMKIT_TEST_SITE') || null,
    api,
    anon,
    service: env('PLATFORMKIT_TEST_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY') || LOCAL_SERVICE_KEY,
    db: env('PLATFORMKIT_TEST_DB_URL') || `postgresql://postgres:postgres@127.0.0.1:${port + 1}/postgres`,
    functions: trim(env('PLATFORMKIT_TEST_FUNCTIONS_URL') || api + '/functions/v1'),
    mail: trim(env('PLATFORMKIT_TEST_MAIL_URL')) || null,
    app: trim(env('PLATFORMKIT_TEST_APP_URL') || env('VITE_APP_URL') || env('APP_URL')) || null,
  }
}

/* the shape `npx supabase status -o json` answered, for a test written against it */
export function statusOf(s = stackOf()) {
  return s ? { API_URL: s.api, ANON_KEY: s.anon, SERVICE_ROLE_KEY: s.service, DB_URL: s.db, FUNCTIONS_URL: s.functions, MAILPIT_URL: s.mail, INBUCKET_URL: s.mail } : null
}

/* a test that cannot run: a note outside the run, a failure inside it */
export function skip(name, why) {
  if (isE2E()) { console.log(`  ✖ ${name}: could not run in the end-to-end run — ${why}`); process.exit(1) }
  console.log(`  ⚠ SKIPPED — ${name}: ${why}`)
  process.exit(0)
}

/* the stack, or a skip that names it */
export function requireStack(name) {
  const s = stackOf()
  if (!s) skip(name, 'no local stack (run it under `platformkit test --e2e`, or with a dev stack\'s env)')
  return s
}

/*
 * NOT ON THIS SITE — the one way a check may stand down in the end-to-end run: the site under test does not have
 * the thing it checks (a module off, no LiveKit account, no enrichment briefs), so there is nothing to check here,
 * and another site's run covers it. It prints a fixed marker the runner accepts; anything else that does not run
 * — no stack, no secret, no service — is a failure there. Use it only for a fact about the SITE, never about the
 * machine.
 */
export const NOT_HERE = 'not on this site'
export function notHere(name, why) {
  console.log(`  — ${name}: ${NOT_HERE} (${why})`)
}

/*
 * LEAVING EARLY. Every early exit of a stack-backed test goes through here (build/test-coverage.test.mjs holds it):
 * outside the end-to-end run it exits as asked, which is how a test run by hand on a machine with no stack has
 * always stood down; inside the run, an early exit is a check that did not run, and fails.
 */
export function leave(code = 0) {
  if (isE2E() && !code) { console.log('  ✖ left before its end in the end-to-end run — a check that did not run is a failure'); process.exit(1) }
  process.exit(code)
}

/*
 * WHETHER THE SITE UNDER TEST HAS A MODULE ON (on unless its config says false), for a check about one module inside a
 * test that runs everywhere: on a site with the module off it stands down by notHere(), and another site's run covers it.
 */
let siteConfig = null
export async function siteUnderTest() {
  if (!siteConfig) { const { loadSite } = await import('./site.mjs'); siteConfig = await loadSite(process.cwd()) }
  return siteConfig
}
export async function moduleOn(key) {
  return ((await siteUnderTest()).modules || {})[key] !== false
}
