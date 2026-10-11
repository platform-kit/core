#!/usr/bin/env node
/*
 * `npm run dev`: the app, the local Supabase stack and the served Edge Functions.
 * The public app port is 3000 unless an explicit port is requested.
 *
 *   1. The stack: `supabase status` for THIS project (its config.toml, its own
 *      ports); not running → `supabase start`. Its API url and keys are read from
 *      the status, never from .env, so the app always talks to the stack that is
 *      actually up. A start that fails because another project holds the ports
 *      says which containers hold them and stops — that is a config.toml decision.
 *   2. The app: port 3000 by default, held strictly (Vite must not silently
 *      move the origin); `--port:auto` opts into searching upward, and
 *      VITE_APP_URL set to it — so a magic link, a checkout's return and the
 *      mock's landing all come back here. The auth server accepts any localhost
 *      port (config.toml additional_redirect_urls), so no restart is needed.
 *   3. The functions: `supabase functions serve` on a generated env file — .env
 *      plus APP_URL for this run — unless --no-functions.
 *
 * Flags: --port N, --port:auto, --no-functions, --no-start (fail rather
 * than start the stack), --no-stack (no Supabase at all — the app alone, for a site
 * that needs no account, such as the docs site: `npm run docs:dev` at the root).
 */
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { connect } from 'node:net'
import path from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { loadEnv } from 'vite'
import { platformkitRuntimePath } from './runtime-paths.mjs'
import { loadSite, deploymentShape } from './site.mjs'
import { siteNameFor, workspaceRoot } from './sites.mjs'
import { copyRuntimeSupabaseProject, createRunRecord, quietOnClosedStreams, signalGroup, spawnGroup, stableProjectId, stopStack } from './dev-runtime.mjs'
import { takeOver, takeOverLine, watchParent } from './dev-owner.mjs'
import { portRequest } from './dev-ports.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const say = (m) => console.log(`\x1b[36m›\x1b[0m ${m}`)
const die = (m) => { console.error(`\n\x1b[31m✖\x1b[0m ${m}\n`); process.exit(1) }
const siteEnv = { ...loadEnv('development', process.cwd(), 'PLATFORMKIT_'), ...process.env }
const workspace = workspaceRoot(process.cwd())
const siteName = siteNameFor(workspace, process.cwd(), siteEnv)
const domain = siteEnv.PLATFORMKIT_DOMAIN || ''
if (path.resolve(process.cwd()) === path.resolve(workspace) && !flag('--single')) {
  try {
    const { runWorkspace } = await import('./dev-workspace.mjs')
    await runWorkspace({ root: workspace, args, env: process.env })
    process.exit(process.exitCode || 0)
  } catch (error) {
    die(`workspace dev could not start: ${error.message}`)
  }
}
if (domain && !siteName) die('PLATFORMKIT_DOMAIN is set, but this root site has no PLATFORMKIT_ROOT_SITE name')
if (domain && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i.test(domain)) die(`PLATFORMKIT_DOMAIN "${domain}" is not a valid domain name`)

let declaredSite
let declaredShape
try {
  declaredSite = await loadSite(process.cwd())
  declaredShape = deploymentShape(declaredSite)
}
catch (error) { die(`the site's PlatformKit configuration could not be read: ${error.message}`) }
const noStack = flag('--no-stack') || (declaredShape && declaredShape.backend === false)
let supabaseWorkdir = opt('--supabase-workdir', '')
const ownRuntimeProject = !noStack && !supabaseWorkdir
const projectId = stableProjectId(declaredSite, siteName || path.basename(process.cwd()))
const standaloneRun = path.resolve(process.cwd()) !== path.resolve(workspace) || flag('--single')
const runRecord = standaloneRun && !process.env.PLATFORMKIT_DEV_PARENT_RUN_ID
  ? createRunRecord(workspace, { kind: 'site', site: siteName || path.basename(process.cwd()), projectId, supabaseWorkdirs: [] })
  : null
