/*
 * A TEST NEVER REACHES ANY STACK BUT THE RUN'S OWN (openspec: test-environment).
 *
 * A stack-backed test runs only inside the end-to-end run (build/e2e.mjs), against the stack that run built for it
 * from the site's files: `pk_<site>_e2e`, fresh each run. It is never given a dev stack, the root `.env`'s project
 * or a hosted one, however it is started: by `npm test`, by hand with a dev run's .env.dev in its environment, or
 * from a folder whose `supabase status` names something else.
 *
 * That is decided here, not left to whoever starts the test. A process is a test when its script is a test file,
 * or when a test started it (PLATFORMKIT_TEST_PROCESS, set on the way in and inherited by every child). In a test:
 *
 *   - outside the end-to-end run there is no stack at all;
 *   - inside it, the only stack is the one the runner named (PLATFORMKIT_TEST_API_URL), and only once Docker says
 *     the container answering on its port is an end-to-end one (`…_e2e`). Anything else ends the test, naming it.
 */
import { execFileSync } from 'node:child_process'

export const isTestProcess = () => process.env.PLATFORMKIT_TEST_PROCESS === '1' || /\.(test|integration)\.m?js$/.test(process.argv[1] || '')
if (isTestProcess()) process.env.PLATFORMKIT_TEST_PROCESS = '1'

const trim = (u) => String(u || '').trim().replace(/\/+$/, '')
const portOf = (u) => { try { const x = new URL(u); return x.port || (x.protocol === 'https:' ? '443' : x.protocol.startsWith('postgres') ? '5432' : '80') } catch { return '' } }

/* who answers on a port, as Docker says: container names, or null where Docker cannot say */
const owners = new Map()
function ownersOf(port) {
  if (!owners.has(port)) {
    try {
      owners.set(port, execFileSync('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map((s) => s.trim()).filter(Boolean))
    } catch { owners.set(port, null) }
  }
  return owners.get(port)
}

/* why an address is not the run's own test stack, or '' when it is */
export function notTheTestStack(url, { what = 'stack' } = {}) {
  if (process.env.PLATFORMKIT_E2E !== '1') return `a test reaches a ${what} only inside the end-to-end run: \`platformkit test --e2e\`, or \`--run <script>\` for one test`
  const port = portOf(url)
  if (!port) return `${url || 'no address'} is not an address`
  const names = ownersOf(port)
  if (names === null) return `Docker could not say what answers on port ${port}`
  if (!names.length) return `nothing in Docker answers on port ${port}`
  const strays = names.filter((n) => !/_e2e$/.test(n))
  if (strays.length) return `port ${port} is ${strays.join(', ')}, not an end-to-end test stack (pk_<site>_e2e)`
  return ''
}

/* the end of a test that was about to reach the wrong stack */
export function refuse(why) {
  console.log(`  ✖ refused: ${why}`)
  process.exit(1)
}

/* the run's API, verified, for a test; null outside the run */
export function testApi() {
  if (process.env.PLATFORMKIT_E2E !== '1') return null
  const api = trim(process.env.PLATFORMKIT_TEST_API_URL)
  const why = notTheTestStack(api)
  if (why) refuse(why)
  return api
}
