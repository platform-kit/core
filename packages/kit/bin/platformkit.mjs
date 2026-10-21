#!/usr/bin/env node
/*
 * platformkit — one command a site runs for everything the kit does. Every command runs in the site's
 * root (--site <path>, else the current directory; from the workspace root, the default site) and
 * hands the rest of its arguments on:
 *
 *   dev         the site on one held port with its stack up and its functions served (build/dev.mjs)
 *   stop        stop PlatformKit-managed dev servers and local Supabase projects for this workspace
 *   sites       list local and registered sites; `sites fetch` and `sites update` manage pinned external checkouts
 *   site-run    run an npm script from the selected site's package
 *   build       the content, the prepare steps, the bundle, the site steps (the form embed, the models' JSON, the pages)
 *   deploy      the environment checks first, then the database, the functions' steps, the functions, the after steps, the site
 *   steps       every build step — the kit's, the theme's, the site's — its phase, on or off and why, its needs (`--check` exits 1 on a missing need)
 *   run <key>   one build step alone
 *   test        the kit's checks (behind their module switches), the site's, the specs; --e2e the stack-backed
 *               ones, on a stack built from each site's files for the run (--only, --jobs, --keep, --run)
 *   migrate     assemble supabase/ and bring the local database to the declaration (`--plan` shows and applies
 *               nothing; `--linked` plans against SUPABASE_DB_URL; `migrate reset` resets, seeds, and puts
 *               the developer's own account back — DEV_ACCOUNT in .env — which the reset emptied)
 *   functions   assemble supabase/ and serve the functions locally (`functions deploy` deploys them)
 *   assemble    supabase/ from the kit's data layer and the site's own (`--check`)
 *   print       the printed editions (build/print.mjs)
 *   tts         the spoken books (build/tts.mjs)
 *   tts-setup   prepare the spoken-book engine and browser weights (build/tts/setup.mjs)
 *   enrich      the companions and introductions (build/enrich.mjs)
 *   share-images photograph the site's share cards and favicon (build/share-images.mjs)
 *   probe       the phone probe (build/phone-probe.mjs)
 *   spec        OpenSpec validate over the site's specs (and the kit's, where they are)
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VERBOSE } from '../build/verbose.mjs'
import { defaultSite, platformKitWorkspaceRoot, workspaceRoot } from '../build/sites.mjs'
import { installPlatformKitSource } from '../build/source-install.mjs'

if (process.versions.node.split('.')[0] !== '22') {
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm')
  const nvmScript = path.join(nvmDir, 'nvm.sh')
  if (fs.existsSync(nvmScript)) {
    console.log(`PlatformKit is restarting under Node.js 22 via nvm (currently ${process.version}).`)
    const result = spawnSync('bash', [
      '-c',
      '. "$NVM_DIR/nvm.sh" && nvm exec 22 "$@"',
      'platformkit',
      'node',
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ], { stdio: 'inherit', env: { ...process.env, NVM_DIR: nvmDir } })
    if (result.error) {
      console.error(`✖ Could not start Node.js 22 through nvm: ${result.error.message}`)
      process.exit(1)
    }
    process.exit(result.status ?? 1)
  }
  console.error(`✖ PlatformKit requires Node.js 22.x (found ${process.version}). Install Node 22 with nvm, run "nvm use" from the repository root, or reopen the Dev Container.`)
  process.exit(1)
}

let kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KIT = (f) => path.join(kitRoot, 'build', f)
const isWorkspace = (directory) => fs.existsSync(path.join(directory, 'sites'))
  && fs.existsSync(path.join(directory, 'packages', 'kit'))
const sourceRoot = platformKitWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const i = args.indexOf('--site')
const explicitSite = i >= 0
const requestedSite = explicitSite ? args.splice(i, 2)[1] : null
const [cmd, ...rest] = args
if (explicitSite && !requestedSite) {
  console.error('✖ --site requires a path')
  process.exit(1)
}
const cwd = process.cwd()
const root = workspaceRoot(cwd)
const inWorkspace = isWorkspace(root) || Boolean(sourceRoot && fs.existsSync(path.join(root, 'packages', 'kit')))
const atWorkspaceRoot = inWorkspace && fs.realpathSync(cwd) === fs.realpathSync(root)
let site = explicitSite ? path.resolve(requestedSite) : cwd
if (!explicitSite && atWorkspaceRoot && cmd && !['help', '--help', 'dev', 'sites', 'stop'].includes(cmd)) {
  try {
    const { loadEnv } = await import('vite')
    const env = { ...loadEnv('development', root, 'PLATFORMKIT_'), ...process.env }
    site = defaultSite(root, env).directory
  } catch (error) {
    console.error(`✖ ${error.message}`)
    process.exit(1)
  }
}
const usage = () => {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
  const start = lines.findIndex((line) => line.startsWith(' * platformkit —'))
  const end = lines.indexOf(' */', start)
  console.log(lines.slice(start, end).map((line) => line.replace(/^ \* ?/, '')).join('\n'))
  process.exit(cmd && !['help', '--help'].includes(cmd) ? 1 : 0)
}
if (!cmd || cmd === 'help' || cmd === '--help') usage()
if (!['dev', 'sites', 'stop'].includes(cmd) && !fs.existsSync(path.join(site, 'platformkit.config.js'))) {
  console.error(`✖ ${site} holds no platformkit.config.js — run from a site directory, set PLATFORMKIT_DEFAULT_SITE, or pass --site <path> (use "platformkit sites" to list workspace sites)`)
  process.exit(1)
}

