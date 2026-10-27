/*
 * THE END-TO-END RUN: every test that needs a database, the functions or a browser, run against a stack
 * of its own for every site under test — built from the site's files on every run, side by side, and
 * never a developer's stack (openspec: test-environment).
 *
 *   platformkit test --e2e [--only <name>[,<name>…]] [--jobs <n>] [--keep] [--run <script>]
 *
 * --run puts one script in place of the suite, against the same fresh stacks (the runner's own test uses it); the
 * coverage gate needs the whole suite, so a --run is never a passing end-to-end run of the site — it says so.
 *
 * The run happens inside a container built for it (build/e2e-container.mjs, docker/e2e.Dockerfile): the project's files
 * as git lists them, installed from scratch, with a Docker daemon of its own for the stacks — never the developer's
 * checkout, packages or Docker (openspec: e2e-runs-in-a-container). Inside it, for each site with a backend:
 *   0. its content compiled and its prepare steps run, as `platformkit build` does, and its functions' data made;
 *   1. any stack an earlier run left (`pk_<site>_e2e`) is stopped without its backup, so nothing survives;
 *   2. a runtime project is made the way the dev workspace makes one (prepareRuntimeProject) — its own
 *      project id, its ports from the test range (40000 up), never a dev port;
 *   3. the stack starts on an empty volume, which applies the site's declaration, data and seed, and the
 *      reset's seed steps run (build/reset-seed.mjs, the same list `platformkit migrate reset` runs);
 *   4. the functions are served with a test environment the run owns: the site's settings, a known value
 *      for every webhook secret, mail to the stack's own catcher by container name; a live payment key
 *      refuses the run;
 *   5. the site's app is served on a test port;
 *   6. `test.mjs --e2e` runs the site's stack tests with the stack's addresses (build/test-stack.mjs reads
 *      them), where a skip is a failure;
 *   7. everything is stopped and its data removed — on success, failure or a signal — unless --keep.
 *
 * Several sites run at once (two by default, --jobs), each alone: a site's tests are given only its stack.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sites as registeredSites, workspaceRoot } from './sites.mjs'
import { runInContainer } from './e2e-container.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = workspaceRoot(process.cwd())
const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt }
const KEEP = args.includes('--keep')
const RUN = opt('--run', '') ? path.resolve(opt('--run', '')) : ''
if (RUN && !fs.existsSync(RUN)) { console.error(`--run names ${RUN}, which is not there`); process.exit(1) }

/* ---- THE RUN'S OWN CONTAINER: on the host, the run builds its image from the project's files and runs this script
   inside it (build/e2e-container.mjs), and nothing below runs here; inside, it carries on. ---- */
await runInContainer(fileURLToPath(import.meta.url), args)
const { loadSite } = await import('./site.mjs')
const { prepareRuntimeProject, findFreePort } = await import('./dev-workspace.mjs')
const { runSeedSteps } = await import('./reset-seed.mjs')
const { moduleSet } = await import('./steps.mjs')
const { paymentProviderIdOf } = await import('./payment-provider-registry.mjs')
const JOBS = Math.max(1, Number(opt('--jobs', process.env.PLATFORMKIT_E2E_JOBS || 2)) || 2)
const PORT_START = 40000
const say = (site, m) => console.log(`\x1b[2m[e2e:${site}]\x1b[0m ${m}`)
const die = (m) => { console.error(`\n\x1b[31m✖\x1b[0m ${m}\n`); process.exit(1) }

/* ---- Docker answers, or nothing below can ---- */
const dockerUp = () => spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 20000 }).status === 0
if (!dockerUp()) die('Docker is not answering — the end-to-end run builds its stacks in Docker (start Docker, or restart OrbStack)')

/* ---- and a browser, which the page checks open (build/browser.mjs) ---- */
{
  const { browserPath } = await import('./browser.mjs')
  const b = await browserPath()
  if (!b.there) die(`no browser for the page checks at ${b.at} — \`npx playwright install chromium\`, or PLAYWRIGHT_CHROMIUM_PATH naming one`)
}

