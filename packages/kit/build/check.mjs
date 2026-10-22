/*
 * PLATFORMKIT CHECK — everything a site needs, asked at once (openspec: kit-check).
 *
 * A site that will not start says why one failure at a time: Docker is not running, then the browser is
 * missing, then a key. This asks all of it in one pass and prints every problem with the thing that fixes
 * it, failures first. Run from a site's root: `platformkit check [--production] [--db] [--online]`.
 *
 *   the machine   Node, Docker, the Supabase CLI, the test browser
 *   the site      the config loads, every module switched on is known, PlatformKit is the version pinned
 *   settings      what the site's switched-on features need, from the deploy check's own derivation. On this
 *                 machine a missing key is a WARNING (a feature runs in practice mode, or not at all, locally);
 *                 with --production the deploy check runs whole against .env.production and every gap fails
 *   the database  the local stack answers; with --db, the plan between it and the declaration is empty
 *                 (migrate --plan: it computes and applies nothing)
 *   --online      one read-only call per service it knows how to ask; without it nothing leaves the machine
 *
 * Exit 1 when anything fails; warnings alone exit 0.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KIT_ROOT = path.resolve(HERE, '..')
export const NODE_MAJOR = 22

const pass = (name, detail = '') => ({ level: 'pass', name, detail })
const warn = (name, detail, fix = '') => ({ level: 'warn', name, detail, fix })
const fail = (name, detail, fix = '') => ({ level: 'fail', name, detail, fix })
const readEnv = (file) => (fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {})
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, ...opts })

/* ---- the machine ---- */
export function machineChecks({ version = process.versions.node, exec = sh } = {}) {
  const out = []
  const major = Number(version.split('.')[0])
  out.push(major >= NODE_MAJOR ? pass('Node', version) : fail('Node', `${version} — PlatformKit needs ${NODE_MAJOR} or later`, `install Node ${NODE_MAJOR} (nvm install ${NODE_MAJOR})`))
  const docker = exec('docker', ['info', '--format', '{{.ServerVersion}}'])
  out.push(docker.status === 0 ? pass('Docker', String(docker.stdout).trim()) : fail('Docker', 'not running — the local database and functions run in it', 'start Docker (or OrbStack), then run this again'))
  const cli = exec('npx', ['--no-install', 'supabase', '--version'])
  out.push(cli.status === 0 ? pass('Supabase CLI', String(cli.stdout).trim()) : fail('Supabase CLI', 'not installed in this site', 'npm install in the site (the CLI comes with PlatformKit\'s dependencies)'))
  return out
}

export async function browserCheck(lookup) {
  const { at, there } = await (lookup || (await import('./browser.mjs')).browserPath)().catch(() => ({ at: null, there: false }))
  return there ? pass('test browser', at) : fail('test browser', 'not installed — the browser checks and the phone probe need it', 'npx playwright install chromium (or set PLAYWRIGHT_CHROMIUM_PATH)')
}

