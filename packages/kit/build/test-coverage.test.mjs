/*
 * NOTHING IS UNTESTED BY CONSTRUCTION (openspec: test-environment, "Nothing is untested by construction").
 *
 * Three rules, each one a way the suite used to go green over something nobody had run:
 *
 *   1. EVERY FUNCTION IS NAMED BY A TEST. A function under supabase/functions that no test calls is a function
 *      nothing has shown boots — five did not, behind a green suite, for want of an import.
 *   2. A TEST LEAVES EARLY ONLY THROUGH THE HELPER. A stack-backed test that exits before its end must do it by
 *      `skip()` (a failure in the end-to-end run) or after `notHere()` (a declared fact about the site), or for its
 *      own `<NAME>_TEST=0` switch. Any other early `process.exit` is a pass that checked nothing — storefront-api
 *      printed "2 passed (the shapes …)" and left, for as long as its function could not boot.
 *   2b. A TEST THAT REACHES A STACK TAKES IT FROM test-stack.mjs, and never from `supabase status` or a fixed port —
 *      the import is how the end-to-end run finds it, so one without it is never run there.
 *   3. EVERY CLAIM NAMES A TEST THAT RUNS. A specification's "Verified by" that names a test file names one that
 *      exists and is registered to run.
 *
 * The runner adds the fourth, at run time: every function was CALLED during the end-to-end run (build/e2e.mjs).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIT = path.resolve(HERE, '..')
const WORKSPACE = path.resolve(KIT, '../..')
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? '\n        ' + String(detail).split('\n').join('\n        ') : '')) } }

const tests = fs.readdirSync(HERE).filter((f) => /\.(test|integration)\.mjs$/.test(f) && f !== 'test-coverage.test.mjs')
const source = Object.fromEntries(tests.map((f) => [f, fs.readFileSync(path.join(HERE, f), 'utf8')]))

/* ─── 1. every function is named by a test ─── */
const FN_DIR = path.join(KIT, 'supabase', 'functions')
const functions = fs.readdirSync(FN_DIR).filter((d) => !d.startsWith('_') && fs.statSync(path.join(FN_DIR, d)).isDirectory())
const callsFunctions = /functions\/v1|FUNCTIONS_URL|\bFN\b|\.functions\b/
const namedBy = (fn) => Object.entries(source).filter(([, s]) => callsFunctions.test(s) && new RegExp(`functions/v1/${fn}\\b|['"\`/]${fn}['"\`?/]`).test(s)).map(([f]) => f)
const untested = functions.filter((fn) => !namedBy(fn).length)
ok(`every function is named by a test (${functions.length - untested.length} of ${functions.length})`, !untested.length, untested.join(', '))