/* ---- the sites: every registered site with a backend, or the ones --only names ---- */
const wanted = String(opt('--only', process.env.PLATFORMKIT_E2E_SITES || '')).split(',').map((s) => s.trim()).filter(Boolean)
const all = registeredSites(ROOT).filter((s) => s.fetched !== false)
for (const w of wanted) if (!all.some((s) => s.name === w)) die(`--only names "${w}", which is not a site in this checkout`)
const chosen = []
for (const s of all.filter((x) => !wanted.length || wanted.includes(x.name))) {
  const config = await loadSite(s.directory)
  if (config.deployment && config.deployment.backend === false) { if (wanted.includes(s.name)) say(s.name, 'has no backend — its checks are the static lane\'s (npm test), not this run\'s'); continue }
  if (!fs.existsSync(path.join(s.directory, 'supabase', 'config.toml'))) { say(s.name, 'has no supabase/config.toml — assembling it first'); }
  chosen.push({ ...s, config })
}
if (!chosen.length) die('no site with a backend was selected')
/* every site in this checkout with a backend, whether or not this run takes it: a run over all of them is a whole run */
let backendSites = 0
for (const s of all) { const c = (chosen.find((x) => x.name === s.name) || {}).config || await loadSite(s.directory); if (!(c.deployment && c.deployment.backend === false)) backendSites++ }

/* ---- the run's own values, and what may never reach a test stack ---- */
const LIVE = /\b(sk|rk|pk)_live_[A-Za-z0-9]+/
const STRIP = /^\s*(APP_URL|VITE_APP_URL|VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL|SUPABASE_ACCESS_TOKEN|PLATFORMKIT_SHADOW_DB_URL|SMTP_[A-Z]+|CAL_WEBHOOK_SECRET|STRIPE_WEBHOOK_SECRET|HYPERSWITCH_WEBHOOK_SECRET|FORMS_WEBHOOK_SECRET|WH_TEST_SECRET|VAPID_[A-Z_]+|VITE_VAPID_PUBLIC_KEY|STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY|VITE_STRIPE_PUBLISHABLE_KEY|STRIPE_MOCK)=.*$/gm
const secret = (prefix) => prefix + crypto.randomBytes(18).toString('hex')
const vapidPair = () => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
  return { VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32).toString('base64url'), VAPID_SUBJECT: 'mailto:test@example.com' }
}
const readEnv = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
const parseEnv = (text) => Object.fromEntries(text.split('\n').map((l) => /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]))

const children = new Set()
const stacks = new Set()
const sb = (workdir, a, opts = {}) => spawnSync('npx', ['supabase', ...a, '--workdir', workdir], { cwd: workdir, encoding: 'utf8', timeout: 600000, ...opts })
/* a stack stopped, and its networks with it: `supabase stop` leaves the shadow database's network, and a run's worth of
   those exhausts Docker's address pools */
const stopStack = (workdir) => {
  const cfg = path.join(workdir, 'supabase', 'config.toml')
  if (!fs.existsSync(cfg)) return
  sb(workdir, ['stop', '--no-backup'])
  const id = (/^project_id\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(cfg, 'utf8')) || [])[1]
  if (id) for (const n of [`supabase_network_${id}`, `supabase_network_${id}-shadow`]) spawnSync('docker', ['network', 'rm', n], { stdio: 'ignore' })
}
/* a server the run starts, writing straight to its own log file: complete, and still writing after the run exits (--keep) */
function background(name, cmd, cmdArgs, { log, ...opts }) {
  const fd = fs.openSync(log.replace(/\.log$/, `.${name}.log`), 'w')
  const p = spawn(cmd, cmdArgs, { ...opts, detached: true, stdio: ['ignore', fd, fd] })
  fs.closeSync(fd)
  children.add(p)
  p.on('exit', () => children.delete(p))
  return p
}
const killGroup = (p) => { try { process.kill(-p.pid, 'SIGTERM') } catch { /* gone */ } }
/* the tests, run so the run still hears a signal while they go (a spawnSync would hold it until the last test ended,
   and an interrupted run would leave its stacks up); they are stopped on every teardown, --keep or not */