if (!['help', '--help', 'sites', 'stop'].includes(cmd)) {
  const relativeSite = sourceRoot ? path.relative(sourceRoot, site) : null
  const usesWorkspaceSource = sourceRoot && (relativeSite === '' || (!relativeSite.startsWith(`..${path.sep}`) && relativeSite !== '..' && !path.isAbsolute(relativeSite)))
  if (sourceRoot && !usesWorkspaceSource) {
    try {
      installPlatformKitSource(site, sourceRoot)
      kitRoot = path.join(site, 'node_modules', '@platform-kit', 'kit')
    }
    catch (error) { console.error(`✖ ${error.message}`); process.exit(1) }
  } else if (!sourceRoot) {
    for (const packageName of ['kit', 'movable-types']) {
      if (!fs.existsSync(path.join(site, 'node_modules', '@platform-kit', packageName, 'package.json'))) {
        console.error(`✖ ${site} is missing @platform-kit/${packageName}; run "npm run setup" from the site root`)
        process.exit(1)
      }
    }
  }
}

const run = (cmdline, a = [], opts = {}) => { const r = spawnSync(cmdline, a, { cwd: site, stdio: 'inherit', env: process.env, ...opts }); if (r.status !== 0) process.exit(r.status || 1) }
const node = (script, a = []) => run(process.execPath, [KIT(script), ...a])
const npx = (a) => run('npx', a)
/*
 * THE BUNDLE NEEDS MORE HEAP THAN NODE GIVES A SMALL MACHINE, and it is the kit's business to know
 * that rather than the deployer's.
 *
 * Measured on this site: the build peaks at 4.0 GB resident and completes with a 3 GB heap (3.5 GB
 * resident); it dies at 2.5 GB and below. Node's own default is derived from the machine's memory,
 * so a laptop is fine and a 2 GB deploy instance dies 36 seconds in with "Ineffective mark-compacts
 * near heap limit" — which is where this was found. Rollup holds the whole module graph, and this
 * one is nine and a half thousand modules including an admin no reader ever loads.
 *
 * So the build asks for a heap it is known to fit in. PLATFORMKIT_BUILD_HEAP overrides it (megabytes,
 * or `off` to leave node's default alone), and an explicit --max-old-space-size in NODE_OPTIONS always
 * wins — somebody who has said what they want is not argued with.
 *
 * It is a floor and not a cure: the instance still needs the memory to give. Lowering the peak means
 * building the admin as its own pass, which is a change and not a flag. Two things that look like
 * cures and are not, both measured: rollup's maxParallelFileOps (4.01 GB at the default, 3.83 GB at
 * six) and turning the minifier off (2.53 against 2.55 GB in the same conditions).
 */
