#!/usr/bin/env node
/*
 * Production deploy — the ONLY path that may touch the production Supabase project.
 *
 * It is deliberately separate from `npm run build` and `npm run dev`, and it
 * refuses to run unless every guardrail passes, so a stray `vite`/`dev` in this
 * repo can never link, push, or deploy to prod:
 *
 *   1. DEPLOY=1 (or CI=true) must be set — an explicit, intentional confirmation.
 *   2. VITE_SUPABASE_URL must be a real remote URL, never localhost/127.0.0.1
 *      (i.e. the production env must actually be loaded).
 *   3. SUPABASE_PROD_REF must be the 20-char production project ref (the allowlist),
 *      and the URL must contain it — no mismatched target.
 *
 * Production values live ONLY in the deploy environment (CI secrets) or a
 * gitignored .env.production that exists only there — never in the repo, never in
 * the dev .env. If any guard fails the script exits non-zero without running a
 * single supabase/vite command.
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
/* the kit's own scripts, wherever the kit is installed; the site is cwd */
const KIT = (f) => JSON.stringify(fileURLToPath(new URL('./' + f, import.meta.url)))
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

/* prod values come from .env.production (deploy env only) with real process.env
   winning; we never read the dev .env here */
const env = { ...loadEnvFile('.env.production'), ...process.env }

function die(msg) {
  console.error(`\n✖ deploy refused: ${msg}\n`)
  process.exit(1)
}

/*
 * WHAT A DEPLOY DOES IN EACH SHAPE, as one declaration both this script and its test read.
 *
 * The deploy was backend-first by construction: link, plan, functions, secrets, then build. Every
 * one of those is an operation against a database, and a site with none had nowhere to send any of
 * it — so the shape that the kit was written for could not be deployed at all.
 *
 * The decision is taken ONCE, here, rather than as a condition repeated at each step, because five
 * conditions are five places to get it wrong. And it is a value rather than a shape of control flow
 * so that build/modes.test.mjs can assert what each shape would run WITHOUT running a deploy — the
 * script reads this same object, so the two cannot drift.
 */
export const deployPlan = (shape) => {
  const backend = !shape || shape.backend !== false
  return {
    targetGuards: backend,   /* the project url, its ref, the access token — all about a project */
    assemble: backend,       /* supabase/ from the kit's sources */
    link: backend,
    migrate: backend,        /* the plan from the declaration, through the shadow */
    contentExport: backend && shape && shape.content === 'rows',
    phases: backend ? ['prepare', 'functions'] : ['prepare'],
    functionsDeploy: backend,
    secrets: backend,
    after: backend,          /* auth settings, the offers to Stripe, the runner's address */
    build: true,             /* THE ONLY THING EVERY SHAPE DOES, and for a static site the whole of it */
  }
}

/* ---- guardrails ---- */
if (env.DEPLOY !== '1' && env.CI !== 'true') {
  die('set DEPLOY=1 (or run in CI) to confirm a production deploy. This guard is why `npm run dev` can never reach prod.')
}

/* A standalone site must have verifiable PlatformKit packages before touching production.
   Refuse before loading site state or running any production-facing command. */
try {
  const { assertPlatformKitForDeploy } = await import('./deploy-pins.mjs')
  const install = assertPlatformKitForDeploy(process.cwd())
  console.log(install.kind === 'release'
    ? `PlatformKit releases: ${install.packages.map(({ name, version }) => `${name}@${version}`).join(', ')}`
    : `PlatformKit source: ${install.source.ref}`)
} catch (error) {
  die(error.message)
}

/* THE SHAPE, BEFORE ANYTHING ELSE. The site's own declaration decides what this deploy is (three
   fields in platformkit.config.js, resolved against the environment by deploymentShape); everything
   below asks the plan rather than the environment. */