const running = new Set()
function runTests(cmd, cmdArgs, { log, ...opts }) {
  return new Promise((resolve) => {
    const p = spawn(cmd, cmdArgs, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    running.add(p)
    let stdout = '', stderr = ''
    /* into the site's log as it comes, so a long run can be watched */
    p.stdout.on('data', (d) => { stdout += d; fs.appendFileSync(log, d) }); p.stderr.on('data', (d) => { stderr += d; fs.appendFileSync(log, d) })
    p.on('close', (code) => { running.delete(p); resolve({ status: code ?? 1, stdout, stderr }) })
  })
}
let tornDown = false
function teardown() {
  if (tornDown) return
  tornDown = true
  for (const p of running) killGroup(p)
  /* --keep leaves everything answering — the stacks, their functions and the apps — for a look */
  if (KEEP) { for (const p of children) p.unref(); console.log('\n--keep: the stacks, functions and apps are left up (platformkit test --e2e again replaces them)'); return }
  for (const p of children) killGroup(p)
  for (const w of stacks) stopStack(w)
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.log(`\n${sig}: stopping the run's stacks`); teardown(); process.exit(130) })

/* a function's own answer, a redirect included (email-track answers 302): following it would ask the site, not the function */
const answers = async (url, init = {}) => { try { const r = await fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(5000) }); return r.status } catch { return 0 } }
async function waitFor(what, test, seconds) {
  for (let i = 0; i < seconds; i++) { if (await test()) return true; await new Promise((r) => setTimeout(r, 1000)) }
  throw new Error(`${what} did not come up within ${seconds}s`)
}

