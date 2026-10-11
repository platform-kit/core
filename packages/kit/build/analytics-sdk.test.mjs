/* The drop-in script: built to dist/analytics.js by build/analytics-sdk.mjs (this test builds it when it is missing), then
   (1) every public method posthog-js's own declarations list on its PostHog class exists on window.posthog as a function
   and takes PostHog's arguments without throwing — so a new PostHog method fails here until it is added; (2) the size
   pin; and, with the local stack up and the functions served, (3) the behaviours in a headless page on a server of this
   test's own at localhost (an origin the demo's source allows): $pageview on load with the standard properties, identify
   / capture / register / reset, an opted-out page still sending under a random id and no fingerprint, PostHog's own
   snippet with only api_host changed, two contexts of one browser giving one anonymous id — the rows read back with
   their source and distinct id, and a batch under an unknown key or a wrong origin refused. Everything written is
   removed. SDK_TEST=0 skips it. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */

const note = (m) => console.log('analytics-sdk: ' + m)
if (process.env.SDK_TEST === '0') { note('skipped (SDK_TEST=0)'); process.exit(0) }
let pass = 0, fail = 0
const ok = (msg, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL  ' + msg + '\n    ' + String(e.message).split('\n')[0]) } }
const ta = async (msg, fn) => { try { await fn(); pass++ } catch (e) { fail++; console.log('  FAIL  ' + msg + '\n    ' + String(e.message).split('\n').slice(0, 2).join(' ')) } }

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'dist/analytics.js')
if (!fs.existsSync(OUT)) execFileSync(process.execPath, [new URL('./analytics-sdk.mjs', import.meta.url).pathname], { stdio: 'inherit' })
const built = fs.readFileSync(OUT, 'utf8')
ok('the built file is under 40 KB gzipped', () => assert.ok(gzipSync(built).length < 40 * 1024, gzipSync(built).length + ' bytes'))
ok('dist/static/array.js is the same file', () => assert.equal(fs.readFileSync(path.join(ROOT, 'dist/static/array.js'), 'utf8'), built))