/* ─── 2. a stack test leaves early only through the helper ─── */
const STACK = /from '\.\/test-stack\.mjs'|supabaseUrl\(\)|localStack\(\)|supabase status|statusOf\(|stackOf\(|requireStack\(|PLATFORMKIT_TEST_API_URL/
/* an exit with failure hides nothing; only an exit that can come out as a pass is held to the helper */
const allowed = (line, before) => /_TEST === '0'|notHere\(/.test(line) || /notHere\(/.test(before) || /process\.exit\(\s*[1-9]\d*\s*\)/.test(line)
const early = []
for (const [f, s] of Object.entries(source)) {
  if (!STACK.test(s)) continue
  const lines = s.split('\n')
  const exits = lines.map((l, i) => [l, i]).filter(([l]) => /process\.exit\(/.test(l) && !/^\s*(\/\/|\*)/.test(l))
  for (const [l, i] of exits.slice(0, -1)) if (!allowed(l, lines[i - 1] || '')) early.push(`${f}:${i + 1}  ${l.trim().slice(0, 110)}`)
}
ok('no stack test leaves early with a pass except through skip() or notHere()', !early.length, `${early.length} early exit(s):\n` + early.slice(0, 40).join('\n') + (early.length > 40 ? `\n… and ${early.length - 40} more` : ''))

/* and every Deno test is one test.mjs runs (DENO_TESTS) — two ran nowhere before */
{
  const runnerText = fs.readFileSync(path.join(HERE, 'test.mjs'), 'utf8')
  const listed = new Set([...(/DENO_TESTS = \[([^\]]*)\]/.exec(runnerText)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]))
  const deno = fs.readdirSync(HERE).filter((f) => /\.test\.ts$/.test(f))
  /* or driven by a wrapper test.mjs registers (the live integrations: stripe-testmode.integration.mjs runs its .test.ts) */
  const runs = new Set([...runnerText.matchAll(/\['([\w.-]+\.(?:test|integration)\.mjs)'/g)].map((m) => m[1]))
  const wrapped = (f) => fs.readdirSync(HERE).some((w) => /\.(test|integration)\.mjs$/.test(w) && runs.has(w) && fs.readFileSync(path.join(HERE, w), 'utf8').includes(f))
  const unrun = deno.filter((f) => !listed.has(f) && !wrapped(f))
  ok('every Deno test is run by test.mjs', !unrun.length, unrun.join(', '))
}

/* ─── 2b. a test that reaches a stack says so, and names no fixed one ───
   The run finds its tests by their import of build/test-stack.mjs. A test that talks to a database, a function or
   the stack's API without it is never given the run's stack: it ran in `npm test` against whatever answered on the
   dev ports, and passed on nothing when nothing did (print-cloud, for as long as it existed). */
const REACHES = /createClient\(|from 'pg'|new pg\.|functions\/v1\/|supabase status|'status', '-o'|process\.env\.SUPABASE_URL|:5432\d\b/
/* tests that name such things as DATA — an address in an assertion, an env given to a child, a container's own
   database — and reach no stack of the site's; each with why */
const NOT_A_STACK = {
  'assets.test.mjs': 'storage addresses as strings to parse',
  'content-refresh.test.mjs': 'an env handed to a function it imports',
  'share-cloud.test.mjs': 'a container\'s environment',
  'sites-host.test.mjs': 'nginx templates and their env',
  'site-module.test.mjs': 'a webhook path in a registration',
  'site-payment-provider.test.mjs': 'a webhook path in a registration',
  'cron-registration.test.mjs': 'a throwaway Postgres container of its own',
  'schema.test.mjs': 'a throwaway database of its own, run by the end-to-end run (E2E_ALSO)',
  'e2e-runner.test.mjs': 'runs the runner itself, which builds the stacks (CI\'s e2e job)',
}
/* the mark test.mjs finds stack tests by (STACK_SOURCE): the helper, or the storage helpers that read the run's SUPABASE_URL */
const marked = (s) => /from '\.\/test-stack\.mjs'|supabaseUrl\(\)|localStack\(\)/.test(s)
const unmarked = Object.entries(source).filter(([f, s]) => REACHES.test(s) && !marked(s) && !NOT_A_STACK[f]).map(([f]) => f)
ok('every test that reaches a stack takes it from test-stack.mjs', !unmarked.length, unmarked.join(', '))
const staleNot = Object.keys(NOT_A_STACK).filter((f) => !source[f] || marked(source[f]))
ok('no test is excused as reaching no stack when it is gone or takes one', !staleNot.length, staleNot.join(', '))
/* a fallback to the dev ports (the stack's 543xx, the app's 5173) is a test that runs against whatever is there when the run's stack is not given */
const FIXED = /(\|\||\?\?)\s*['"`][^'"`]*(127\.0\.0\.1|localhost):(5\d{4}|5173)\b|supabase status|'status', '-o'/
const fixed = Object.entries(source).filter(([f, s]) => marked(s)).flatMap(([f, s]) => s.split('\n').map((l, i) => [l, i]).filter(([l]) => FIXED.test(l) && !/^\s*(\/\/|\*)/.test(l)).map(([l, i]) => `${f}:${i + 1}  ${l.trim().slice(0, 110)}`))
ok('no stack test reads `supabase status` or falls back to a fixed port', !fixed.length, fixed.join('\n'))

/* every browser launch honours PLAYWRIGHT_CHROMIUM_PATH (or goes through browser.mjs, which does): a machine where
   Playwright's own build is not installed names its own, and a launch that ignores it fails there — six did */
{
  const launches = fs.readdirSync(HERE).filter((f) => f.endsWith('.mjs') && f !== 'browser.mjs').flatMap((f) => fs.readFileSync(path.join(HERE, f), 'utf8').split('\n').map((l, i) => [f, l, i]).filter(([, l]) => /chromium\.launch\(/.test(l) && !/PLAYWRIGHT_CHROMIUM_PATH|executablePath: exe\b|\{ executablePath \}/.test(l)).map(([f, l, i]) => `${f}:${i + 1}  ${l.trim().slice(0, 100)}`))
  ok('every browser launch honours PLAYWRIGHT_CHROMIUM_PATH', !launches.length, launches.join('\n'))
}

/* ─── 3. every claim names a test that runs ─── */
const runner = fs.readFileSync(path.join(HERE, 'test.mjs'), 'utf8')
const registered = new Set([...runner.matchAll(/\['([\w.-]+\.(?:test|integration)\.mjs)'/g)].map((m) => m[1]).concat(['cloud-lane.test.mjs', 'static-site.test.mjs', 'e2e-runner.test.mjs']))
const specFiles = []
const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && e.name !== 'archive') walk(p); else if (e.name === 'spec.md') specFiles.push(p) } }
walk(path.join(WORKSPACE, 'openspec'))
const claims = []
/* KNOWN GAPS: a claim the code does not back and no test can — said here, each with why and what decides it, and
   printed on every run so it is never forgotten. Nothing goes here to make the check pass; it goes here because
   the remedy is a decision rather than a test. */
const KNOWN_GAPS = {
}
/* a change not yet started is a plan — the tests it names are still to be written; once any of its tasks is done, its
   claims count like the specs' */
const started = (f) => { const m = /openspec\/changes\/([^/]+)\//.exec(f.split(path.sep).join('/')); if (!m) return true; const t = path.join(WORKSPACE, 'openspec', 'changes', m[1], 'tasks.md'); return fs.existsSync(t) && /^- \[x\]/m.test(fs.readFileSync(t, 'utf8')) }
for (const f of specFiles.filter(started)) {
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(/^Verified by:([^\n]*)$/gm)) for (const t of m[1].matchAll(/`(?:node )?(?:packages\/kit\/)?(?:build\/)?([\w.-]+\.(?:test|integration)\.mjs)`/g)) {
    const name = t[1]
    if (!fs.existsSync(path.join(HERE, name))) claims.push(`${path.relative(WORKSPACE, f)}: ${name} does not exist`)
    else if (!registered.has(name)) claims.push(`${path.relative(WORKSPACE, f)}: ${name} is not registered to run (test.mjs)`)
  }
}
const gaps = [...new Set(claims)].filter((c) => KNOWN_GAPS[c])
for (const g of gaps) console.log('  ⚠ known gap: ' + g + ' — ' + KNOWN_GAPS[g])
const open = [...new Set(claims)].filter((c) => !KNOWN_GAPS[c])
ok('every "Verified by" names a test that exists and is registered to run', !open.length, open.join('\n'))
ok('no known gap is listed that has since been closed', Object.keys(KNOWN_GAPS).every((k) => claims.includes(k)), Object.keys(KNOWN_GAPS).filter((k) => !claims.includes(k)).join('\n'))

console.log(fail ? `test-coverage: ${fail} failed, ${pass} passed` : `test-coverage: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