/* the mail catcher's address on its stack's network */
function catcherAddress(projectId) {
  const r = spawnSync('docker', ['inspect', `supabase_inbucket_${projectId}`, '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'], { encoding: 'utf8' })
  const ip = (r.stdout || '').trim()
  if (r.status !== 0 || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error(`the stack's mail catcher has no address (${(r.stderr || '').trim().slice(0, 120)})`)
  return ip
}

/* ---- one site, start to finish ---- */
async function runSite(site, reserved) {
  const name = site.name
  const slug = name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
  const projectId = `pk_${slug}_e2e`
  const runtimeRoot = path.join(ROOT, 'node_modules', '.cache', 'platformkit', 'e2e', name)
  const logs = path.join(runtimeRoot, '..', `${name}.log`)
  fs.mkdirSync(path.dirname(logs), { recursive: true }); fs.writeFileSync(logs, '')
  const result = { site: name, ok: false, failed: [], note: '' }
  try {
    /* 0. the site's own settings may hold nothing live */
    const base = readEnv(path.join(site.directory, '.env'))
    const live = base.split('\n').find((l) => LIVE.test(l))
    if (live) throw new Error(`its .env holds a live payment key (${live.split('=')[0]}) — the end-to-end run never starts with one`)
    /* Stripe's test mode, where the site takes payments through Stripe: its checkout tests run against it, so a test key
       is the run's to have — from the run's environment (CI's secret), the site's .env, or the workspace's — and a site
       without one fails here rather than passing with its payments unchecked */
    const PAY = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'VITE_STRIPE_PUBLISHABLE_KEY']
    const workspaceEnv = parseEnv(readEnv(path.join(ROOT, '.env'))), siteEnv = parseEnv(base)
    const pay = Object.fromEntries(PAY.map((k) => [k, process.env[k] || siteEnv[k] || workspaceEnv[k] || '']).filter(([, v]) => v))
    for (const [k, v] of Object.entries(pay)) if (LIVE.test(v)) throw new Error(`${k} is a live payment key — the end-to-end run never starts with one`)
    const manifests = await moduleSet(site.config)
    const paysByStripe = paymentProviderIdOf(site.config) === 'stripe' && [...manifests.values()].some((m) => (m.owns.env || []).includes('STRIPE_SECRET_KEY') && site.config.modules?.[m.key] !== false)
    if (paysByStripe && !/^sk_test_/.test(pay.STRIPE_SECRET_KEY || '')) throw new Error('no Stripe test key (STRIPE_SECRET_KEY=sk_test_…) — the site takes payments through Stripe and its checkout tests run in Stripe\'s test mode; set it in the run\'s environment, the site\'s .env or the workspace\'s')

    /* its dependencies installed: a fetched site is not a workspace, and its checkout needs its own npm ci — without it the
       app compiled nothing that imported one (DharmaLab's admin, over @tiptap/extension-underline) and every browser check
       timed out waiting for a page that had answered 500 */
    {
      const pkg = JSON.parse(readEnv(path.join(site.directory, 'package.json')) || '{}')
      const there = (dep) => { for (let d = site.directory; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, 'node_modules', dep))) return true; if (path.dirname(d) === d) return false } }
      const missing = Object.keys(pkg.dependencies || {}).filter((d) => !there(d))
      if (missing.length) throw new Error(`its dependencies are not installed (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' and ' + (missing.length - 4) + ' more' : ''}) — run npm ci in ${path.relative(ROOT, site.directory) || '.'}`)
    }

    /* 1. nothing an earlier run left */
    const assembled = spawnSync(process.execPath, [path.join(HERE, 'assemble.mjs')], { cwd: site.directory, encoding: 'utf8' })
    if (assembled.status !== 0) throw new Error('the site would not assemble:\n' + ((assembled.stdout || '') + (assembled.stderr || '')).trim().split('\n').slice(-8).join('\n'))
    /* its content, compiled now and prepared as `platformkit build` does it (the engine the site asks for, then the
       prepare steps — the search index among them): the drop-in scripts compile it in, and a copy of the code has none
       an earlier build left */
    for (const [what, a] of [['content', ['--input-type=module', '-e', `const { engineFor } = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'collections.mjs')).href)}); const e = await engineFor(process.cwd()); await e.build({ root: process.cwd(), log: () => {} })`]], ['prepare steps', [path.join(HERE, 'steps.mjs'), '--run', 'prepare']]]) {
      const r = spawnSync(process.execPath, a, { cwd: site.directory, encoding: 'utf8', env: { ...process.env, ...parseEnv(base) } })
      if (r.status !== 0) throw new Error(`its ${what} would not build:\n` + ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-8).join('\n'))
    }
    /* and the data the functions import, made now from the site's content: a file an earlier build left (or none at
       all, on a site never built here) is not the site as it is — the club's stack would not start without them */
    const data = spawnSync(process.execPath, [path.join(HERE, 'functions-data.mjs')], { cwd: site.directory, encoding: 'utf8', env: { ...process.env, ...parseEnv(base) } })
    if (data.status !== 0) throw new Error('the functions\' data could not be made:\n' + ((data.stdout || '') + (data.stderr || '')).trim().split('\n').slice(-8).join('\n'))
    stopStack(runtimeRoot)
    spawnSync('npx', ['supabase', 'stop', '--project-id', projectId, '--no-backup'], { cwd: ROOT, stdio: 'ignore', timeout: 300000 })
    fs.rmSync(runtimeRoot, { recursive: true, force: true })

    /* 2. the runtime project, as dev makes it, in the test range */
    const appPort = await findFreePort(PORT_START + 900, reserved)
    await prepareRuntimeProject({ source: site.directory, runtimeRoot, siteName: name, projectId, domain: 'localhost', frontDoorPort: appPort, reservedPorts: reserved, portStart: PORT_START })
    stacks.add(runtimeRoot)
    /* the auth server's own limits, lifted on a TEST stack only: every account a suite signs in comes from one address,
       and thirty sign-ins in five minutes is a short suite's morning — the club's browser checks waited a minute for a
       session the limit had refused. The site's own limits (abuse-limits.test.mjs) are the app's, and stay as they are. */
    {
      const rt = path.join(runtimeRoot, 'supabase', 'config.toml')
      fs.writeFileSync(rt, fs.readFileSync(rt, 'utf8').replace(/^(sign_in_sign_ups|token_verifications|token_refresh)\s*=\s*\d+/gm, '$1 = 100000'))
    }

    /* 3. a stack on an empty volume: the declaration, the data and the seed — then the reset's steps */
    say(name, `starting ${projectId}`)
    const started = sb(runtimeRoot, ['start', '-x', 'studio,vector,logflare,supavisor'])
    if (started.status !== 0) throw new Error('the stack did not start:\n' + (started.stdout + started.stderr).trim().split('\n').slice(-12).join('\n'))
    const st = JSON.parse(sb(runtimeRoot, ['status', '-o', 'json']).stdout || '{}')
    if (!st.API_URL || !st.ANON_KEY || !st.SERVICE_ROLE_KEY || !st.DB_URL) throw new Error('the stack gave no API url and keys')
    const mail = st.MAILPIT_URL || st.INBUCKET_URL || ''
    const appUrl = `http://localhost:${appPort}`
    const stackEnv = {
      SUPABASE_URL: st.API_URL, VITE_SUPABASE_URL: st.API_URL, SUPABASE_ANON_KEY: st.ANON_KEY, VITE_SUPABASE_ANON_KEY: st.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: st.SERVICE_ROLE_KEY, APP_URL: appUrl, VITE_APP_URL: appUrl,
    }
    const seeded = runSeedSteps({ cwd: site.directory, env: { ...process.env, ...parseEnv(base), ...stackEnv }, stdio: 'pipe' })
    if (!seeded.ok) throw new Error(`the seed step ${seeded.step} failed:\n${seeded.output}`)
    /* a site whose content is rows has them filled from its files, as its deploy does (build/content-export.mjs) */
    if (site.config.deployment && site.config.deployment.content === 'rows') {
      const ex = spawnSync(process.execPath, [path.join(HERE, 'content-export.mjs')], { cwd: site.directory, env: { ...process.env, ...parseEnv(base), ...stackEnv, CONTENT_STORE: 'cloud' }, encoding: 'utf8' })
      if (ex.status !== 0) throw new Error('the content rows could not be filled:\n' + ((ex.stdout || '') + (ex.stderr || '')).trim().split('\n').slice(-8).join('\n'))
    }

    /* 4. the functions, with the run's own environment */
    const secrets = {
      CAL_WEBHOOK_SECRET: secret('e2e_cal_'), STRIPE_WEBHOOK_SECRET: secret('whsec_e2e'), HYPERSWITCH_WEBHOOK_SECRET: secret('e2e_hs_'),
      FORMS_WEBHOOK_SECRET: secret('e2e_forms_'), WH_TEST_SECRET: secret('e2e_wh_'),
      /* mail to this stack's own catcher at its address on the stack's network — read now, from the container this
         run just started, so it cannot be stale (the functions runtime resolves names itself, not through Docker's DNS) */
      SMTP_HOST: catcherAddress(projectId), SMTP_PORT: '1025', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: 'Test <test@example.com>',
      /* a VAPID pair of the run's own, so push is exercised configured rather than answering "not configured" */
      ...vapidPair(),
      /* the test-mode keys, wherever they came from, and never the mock in their place */
      ...pay, ...(paysByStripe ? { STRIPE_MOCK: '0' } : {}),
      /* cal.com's key, where the site has none: the recordings test serves cal.com's answers itself and needs only that a
         key is set; a site's own key, where it has one, is its own */
      ...(siteEnv.CAL_API_KEY ? {} : { CAL_API_KEY: secret('cal_e2e_') }),
    }
    /* the network's wider world, where the site has the module: a directory and an app view the federation test runs
       on a port pair of the site's own, so two sites at once do not meet (NETWORK_FEDERATE is a local stack's only) */
    const network = site.config.modules?.network !== false
    const plcPort = network ? await findFreePort(PORT_START + 950, reserved) : 0
    if (network) { reserved.add(plcPort + 1); Object.assign(secrets, { NETWORK_FEDERATE: '1', NETWORK_PLC_URL: `http://host.docker.internal:${plcPort}`, NETWORK_PLC_ROTATION_KEY: crypto.randomBytes(32).toString('hex'), NETWORK_APPVIEW_URL: `http://host.docker.internal:${plcPort + 1}`, NETWORK_APPVIEW_DID: 'did:web:appview.test' }) }
    const envFile = path.join(runtimeRoot, '.env.e2e')
    fs.writeFileSync(envFile, `${base.replace(STRIP, '').trim()}\n\n# written by build/e2e.mjs for this run — not for editing\n${Object.entries({ ...stackEnv, ...secrets }).map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
    background('functions', 'npx', ['supabase', 'functions', 'serve', '--env-file', envFile, '--workdir', runtimeRoot], { cwd: runtimeRoot, env: process.env, log: logs })
    /* a function every site with a backend has, and one that boots on its own (not admin, which needs its import map) */
    const fnDirs = fs.readdirSync(path.join(runtimeRoot, 'supabase', 'functions'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name)
    const probe = ['cal-webhook', 'reader-content', 'ingest'].find((f) => fnDirs.includes(f)) || fnDirs[0]
    await waitFor('the functions', async () => { const s = await answers(`${st.API_URL}/functions/v1/${probe}`, { method: 'OPTIONS' }); return s > 0 && s !== 503 && s !== 502 }, 240)
    /* every function booted once before a test asks: a first boot of a large one (admin) takes longer than a test's probe
       allows, and a function that cannot boot at all is named here rather than as a test's mystery 503 */
    const cold = []
    await Promise.all(fnDirs.map(async (f) => { for (let i = 0; i < 30; i++) { const c = await answers(`${st.API_URL}/functions/v1/${f}`, { method: 'OPTIONS' }); if (c > 0 && c !== 503 && c !== 502) return; await new Promise((r) => setTimeout(r, 2000)) } cold.push(f) }))
    if (cold.length) throw new Error(`these functions did not boot: ${cold.join(', ')} (the run's functions log names why)`)
    /* where the log stands once every function is warm: what a TEST called is what is written after this */
    const fnLog = logs.replace(/\.log$/, '.functions.log')
    const warmAt = fs.existsSync(fnLog) ? fs.statSync(fnLog).size : 0

    /* 5. the site's app, on a test port */
    /* the drop-in scripts the app serves (the analytics, the support widget, the comments), built now against THIS
       stack into the run's own folder: the dev server serves them from dist/ when they are there, and the ones a dev
       build left there name the dev stack — the support widget on another origin posted to it, and was refused */
    const dist = path.join(runtimeRoot, 'dist')
    for (const sdk of ['analytics-sdk.mjs', 'support-sdk.mjs', 'comments-sdk.mjs']) {
      const b = spawnSync(process.execPath, [path.join(HERE, sdk)], { cwd: site.directory, env: { ...process.env, ...parseEnv(base), ...stackEnv, PLATFORMKIT_DIST: dist }, encoding: 'utf8' })
      if (b.status !== 0) throw new Error(`${sdk} would not build:\n` + ((b.stdout || '') + (b.stderr || '')).trim().split('\n').slice(-8).join('\n'))
    }
    background('app', 'npx', ['vite', '--port', String(appPort), '--strictPort'], { cwd: site.directory, env: { ...process.env, ...stackEnv, PLATFORMKIT_DIST: dist }, log: logs })
    await waitFor('the app', async () => (await answers(appUrl)) > 0, 180)
    say(name, `up — API ${st.API_URL} · app ${appUrl} · mail ${mail}`)

    /* 6. the site's stack tests, where a skip is a failure */
    const testEnv = {
      ...process.env, ...parseEnv(base), ...stackEnv, ...secrets,
      /* two sites' suites share the machine, and a page's first visit compiles it cold: the browser floor (browser.mjs,
         BROWSER_WAIT_MS, meant for a slow machine) is doubled for the run, unless it was set */
      BROWSER_WAIT_MS: process.env.BROWSER_WAIT_MS || '120000',
      PLATFORMKIT_E2E: '1', PLATFORMKIT_TEST_SITE: name, PLATFORMKIT_TEST_API_URL: st.API_URL, PLATFORMKIT_TEST_ANON_KEY: st.ANON_KEY,
      PLATFORMKIT_TEST_SERVICE_ROLE_KEY: st.SERVICE_ROLE_KEY, PLATFORMKIT_TEST_DB_URL: st.DB_URL, PLATFORMKIT_TEST_FUNCTIONS_URL: `${st.API_URL}/functions/v1`,
      PLATFORMKIT_TEST_MAIL_URL: mail, PLATFORMKIT_TEST_APP_URL: appUrl, SUPABASE_WORKDIR: runtimeRoot,
      /* test.mjs runs the Stripe test-mode integrations on a site that pays through Stripe — they fail without the key */
      PLATFORMKIT_E2E_STRIPE: paysByStripe ? '1' : '0',
      ...(network ? { ATPROTO_PLC_PORT: String(plcPort) } : {}),
    }
    const t = await runTests(process.execPath, RUN ? [RUN] : [path.join(HERE, 'test.mjs'), '--e2e'], { cwd: site.directory, env: testEnv, log: logs })
    result.failed = [...String(t.stdout || '').matchAll(/^✗ (.+?) (?:failed|could not run)/gm)].map((m) => m[1])
    /* what this site's tests called, read from the functions' own log after the warm-up, for the run's coverage gate */
    if (RUN) { result.ok = t.status === 0; result.note = `--run ${path.basename(RUN)} only: the suite and its coverage gate were not run`; result.output = t.stdout || ''; return result }
    const called = new Set([...fs.readFileSync(fnLog, 'utf8').slice(warmAt).matchAll(/serving the request with supabase\/functions\/([a-z0-9-]+)/g)].map((m) => m[1]))
    /* kept for the run's gate below: a function is covered when any site's tests called it (a module one site has off
       is another's to exercise — the club has most of them off) */
    result.served = fnDirs; result.called = [...called]
    result.ok = t.status === 0
    result.note = (t.stdout || '').trim().split('\n').slice(-1)[0] || ''
  } catch (e) {
    result.note = e.message
    say(name, '\x1b[31mfailed\x1b[0m — ' + e.message.split('\n')[0])
    if (!dockerUp()) result.note += '\n(Docker stopped answering during the run)'
  } finally {
    if (!KEEP) { stopStack(runtimeRoot); stacks.delete(runtimeRoot) }
    result.log = logs
  }
  return result
}

