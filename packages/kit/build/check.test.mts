/*
 * PLATFORMKIT CHECK (openspec: kit-check). Every problem in one run, failures first, exit 1 on any failure;
 * the settings asked for from the deploy check's own derivation, so a need added in one place is asked for by
 * both; nothing leaves the machine without --online, and with it a refused key is told apart from a service
 * that could not be reached. Runs against sites/demo with Docker, the browser and the network stood in for.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { machineChecks, browserCheck, settingsChecks, siteChecks, onlineChecks, runChecks, report, webhookVersionFindings } from './check.mjs'
import { STRIPE_API_VERSION } from './stripe-version.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEMO = path.resolve(HERE, '../../../sites/demo')
let pass = 0, fail = 0
const ok = (msg: string, cond: unknown, detail: unknown = '') => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + String(detail).slice(0, 400) : '')) } }
const ran = (status: number, stdout = '') => () => ({ status, stdout });

/* two problems at once: Docker down and no browser, both reported, failures first, exit 1 */
{
  const machine = machineChecks({ version: '22.1.0', exec: (cmd) => (cmd === 'docker' ? ran(1)() : ran(0, 'x')()) })
  const browser = await browserCheck(async () => ({ at: null, there: false }))
  const { text, ok: fine } = report([['the machine', [...machine, browser]]])
  ok('two problems: both reported in one run', /✖ Docker/.test(text) && /✖ test browser/.test(text), text)
  ok('…each with its fix', /→ start Docker/.test(text) && /→ npx playwright install chromium/.test(text), text)
  ok('…and the run fails', fine === false)
  ok('an old Node fails, naming the version needed', machineChecks({ version: '18.20.0', exec: ran(0) })[0].level === 'fail')
}

/* a clean run passes */
{
  const { ok: fine, text } = report([['the machine', machineChecks({ version: '22.22.1', exec: ran(0, 'v') })]])
  ok('nothing wrong: the run passes', fine && /Everything is ready/.test(text), text)
}

/* one list of needs: the demo's own build step asks for a key, and check and deploy both ask for it */
{
  const KEY = (await import(path.join(DEMO, 'src/stockists/step.js'))).default.needs.env[0]
  const { site, modules } = await siteChecks(DEMO)
  ok('the demo\'s config loads', !!site && !!modules)
  const env = { ...process.env }; delete env[KEY]
  const local = await settingsChecks(DEMO, site, modules, env)
  ok('on this machine the step\'s key is a warning', local.some((r) => r.name === KEY && r.level === 'warn'), JSON.stringify(local.map((r) => r.name)))
  const prod = await settingsChecks(DEMO, site, modules, env, { production: true })
  ok('with --production it is a failure', prod.some((r) => r.name === KEY && r.level === 'fail'))
  const { surfaces, checkDeploy } = await import('./deploy-checks.mjs')
  const { deploymentShape } = await import('./site.mjs')
  const { loadSteps, needsOf } = await import('./steps.mjs')
  const shape = deploymentShape(site, env)
  const deploy = checkDeploy(env, Object.assign(surfaces(DEMO), { network: site.network || {} }), site.modules, needsOf(await loadSteps(site), site, env, shape), shape, [], modules, site)
  ok('…and the deploy asks for the same key, from the same declaration', deploy.missing.some((m) => m.key === KEY))
  ok('a test key is not a problem on this machine', !local.some((r) => /live key/.test(r.detail)))
}

/* offline by default: nothing reaches fetch without --online */
{
  const seen: any = []
  const real = globalThis.fetch
  globalThis.fetch = async (u) => { seen.push(String(u)); throw new Error('no network in this test') }
  try {
    const stand = { machine: () => [], browser: async () => ({ level: 'pass', name: 'test browser' }), database: async () => [], online: { fetch: globalThis.fetch, connect: async () => { seen.push('tcp'); return false } } }
    await runChecks({ root: DEMO, deps: stand })
    ok('without --online no request leaves the machine', seen.length === 0, seen.join(', '))
    await runChecks({ root: DEMO, online: true, deps: stand })
    ok('with --online the configured services are asked (the demo\'s .env names Stripe and a mail relay)', seen.length > 0, seen.join(', '))
  } finally { globalThis.fetch = real }
}

/* a refused key is told apart from an unreachable service */
{
  const env = { STRIPE_SECRET_KEY: 'sk_test_refused' }
  const refused = await onlineChecks({}, env, { fetch: async () => ({ status: 401, ok: false }) })
  ok('a refused key: the report says refused', refused.some((r) => r.name === 'Stripe' && r.level === 'fail' && /refused/.test(r.detail)), JSON.stringify(refused))
  const away = await onlineChecks({}, env, { fetch: async () => { throw new Error('getaddrinfo ENOTFOUND') } })
  ok('an unreachable service: the report says could not be reached', away.some((r) => r.name === 'Stripe' && r.level === 'warn' && /could not be reached/.test(r.detail)), JSON.stringify(away))
}

/* a Stripe webhook endpoint on an older version than the kit's is named, with where to move it (openspec: stripe-current-api) */
{
  const found = webhookVersionFindings([
    { id: 'we_old', url: 'https://site.test/functions/v1/stripe-webhook', api_version: '2024-06-20' },
    { id: 'we_now', url: 'https://site.test/now', api_version: STRIPE_API_VERSION },
    { id: 'we_default', url: 'https://site.test/default', api_version: null },
    { id: 'we_off', url: 'https://site.test/off', api_version: '2020-08-27', status: 'disabled' },
  ], '2025-02-24.acacia')
  const old = found.find((r) => /stripe-webhook/.test(r.name))
  ok('an endpoint at 2024-06-20: a warning', old?.level === 'warn', JSON.stringify(found))
  ok('…naming the kit\'s version and where to change it', !!old && old.detail.includes(STRIPE_API_VERSION) && /Webhooks/.test(old.fix || ''), JSON.stringify(old))
  ok('an endpoint at the kit\'s version passes', found.find((r) => /now/.test(r.name))?.level === 'pass')
  ok('an endpoint on the account default is judged by that default', found.find((r) => /default/.test(r.name))?.level === 'warn')
  ok('a disabled endpoint is not reported', !found.some((r) => /off/.test(r.name)))
  const env = { STRIPE_SECRET_KEY: 'sk_test_x' }
  const asked: string[] = []
  const online = await onlineChecks({}, env, { fetch: async (url: string) => { asked.push(url); return { status: 200, ok: true, json: async () => (/webhook_endpoints/.test(url) ? { data: [{ id: 'we_1', url: 'https://x.test/hook', api_version: '2024-06-20' }] } : { data: [] }) } }, connect: async () => true })
  ok('online, the key accepted: the endpoints are read and the old one warned', online.some((r) => r.name === 'Stripe webhook https://x.test/hook' && r.level === 'warn'), JSON.stringify(online))
}

console.log(fail ? `check: ${fail} failed, ${pass} passed` : `check: all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
