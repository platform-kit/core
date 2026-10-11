/*
 * THE SHARE PICTURES AND THE CRAWLER'S PAGE, WHERE NOTHING BUILDS.
 *
 * A cloud deployment never builds again, and two different things break because of it: a crawler
 * asking for a record published since the last build is served the shell (the site's default title
 * and picture, for an article published this morning), and og:image names a file the build never
 * photographed. The sidecar answers both — it is a Chrome, and pointing it at the app's own
 * /__share/ route means there is still exactly one card design.
 *
 * Two levels of check, because the honest one is expensive:
 *
 *   ALWAYS — the nginx config is valid BOTH WAYS. This is not ceremony: the first draft referred to
 *   a named location that only existed when the sidecar was on, so a static deployment would have
 *   refused to start, and the second duplicated `location /` against the generated rewrites. Both
 *   were found here and neither would have shown up in any other test.
 *
 *   WITH PLATFORMKIT_SHARE_STACK=1 — the compose stack actually up, a crawler served a rendered
 *   head, a reader served the app, and a picture the build never took coming back as a PNG. It is
 *   minutes and a Playwright image, so it is not in the default run; a skip says so rather than
 *   passing quietly.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, cpSync, chmodSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
let pass = 0, fail = 0
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')) } }

console.log('\nSHARE PICTURES AND PRERENDER, IN THE CLOUD SHAPE\n')

const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', cwd: REPO, ...opts })
if (docker(['version']).status !== 0) {
  console.log('  ⚠ SKIPPED — no Docker here, so neither the nginx config nor the sidecar was checked\n')
  process.exit(0)
}

/* ---------------------------------------------------------------- the config, both ways round */
{
  const dir = mkdtempSync(join(tmpdir(), 'nginx-'))
  for (const f of ['templates/default.conf.template', 'templates/rewrites.inc.template', 'templates/prerender.inc.template', 'templates/functions-proxy.inc.template'])
    cpSync(join(REPO, 'deploy/nginx', f), join(dir, f.split('/').pop()))
  for (const f of ['15-supabase-host.envsh', '40-prerender.sh']) { cpSync(join(REPO, 'deploy/nginx', f), join(dir, f)); chmodSync(join(dir, f), 0o755) }

  const check = (env) => {
    const args = ['run', '--rm', '-v', `${dir}:/etc/nginx/templates:ro`,
      '-v', `${dir}/15-supabase-host.envsh:/docker-entrypoint.d/15-supabase-host.envsh:ro`,
      '-v', `${dir}/40-prerender.sh:/docker-entrypoint.d/40-prerender.sh:ro`,
      '-e', 'SUPABASE_URL=https://example.com', '-e', 'NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d']
    for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
    args.push('nginx:1.27-alpine', 'nginx', '-t')
    const r = docker(args)
    return { ok: /test is successful/.test(r.stdout + r.stderr), out: (r.stdout + r.stderr).match(/\[emerg\].*/)?.[0] || '' }
  }

  /* A STATIC OR GIT-BACKED DEPLOYMENT MUST START. The sidecar is the cloud shape's alone, and its
     absence has to cost nothing — not a 502 on every crawler, and certainly not a refusal to boot. */
  const off = check({})
  ok('the config is valid with no sidecar', off.ok, off.out)
  const on = check({ PRERENDER_URL: 'http://prerender:3000' })
  ok('the config is valid with one', on.ok, on.out)

  /* and the switch actually switches: the stub, not the proxy */
  const inc = (env) => {
    const args = ['run', '--rm', '-v', `${dir}:/etc/nginx/templates:ro`,
      '-v', `${dir}/15-supabase-host.envsh:/docker-entrypoint.d/15-supabase-host.envsh:ro`,
      '-v', `${dir}/40-prerender.sh:/docker-entrypoint.d/40-prerender.sh:ro`,
      '-e', 'SUPABASE_URL=https://example.com', '-e', 'NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d']
    for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
    args.push('nginx:1.27-alpine', 'nginx', '-T')
    return docker(args).stdout || ''
  }
  const dumpOff = inc({})
  ok('with no sidecar nothing proxies a page anywhere', !/\/render\?path=/.test(dumpOff), 'the prerender proxy is in the config')
  ok('…and the named locations still exist, so nginx boots', /location @prerender/.test(dumpOff))
  const dumpOn = inc({ PRERENDER_URL: 'http://prerender:3000' })
  ok('with one, a crawler is proxied to it', /\/render\?path=/.test(dumpOn))
  ok('…and a missing share picture is photographed', /\/shot\?path=/.test(dumpOn))
  ok('…the file is still tried first', /try_files \$uri @shot/.test(dumpOn))
}

