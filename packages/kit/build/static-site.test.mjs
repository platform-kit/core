/*
 * THE STATIC LANE: a site with no backend, built, served, and walked.
 *
 * The shape has worked the whole time and nothing ever ran it. src/lib/supabase.js was written for
 * it — "a build with no backend, so callers can degrade to the anonymous, local-only app" — and
 * fifty-odd call sites honour it, and the only evidence that any of it still worked was that nobody
 * had tried. A mode nothing exercises is a mode that rots, and the rot is invisible: a component
 * that quietly stops guarding `configured` breaks no test, because every other test runs against a
 * stack.
 *
 * So this is the lane that would notice. It is slow on purpose — a real build, a real server, a real
 * browser — because the cheap versions of this check are the ones that would have passed while the
 * shape was broken:
 *
 *   a build with no Supabase in the environment       (not a mocked one: the env is actually empty)
 *   every public route visited in a browser           (not a DOM probe: the app actually boots)
 *   the console watched                               (an error is a failure, not a warning)
 *   the network watched                               (A REQUEST TO A BACKEND IS A FAILURE — this is
 *                                                      the one that catches a lost `configured`
 *                                                      guard, and nothing else would)
 *
 * Run alone:  node packages/kit/build/static-site.test.mjs [--site sites/docs] [--keep]
 * Skipped with PLATFORMKIT_SKIP_STATIC_LANE=1, which REPORTS rather than passing quietly.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }

const args = process.argv.slice(2)
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }
/*
 * TWO FIXTURES, AND THE SECOND IS THE ONE THAT MATTERS.
 *
 * sites/docs is every module off — the easy case, and so inert that it makes no backend call even
 * when a Supabase url IS configured, which means it cannot prove the network watch below works.
 * sites/brochure is the library with every row-backed module off: the shape most static sites take,
 * and the one where a component that stopped guarding `configured` would actually reach out.
 *
 * A site's own module — sites/demo's stockists — is not walked here: the demo has a backend and is
 * not a static site. build/site-module.test.mjs holds that, and the demo's own dev server shows it.
 */
const SITES = (argOf('--site', '') ? [argOf('--site', '')] : ['sites/docs', 'sites/brochure'])

console.log('\nTHE STATIC LANE — a site with no backend, built and walked\n')

if (process.env.PLATFORMKIT_SKIP_STATIC_LANE === '1') {
  /* A SKIPPED LANE IS REPORTED, NEVER SILENT. The point of the lane is that nothing exercises this
     shape; a skip that looks like a pass would put it straight back. */
  console.log('  ⚠ SKIPPED (PLATFORMKIT_SKIP_STATIC_LANE=1) — the static shape is NOT covered by this run\n')
  process.exit(0)
}

/* the environment a static host actually has: no Supabase of any kind, whatever this shell holds */
const cleanEnv = () => {
  const e = { ...process.env }
  for (const k of Object.keys(e)) if (/SUPABASE|^VITE_VAPID|^SMTP_|^STRIPE_|^CAL_/.test(k)) delete e[k]
  e.PRERENDER = '1'
  e.SHARE_IMAGES = '0'   /* the pictures are their own change; the pages are what this walks */
  return e
}

let playwright = null
try { playwright = await import('playwright') } catch { /* reported below */ }
if (!playwright) {
  console.log('  ⚠ SKIPPED — playwright is not installed, so no route was visited and the static shape is NOT covered\n')
  process.exit(0)
}

