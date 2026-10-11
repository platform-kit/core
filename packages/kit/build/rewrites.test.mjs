/* The rewrite rules — deploy/_redirects, the one source of truth — and the nginx instance (deploy/nginx) that implements
   them. Under Node: the file parsed, checked against the modules (a need missing, a rule for a module off, the order,
   the fallback), filled for dist/_redirects, rendered for nginx. Then the image itself — the Dockerfile built on a
   stand-in dist, run in Docker with SUPABASE_URL=http://host.docker.internal:54321 — against the local stack's
   functions: every rule reaches its function (the function's own answer comes back: the content API's space, the
   Forms API's and the Scheduling API's 401 envelopes, the functions door), and every other path is the app: a
   prerendered page as it is, a route the prerender did not bake as the shell, always 200. Skipped when Docker or the
   stack is down, or the site keeps no deploy/_redirects; REWRITES_TEST=0 skips it. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { supabaseUrl, localStack } from './tts/storage.mjs'
import { loadSite } from './site.mjs'
import { FILE, PLACEHOLDER, NEEDS, needsFor, parseRedirects, fillRedirects, renderNginx, checkRules, siteRules } from './rewrites.mjs'

const note = (m) => console.log('rewrites: ' + m)
if (process.env.REWRITES_TEST === '0') { note('skipped (REWRITES_TEST=0)'); process.exit(0) }
const ROOT = process.cwd()
const c = await loadSite(ROOT)
let pass = 0, fail = 0
const ok = async (name, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + (e && e.message ? e.message.split('\n').join('\n    ') : e)) } }
// The local Edge Runtime may briefly return gateway errors while regenerated functions start.
const retryGateway = async (target, init) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(target, init)
    if (![502, 503].includes(response.status) || attempt === 19) return response
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('unreachable')
}

const FULL = `# a
/api/content/*       $SUPABASE_URL/functions/v1/content/:splat                  200
/api/media/*         $SUPABASE_URL/functions/v1/images/:splat                   200
# b
/api/desk/packs/js/sdk.js  /packs/js/sdk.js                                     200
/api/desk/*          $SUPABASE_URL/functions/v1/support-api/:splat              200
/api/scheduling/*    $SUPABASE_URL/functions/v1/scheduling-api/:splat           200
/api/forms/*         $SUPABASE_URL/functions/v1/forms-api/:splat                200
/api/events/*        $SUPABASE_URL/functions/v1/ingest/:splat                   200
/api/events          $SUPABASE_URL/functions/v1/ingest                          200
/api/store/*         $SUPABASE_URL/functions/v1/storefront-api/:splat           200
/api/*               $SUPABASE_URL/functions/v1/storefront-api/api/:splat       200
/xrpc/*              $SUPABASE_URL/functions/v1/atproto/xrpc/:splat             200
/.well-known/atproto-did  $SUPABASE_URL/functions/v1/atproto/.well-known/atproto-did  200
/.well-known/did.json     $SUPABASE_URL/functions/v1/atproto/.well-known/did.json     200
/v1/*                $SUPABASE_URL/functions/v1/:splat                          200
/*                   /index.html                                                200
`
await ok('the file parsed and checked: every need covered, a rule for a module off refused, the order, the fallback last; filled for dist; rendered for nginx', () => {
  const rules = parseRedirects(FULL)
  assert.equal(rules.length, 15); assert.deepEqual(rules[0], { source: '/api/content/*', to: '$SUPABASE_URL/functions/v1/content/:splat', status: 200, comment: 'a' }); assert.equal(rules[2].comment, 'b'); assert.equal(rules[1].comment, '')
  assert.deepEqual(checkRules(rules, {}), [], 'every module on: the file covers it')
  /* with the API module off, what is left is the analytics door (every site sends its own events) and the mail's */
  assert.deepEqual(needsFor({ api: false, network: false }).map((n) => n.source), ['/api/events/*', '/v1/*']);
  /* the social network's three doors come and go with the network module, whatever the API does */
  assert.deepEqual(needsFor({ api: false }).map((n) => n.source), ['/api/events/*', '/xrpc/*', '/.well-known/atproto-did', '/.well-known/did.json', '/v1/*'])
  assert.ok(checkRules(rules, { network: false }).some((f) => f.includes('/xrpc/* is in')), 'the network\'s doors with the module off are refused'); assert.ok(checkRules(rules, { api: false }).some((f) => f.includes('/api/content/* is in')), 'a rule for a module off is refused')
  assert.ok(checkRules(parseRedirects(FULL.replace(/^\/api\/scheduling\/.*\n/m, '')), {}).some((f) => f.includes('/api/scheduling/* is needed')), 'a need the file lacks is refused')
  assert.ok(checkRules(parseRedirects(FULL.replace(/\n\/\*.*\n$/, '\n')), {}).some((f) => f.includes('fallback')), 'no fallback is refused')
  assert.ok(checkRules(parseRedirects(FULL.replace('/api/scheduling/*    $SUPABASE_URL/functions/v1/scheduling-api/:splat           200\n', '').replace('/*                   /index.html', '/api/scheduling/*    $SUPABASE_URL/functions/v1/scheduling-api/:splat           200\n/*                   /index.html')), {}).some((f) => f.includes('before /v1/*')), 'a specific rule after /v1/* is refused')
  assert.ok(checkRules(parseRedirects(FULL.replace('functions/v1/content/:splat                  200', 'functions/v1/content/:splat                  301')), {}).some((f) => f.includes('status 200')))
  assert.throws(() => parseRedirects('/x'), /source destination status/)
  const filled = fillRedirects(FULL, 'https://abc.supabase.co/'); assert.ok(!filled.includes(PLACEHOLDER) && filled.includes('https://abc.supabase.co/functions/v1/:splat'))
  const ng = renderNginx(rules)
  /* the proxied prefixes; a rule that is not one (a file at a second address, an exact door) is drawn its own way */
  for (const r of rules.filter((x) => x.source.endsWith('/*') && x.to.startsWith(PLACEHOLDER))) assert.ok(ng.includes('location ^~ ' + r.source.replace('*', '') + ' {') && ng.includes('proxy_pass ${SUPABASE_URL}' + r.to.slice(PLACEHOLDER.length).replace(':splat', '') + ';'), r.source + ' in nginx')
  /* the catch-all hands an unmatched path to @page rather than straight to the shell: that is where the
     crawler branch lives, and where there is no prerender sidecar @page is a stub that serves the shell */
  assert.ok(ng.trim().endsWith('try_files $uri $uri/index.html @page;\n}'), 'the fallback last, through @page'); assert.ok(ng.includes('# a\nlocation'), 'the comment carried')
  const siteIncludes = renderNginx(rules, { appFallback: false })
  assert.ok(!siteIncludes.includes('location / {'), 'a per-site include leaves the app fallback to its server block')
  assert.ok(siteIncludes.includes('location ^~ /api/content/ {'), 'per-site includes retain provider routes')
  assert.throws(() => renderNginx(parseRedirects('/old/* /new/:splat 301\n/* /index.html 200')), /nginx cannot say/)
  assert.ok(NEEDS.every((n) => FULL.includes(n.source)), 'the fixture names every need')
})
await ok('per-site redirects inherit only enabled backend rooms and apply local overrides without changing another site', () => {
  const shared = parseRedirects(FULL)
  const modules = { api: false, support: false, sessions: false, forms: false, store: false, network: false }
  const perSite = siteRules(shared, parseRedirects('/legacy /index.html 200\n'), modules)
  assert.deepEqual(checkRules(perSite, modules), [])
  assert.ok(!perSite.some((rule) => ['/api/content/*', '/api/desk/*', '/api/scheduling/*', '/api/forms/*', '/api/store/*', '/xrpc/*', '/.well-known/did.json'].includes(rule.source)))
  assert.ok(perSite.some((rule) => rule.source === '/legacy'))
  const demo = renderNginx(shared)
  const brochure = renderNginx(perSite)
  assert.ok(demo.includes('proxy_pass ${SUPABASE_URL}/functions/v1/content/;'))
  assert.ok(!brochure.includes('proxy_pass ${SUPABASE_URL}/functions/v1/content/;'))
  assert.ok(!brochure.includes('/functions-proxy.demo.inc'), 'proxy includes are assigned only at the host-generation boundary')
})

