/* build/test-stack.mjs, which every stack-backed test reads its stack from: the run's own addresses, nothing outside
   a run or a local stack, a skip that FAILS under the end-to-end run and only notes outside it, and the one marker
   for a fact about the site. Each case runs in a child, since a skip exits. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HELPER = fileURLToPath(new URL('./test-stack.mjs', import.meta.url))
let pass = 0, fail = 0
const ok = (msg, cond, detail = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PLATFORMKIT_|SUPABASE_|VITE_SUPABASE_|VITE_APP_URL|APP_URL)/.test(k)))
const child = (code, env = {}) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import * as t from ${JSON.stringify('file://' + HELPER)}\n${code}`], { env: { ...clean, ...env }, encoding: 'utf8' })
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
const RUN = {
  PLATFORMKIT_E2E: '1', PLATFORMKIT_TEST_SITE: 'demo', PLATFORMKIT_TEST_API_URL: 'http://127.0.0.1:40000', PLATFORMKIT_TEST_ANON_KEY: 'anon',
  PLATFORMKIT_TEST_SERVICE_ROLE_KEY: 'service', PLATFORMKIT_TEST_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:40001/postgres',
  PLATFORMKIT_TEST_FUNCTIONS_URL: 'http://127.0.0.1:40000/functions/v1', PLATFORMKIT_TEST_MAIL_URL: 'http://127.0.0.1:40005', PLATFORMKIT_TEST_APP_URL: 'http://localhost:40900',
  /* a dev stack's address beside it, which must lose */
  VITE_SUPABASE_URL: 'http://127.0.0.1:20000', VITE_SUPABASE_ANON_KEY: 'dev-anon',
}

{
  const r = child('console.log(JSON.stringify(t.stackOf()))', RUN)
  const s = JSON.parse(r.out.trim().split('\n').pop())
  ok('under the run, the stack is the run\'s own — not the dev stack beside it', s.api === 'http://127.0.0.1:40000' && s.anon === 'anon', r.out)
  ok('…with its database, functions, mail and app', s.db.endsWith(':40001/postgres') && s.functions.endsWith('/functions/v1') && s.mail === 'http://127.0.0.1:40005' && s.app === 'http://localhost:40900' && s.site === 'demo', r.out)
}
{
  const r = child('console.log(JSON.stringify(t.stackOf()))')
  ok('with nothing given, there is no stack', r.out.trim().split('\n').pop() === 'null', r.out)
  const remote = child('console.log(JSON.stringify(t.stackOf()))', { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: 'x' })
  ok('and a hosted project is never a test stack', remote.out.trim().split('\n').pop() === 'null', remote.out)
}
{
  const inRun = child('t.skip("probe", "no LiveKit dev server")', RUN)
  ok('a skip under the run fails, naming what was missing', inRun.status !== 0 && /could not run in the end-to-end run — no LiveKit dev server/.test(inRun.out), inRun.out)
  const outside = child('t.skip("probe", "no stack")')
  ok('outside it, a skip is a note and exits cleanly', outside.status === 0 && /SKIPPED — probe: no stack/.test(outside.out), outside.out)
  const need = child('t.requireStack("probe")', { PLATFORMKIT_E2E: '1' })
  ok('a test that needs a stack and has none fails the run', need.status !== 0, need.out)
}
{
  const r = child('t.notHere("meetings", "the site has no LiveKit account")', RUN)
  ok('a fact about the site is said with the one marker the runner accepts', r.status === 0 && r.out.includes('meetings: not on this site (the site has no LiveKit account)'), r.out)
}

console.log(fail ? `test-stack: ${fail} failed, ${pass} passed` : `test-stack: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