/* ---- the site ---- */
export async function siteChecks(root, { kitVersion = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8')).version } = {}) {
  const out = []
  let site = null
  try {
    const { loadSite } = await import('./site.mjs')
    site = await loadSite(root)
    out.push(pass('site config', `${site.name || path.basename(root)}`))
  } catch (e) {
    out.push(fail('site config', `platformkit.config.js does not load: ${String(e.message || e).split('\n')[0]}`, 'fix the error named, then run this again'))
    return { out, site: null, modules: null }
  }
  let modules = null
  try {
    const { moduleSet } = await import('./steps.mjs')
    modules = await moduleSet(site)
    const unknown = Object.keys(site.modules || {}).filter((k) => !modules.has(k))
    out.push(unknown.length ? fail('modules', `not a module PlatformKit or this site declares: ${unknown.join(', ')}`, 'correct the name in modules, or remove it') : pass('modules', `${Object.values(site.modules || {}).filter(Boolean).length} switched on`))
  } catch (e) {
    out.push(fail('modules', `the module list could not be read: ${String(e.message || e).split('\n')[0]}`))
  }
  const pkg = path.join(root, 'package.json')
  const pinned = fs.existsSync(pkg) ? (JSON.parse(fs.readFileSync(pkg, 'utf8')).dependencies || {}).platformkit : null
  if (!pinned) out.push(warn('PlatformKit version', 'the site\'s package.json names no platformkit dependency', 'npm install platformkit'))
  else if (/^\d+\.\d+\.\d+$/.test(pinned) && pinned !== kitVersion) out.push(fail('PlatformKit version', `the site pins ${pinned}; ${kitVersion} is installed`, 'npm install in the site'))
  else out.push(pass('PlatformKit version', /^\d/.test(pinned) ? kitVersion : `${kitVersion} (from ${pinned})`))
  return { out, site, modules }
}

/* ---- settings: the deploy check's derivation, read for this machine or for production ---- */
export async function settingsChecks(root, site, modules, env, { production = false } = {}) {
  const { surfaces, checkDeploy, DEPLOYMENT_ENV } = await import('./deploy-checks.mjs')
  const { deploymentShape } = await import('./site.mjs')
  const { loadSteps, needsOf } = await import('./steps.mjs')
  const { unmetRequirements } = await import('./modules/manifest.mjs')
  const s = surfaces(root); s.network = site.network || {}
  const shape = deploymentShape(site, env)
  const r = checkDeploy(env, s, site.modules, needsOf(await loadSteps(site), site, env, shape), shape, unmetRequirements(modules, site.modules), modules, site)
  if (production) {
    const none = fs.existsSync(path.join(root, '.env.production')) ? [] : [fail('.env.production', 'not found — the deploy reads its settings from it', 'create .env.production on the machine that deploys (never commit it)')]
    return [...none, ...r.missing.map((m) => fail(m.key, `not set — ${m.why}`, 'set it in .env.production')), ...r.wrong.map((w) => fail('production setting', w)), ...(r.ok ? [pass('production settings', 'every setting the deploy needs is present')] : [])]
  }
  /* on this machine: the deployment's own keys come from the local stack, and the rules only production has
     (a live key, an https origin) are not this machine's to meet */
  const local = r.missing.filter((m) => !DEPLOYMENT_ENV.includes(m.key))
  const wrong = r.wrong.filter((w) => !/live key|https origin|shadow database/i.test(w))
  const out = [...local.map((m) => warn(m.key, `not set here — ${m.why}`, 'set what you need in .env; a feature without its key runs in practice mode or not at all')), ...wrong.map((w) => fail('setting', w))]
  if (!out.length) out.push(pass('settings', 'every setting the switched-on features use is set'))
  return out
}

/* ---- the database ---- */
export async function databaseChecks(root, { db = false, exec = sh, connect = tcpOpen } = {}) {
  const st = exec('npx', ['--no-install', 'supabase', 'status', '-o', 'env'], { cwd: root })
  const m = /^DB_URL="?([^"\n]+)"?/m.exec(String(st.stdout || ''))
  if (!m) return [fail('local database', 'not up', 'platformkit dev (or npx supabase start)')]
  const u = new URL(m[1])
  if (!(await connect(u.hostname, Number(u.port || 5432)))) return [fail('local database', `${u.host} does not answer`, 'npx supabase stop, then platformkit dev')]
  const out = [pass('local database', u.host)]
  if (db) {
    const plan = exec(process.execPath, [path.join(HERE, 'assemble.mjs')], { cwd: root, timeout: 120000 })
    const p = plan.status === 0 ? exec(process.execPath, [path.join(HERE, 'plan.mjs'), '--plan', '--json'], { cwd: root, timeout: 300000 }) : plan
    let empty = false
    try { empty = JSON.parse(String(p.stdout).slice(String(p.stdout).indexOf('{'))).empty === true } catch {}
    out.push(empty ? pass('database schema', 'matches the declaration') : fail('database schema', 'differs from the declaration', 'platformkit migrate (platformkit migrate --plan shows what it would do)'))
  }
  return out
}

export function tcpOpen(host, port, ms = 3000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port }); const done = (v) => { s.destroy(); resolve(v) }
    s.setTimeout(ms, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false))
  })
}