if (runRecord) process.env.PLATFORMKIT_DEV_RUN_ID = runRecord.runId
process.on('exit', () => runRecord?.remove())

/* ---- 1b. take over from a run that ended without cleaning up (a closed terminal, a kill) ---- */
if (runRecord) {
  const { stopped } = await takeOver(workspace, { error: (message) => console.error(message), say })
  if (stopped.length) say(takeOverLine(stopped))
}

/* ---- 2. a free port for the app ---- */
/* free = nothing answers a connection. (Binding to test is wrong on macOS: a
   listen on 127.0.0.1:P succeeds while another process holds *:P — an editor's
   port forward, say — and the browser then reaches that process, not us.) */
const free = (port) => new Promise((res) => { const s = connect({ port, host: '127.0.0.1' }); s.setTimeout(400); s.once('connect', () => { s.destroy(); res(false) }); s.once('timeout', () => { s.destroy(); res(false) }); s.once('error', () => res(true)) })
let requestedPort
try { requestedPort = portRequest(args, '--port', '3000') }
catch (error) { die(error.message) }
let port = requestedPort.auto ? 3000 : requestedPort.port
if (supabaseWorkdir && !requestedPort.auto && !(await free(port))) die(`reserved workspace Vite port ${port} was taken before ${siteName} could start`)
if (requestedPort.auto) {
  while (port <= 65535 && !(await free(port))) { say(`port ${port} is taken — trying ${port + 1}`); port++ }
  if (port > 65535) die('no free development port remains')
} else if (!await free(port)) {
  die(`development port ${port} is unavailable; choose another port or pass --port:auto`)
}
const frontDoorPort = Number(opt('--front-door-port', 0)) || 0
const appUrl = domain ? `http://${siteName}.${domain}${frontDoorPort ? `:${frontDoorPort}` : ''}` : `http://localhost:${port}`
const portFile = siteName ? platformkitRuntimePath(workspace, 'dev', `${siteName}.port`) : null
if (portFile && existsSync(portFile)) {
  const priorPort = Number(readFileSync(portFile, 'utf8').trim())
  if (Number.isInteger(priorPort) && !(await free(priorPort))) die(`${siteName} already has a dev server on port ${priorPort}; stop it before starting another`)
  rmSync(portFile, { force: true })
}
if (portFile) {
  mkdirSync(path.dirname(portFile), { recursive: true })
  writeFileSync(portFile, `${port}\n`, { flag: 'wx' })
}
function cleanupPort() {
  if (portFile && existsSync(portFile) && readFileSync(portFile, 'utf8').trim() === String(port)) rmSync(portFile, { force: true })
}
process.on('exit', cleanupPort)

/* Assemble only after the public port is known to be available. */
{ const r = spawnSync(process.execPath, [fileURLToPath(new URL('./assemble.mjs', import.meta.url))], { stdio: 'inherit' }); if (r.status !== 0) die('supabase/ could not be assembled') }