/* ------------------------------------------------------- the real thing, when it is asked for */
if (process.env.PLATFORMKIT_SHARE_STACK !== '1') {
  console.log('\n  ⚠ the stack itself was NOT run (PLATFORMKIT_SHARE_STACK=1 runs it: a compose build, minutes)')
  console.log('    so a crawler being served a rendered head, and a picture the build never took, are unchecked\n')
  console.log(`  ${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

const compose = (...args) => docker(['compose', '-f', 'deploy/nginx/docker-compose.yml', '--profile', 'cloud', ...args],
  { env: { ...process.env, SUPABASE_URL: 'https://example.com', PRERENDER_URL: 'http://prerender:3000' } })

if (!existsSync(join(REPO, 'dist', 'index.html'))) { console.log('  ⚠ no dist/ — run npm run build first\n'); process.exit(0) }

try {
  const up = compose('up', '-d', '--build')
  ok('the stack comes up', up.status === 0, (up.stderr || '').split('\n').slice(-3).join(' | '))
  if (up.status !== 0) throw new Error('stack')

  /*
   * WAIT FOR THE SIDECAR TO BE READY, and this is not politeness. A sidecar that is not up yet is
   * a connection refused, which nginx turns into the app — correctly, that is the whole fallback —
   * and the app is byte-for-byte what a working reader request returns. So asserting too early
   * does not fail loudly, it fails as "the shell was served to both", which reads exactly like the
   * routing being broken. It cost an hour of looking in the wrong place.
   */
  let health = ''
  for (let i = 0; i < 120; i++) {
    health = (docker(['inspect', '--format', '{{.State.Health.Status}}', 'nginx-prerender-1']).stdout || '').trim()
    if (health === 'healthy') break
    await new Promise((r) => setTimeout(r, 1000))
  }
  ok('the sidecar reports healthy before anything is asked of it', health === 'healthy', health || 'no health reported')

  const base = 'http://127.0.0.1:8080'
  const get = async (path, ua) => {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(base + path, { headers: ua ? { 'user-agent': ua } : {} })
        return { status: r.status, type: r.headers.get('content-type') || '', body: Buffer.from(await r.arrayBuffer()) }
      } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    return { status: 0, type: '', body: Buffer.alloc(0) }
  }
  const CRAWLER = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
  const READER = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36'

  /*
   * A ROUTE THE BUILD DID NOT BAKE. This matters and the first version of this test got it wrong:
   * asking for `/` proves nothing, because `/` IS a file and try_files serves it before the crawler
   * branch is ever reached — which is correct, and looked exactly like the sidecar being broken.
   * The whole point is the record published since the last build, so the route has to be one with
   * no file behind it.
   */
  const article = (readdirSync(join(REPO, 'content', 'articles')).find((n) => n.endsWith('.md')) || 'none.md').replace(/\.md$/, '')
  const route = `/content/articles/${article}`
  ok('the route under test was not baked', !existsSync(join(REPO, 'dist', route.slice(1), 'index.html')), route + ' has a file, so it proves nothing')

  const asReader = await get(route, READER)
  ok('a reader gets the app', asReader.status === 200 && /text\/html/.test(asReader.type), String(asReader.status))
  const asCrawler = await get(route, CRAWLER)
  ok('a crawler gets html too', asCrawler.status === 200 && /text\/html/.test(asCrawler.type), String(asCrawler.status))
  /* the point of it: the crawler's copy has been rendered, so it is the record's page and not the shell */
  ok('and the crawler’s copy has had its JavaScript run', asCrawler.body.length > asReader.body.length * 3,
    `crawler ${asCrawler.body.length}b vs reader ${asReader.body.length}b — the shell was served to both`)

  /* a picture the build never took, photographed from the app's own card */
  const made = await get(`/share/articles/${article}.png`, READER)
  ok('a share picture with no file is photographed', made.status === 200 && /image\/png/.test(made.type), made.status + ' ' + made.type)
  ok('…and it is a real PNG of some size', made.body.slice(1, 4).toString() === 'PNG' && made.body.length > 20000,
    made.body.slice(0, 8).toString('hex') + ' ' + made.body.length + 'b')
  const again = await get(`/share/articles/${article}.png`, READER)
  ok('asked twice, it answers the same', again.status === 200 && again.body.length === made.body.length, String(again.status))

  /* AND THE SIDECAR BEING DOWN IS NOT THE PAGE BEING DOWN. This is the check that would have caught
     the missing recursive_error_pages: the fallback to @app was dead code, because nginx does not
     run an error_page from inside one, and a crawler got a 502 rather than the app. */
  compose('stop', 'prerender')
  const orphaned = await get(route, CRAWLER)
  ok('with the sidecar stopped a crawler still gets the app', orphaned.status === 200 && /text\/html/.test(orphaned.type),
    orphaned.status + ' ' + orphaned.type)
  const noPic = await get(`/share/articles/${article}.png`, READER)
  ok('…and a missing picture is a 404, never a 502', noPic.status === 404, String(noPic.status))
} finally {
  compose('down', '-v')
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
