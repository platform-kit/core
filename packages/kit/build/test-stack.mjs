/*
 * THE STACK A TEST RUNS AGAINST, as the end-to-end runner gave it (build/e2e.mjs) — never the stack the
 * folder a test was started in happens to name (`supabase status`), and never a fixed port.
 *
 * Under the runner (PLATFORMKIT_E2E=1) every address is the run's own: the site's app, its API, its keys,
 * its database, its functions and its mail catcher, on a fresh `pk_<site>_e2e` stack. Outside it there is no
 * stack, whatever the environment names (a dev run's .env.dev included), and the test skips with a note. Run one
 * by itself with `platformkit test --e2e --run <script>`. test-guard.mjs makes the same true of every other way a
 * test could reach a database.
 *
 * A SKIP IN THE END-TO-END RUN IS A FAILURE. `skip()` exits non-zero there, naming what was missing: a
 * check that cannot run is not a check that passed.
 */
import { LOCAL_SERVICE_KEY } from './tts/storage.mjs'
import { notTheTestStack, refuse } from './test-guard.mjs'

export const isE2E = () => process.env.PLATFORMKIT_E2E === '1'
const env = (k) => (process.env[k] || '').trim()
const trim = (u) => u.replace(/\/+$/, '')
const isLocal = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/.test(trim(u))

/* the run's stack as the runner wrote it, unverified: for this helper's own test of its shape, and nothing else
   (test-coverage.test.mjs holds every other test to stackOf) */
export function runStackFrom(e = process.env) {
  const get = (k) => (e[k] || '').trim()
  const api = trim(get('PLATFORMKIT_TEST_API_URL'))
  const anon = get('PLATFORMKIT_TEST_ANON_KEY')
  if (!api || !isLocal(api) || !anon) return null
  return {
    site: get('PLATFORMKIT_TEST_SITE') || null,
    api,
    anon,
    service: get('PLATFORMKIT_TEST_SERVICE_ROLE_KEY') || LOCAL_SERVICE_KEY,
    db: get('PLATFORMKIT_TEST_DB_URL') || `postgresql://postgres:postgres@127.0.0.1:${Number(new URL(api).port || 54321) + 1}/postgres`,
    functions: trim(get('PLATFORMKIT_TEST_FUNCTIONS_URL') || api + '/functions/v1'),
    mail: trim(get('PLATFORMKIT_TEST_MAIL_URL')) || null,
    app: trim(get('PLATFORMKIT_TEST_APP_URL')) || null,
  }
}

/* THE SITE'S STACK: only inside the end-to-end run, only the one it built, and only once Docker says both its API and its
   database are end-to-end containers (test-guard.mjs). Outside the run there is none, so the test skips; a stack that
   is not the run's own ends the test. A dev stack's address in the environment is never read. */
export function stackOf() {
  if (!isE2E()) return null
  const s = runStackFrom()
  if (!s) return null
  const why = notTheTestStack(s.api) || notTheTestStack(s.db, { what: 'database' })
  if (why) refuse(why)
  return s
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
  if (!s) skip(name, 'no stack: stack tests run only on the end-to-end run\'s own stack (`platformkit test --e2e`, or `--run <script>` for one)')
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