const HEAP = () => {
  const said = String(process.env.PLATFORMKIT_BUILD_HEAP || '').trim()
  if (/^(off|0|no|false)$/i.test(said)) return null
  if (/--max-old-space-size/.test(process.env.NODE_OPTIONS || '')) return null
  return /^\d+$/.test(said) ? said : '3072'
}
/* vite, with a heap the bundle fits in */
const vite = (a) => {
  const mb = HEAP()
  const env = mb ? { ...process.env, NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --max-old-space-size=' + mb).trim() } : process.env
  run('npx', a, { env })
}
/*
 * HOW MUCH THE BUNDLE SAYS ABOUT ITSELF.
 *
 * vite lists every emitted file with its size and its gzipped size: three hundred and five lines of
 * a four-hundred-line build log on this site, most of it an icon chunk of half a kilobyte. A deploy
 * host drops a burst that long and takes whatever followed it with it, which on a failed deploy is
 * the failure. So the listing is off unless somebody asks for it (--verbose, PLATFORMKIT_VERBOSE=1)
 * and what stands in its place is the three facts anybody reads a bundle report for: how many files,
 * how much altogether, and the largest of them.
 */
const bundleReport = (outDir) => {
  const dir = path.join(site, outDir, 'assets')
  if (!fs.existsSync(dir)) return
  const files = fs.readdirSync(dir).map((f) => ({ f, n: fs.statSync(path.join(dir, f)).size })).sort((a, b) => b.n - a.n)
  if (!files.length) return
  const kb = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB')
  const total = files.reduce((t, x) => t + x.n, 0)
  console.log(`bundle: ${files.length} file(s), ${kb(total)} — largest ${files[0].f} at ${kb(files[0].n)} (--verbose lists them all)`)
}
/* the content, by whichever engine this site asks for: velite by default, Content Collections with
   CONTENT_ENGINE=collections, the site's own where it registers content.engine (build/collections.mjs) */
const velite = () => run(process.execPath, ['--input-type=module', '-e',
  `const { engineFor } = await import(${JSON.stringify(pathToFileURL(KIT('collections.mjs')).href)})
   const e = await engineFor(process.cwd())
   if (e.name !== 'velite') { console.log('  content: ' + e.name); await e.build({ root: process.cwd(), log: (m) => console.log('  ' + m) }) }
   else { const { build } = await import('velite'); await build({ clean: true }) }`])

switch (cmd) {
  case 'dev': node('dev.mjs', explicitSite ? [...rest, '--single'] : rest); break
  case 'stop': node('dev-stop.mjs', rest); break
  case 'sites': node('sites.mjs', rest); break
  case 'site-run': {
    const [script, ...scriptArgs] = rest
    if (!script) { console.error('✖ site-run requires an npm script name'); process.exit(1) }
    run('npm', ['run', script, ...(scriptArgs.length ? ['--', ...scriptArgs] : [])])
    break
  }
  case 'build': {
    const { loadSite, deploymentShape, contentStoreMode, assertAdminCmsShape } = await import('../build/site.mjs')
    const config = await loadSite(site)
    const shape = deploymentShape(config, process.env)
    assertAdminCmsShape(config, shape)
    if (!process.env.CONTENT_STORE) process.env.CONTENT_STORE = contentStoreMode(shape)
    npx(['playwright', 'install', 'chromium'])
    if (process.env.CONTENT_STORE === 'cloud') node('content-export.mjs')
    velite(); node('steps.mjs', ['--run', 'prepare'])
    /* and vite's own copy of the plugin must not do it again (see the plugin's buildStart) */
    process.env.PLATFORMKIT_CONTENT_DONE = '1'
    /* the bundle. Quiet unless asked: vite's own listing is one line per emitted file */
    const quiet = !VERBOSE && !rest.some((a) => String(a).startsWith('--logLevel'))
    vite(['vite', 'build', ...rest, ...(quiet ? ['--logLevel', 'warn'] : [])])
    const o = rest.indexOf('--outDir')
    bundleReport(o >= 0 ? rest[o + 1] : 'dist')
    node('steps.mjs', ['--run', 'site'])
    break
  }   /* cloud mode's rows out as files first; the steps (build/steps/): after the content, then after the bundle */
  case 'steps': node('steps.mjs', rest); break
  case 'run': node('steps.mjs', ['--only', ...rest]); break
  case 'deploy': node('deploy.mjs', rest); break
  /* --e2e: every stack-backed check, on stacks built for it from each site's files (build/e2e.mjs) */
  case 'test': if (rest.includes('--e2e')) node('e2e.mjs', rest.filter((x) => x !== '--e2e')); else node('test.mjs', rest); break
  case 'assemble': node('assemble.mjs', rest); break
  /* a reset brings the database to the declaration — the schema, the rows, the seed — and then to
     the CONTENT that is a declaration too: the spaces are files, so they are compiled and projected
     after the reset, and the seed's morning in the staff room is asked for once its rooms exist. The
     calendar and what may be commented on follow, in that order: an event belongs to a space and a
     comment subject may name one of its channels.

     EVERY PROJECTION THE FILES OWN BELONGS ON THIS LINE. One that is missing does not fail — the
     table is simply empty, and whatever asks it politely finds nothing: the bots were absent here,
     so after any reset the support desk's Get an instant answer started no run and said it could
     not, with nothing anywhere to say why. The search rows were absent for the same reason, which
     is a bot's `search` tool finding an empty library. The print bucket's TYPE is the same thing
     one layer over — a reset empties the buckets as well as the tables, and a typesetter with no
     fonts fails with "there is no type in the bucket", which reads as a broken build rather than
     an emptied bucket. If a new projection is added to the `after` phase, it is added here too. */
  case 'migrate': node('assemble.mjs'); if (rest[0] === 'reset') { npx(['supabase', 'db', 'reset', ...rest.slice(1)]); const { runSeedSteps } = await import(pathToFileURL(KIT('reset-seed.mjs')).href); const seeded = runSeedSteps({ cwd: site }); if (!seeded.ok) { console.error(`✖ the reset's seed step ${seeded.step} failed`); process.exit(1) } } else node('plan.mjs', rest); break
  /* the same by hand, for an account lost to a reset run some other way */
  case 'dev-account': node('dev-account.mjs'); break
  case 'functions': node('assemble.mjs'); npx(rest[0] === 'deploy' ? ['supabase', 'functions', 'deploy', ...rest.slice(1)] : ['supabase', 'functions', 'serve', '--env-file', '.env', ...rest]); break
  case 'print': node('print.mjs', rest); break
  case 'tts': node('tts.mjs', rest); break
  case 'tts-setup': node('tts/setup.mjs', rest); break
  case 'enrich': node('enrich.mjs', rest); break
  case 'share-images': node('share-images.mjs', rest); break
  case 'probe': node('phone-probe.mjs', rest); break
  case 'spec': { if (!fs.existsSync(path.join(site, 'openspec'))) { console.log('no openspec/ here'); break } npx(['openspec', 'validate', '--all', '--strict', ...rest]); break }
  default: console.error(`✖ unknown command "${cmd}"\n`); usage()
}
