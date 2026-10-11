/* What a session records on arrival (lib/arrival.js, pure) on fixed addresses and user agents; then, when the local
   stack is up, the database's side: the channel rule on thirty fixed inputs, the audience partition (guests + signed
   in = everyone), recirculation on rows written for the purpose, right now, and admin_kpis' channels summing to its
   visitors and sign-ups over the seed. Everything the run writes is removed. ANALYTICS_TEST=0 skips the stack part. */
import assert from 'node:assert/strict'
import { arrival, utmOf, browserOf, osOf, deviceOf } from '../src/lib/arrival.js'

let pass = 0, fail = 0
const ok = (msg, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('  FAIL  ' + msg + '\n    ' + String(e.message).split('\n')[0]) } }

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const LINUX_FF = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0'

ok('the tags off an address, lower-cased, the rest left alone', () => {
  assert.deepEqual(utmOf('/store?utm_source=Newsletter&utm_medium=email&utm_campaign=Autumn&x=1'), { source: 'newsletter', medium: 'email', campaign: 'autumn' })
  assert.deepEqual(utmOf('https://example.com/a?utm_term=lao%20tzu&utm_content=cta-2'), { term: 'lao tzu', content: 'cta-2' })
  assert.equal(utmOf('/store'), null); assert.equal(utmOf(''), null)
})
ok('the browser families', () => {
  assert.equal(browserOf(IPHONE), 'safari'); assert.equal(browserOf(MAC_CHROME), 'chrome'); assert.equal(browserOf(MAC_SAFARI), 'safari')
  assert.equal(browserOf(WIN_EDGE), 'edge'); assert.equal(browserOf(ANDROID), 'chrome'); assert.equal(browserOf(LINUX_FF), 'firefox'); assert.equal(browserOf('curl/8'), 'other')
})
ok('the system families', () => {
  assert.equal(osOf(IPHONE), 'ios'); assert.equal(osOf(IPAD), 'ios'); assert.equal(osOf(MAC_CHROME), 'mac'); assert.equal(osOf(WIN_EDGE), 'windows')
  assert.equal(osOf(ANDROID), 'android'); assert.equal(osOf(LINUX_FF), 'linux'); assert.equal(osOf(''), 'other')
})
ok('the device class', () => {
  assert.equal(deviceOf(IPHONE), 'phone'); assert.equal(deviceOf(ANDROID), 'phone'); assert.equal(deviceOf(IPAD), 'tablet'); assert.equal(deviceOf(ANDROID_TAB), 'tablet')
  assert.equal(deviceOf(MAC_CHROME), 'desktop'); assert.equal(deviceOf(MAC_SAFARI, { coarse: true }), 'tablet', 'an iPad that says Macintosh, told by its pointer')
  assert.equal(deviceOf(WIN_EDGE, { coarse: false, width: 1400 }), 'desktop')
})
ok('the whole arrival: families only, never a version, nothing beyond the six facts', () => {
  const a = arrival({ address: '/store?utm_source=newsletter&utm_medium=email&utm_campaign=autumn', ua: IPHONE, coarse: true, width: 390, tz: 'Europe/Amsterdam', lang: 'en-GB' })
  assert.deepEqual(a, { device: 'phone', browser: 'safari', os: 'ios', utm: { source: 'newsletter', medium: 'email', campaign: 'autumn' }, tz: 'Europe/Amsterdam', lang: 'en-GB' })
  assert.deepEqual(Object.keys(arrival({ ua: MAC_CHROME })).sort(), ['browser', 'device', 'os'])
})