if (ownRuntimeProject) {
  try {
    const runtimeRoot = platformkitRuntimePath(workspace, 'dev', 'single', siteName || path.basename(process.cwd()))
    supabaseWorkdir = copyRuntimeSupabaseProject({ source: process.cwd(), runtimeRoot, projectId })
    runRecord?.update({ supabaseWorkdirs: [supabaseWorkdir] })
  } catch (error) { die(error.message) }
}
const workdirArgs = supabaseWorkdir ? ['--workdir', supabaseWorkdir] : []
const status = () => {
  try {
    const result = spawnSync('npx', ['supabase', 'status', '-o', 'json', ...workdirArgs], { encoding: 'utf8' })
    return result.status === 0 ? JSON.parse(result.stdout) : null
  } catch (e) { return null }
}
let st = noStack ? { API_URL: '', ANON_KEY: '', SERVICE_ROLE_KEY: '' } : status()
if (!st) {
  if (flag('--no-start')) die('the local Supabase stack is not running (--no-start given)')
  say(`local Supabase ${projectId} is not running — starting it`)
  const started = spawnSync('npx', ['supabase', 'start', ...workdirArgs], { stdio: 'inherit' })
  if (started.status !== 0) {
    let held = ''
    try { held = execSync("docker ps --format '{{.Names}}  {{.Ports}}' | grep -E '5432[0-9]|54[0-9]{3}' || true").toString().trim() } catch (e2) { /* no docker */ }
    die(`supabase start failed.${held ? ' Containers holding ports:\n' + held + '\nRun `platformkit stop` for managed dev services or change this site’s data.ports.' : ''}`)
  }
  st = status()
  if (!st) die('the stack started but its status could not be read')
}
const api = st.API_URL, anon = st.ANON_KEY, service = st.SERVICE_ROLE_KEY
if (!noStack && (!api || !anon)) die('supabase status gave no API_URL / ANON_KEY')
if (noStack) say(flag('--no-stack')
  ? 'No stack (--no-stack): the app alone, nothing that needs an account'
  : 'No stack: this site declares deployment.backend false — the app alone, nothing that needs an account')
else say(`Supabase  ${api}  ·  Studio ${st.STUDIO_URL || ''}  ·  Mailpit ${st.MAILPIT_URL || st.INBUCKET_URL || ''}`)

/* the env every process gets: the stack's real address and keys, the app's real port */
/*
 * THE RUN’S OWN STACK, UNDER BOTH NAMES.
 *
 * `SUPABASE_URL` is set as well as `VITE_SUPABASE_URL` because the build scripts resolve
 * through `tts/storage.mjs`, which reads `SUPABASE_URL` FIRST and falls back to the Vite name.
 * With only the Vite name set, the root `.env`’s `SUPABASE_URL` won — and every projection a
 * site's dev server ran wrote into whatever stack that file named, not the one this run is
 * actually using.
 *
 * That is not theoretical: running the demo in this checkout projected ITS spaces and ITS bots
 * into the ROOT project's database, where the next test run found rows no file declared and
 * correctly refused to project over them. One checkout holding several sites makes a stack
 * resolved from a shared file wrong by default, so the run says which stack it means.
 */
const env = {
  ...process.env,
  SUPABASE_URL: api,
  SUPABASE_SERVICE_ROLE_KEY: service,
  VITE_SUPABASE_URL: api,
  VITE_SUPABASE_ANON_KEY: anon,
  VITE_APP_URL: appUrl,
  APP_URL: appUrl,
}

/* ---- 2b. the data the functions import, which is generated and not committed ---- */
/* Thirteen JSON files in the functions tree — the catalog, the compiled emails, the funnels, the
   bots, the spaces, the forms — are read by STATIC imports, so a missing one does not degrade: the
   worker fails to boot and every function sharing that module answers 503. They are a pure
   function of the content and are not in git, so they are made here, before `functions serve`
   below ever starts. About a second from nothing. */
{ const r = spawnSync(process.execPath, [fileURLToPath(new URL('./functions-data.mjs', import.meta.url))], { stdio: 'inherit', env }); if (r.status !== 0) die("the functions' data could not be made") }

/* IT RUNS HERE, NOT BEFORE THE STACK. In cloud mode the content is rows, so the steps that read
   content reach for the store, and the store needs the stack address — which is only known once
   'supabase status' has answered above. Run before that, the spaces compile died with
   'supabaseUrl is required' and took the whole dev server with it. It is still before
   'functions serve' below, which is what the order is actually for. */

/* ---- 3. the functions' env file: .env plus this run's address ---- */
const procs = []
/* one serve per project: two watching the same folder both rebuild the one runtime
   container (supabase_edge_runtime_<project>) on a change and collide on its name */