/* ---- the instance, in Docker, against the local stack ---- */
const docker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
const url = supabaseUrl()
let up = false
try { up = !!(url && localStack()) && (await retryGateway(url + '/functions/v1/content/openapi.json', { signal: AbortSignal.timeout(4000) })).status < 500 } catch { /* down */ }
const has = fs.existsSync(path.join(ROOT, FILE))
if (!docker || !up || !has) { note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''} (the rules — ${!has ? 'this site keeps no ' + FILE : !docker ? 'Docker is not running' : 'the local stack is not up or the functions are not served'}; the instance is not run)`); process.exit(fail ? 1 : 0) }
const rules = parseRedirects(fs.readFileSync(path.join(ROOT, FILE), 'utf8'))
const hasRule = (source) => rules.some((r) => r.source === source)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rewrites-'))
/* the image's own build context: deploy/nginx as it is, a stand-in dist */
const dist = path.join(tmp, 'dist')
fs.mkdirSync(path.join(dist, 'about'), { recursive: true })
fs.cpSync(path.join(ROOT, 'deploy', 'nginx'), path.join(tmp, 'deploy', 'nginx'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'packages', 'kit', 'build'), { recursive: true })
for (const file of ['hosts.mjs', 'sites.mjs']) fs.copyFileSync(path.join(ROOT, 'packages', 'kit', 'build', file), path.join(tmp, 'packages', 'kit', 'build', file))
fs.mkdirSync(path.join(tmp, 'sites', 'demo'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'sites', 'demo', 'package.json'), '{}')
fs.writeFileSync(path.join(tmp, 'deploy', 'nginx', 'templates', 'rewrites.inc.template'), renderNginx(rules))
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body data-shell>shell</body></html>')
fs.writeFileSync(path.join(dist, 'about', 'index.html'), '<!doctype html><html><body data-prerendered="/about">about</body></html>')
fs.writeFileSync(path.join(dist, 'app.js'), 'console.log(1)')
const port = 18080 + Math.floor(Math.random() * 1000)
const name = 'pk-rewrites-' + process.pid
const stackUrl = url.replace(/^(https?:\/\/)(127\.0\.0\.1|localhost)/, '$1host.docker.internal')
let id = ''
try {
  const built = spawnSync('docker', ['build', '-q', '-f', path.join(tmp, 'deploy', 'nginx', 'Dockerfile'), '-t', name, tmp], { encoding: 'utf8' })
  if (built.status !== 0) throw new Error('the image did not build:\n' + (built.stdout + built.stderr).slice(-2000))
  const run = ['run', '-d', '--name', name, '-p', `${port}:80`, '-e', `SUPABASE_URL=${stackUrl}`]
  if (process.platform !== 'darwin') run.push('--add-host', 'host.docker.internal:host-gateway')
  run.push(name)
  id = execFileSync('docker', run, { encoding: 'utf8' }).trim()
  const base = 'http://127.0.0.1:' + port
  let ready = false
  for (let i = 0; i < 40 && !ready; i++) { await new Promise((r) => setTimeout(r, 500)); try { ready = (await fetch(base + '/', { signal: AbortSignal.timeout(2000) })).status === 200 } catch { /* starting */ } }
  if (!ready) { const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' }); throw new Error('nginx did not come up:\n' + (logs.stdout + logs.stderr).slice(-2000)) }
  const request = (p, init = {}) => retryGateway(base + p, { redirect: 'manual', ...init })
  const get = async (p, headers = {}) => { const r = await request(p, { headers }); return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() } }
  await ok('every other path is the app: the shell at /, a prerendered page as it is, an unbaked route the shell, a file itself — all 200', async () => {
    const root = await get('/'); assert.equal(root.status, 200); assert.ok(root.text.includes('data-shell'))
    const about = await get('/about'); assert.equal(about.status, 200); assert.ok(about.text.includes('data-prerendered="/about"'), 'the prerendered page')
    const about2 = await get('/about/'); assert.equal(about2.status, 200); assert.ok(about2.text.includes('data-prerendered'))
    const deep = await get('/store/products/nothing'); assert.equal(deep.status, 200); assert.ok(deep.text.includes('data-shell'), 'an unbaked route is the shell')
    const js = await get('/app.js'); assert.equal(js.status, 200); assert.ok(js.text.includes('console.log'))
  })
  /* EACH ROOM, THROUGH THE HOST'S OWN RULES: the room is stripped and the product's own path is
     what the function sees — which is the whole claim this shape makes. */
  if (hasRule('/api/content/*')) await ok('/api/content — Contentful\'s own paths inside the room', async () => {
    const idx = await (await retryGateway(url + '/functions/v1/content/openapi.json')).json()
    const space = idx.info.description.match(/Space `([^`]+)`/)[1]
    const r = await get('/api/content/spaces/' + space); assert.equal(r.status, 200, r.text.slice(0, 200))
    const j = JSON.parse(r.text); assert.equal(j.sys.type, 'Space'); assert.equal(j.sys.id, space)
    const nope = await get('/api/content/spaces/not-this-space'); assert.equal(nope.status, 404)
    assert.equal(JSON.parse(nope.text).sys.id, 'NotFound', 'the function\'s own refusal, not nginx\'s')
    const gql = await get('/api/content/content/v1/openapi.json'); assert.equal(gql.status, 200, 'the doubled word is kept')
  })
  if (hasRule('/api/media/*')) await ok('/api/media — the images door', async () => {
    const r = await get('/api/media/x/y/z/w.png'); assert.ok([400, 404].includes(r.status), String(r.status))
    assert.ok(r.type.includes('json'), 'the function answered: ' + r.type)
  })
  if (hasRule('/api/scheduling/*')) await ok('/api/scheduling — cal.com\'s v2 inside the room', async () => {
    const r = await get('/api/scheduling/v2/me'); assert.equal(r.status, 401)
    const j = JSON.parse(r.text); assert.equal(j.status, 'error'); assert.equal(j.error.code, 'UNAUTHORIZED')
  })
  if (hasRule('/api/desk/*')) await ok('/api/desk — Chatwoot\'s own /api/v1 and /public kept inside the room', async () => {
    const c = await request('/api/desk/public/api/v1/inboxes/nope/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(c.status, 404); assert.ok((await c.json()).errors)
    const a2 = await request('/api/desk/api/v1/profile'); assert.equal(a2.status, 401, 'the doubled /api is kept')
    assert.ok((await a2.json()).errors)
    const sdk = await get('/api/desk/packs/js/sdk.js')
    assert.ok(sdk.status === 200 || sdk.status === 404, String(sdk.status))
    if (sdk.status === 200) assert.ok(sdk.type.includes('javascript'), 'the snippet\'s script, not the app: ' + sdk.type)
  })
  if (hasRule('/api/forms/*')) await ok('/api/forms — Typeform\'s own /forms inside the room', async () => {
    const f = await get('/api/forms/forms')
    if (c.modules.forms !== false) { assert.equal(f.status, 401); assert.equal(JSON.parse(f.text).code, 'AUTHENTICATION_FAILED') } else assert.ok(f.status >= 400)
  })
  await ok('/api/events — the analytics door, at the room\'s own root', async () => {
    const i = await request('/api/events', { method: 'OPTIONS' }); assert.ok(i.status < 500, 'a preflight: ' + i.status)
  })
  if (hasRule('/api/*')) await ok('the store: its room and the alias Shopify\'s client insists on are one door; /api itself is still the app', async () => {
    const shop = (p) => request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const r = await shop('/api/2024-10/graphql.json')
    assert.equal(r.status, 401); const j = await r.json(); assert.ok(j.errors && j.errors[0].message)
    const room = await shop('/api/store/api/2024-10/graphql.json')
    assert.equal(room.status, r.status, 'the room answers exactly as the alias does'); assert.ok((await room.json()).errors, 'and with the same shape')
    const page = await get('/api'); assert.ok(page.status === 200 && page.type.includes('html'), 'the reference page is the app\'s: ' + page.status + ' ' + page.type)
  })
  /* THE POINT OF A COMPATIBILITY API IS THAT THE PRODUCT'S OWN CLIENT WORKS. Two of them are driven
     here rather than in their own suites, because here is where the host's rules exist: a real SDK,
     given the site and its room as a base, has to build a URL that nginx routes to the right
     function — and the function has to answer in that product's own shape. No key is set up; an
     unauthenticated call is enough to prove the path and the envelope, and the authenticated
     behaviour is what the API's own suite covers. */
  if (hasRule('/api/desk/*')) await ok("Chatwoot's own SDK, given <site>/api/desk, reaches the desk", async () => {
    const { default: mod } = await import('@figuro/chatwoot-sdk')
    const Client = mod.default
    const client = new Client({ config: { basePath: base + '/api/desk', token: 'not-a-key' } })
    let answered = null
    try { await client.conversations.list({ accountId: 1 }) } catch (e) { answered = e }
    assert.ok(answered, 'an unauthenticated call is refused')
    assert.equal(answered.status, 401, "and refused by the desk, in Chatwoot's own shape: " + answered.status)
  })
  if (hasRule('/api/scheduling/*')) await ok("cal.com's own SDK, given <site>/api/scheduling, reaches the scheduler", async () => {
    const { Cal } = await import('@calcom/sdk')
    const cal = new Cal('client-id', { accessToken: 'not-a-token' }, { baseUrl: base + '/api/scheduling/' })
    let answered = null
    try { await cal.slots.getAvailableSlots({}) } catch (e) { answered = e }
    assert.ok(answered, 'an unauthenticated call is refused')
    const said = JSON.stringify(answered.response?.data ?? answered.message ?? '')
    assert.ok(/unauthorized|401/i.test(said), "and refused by the scheduler, in cal.com's own shape: " + said.slice(0, 120))
  })
  await ok('/v1 — the app\'s own backend, and the links in mail already sent', async () => {
    const u = await get('/v1/email-unsubscribe?u=nobody&t=nope'); assert.ok(u.status < 500, 'the function answered: ' + u.status)
  })
} finally {
  if (fail && id) {
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' })
    const output = (logs.stdout + logs.stderr).trim()
    if (output) console.log('nginx logs:\n' + output.slice(-2000))
  }
  if (id) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' })
  spawnSync('docker', ['rmi', '-f', name], { stdio: 'ignore' })
  fs.rmSync(tmp, { recursive: true, force: true })
}
note(`${pass} passed${fail ? ', ' + fail + ' failed' : ''}`)
process.exit(fail ? 1 : 0)