/* ---- the database's side ---- */
if (process.env.ANALYTICS_TEST !== '0') {
  const { createClient } = await import('@supabase/supabase-js')
  const { supabaseUrl, localStack, serviceKey } = await import('./tts/storage.mjs')
  const url = supabaseUrl(), anon = process.env.VITE_SUPABASE_ANON_KEY || ''
  let up = false
  try { up = !!(url && anon && localStack()) && (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
  if (!up) console.log('analytics: the local stack is not up — the database checks are skipped')
  else {
    const service = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: who, error: se } = await sb.auth.signInWithPassword({ email: 'admin@example.com', password: 'password123' })
    if (se) throw new Error(se.message)
    const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw new Error(name + ': ' + error.message); return data }

    /* the channel rule, thirty fixed inputs */
    const cases = [
      [null, null, 'direct'], ['', null, 'direct'], ['https://www.google.com/', null, 'search'], ['https://www.google.co.uk/search?q=x', null, 'search'], ['https://www.bing.com/', null, 'search'],
      ['https://duckduckgo.com/', null, 'search'], ['https://search.yahoo.com/', null, 'search'], ['https://www.ecosia.org/', null, 'search'], ['https://search.brave.com/', null, 'search'], ['https://yandex.ru/', null, 'search'],
      ['https://www.facebook.com/', null, 'social'], ['https://l.instagram.com/', null, 'social'], ['https://t.co/abc', null, 'social'], ['https://x.com/', null, 'social'], ['https://www.linkedin.com/', null, 'social'],
      ['https://www.reddit.com/r/x', null, 'social'], ['https://www.threads.net/', null, 'social'], ['https://www.tiktok.com/', null, 'social'], ['https://m.youtube.com/', null, 'social'], ['https://bsky.app/', null, 'social'],
      ['https://chatgpt.com/', null, 'ai'], ['https://www.perplexity.ai/', null, 'ai'], ['https://claude.ai/', null, 'ai'], ['https://gemini.google.com/', null, 'ai'], ['https://copilot.microsoft.com/', null, 'ai'],
      ['https://mail.google.com/', null, 'email'], [null, { medium: 'email', source: 'welcome' }, 'email'], ['https://www.google.com/', { medium: 'email' }, 'email'], ['https://example.org/post', null, 'referral'], ['https://news.ycombinator.com/', { medium: 'social' }, 'social'],
    ]
    let chan = 0
    for (const [ref, utm, want] of cases) { const got = await rpc('channel_of', { ref, utm }); if (got === want) chan++; else console.log(`  FAIL  channel_of(${ref}, ${JSON.stringify(utm)}) = ${got}, wanted ${want}`) }
    if (chan === cases.length) pass++; else fail++

    /* rows written for the purpose: a session A → B, a session A alone, a session that came in now */
    const mark = 'analytics-test'
    const sid1 = crypto.randomUUID(), sid2 = crypto.randomUUID(), sid3 = crypto.randomUUID(), a1 = crypto.randomUUID(), a2 = crypto.randomUUID(), a3 = crypto.randomUUID()
    const t = (m) => new Date(Date.now() - m * 60000).toISOString()
    const piece = (id) => ({ kind: 'articles', id, title: mark + ' ' + id, tags: [] })
    const rows = [
      { session_id: sid1, anon_id: a1, type: 'session_start', path: '/articles/' + mark + '-a', ref: 'https://www.google.com/', props: { entry: '/articles/' + mark + '-a', device: 'phone', browser: 'safari', os: 'ios', tz: 'Europe/Amsterdam', lang: 'nl' }, occurred_at: t(30) },
      { session_id: sid1, anon_id: a1, type: 'content_view', path: '/articles/' + mark + '-a', props: piece(mark + '-a'), occurred_at: t(30) },
      { session_id: sid1, anon_id: a1, type: 'content_view', path: '/articles/' + mark + '-b', props: piece(mark + '-b'), occurred_at: t(28) },
      { session_id: sid2, anon_id: a2, type: 'session_start', path: '/articles/' + mark + '-a', ref: null, props: { entry: '/articles/' + mark + '-a', device: 'desktop', browser: 'chrome', os: 'mac', utm: { source: 'welcome', medium: 'email', campaign: 'the first note' } }, occurred_at: t(20) },
      { session_id: sid2, anon_id: a2, type: 'content_view', path: '/articles/' + mark + '-a', props: piece(mark + '-a'), occurred_at: t(20) },
      { session_id: sid3, anon_id: a3, type: 'session_start', path: '/articles/' + mark + '-b', ref: null, props: { entry: '/articles/' + mark + '-b', device: 'desktop', browser: 'firefox', os: 'linux' }, occurred_at: t(1) },
      { session_id: sid3, anon_id: a3, type: 'pageview', path: '/articles/' + mark + '-b', props: {}, occurred_at: t(1) },
      { session_id: sid3, anon_id: a3, type: 'content_view', path: '/articles/' + mark + '-b', props: piece(mark + '-b'), occurred_at: t(1) },
      /* a site's own event, named as a script would name it, with a property */
      { session_id: sid1, anon_id: a1, type: 'Signed up for the webinar', path: '/articles/' + mark + '-a', props: { plan: 'monthly', seats: 3 }, occurred_at: t(27) },
    ]
    const { error: we } = await service.from('events').insert(rows)
    if (we) throw new Error('events: ' + we.message)
    try {
      const c = await rpc('admin_content', { days: 1, audience: 'all' })
      const A = (c.items || []).find((x) => x.id === mark + '-a'), B = (c.items || []).find((x) => x.id === mark + '-b')
      ok('recirculation: A → B in one session, A alone in another — A 50%, B 0%', () => { assert.ok(A && B); assert.equal(A.recirculation, 50); assert.equal(B.recirculation, 0) })
      const pa = await rpc('admin_piece', { kind: 'articles', id: mark + '-a', days: 1, audience: 'all', tz: 'UTC' })
      ok("a piece's page: the next piece, the channels, the devices", () => {
        assert.equal(pa.now.views, 2); assert.equal(pa.now.recirculation, 50)
        assert.ok((pa.next || []).some((n) => n.id === mark + '-b' && n.n === 1))
        assert.ok((pa.channels || []).some((x) => x.channel === 'search' && x.n === 1) && (pa.channels || []).some((x) => x.channel === 'email' && x.n === 1))
        assert.ok((pa.devices || []).some((x) => x.device === 'phone' && x.n === 1))
      })
      const now = await rpc('admin_now', {})
      ok('right now: the session of a minute ago is on the site, on its piece', () => { assert.ok(now.visitors >= 1); assert.ok((now.pieces || []).some((p) => p.id === mark + '-b')) })
      const k = await rpc('admin_kpis', { days: 1, audience: 'all', tz: 'UTC' })
      ok("the channels: search, email and direct among them, and the campaign", () => {
        const ch = Object.fromEntries((k.channels || []).map((x) => [x.channel, x]))
        assert.ok(ch.search && ch.search.visitors >= 1); assert.ok(ch.email && ch.email.visitors >= 1); assert.ok(ch.direct && ch.direct.visitors >= 1)
        assert.ok((k.campaigns || []).some((x) => x.source === 'welcome' && x.medium === 'email'))
      })
      ok('the channels partition the sessions and the credited sign-ups (a browser seen by two channels is a visitor in each)', () => {
        const sumS = (k.channels || []).reduce((s, x) => s + x.sessions, 0), sumV = (k.channels || []).reduce((s, x) => s + x.visitors, 0), sumG = (k.channels || []).reduce((s, x) => s + x.signups, 0)
        assert.equal(sumS, k.totals.sessions); assert.ok(sumV >= k.totals.visitors); assert.equal(sumG, k.goals.signups.credited); assert.ok(k.goals.signups.credited <= k.goals.signups.n)
      })
      const g = await rpc('admin_kpis', { days: 1, audience: 'guest', tz: 'UTC' }), u = await rpc('admin_kpis', { days: 1, audience: 'user', tz: 'UTC' })
      ok('the audience partitions: guests + signed in = everyone (sessions and views exactly; a browser seen both ways is a visitor in each)', () => {
        assert.equal(g.totals.sessions + u.totals.sessions, k.totals.sessions); assert.equal(g.totals.pageviews + u.totals.pageviews, k.totals.pageviews); assert.ok(g.totals.visitors + u.totals.visitors >= k.totals.visitors)
      })
      /* the filters: a chip narrows every read; the channels partition the sessions */
      const byChannel = await Promise.all((k.channels || []).map((c) => rpc('admin_kpis', { days: 1, audience: 'all', tz: 'UTC', filters: { channel: c.channel } })))
      ok('a channel chip narrows the sessions, and the chips partition the whole', () => {
        assert.equal(byChannel.reduce((n, x) => n + x.totals.sessions, 0), k.totals.sessions)
        for (const [i, c] of (k.channels || []).entries()) assert.equal(byChannel[i].totals.sessions, c.sessions)
      })
      const phone = await rpc('admin_kpis', { days: 1, audience: 'all', tz: 'UTC', filters: { channel: 'search', device: 'phone' } })
      ok('two chips together: the search session on a phone alone', () => { assert.ok(phone.totals.sessions >= 1); assert.ok(phone.totals.sessions <= (k.channels.find((c) => c.channel === 'search') || {}).sessions) })
      const cf = await rpc('admin_content', { days: 1, audience: 'all', published: {}, filters: { channel: 'email' } })
      ok('the content page narrows to the chip too', () => { const A2 = (cf.items || []).find((x) => x.id === mark + '-a'); assert.ok(A2 && A2.views === 1) })
      /* a site's own goal: registered by key, counted and per channel */
      const kg = await rpc('admin_kpis', { days: 1, audience: 'all', tz: 'UTC', filters: {}, goals: [{ key: 'Signed up for the webinar', label: 'Webinar', value: 'seats' }] })
      ok('a registered goal is counted with its value, and per channel', () => {
        const g = (kg.goals.custom || []).find((x) => x.key === 'Signed up for the webinar'); assert.ok(g && g.n >= 1 && g.value >= 3)
        assert.ok((kg.channels || []).some((c) => c.channel === 'search' && (c.custom || {})['Signed up for the webinar'] >= 1))
      })
      /* the events read: every name as sent, and one opened */
      const ev = await rpc('admin_events', { days: 1, audience: 'all', filters: {}, event: 'Signed up for the webinar' })
      ok('the events read lists a name as it was sent, with its people and top values', () => {
        const e = (ev.events || []).find((x) => x.type === 'Signed up for the webinar'); assert.ok(e && e.n >= 1 && e.people >= 1)
        assert.ok(ev.one && (ev.one.properties || []).some((pp) => pp.key === 'plan' && pp.values.some((v) => v.value === 'monthly')))
        assert.ok((ev.one.channels || []).some((c) => c.channel === 'search'))
      })
      /* retention: recomputed from the rows for the last two weeks */
      const ret = await rpc('admin_retention', { weeks: 8, audience: 'all', filters: {} })
      const allRows = []; for (let from = 0; ; from += 1000) { const { data: page } = await service.from('events').select('anon_id, occurred_at').is('source', null).order('id').range(from, from + 999); allRows.push(...(page || [])); if (!page || page.length < 1000) break }
      const firstOf = {}; for (const r of allRows) { const t0 = Date.parse(r.occurred_at); if (!(r.anon_id in firstOf) || t0 < firstOf[r.anon_id]) firstOf[r.anon_id] = t0 }
      const week = (ms) => { const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)); return m.getTime() }
      ok('retention: each cohort\'s size is the browsers first seen that week', () => {
        for (const row of ret) { const wk = Date.parse(row.week + 'T00:00:00Z'); const size = Object.values(firstOf).filter((f) => week(f) === wk).length; assert.equal(row.size, size, row.week) }
      })
      /* a chip narrows the cohorts to the browsers whose first session passes it, and never widens one */
      const retS = await rpc('admin_retention', { weeks: 8, audience: 'all', filters: { channel: 'search' } })
      const retD = await rpc('admin_retention', { weeks: 8, audience: 'all', filters: { channel: 'direct' } })
      ok('retention honours a chip: search and direct cohorts each within the whole, and together no more than it', () => {
        const by = (rows) => Object.fromEntries(rows.map((r) => [r.week, r.size]))
        const all = by(ret), bs = by(retS), bd = by(retD)
        for (const w of Object.keys(all)) { assert.ok((bs[w] || 0) <= all[w] && (bd[w] || 0) <= all[w] && (bs[w] || 0) + (bd[w] || 0) <= all[w], w) }
        assert.ok(Object.values(bs).some((n) => n > 0) || Object.values(all).every((n) => n === 0))
      })
      const member = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
      await member.auth.signInWithPassword({ email: 'member@example.com', password: 'password123' })
      const r = await member.rpc('admin_piece', { kind: 'articles', id: mark + '-a', days: 1 })
      ok('a member is refused the piece read', () => assert.ok(r.error && /42501|admin only/.test(r.error.code + r.error.message)))
    } finally {
      await service.from('events').delete().in('session_id', [sid1, sid2, sid3])
    }

    /* the door, against the served function: the site's own batch with the reader's JWT, a country from the host's header,
       a malformed name, a source's key and origin */
    let served = false
    try { served = (await fetch(url + '/functions/v1/ingest', { method: 'OPTIONS', signal: AbortSignal.timeout(2000) })).status < 500 } catch { /* not served */ }
    if (!served) console.log('analytics: the functions are not served (npm run dev serves them) — the door is not checked')
    else {
      const fsMod = await import('node:fs')
      const cfg = JSON.parse(fsMod.readFileSync('supabase/functions/_shared/analytics.json', 'utf8'))
      const sid = crypto.randomUUID(), aid = crypto.randomUUID()
      const post = (body, headers = {}) => fetch(url + '/functions/v1/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon, ...headers }, body: JSON.stringify(body) })
      const row = (type, extra = {}) => ({ type, session_id: sid, anon_id: aid, path: '/', props: {}, occurred_at: new Date().toISOString(), ...extra })
      try {
        const bad = await post({ batch: [row('<script>alert(1)')] })
        const long = await post({ batch: [row('x'.repeat(200))] })
        ok('a malformed event name is refused and nothing written', () => { assert.equal(bad.status, 400); assert.equal(long.status, 400) })
        const token = (await sb.auth.getSession()).data.session.access_token
        const mine = await post({ batch: [row('session_start', { props: { entry: '/' }, user_id: '00000000-0000-4000-8000-000000000000' }), row('Signed up for the webinar')] }, { Authorization: 'Bearer ' + token, 'x-country': 'nl' })
        /* THE DOOR ANSWERS BEFORE THE ROWS ARE THERE — it takes the batch and writes it, so a read
           the same millisecond can find one row or none. Wait for what was sent rather than
           asserting on whatever happened to have landed: that race passed on a warm function and
           failed in a full run, which is the worst way for a check to be wrong. */
        const rowsIn = async (n) => { let r = []; for (let i = 0; i < 40; i++) { r = (await service.from('events').select('type, user_id, props, source').eq('session_id', sid).order('occurred_at')).data || []; if (r.length >= n) return r; await new Promise((z) => setTimeout(z, 250)) } return r }
        const got = await rowsIn(2)
        ok('the signed-in reader\'s rows carry their user from the JWT alone, the name as sent, the country from the header', () => {
          assert.equal(mine.status, 200); assert.equal(got.length, 2)
          assert.ok(got.every((r) => r.user_id === who.user.id)); assert.equal(got[0].props.country, 'NL'); assert.ok(got.some((r) => r.type === 'Signed up for the webinar')); assert.ok(got.every((r) => r.source === null))
        })
        const unknown = await post({ key: 'pk_no_such_key_000000', batch: [row('$pageview')] })
        ok('a batch under an unknown key is refused', () => assert.equal(unknown.status, 403))
        const src = (cfg.sources || [])[0]
        if (!src) console.log('analytics: this site registers no source — the origin check is on the demo')
        else {
          const wrong = await post({ key: src.key, batch: [row('$pageview')] }, { Origin: 'https://nowhere.invalid' })
          const right = await post({ key: src.key, batch: [row('$pageview', { distinct_id: 'u-42' })] }, { Origin: 'https://' + src.hosts[0] })
          let srows = []
          for (let i = 0; i < 40; i++) { srows = (await service.from('events').select('type, user_id, source, distinct_id').eq('session_id', sid).eq('type', '$pageview')).data || []; if (srows.length) break; await new Promise((z) => setTimeout(z, 250)) }
          ok('a source\'s batch: refused from a wrong origin, landed from an allowed one with its name and distinct id and no user', () => {
            assert.equal(wrong.status, 403); assert.equal(right.status, 200); assert.equal(srows.length, 1)
            assert.equal(srows[0].source, src.name); assert.equal(srows[0].distinct_id, 'u-42'); assert.equal(srows[0].user_id, null)
          })
        }
      } finally {
        await service.from('events').delete().eq('session_id', sid)
      }
    }
    void who
  }
}

console.log(`analytics: ${pass} passed${fail ? `, ${fail} failed` : ''}`)
process.exit(fail ? 1 : 0)