for (const rel of SITES) {
  const root = join(REPO, rel)
  if (!existsSync(join(root, 'platformkit.config.js'))) { ok(rel + ' exists', false, 'no platformkit.config.js'); continue }

  /* it must BE a static site, or the lane is walking something else and proving nothing */
  const { loadSite, deploymentShape } = await import('./site.mjs')
  const site = await loadSite(root)
  const shape = deploymentShape(site, {})
  ok(rel + ' declares itself static', shape.mode === 'static', 'it is ' + shape.mode + ' — set deployment.backend: false, or point the lane elsewhere')
  if (shape.mode !== 'static') continue

  console.log('  building ' + rel + ' with no Supabase in the environment …')
  const built = spawnSync('npm', ['run', 'build'], { cwd: root, env: cleanEnv(), encoding: 'utf8' })
  ok(rel + ' builds with no backend', built.status === 0, (built.stderr || '').split('\n').filter(Boolean).slice(-3).join(' | '))
  if (built.status !== 0) continue
  ok(rel + ' wrote a bundle', existsSync(join(root, 'dist', 'index.html')))

  /*
   * THE ROUTES, COMPUTED IN A CHILD PROCESS — one per site, because the module cache is per process
   * and routes.mjs reads the site through content-node.mjs at import time. Walking two sites in one
   * process gave the second one a route list contaminated by the first: eight routes came back as
   * four, and the lane cheerfully walked the wrong site. A cache-busting query on routes.mjs does
   * not help, since what is cached is what it imports.
   */
  let routes = []
  {
    const code = "const { publicRoutes } = await import('platformkit/build/routes.mjs'); console.log(JSON.stringify(publicRoutes()))"
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: cleanEnv(), encoding: 'utf8' })
    try { routes = JSON.parse((r.stdout || '').trim().split('\n').pop()) } catch { /* reported next */ }
    ok(rel + ' lists its routes', Array.isArray(routes) && routes.length > 0, (r.stderr || '').split('\n').filter(Boolean).slice(-2).join(' | '))
  }
  ok(rel + ' has its own routes, not another site\'s', routes.includes('/') && routes.length >= 3, routes.length + ': ' + routes.slice(0, 4).join(' '))
  if (!routes.length) continue

  /*
   * WHAT THE BUILD ACTUALLY WROTE. The lane already builds with PRERENDER=1 and then walks the
   * routes through a server — which proves the app runs, and says nothing about the baked files a
   * crawler is served. Those are the whole point of prerendering: a route with no index.html is
   * invisible to search, and nobody browsing the site would ever notice, because the app renders
   * it fine.
   */
  {
    const missing = routes.filter((r) => {
      const p = r === '/' ? join(root, 'dist', 'index.html') : join(root, 'dist', r.replace(/^\//, ''), 'index.html')
      return !existsSync(p)
    })
    ok(rel + ' baked a page for every public route', missing.length === 0, missing.length + ' without one: ' + missing.slice(0, 4).join(' '))

    /* and each is prerendered rather than the empty shell copied into place */
    const shell = routes.filter((r) => {
      const p = r === '/' ? join(root, 'dist', 'index.html') : join(root, 'dist', r.replace(/^\//, ''), 'index.html')
      if (!existsSync(p)) return false
      return !/data-prerendered/.test(readFileSync(p, 'utf8'))
    })
    ok(rel + ' marked each baked page as prerendered', shell.length === 0, shell.length + ' unmarked: ' + shell.slice(0, 4).join(' '))

    /* the sitemap, where the site says where it lives */
    const map = join(root, 'dist', 'sitemap.xml')
    if (!existsSync(map)) console.log('  (' + rel + ' has no public address in content/site.md, so no sitemap is written — that is the rule, not a fault)')
    else {
      const xml = readFileSync(map, 'utf8')
      const absent = routes.filter((r) => !xml.includes(r === '/' ? '<loc>' : r))
      ok(rel + ' lists its routes in the sitemap', absent.length === 0, absent.length + ' missing: ' + absent.slice(0, 4).join(' '))
    }
  }

  const { preview } = await import('vite')
  const server = await preview({ root, preview: { port: 0, strictPort: false }, logLevel: 'silent' })
  const base = server.resolvedUrls.local[0].replace(/\/$/, '')
  const browser = await playwright.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })

  const errors = [], backendCalls = []
  let seen = 0
  /* anything that looks like a backend: the project host, the functions, the realtime socket */
  const BACKEND = /supabase\.(co|in)|\/functions\/v1\/|\/rest\/v1\/|\/auth\/v1\/|\/realtime\/v1\//
  try {
    const page = await browser.newPage()
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 180)) })
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 180)))
    page.on('request', (r) => { seen++; if (BACKEND.test(r.url())) backendCalls.push(r.url().slice(0, 140)) })

    let visited = 0
    for (const r of routes) {
      const before = errors.length
      const res = await page.goto(base + r, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => ({ status: () => 0, err: e.message }))
      const status = typeof res.status === 'function' ? res.status() : 0
      if (status !== 200) { ok('GET ' + r, false, 'status ' + status + (res.err ? ' — ' + res.err : '')); continue }
      /* the app has to have actually booted, not served an empty shell */
      const text = await page.evaluate(() => (document.body.innerText || '').trim().length)
      ok('GET ' + r + ' renders', text > 40, text + ' characters of text')
      ok('GET ' + r + ' logs no error', errors.length === before, errors.slice(before).join(' | '))
      visited++
    }
    ok('every route was visited', visited === routes.length, visited + ' of ' + routes.length)
  } finally {
    await browser.close()
    await server.close()
  }

  /*
   * THE CHECK THIS FILE EXISTS FOR. A static build that reaches for a backend is a component that
   * stopped guarding `configured`, and it fails nothing else anywhere in the suite.
   */
  /* A LISTENER THAT NEVER FIRES WOULD PASS THE CHECK BELOW FOREVER. If the page asked for nothing
     at all, the watch is broken rather than the site being clean, and that has to be told apart. */
  ok(rel + "'s network was actually watched", seen > 0, 'not one request was seen — the watch is broken, so "asked no backend" below means nothing')
  ok(rel + ' asked no backend for anything', backendCalls.length === 0,
    [...new Set(backendCalls)].slice(0, 5).join(' | ') + (backendCalls.length > 5 ? ` (+${backendCalls.length - 5})` : ''))

  if (!args.includes('--keep')) rmSync(join(root, 'dist'), { recursive: true, force: true })
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