let served = false
if (!supabaseWorkdir) {
  try { served = execSync('pgrep -f "supabase functions serve"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0 } catch (e) { /* none */ }
}
if (served && !flag('--no-functions') && !noStack) say('the functions are already being served by another npm run dev of this project — not starting a second (it would fight over the runtime container)')
if (!flag('--no-functions') && !served && !noStack) {
  const base = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
  const envFile = supabaseWorkdir ? path.join(supabaseWorkdir, '.env.dev') : path.resolve('.env.dev')
  if (supabaseWorkdir) mkdirSync(supabaseWorkdir, { recursive: true })
  const reserved = /^\s*(APP_URL|VITE_APP_URL|VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=.*$/gm
  writeFileSync(envFile, `${base.replace(reserved, '').trim()}\n\n# written by build/dev.mjs for this run — not for editing\nAPP_URL=${appUrl}\nVITE_APP_URL=${appUrl}\nSUPABASE_URL=${api}\nSUPABASE_ANON_KEY=${anon}\nSUPABASE_SERVICE_ROLE_KEY=${service}\nVITE_SUPABASE_URL=${api}\nVITE_SUPABASE_ANON_KEY=${anon}\n${process.env.CONTENT_STORE === 'cloud' && !/^\s*CONTENT_STORE=/m.test(base) ? 'CONTENT_STORE=cloud\n' : ''}`)   /* cloud mode reaches the functions too (the content API reads the rows) */
  procs.push(run('functions', 'npx', ['supabase', 'functions', 'serve', '--env-file', envFile, ...workdirArgs]))
}
const viteArgs = ['vite', '--port', String(port), '--strictPort']
if (domain) viteArgs.push('--host', '0.0.0.0')
procs.push(run('vite', 'npx', viteArgs))

function run(name, cmd, cmdArgs) {
  const p = spawnGroup(cmd, cmdArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const tag = `\x1b[2m[${name}]\x1b[0m `
  const pipe = (stream, out) => { let buf = ''; stream.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) out.write(tag + l + '\n') }) }
  pipe(p.stdout, process.stdout); pipe(p.stderr, process.stderr)
  p.on('exit', (code) => { if (code && code !== 0 && !closing) { console.error(`${tag}exited ${code}`); shutdown(code) } })
  return p
}
let closing = false
function shutdown(code = 0) {
  if (closing) return
  closing = true
  cleanupPort()
  if (supabaseWorkdir) rmSync(path.join(supabaseWorkdir, '.env.dev'), { force: true })
  for (const p of procs) try { signalGroup(p, 'SIGTERM') } catch (e) { /* gone */ }
  if (!noStack && supabaseWorkdir) {
    const stopped = stopStack(supabaseWorkdir)
    if (stopped.stdout) process.stdout.write(stopped.stdout)
    if (stopped.error || stopped.status !== 0) console.error(`dev cleanup: could not stop Supabase project ${projectId}`)
  }
  runRecord?.remove()
  setTimeout(() => process.exit(code), 300)
}
/* a closed terminal is a stop like Ctrl+C; and if whoever started this run goes without a signal
   (a kill no handler can catch), the run notices and stops too */
quietOnClosedStreams()
process.on('SIGINT', () => shutdown(0)); process.on('SIGTERM', () => shutdown(0)); process.on('SIGHUP', () => shutdown(0))
watchParent(() => shutdown(0), 2000, {
  parentPid: Number(process.env.PLATFORMKIT_DEV_PARENT_PID),
})

say(`App       ${appUrl}  (VITE_APP_URL for this run — links, checkout returns and the mock come back here)`)
say(`Functions ${noStack ? (flag('--no-stack') ? 'not served (--no-stack)' : 'not served — this site declares no backend') : flag('--no-functions') ? 'not served (--no-functions)' : served ? 'served by the other npm run dev' : api + '/functions/v1 (from .env.dev)'}`)