const { loadSite: _loadSite, deploymentShape, contentStoreMode, assertAdminCmsShape } = await import('./site.mjs')
const DEPLOY_SITE = await _loadSite()
const SHAPE = deploymentShape(DEPLOY_SITE, env)
try { assertAdminCmsShape(DEPLOY_SITE, SHAPE) } catch (error) { die(error.message) }
if (!env.CONTENT_STORE) env.CONTENT_STORE = contentStoreMode(SHAPE)
const PLAN = deployPlan(SHAPE)
console.log(`\n› a ${SHAPE.mode} deployment — backend ${SHAPE.backend ? 'yes' : 'no'}, content in ${SHAPE.content}, repository ${SHAPE.repo ? 'in' : 'out of'} the cycle`)

const url = env.VITE_SUPABASE_URL || ''
if (PLAN.targetGuards && (!url || /localhost|127\.0\.0\.1/.test(url))) {
  die(`VITE_SUPABASE_URL is "${url || '(unset)'}" — local or empty. The production env is not loaded; aborting so dev never targets prod.`)
}
const prodRef = env.SUPABASE_PROD_REF || ''
if (PLAN.targetGuards && !/^[a-z0-9]{20}$/.test(prodRef)) {
  die('SUPABASE_PROD_REF must be the 20-char production project ref (the allowlisted target). Refusing without it.')
}
if (PLAN.targetGuards && !url.includes(prodRef)) {
  die(`VITE_SUPABASE_URL (${url}) does not contain the allowlisted project ref (${prodRef}). Refusing a mismatched target.`)
}
if (PLAN.targetGuards && !env.SUPABASE_ACCESS_TOKEN) {
  die('SUPABASE_ACCESS_TOKEN is unset. Create a Supabase personal access token and add it as a secret environment variable in the deploy service.')
}

/* ---- everything production needs, checked before a single command runs ----
   What the content switches on decides what must be set (build/deploy-checks.mjs): anything for
   sale needs Stripe, a book in print needs a printer, a session needs cal.com, and the mail relay
   and the staff's push are always needed. A deploy without any of it is refused here, all of it
   named at once — nothing linked, pushed, built or deployed — rather than found one at a time
   from production. `node build/deploy-checks.mjs --env .env.production` gives the same report. */
{
  const { surfaces, checkDeploy, format, unmetFor } = await import('./deploy-checks.mjs')
  const s = surfaces('.')
  const site = DEPLOY_SITE
  s.network = site.network || {}
  const { loadSteps, needsOf } = await import('./steps.mjs')
  const r = checkDeploy(env, s, site.modules, needsOf(await loadSteps(site), site, env, SHAPE), SHAPE, await unmetFor(site, site.modules), undefined, site)
  console.log(format(r, s))
  if (!r.ok) die('the production environment is incomplete (above); nothing was run')
}

const run = (cmd) => { console.log(`› ${cmd}`); execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } }) }

console.log(`\nDeploying to Supabase project ${prodRef} …\n`)

/* 1. database + functions (these touch prod) */
/* the site's supabase/ from the kit's data layer and the site's own, before anything is pushed */
if (PLAN.assemble) run(`node ${KIT('assemble.mjs')}`)
if (PLAN.link) run(`npx supabase link --project-ref ${prodRef}`)
/* the database, brought to the declaration by the plan (build/plan.mjs) — never a migration: the renames the
   declaration annotates, the diff from production to the declaration through the shadow database
   (PLATFORMKIT_SHADOW_DB_URL, reset to the declaration first; the box has no Docker), the kit's data script —
   printed whole, refused whole when a statement would lose data unless PLATFORMKIT_ALLOW_DESTRUCTIVE=1 is set
   for this run (and then said so), applied in order, each part in its own transaction */