/* ---- online: one read-only call per service this knows how to ask ---- */
export async function onlineChecks(site, env, { fetch: f = fetch, connect = tcpOpen } = {}) {
  const out = []
  const ask = async (name, url, headers) => {
    try {
      const r = await f(url, { headers, signal: AbortSignal.timeout(8000) })
      if (r.status === 401 || r.status === 403) return fail(name, `the key was refused (${r.status})`, 'replace the key')
      return r.ok ? pass(name, 'the key is accepted') : warn(name, `answered ${r.status}`)
    } catch (e) { return warn(name, `could not be reached: ${String(e.message || e).split('\n')[0]}`) }
  }
  if (env.STRIPE_SECRET_KEY) out.push(await ask('Stripe', 'https://api.stripe.com/v1/balance', { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY }))
  if (env.SMTP_HOST) out.push((await connect(env.SMTP_HOST, Number(env.SMTP_PORT || 587))) ? pass('mail relay', `${env.SMTP_HOST} answers`) : warn('mail relay', `${env.SMTP_HOST}:${env.SMTP_PORT || 587} could not be reached`))
  let providers = []
  try { const { inferenceOf } = await import('./site.mjs'); providers = inferenceOf(site || {})?.providers || [] } catch {}
  for (const p of providers) {
    if (!env[p.secretEnv]) continue
    const headers = p.protocol === 'anthropic' ? { 'x-api-key': env[p.secretEnv], 'anthropic-version': '2023-06-01' } : { authorization: 'Bearer ' + env[p.secretEnv] }
    out.push(await ask(`AI provider ${p.id}`, p.baseUrl.replace(/\/$/, '') + (p.protocol === 'anthropic' ? '/v1/models' : '/models'), headers))
  }
  if (!out.length) out.push(pass('online', 'no service it knows how to ask is configured'))
  return out
}

/* ---- the run ---- */
/* `deps` stands in for the parts that need Docker, a browser or the network — the test's way in, never a site's */
export async function runChecks({ root = process.cwd(), production = false, db = false, online = false, deps = {} } = {}) {
  const groups = []
  groups.push(['the machine', [...(deps.machine || machineChecks)(), await (deps.browser || browserCheck)()]])
  const { out, site, modules } = await siteChecks(root)
  groups.push(['the site', out])
  if (site && modules) {
    const env = production ? { ...readEnv(path.join(root, '.env.production')), ...process.env } : { ...readEnv(path.join(root, '.env')), ...process.env }
    groups.push([production ? 'production settings' : 'settings', await settingsChecks(root, site, modules, env, { production })])
    if (online) groups.push(['online', await onlineChecks(site, env, deps.online || {})])
  }
  if (!production) groups.push(['the database', await (deps.database || databaseChecks)(root, { db })])
  return groups
}

export function report(groups) {
  const all = groups.flatMap(([g, rs]) => rs.map((r) => ({ ...r, group: g })))
  const fails = all.filter((r) => r.level === 'fail'), warns = all.filter((r) => r.level === 'warn')
  /* a fix shared by a run of problems is printed once, after the last of them */
  const lines = []
  const list = [...fails, ...warns]
  list.forEach((r, i) => { lines.push(`${r.level === 'fail' ? '✖' : '⚠'} ${r.name} — ${r.detail}`); if (r.fix && list[i + 1]?.fix !== r.fix) lines.push(`    → ${r.fix}`) })
  if (lines.length) lines.push('')
  for (const [g, rs] of groups) lines.push(`${g}: ${rs.filter((r) => r.level === 'pass').map((r) => '✔ ' + r.name).join(' · ') || '—'}`)
  lines.push('', fails.length ? `${fails.length} problem${fails.length === 1 ? '' : 's'}${warns.length ? `, ${warns.length} warning${warns.length === 1 ? '' : 's'}` : ''}.` : warns.length ? `Ready, with ${warns.length} warning${warns.length === 1 ? '' : 's'}.` : 'Everything is ready.')
  return { text: lines.join('\n'), ok: !fails.length }
}

/* run directly: compared as real paths, since /var on macOS is /private/var and a symlinked path would never match */
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2)
  const groups = await runChecks({ production: a.includes('--production'), db: a.includes('--db'), online: a.includes('--online') })
  const { text, ok } = report(groups)
  console.log(text)
  process.exit(ok ? 0 : 1)
}