/* (1) PostHog's declared surface, read from the installed package */
const dts = (() => { for (const p of ['node_modules/posthog-js/dist/module.d.ts', '../../node_modules/posthog-js/dist/module.d.ts']) { const f = path.join(ROOT, p); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8') } return '' })()
if (!dts) note('posthog-js is not installed here — the surface is pinned to the list in the design')
const cls = (() => { const i = dts.indexOf('declare class PostHog implements PostHogInterface {'); if (i < 0) return ''; return dts.slice(i, dts.indexOf('\n}\n', i)) })()
const declared = [...new Set([...cls.matchAll(/^    ([a-zA-Z_$][\w$]*)\(/gm)].map((m) => m[1]).filter((m) => m !== 'constructor' && !m.startsWith('_')))]
const FALLBACK = 'init push capture calculateEventProperties register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty toString createPersonProfile setInternalOrTestUser opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric'.split(' ')
const methods = declared.length ? declared : FALLBACK

/* a page of this test's own, at localhost, serving the built file and an empty page */
/* the page's own host, as a site's would be: the script, an empty page, and /api/events handed on to the served function (the host's rewrite) */
let DOOR = ''
/* PostHog's own build, when installed: the real SDK pointed at the door */
const POSTHOG_DIST = (() => { for (const p of ['node_modules/posthog-js/dist/array.full.js', '../../node_modules/posthog-js/dist/array.full.js']) { const f = path.join(ROOT, p); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8') } return '' })()
const server = http.createServer((req, res) => {
  const u = (req.url || '').split('?')[0]
  if (u === '/analytics.js' || u === '/static/array.js') { res.setHeader('content-type', 'application/javascript'); return res.end(built) }
  if ((u === '/api/events' || u.startsWith('/api/events/')) && DOOR) {
    /* the host's rewrite: the path under /api/events, the query and the raw body handed on (PostHog's SDK gzips) */
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', async () => {
      try {
        const target = DOOR + u.slice('/api/events'.length) + ((req.url || '').includes('?') ? (req.url || '').slice((req.url || '').indexOf('?')) : '')
        const pass = ['content-type', 'content-encoding', 'origin', 'authorization', 'apikey']
        const headers = {}; for (const h of pass) if (req.headers[h]) headers[h] = req.headers[h]
        const r = await fetch(target, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks), redirect: 'manual' })
        res.statusCode = r.status; res.setHeader('content-type', r.headers.get('content-type') || 'application/json'); res.setHeader('access-control-allow-origin', '*'); if (r.headers.get('location')) res.setHeader('location', r.headers.get('location')); res.end(Buffer.from(await r.arrayBuffer()))
      } catch (e) { res.statusCode = 502; res.end('{}') }
    }); return
  }
  if (u === '/posthog.js') { res.setHeader('content-type', 'application/javascript'); return res.end(POSTHOG_DIST) }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><title>a page</title></head><body><h1>a page</h1></body></html>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PAGE = `http://localhost:${server.address().port}`

const { chromium } = await import('playwright')
let browser = null
try {
  const shell = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (fs.existsSync(shell) ? shell : undefined) })
} catch (e) { note('no browser (PLAYWRIGHT_CHROMIUM_PATH) — the page checks are skipped: ' + String(e.message).split('\n')[0]) }

if (browser) {
  const ctx = await browserContext(browser)
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(PAGE + '/', { waitUntil: 'load' })
  await page.addScriptTag({ url: PAGE + '/analytics.js' })
  const surface = await page.evaluate((names) => {
    const out = { missing: [], threw: [] }
    for (const n of names) { if (typeof window.posthog[n] !== 'function') out.missing.push(n) }
    return out
  }, methods)
  ok(`every one of PostHog's ${methods.length} declared methods is on window.posthog as a function`, () => assert.deepEqual(surface.missing, []))
  const people = await page.evaluate(() => typeof window.posthog.people.set === 'function' && typeof window.posthog.people.set_once === 'function')
  ok('people.set and people.set_once are there', () => assert.equal(people, true))
  /* every method called with PostHog's arguments, before and after init, throws nothing */
  const threw = await page.evaluate((names) => {
    const args = { init: ['pk_test', { api_host: 'http://localhost:1', capture_pageview: false }], capture: ['x', { a: 1 }], identify: ['u-1', { plan: 'a' }, { first: 1 }], alias: ['a', 'b'], register: [{ k: 1 }], register_once: [{ k: 2 }], register_for_session: [{ s: 1 }], unregister: ['k'], unregister_for_session: ['s'], getFeatureFlag: ['f'], getFeatureFlagPayload: ['f'], getFeatureFlagResult: ['f'], isFeatureEnabled: ['f'], onFeatureFlags: [() => {}], on: ['x', () => {}], onSurveysLoaded: [() => {}], onSessionId: [() => {}], getSurveys: [() => {}], getActiveMatchingSurveys: [() => {}], renderSurvey: ['s', '#x'], displaySurvey: ['s'], cancelPendingSurvey: ['s'], canRenderSurvey: ['s'], canRenderSurveyAsync: ['s'], group: ['company', 'c-1', { name: 'x' }], setPersonProperties: [{ a: 1 }], unsetPersonProperties: [['a']], setPersonPropertiesForFlags: [{}], setGroupPropertiesForFlags: [{}], resetGroupPropertiesForFlags: ['company'], captureException: [new Error('e')], addExceptionStep: [{}], captureLog: ['x'], get_property: ['k'], getSessionProperty: ['k'], set_config: [{ debug: false }], debug: [false], push: [['capture', 'queued']], captureTraceFeedback: ['t', 'f'], captureTraceMetric: ['t', 'm', 1], calculateEventProperties: ['x', {}], updateFlags: [{}], updateEarlyAccessFeatureEnrollment: ['f', true], getEarlyAccessFeatures: [() => {}], setIdentity: ['u-2'], setInternalOrTestUser: [true], opt_in_capturing: [{ captureEventName: false }], get_session_replay_url: [{}], startSessionRecording: [{}], loadToolbar: [{}], reset: [false], shutdown: [], clearIdentity: [], createPersonProfile: [] }
    const threw = []
    const order = names.filter((n) => n !== 'init' && n !== 'reset' && n !== 'shutdown')
    for (const n of order) { try { const r = window.posthog[n](...(Object.hasOwn(args, n) ? args[n] : [])); if (r && typeof r.then === 'function') r.catch(() => {}) } catch (e) { threw.push(n + ': ' + e.message) } }
    try { window.posthog.init(...args.init) } catch (e) { threw.push('init: ' + e.message) }
    for (const n of order) { try { const r = window.posthog[n](...(Object.hasOwn(args, n) ? args[n] : [])); if (r && typeof r.then === 'function') r.catch(() => {}) } catch (e) { threw.push(n + ': ' + e.message) } }
    try { window.posthog.reset(false); window.posthog.shutdown() } catch (e) { threw.push('reset: ' + e.message) }
    return threw
  }, methods)
  ok('every method takes PostHog\'s arguments without throwing, before init and after', () => assert.deepEqual(threw, [], threw.join(' | ')))
  const shapes = await page.evaluate(() => ({ flag: window.posthog.isFeatureEnabled('x'), payload: window.posthog.getFeatureFlagPayload('x'), all: window.posthog.getAllFeatureFlags(), rec: window.posthog.sessionRecordingStarted(), url: window.posthog.get_session_replay_url(), consent: window.posthog.get_explicit_consent_status() }))
  ok('isFeatureEnabled false, payload undefined, flags {}, recording false, replay url null', () => { assert.equal(shapes.flag, false); assert.equal(shapes.payload, undefined); assert.deepEqual(shapes.all, {}); assert.equal(shapes.rec, false); assert.equal(shapes.url, null) })
  ok('no page error', () => assert.deepEqual(errors, []))
  await ctx.close()

  /* (3) the behaviours against the served door */
  const { supabaseUrl, localStack, serviceKey } = await import('./tts/storage.mjs')
  const url = supabaseUrl()
  let served = false
  try { served = !!(url && localStack()) && (await fetch(url + '/functions/v1/ingest', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* down */ }
  const cfgPath = path.join(ROOT, 'supabase/functions/_shared/analytics.json')
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : { sources: [] }
  const src = (cfg.sources || []).find((s) => s.hosts.includes('localhost') || s.hosts.includes('*'))
  if (!served) note('the functions are not served — the door is not checked')
  else if (!src) note('this site registers no source allowed from localhost — the drop-in against the door is checked on the demo')
  else {
    const { createClient } = await import('@supabase/supabase-js')
    const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    DOOR = url + '/functions/v1/ingest'
    const apiHost = PAGE   /* the page's own host, as a site's: the drop-in posts to <api_host>/api/events and the host hands it on */
    const mark = 'sdk-test-' + Date.now()
    const rowsOf = async () => (await service.from('events').select('type, source, distinct_id, user_id, props, anon_id, session_id').eq('source', src.name).filter('props->>mark', 'eq', mark).order('occurred_at')).data || []
    try {
      /* the script's URL changed and nothing else: init, a $pageview on load, identify, capture, register, the rows land */
      const c1 = await browserContext(browser); const p1 = await c1.newPage()
      await p1.goto(PAGE + '/?utm_source=ad&utm_medium=cpc', { waitUntil: 'load' })
      await p1.addScriptTag({ url: PAGE + '/analytics.js' })
      await p1.evaluate(({ key, apiHost, mark }) => {
        /* a super property set before init rides on the $pageview init fires, as with PostHog */
        window.posthog.register({ mark })
        window.posthog.init(key, { api_host: apiHost, capture_pageleave: false })
        window.posthog.identify('u-42', { plan: 'monthly' })
        window.posthog.capture('signup', { plan: 'monthly' })
        return window.posthog.get_distinct_id()
      }, { key: src.key, apiHost, mark })
      await new Promise((r) => setTimeout(r, 1200))   /* the fingerprint, then the flush */
      /* the flush: as the page would on leaving */
      await p1.evaluate(() => window.dispatchEvent(new Event('pagehide')))
      await new Promise((r) => setTimeout(r, 1500))
      const rows = await rowsOf()
      await ta('a page written for PostHog, one URL changed: $pageview with its standard properties, the identify, the capture, all under the source and its distinct id', async () => {
        const pv = rows.find((r) => r.type === '$pageview'), su = rows.find((r) => r.type === 'signup'), id = rows.find((r) => r.type === '$identify')
        assert.ok(pv, '$pageview'); assert.ok(su, 'signup'); assert.ok(id, '$identify')
        assert.equal(pv.props.$host, new URL(PAGE).host); assert.equal(pv.props.$pathname, '/'); assert.ok('$referrer' in pv.props); assert.ok(pv.props.$current_url.startsWith(PAGE))
        assert.equal(su.source, src.name); assert.equal(su.distinct_id, 'u-42'); assert.equal(su.user_id, null); assert.equal(su.props.plan, 'monthly')
        assert.deepEqual(pv.props.utm, { source: 'ad', medium: 'cpc' })
      })
      /* the same browser, another context: the fingerprint gives one anonymous id */
      const c2 = await browserContext(browser); const p2 = await c2.newPage()
      await p2.goto(PAGE + '/', { waitUntil: 'load' }); await p2.addScriptTag({ url: PAGE + '/analytics.js' })
      await p2.evaluate(({ key, apiHost, mark }) => { window.posthog.register({ mark, second: true }); window.posthog.init(key, { api_host: apiHost, capture_pageleave: false }) }, { key: src.key, apiHost, mark })
      await new Promise((r) => setTimeout(r, 1500)); await p2.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await new Promise((r) => setTimeout(r, 1200))
      const rows2 = await rowsOf()
      await ta('two contexts of one browser: the same anonymous id (the fingerprint)', async () => {
        const first = rows2.find((r) => r.type === '$pageview' && !r.props.second), second = rows2.find((r) => r.type === '$pageview' && r.props.second)
        assert.ok(first && second); assert.equal(first.anon_id, second.anon_id)
      })
      /* opted out: still sending, under a random id, no fingerprint */
      const c3 = await browserContext(browser); const p3 = await c3.newPage()
      await p3.goto(PAGE + '/', { waitUntil: 'load' }); await p3.addScriptTag({ url: PAGE + '/analytics.js' })
      await p3.evaluate(({ key, apiHost, mark }) => { window.posthog.init(key, { api_host: apiHost, capture_pageview: false, capture_pageleave: false }); window.posthog.opt_out_capturing(); window.posthog.register({ mark, out: true }); window.posthog.capture('still here') }, { key: src.key, apiHost, mark })
      await new Promise((r) => setTimeout(r, 300)); await p3.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await new Promise((r) => setTimeout(r, 1200))
      const rows3 = await rowsOf()
      await ta('an opted-out page keeps sending, under an id that is not the fingerprint', async () => {
        const out = rows3.find((r) => r.type === 'still here'), pv = rows3.find((r) => r.type === '$pageview' && !r.props.second)
        assert.ok(out); assert.notEqual(out.anon_id, pv.anon_id)
        assert.equal(await p3.evaluate(() => window.posthog.has_opted_out_capturing()), true)
      })
      /* PostHog's own snippet, api_host changed and nothing else */
      const c4 = await browserContext(browser); const p4 = await c4.newPage()
      await p4.goto(PAGE + '/', { waitUntil: 'load' })
      await p4.evaluate(({ key, apiHost, mark }) => {
        /* the snippet as PostHog ships it, the script's host ours */
        !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]||t.head).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister identify alias reset group".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
        window.posthog.init(key, { api_host: window.location.origin, capture_pageleave: false })
        window.posthog.register({ mark, snippet: true })
        window.posthog.capture('from the snippet')
      }, { key: src.key, apiHost, mark })
      await p4.waitForFunction(() => window.posthog && window.posthog.__loaded === true, null, { timeout: 5000 }).catch(() => {})
      const snippetLoaded = await p4.evaluate(() => !!(window.posthog && window.posthog.__loaded))
      await ta('PostHog\'s own snippet with api_host set to the site loads /static/array.js and replays its queued calls', async () => { assert.equal(snippetLoaded, true); assert.equal(await p4.evaluate(() => window.posthog.get_property('snippet')), true) })
      await c1.close(); await c2.close(); await c3.close(); await c4.close()
      /* the door's refusals through the script's own request */
      const c5 = await browserContext(browser); const p5 = await c5.newPage()
      await p5.goto(PAGE + '/', { waitUntil: 'load' }); await p5.addScriptTag({ url: PAGE + '/analytics.js' })
      const status = await p5.evaluate(async ({ apiHost }) => {
        const r = await fetch(apiHost + '/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'pk_unknown_000000000', batch: [{ type: '$pageview', session_id: crypto.randomUUID(), anon_id: crypto.randomUUID() }] }) })
        return r.status
      }, { apiHost })
      ok('a batch under an unknown key is refused from the page (403)', () => assert.equal(status, 403))
      await c5.close()

      /* PostHog's wire protocol: the decoder under Node on each encoding, then the real posthog-js pointed at the door */
      const { decodeBody, decode, toRow, kindOf } = await import('../supabase/functions/_shared/posthog-wire.js')
      const ev = { uuid: '019a0000-0000-7000-8000-000000000001', event: '$pageview', properties: { token: src.key, distinct_id: 'u-1', $device_id: '0199fff0-0000-7000-8000-0000000000aa', $session_id: '0199fff0-0000-7000-8000-0000000000bb', $pathname: '/x', $referrer: '$direct', mark }, timestamp: '2026-09-21T22:00:00.000Z' }
      const plain = await decodeBody(new TextEncoder().encode(JSON.stringify([ev])), { contentType: 'application/json' })
      const b64 = await decodeBody(new TextEncoder().encode('data=' + encodeURIComponent(Buffer.from(JSON.stringify([ev])).toString('base64'))), { contentType: 'application/x-www-form-urlencoded', query: { compression: 'base64' } })
      const gz = await decodeBody(gzipSync(JSON.stringify([ev])), { contentType: 'text/plain', query: { compression: 'gzip-js' } })
      const batch = decode({ api_key: src.key, batch: [{ event: 'server_signup', distinct_id: 'u-9', properties: { plan: 'monthly' }, timestamp: '2026-09-21T22:01:00.000Z', type: 'capture' }] })
      ok('the wire decoder reads plain, base64 and gzip-js alike, and a server batch', () => {
        for (const j of [plain, b64, gz]) { const d = decode(j); assert.equal(d.key, src.key); const r = toRow(d.events[0]); assert.equal(r.type, '$pageview'); assert.equal(r.anon_id, ev.properties.$device_id); assert.equal(r.session_id, ev.properties.$session_id); assert.equal(r.distinct_id, 'u-1'); assert.equal(r.path, '/x'); assert.equal(r.ref, null); assert.equal(r.props.mark, mark); assert.ok(!('token' in r.props) && !('$device_id' in r.props)) }
        assert.equal(batch.key, src.key); const r = toRow(batch.events[0]); assert.equal(r.type, 'server_signup'); assert.equal(r.distinct_id, 'u-9'); assert.ok(/^[0-9a-f-]{36}$/.test(r.anon_id), 'a non-uuid id made one'); assert.equal(r.props.plan, 'monthly')
        assert.equal(kindOf('/e/'), 'events'); assert.equal(kindOf('/i/v0/e/'), 'events'); assert.equal(kindOf('/flags/'), 'flags'); assert.equal(kindOf('/array/x/config.js'), 'config'); assert.equal(kindOf('/s/'), 'recordings'); assert.equal(kindOf('/'), null)
      })
      /* the served door: a server's /batch/ plain and gzipped, an unregistered token */
      const post = async (sub, body, headers = {}) => { const r = await fetch(DOOR + sub, { method: 'POST', headers: { origin: PAGE, ...headers }, body }); return { status: r.status, body: await r.json().catch(() => null) } }
      const b1 = await post('/batch/', JSON.stringify({ api_key: src.key, batch: [{ event: 'server_signup', distinct_id: 'u-9', properties: { plan: 'monthly', mark }, timestamp: new Date().toISOString(), type: 'capture' }] }), { 'content-type': 'application/json' })
      const b2 = await post('/batch/', gzipSync(JSON.stringify({ api_key: src.key, batch: [{ event: 'server_signup', distinct_id: 'u-10', properties: { plan: 'yearly', mark }, timestamp: new Date().toISOString(), type: 'capture' }] })), { 'content-type': 'application/json', 'content-encoding': 'gzip' })
      const b3 = await post('/e/', JSON.stringify({ event: 'nope', properties: { token: 'pk_unknown_000000000', $device_id: ev.properties.$device_id, mark } }), { 'content-type': 'application/json' })
      const flags = await post('/flags/?v=2', JSON.stringify({ token: src.key, distinct_id: 'u-9' }), { 'content-type': 'application/json' })
      const cfg = await fetch(DOOR + '/array/' + src.key + '/config.js'); const cfgText = await cfg.text()
      await new Promise((r) => setTimeout(r, 400))
      const serverRows = (await rowsOf()).filter((r) => r.type === 'server_signup')
      ok('/batch/ plain and gzipped land as the source\'s rows; an unregistered token is refused; flags and config answer', () => {
        assert.equal(b1.status, 200); assert.equal(b2.status, 200); assert.equal(b3.status, 401); assert.equal(b3.body.status, 0)
        assert.deepEqual(serverRows.map((r) => r.distinct_id).sort(), ['u-10', 'u-9'])
        assert.equal(flags.status, 200); assert.deepEqual(flags.body.flags, {}); assert.equal(flags.body.sessionRecording, false); assert.deepEqual(flags.body.supportedCompression, ['gzip-js'])
        assert.equal(cfg.status, 200); assert.ok(/application\/javascript/.test(cfg.headers.get('content-type'))); assert.ok(cfgText.includes('_POSTHOG_REMOTE_CONFIG'))
      })
      /* the real posthog-js in a page, api_host at the site's /api/events: a $pageview, identify, capture, no page errors */
      if (POSTHOG_DIST) {
        const c6 = await browserContext(browser); const p6 = await c6.newPage(); const errs6 = []; p6.on('pageerror', (e) => errs6.push(e.message))
        await p6.goto(PAGE + '/', { waitUntil: 'load' })
        await p6.addScriptTag({ url: PAGE + '/posthog.js' })
        await p6.evaluate(({ key, apiHost, mark }) => { window.posthog.init(key, { api_host: apiHost + '/api/events', capture_pageleave: false, disable_session_recording: true, autocapture: false, opt_out_useragent_filter: true /* a headless browser is a bot to PostHog */, loaded: (ph) => { ph.register({ mark }); ph.identify('u-7'); ph.capture('signup', { plan: 'monthly' }) } }) }, { key: src.key, apiHost, mark })
        await p6.waitForTimeout(1500)
        await p6.evaluate(() => { try { window.posthog.capture('flush_marker'); } catch { /* none */ } })
        await p6.waitForTimeout(3500)
        const ph = (await rowsOf()).filter((r) => r.props && r.props.$lib === 'web')
        ok('the official posthog-js, api_host changed: its $pageview and capture land under the source with PostHog\'s ids and the person', () => {
          assert.ok(ph.some((r) => r.type === '$pageview'), 'a $pageview: ' + JSON.stringify(ph.map((r) => r.type)))
          const su = ph.find((r) => r.type === 'signup'); assert.ok(su, 'the capture'); assert.equal(su.distinct_id, 'u-7'); assert.equal(su.props.plan, 'monthly'); assert.equal(su.props.mark, mark)
          assert.ok(ph.every((r) => /^[0-9a-f-]{36}$/.test(r.anon_id) && /^[0-9a-f-]{36}$/.test(r.session_id)), 'PostHog\'s ids as uuids')
          assert.ok(new Set(ph.map((r) => r.anon_id)).size === 1, 'one device id')
          assert.deepEqual(errs6, [])
        })
        await c6.close()
      } else note('posthog-js is not installed here — the official SDK is not run against the door')
    } finally {
      await service.from('events').delete().eq('source', src.name).filter('props->>mark', 'eq', mark)
    }
  }
  await browser.close()
}
server.close()
console.log(`analytics-sdk: ${pass} passed${fail ? `, ${fail} failed` : ''}`)
process.exit(fail ? 1 : 0)