if (PLAN.migrate) {
  const { computePlan, applyPlan, printPlan } = await import('./plan.mjs')
  Object.assign(process.env, { PLATFORMKIT_SHADOW_DB_URL: env.PLATFORMKIT_SHADOW_DB_URL, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN })
  console.log('› the plan against production')
  let plan
  try { plan = await computePlan({ root: process.cwd(), target: env.SUPABASE_DB_URL, shadowUrl: env.PLATFORMKIT_SHADOW_DB_URL, env }) }
  catch (e) {
    const net = /ENETUNREACH|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(String(e.code || e.message))
    die(`the plan could not be computed — ${e.message}${net ? '\n  (a connection failed: both urls must be the SESSION pooler — postgresql://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:5432/postgres — reachable from this box; the direct db.<ref>.supabase.co address is IPv6-only)' : ''}`)
  }
  const ok = printPlan(plan, env.SUPABASE_DB_URL)
  /* the line to set is the plan's own digest, printed above with the refusal: it names these
     statements and nothing a later deploy brings, so the allowance cannot be left behind */
  if (!ok) die(`the plan would lose data (above) — set PLATFORMKIT_ALLOW_DESTRUCTIVE=${plan.verdict.digest} for this deploy, having read what it costs`)
  const risky = plan.verdict.hits.filter((h) => h.loses !== 'nothing')
  if (risky.length) console.log(`! allowed by PLATFORMKIT_ALLOW_DESTRUCTIVE (${plan.verdict.allowance.kind}): the ${risky.length} statement(s) above that would lose data are applied on purpose`)
  console.log(plan.empty ? '› production matches the declaration; the data script runs' : '› applying the plan')
  try { await applyPlan(plan, env.SUPABASE_DB_URL) } catch (e) { die(e.message) }
}
/* cloud mode: the rows of public.content out as files before anything reads content/ — the steps below, the
   functions' words, the bundle (build/content-export.mjs; `npm run build` runs it again, idempotent) */
if (PLAN.contentExport) run(`node ${KIT('content-export.mjs')}`)
/* the steps that make what the functions carry and what the site reads — the functions' words, the email
   designs, the funnels; the printed books, the catalog, the printer's webhook (build/steps/, by phase) */
{
  const { runPhase } = await import('./steps.mjs')
  const site = await (await import('./site.mjs')).loadSite()
  try { for (const p of PLAN.phases) await runPhase(p, { site, env, shape: SHAPE }) } catch (e) { die(e.message) }
}
if (PLAN.functionsDeploy) run('npx supabase functions deploy')
/* the functions' links point at the site: APP_URL from VITE_APP_URL when unset (the secrets below carry it) */
if (!env.APP_URL && env.VITE_APP_URL) env.APP_URL = env.VITE_APP_URL

/* 2. server-only function secrets, via a temp env-file so values never appear in
  a process listing. SUPABASE_* values are injected by the platform and cannot
  be set as user secrets. */
const SECRET_KEYS = ['CONTENT_STORE', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CAL_WEBHOOK_SECRET', 'CAL_API_KEY', 'CAL_API_BASE',
  'APP_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  'LULU_CLIENT_KEY', 'LULU_CLIENT_SECRET', 'LULU_SANDBOX', 'MIXAM_USER', 'MIXAM_PASS', 'MIXAM_UK', 'BOOKVAULT_API_KEY', 'SUPPORT_EMAIL', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'VITE_VAPID_PUBLIC_KEY']
/* the functions' links point at the site: APP_URL (set above from VITE_APP_URL when unset) */
const secrets = PLAN.secrets ? SECRET_KEYS.filter((k) => env[k]).map((k) => `${k}=${env[k]}`).join('\n') : ''
if (secrets) {
  const tmp = '.supabase-secrets.tmp'
  try {
    writeFileSync(tmp, secrets + '\n', { mode: 0o600 })
    run(`npx supabase secrets set --env-file ${tmp}`)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/* 3. the steps that run once the functions are live: the auth settings, the offers pushed to Stripe, the
   funnels' runner told where it lives, the spoken books when TTS=1 (build/steps/, the `after` phase) */
{
  const { runPhase } = await import('./steps.mjs')
  const site = await (await import('./site.mjs')).loadSite()
  try { if (PLAN.after) await runPhase('after', { site, env, shape: SHAPE }) } catch (e) { die(e.message) }
}

/* 4. the site: the content, the prepare steps again (cheap), the bundle, the site steps — with the prod VITE_* in env */
run('npm run build')

console.log('\n✔ deploy complete.\n')