/* ---- the sites, a few at a time ---- */
const reserved = new Set()
const queue = [...chosen], results = []
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => { while (queue.length) results.push(await runSite(queue.shift(), reserved)) }))
teardown()

/* THE COVERAGE GATE, over the whole run: every function any site served was called by some site's tests. A function
   nothing called is one nothing has shown answers — five sat behind a green suite that way. */
const served = new Set(results.flatMap((r) => r.served || [])), calledAny = new Set(results.flatMap((r) => r.called || []))
const uncalled = [...served].filter((f) => !calledAny.has(f)).sort()
const ran = results.some((r) => r.served)

console.log('\n══ end-to-end ══')
for (const r of results) {
  console.log(`${r.ok ? '✔' : '✖'} ${r.site}${r.ok ? '' : ' — ' + (r.failed.length ? r.failed.join(', ') : r.note)}`)
  if (!r.ok) console.log(`   the run's log: ${r.log}`)
  if (RUN) { if (r.output) process.stdout.write(r.output.replace(/^/gm, '   ')); console.log('   ' + r.note) }
}
/* a run over SOME sites (--only) covers what their tests call, and the whole run the rest: there it is reported, and it fails
   only a run over every registered site, which is what CI and `npm run test:e2e` are */
const partial = chosen.length < backendSites
if (ran && !RUN) console.log(uncalled.length
  ? `${partial ? '⚠' : '✖'} the coverage gate — no test in this run called: ${uncalled.join(', ')}${partial ? ' (a run over some sites; the whole run must call them)' : ''}`
  : `✔ the coverage gate — every one of the ${served.size} functions served was called`)
process.exit(results.every((r) => r.ok) && (RUN || partial || !uncalled.length) ? 0 : 1)
