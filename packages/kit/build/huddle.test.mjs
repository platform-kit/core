/*
 * A call that needs no account: the ICE servers a browser is handed and where they came from, the
 * standard's own credential (pinned against a known HMAC vector, because a relay somewhere else has
 * to accept what we mint), the provider a room gets from what the site has, and the mesh's own
 * answers — its cap, its refusal to pretend it records, and a token that names one person and one
 * room. Nothing here reaches any provider: a check asserts that no vendor is named in the kit's own
 * code or in a variable it reads.
 */
import { createHmac } from 'node:crypto'
import { stackOf } from './test-stack.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { iceServers, hmacCredential } from '../supabase/functions/_shared/video/ice.js'
import { mesh, MESH_MAX, readToken } from '../supabase/functions/_shared/video/mesh.js'
import { videoIdOf, VIDEO_IDS } from '../supabase/functions/_shared/video/choose.js'
import { shouldOffer, shouldAnswer, livePeers, roomFull, tiles, layoutOf, stateOf, reachable } from '../src/lib/call/rules.js'
import { context as browserContext } from './browser.mjs'   /* one timeout for every browser here: build/browser.mjs */

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const envOf = (o) => (k) => (o[k] === undefined ? '' : o[k])

console.log('\nHUDDLE\n')

/* --- the credential the standard defines --- */
{
  const secret = 'a-shared-secret'
  const { username, credential } = await hmacCredential(secret, 'ada', 600)
  const [expiry, who] = username.split(':')
  ok('the name is when it expires and who it is for', who === 'ada' && Number(expiry) > Math.floor(Date.now() / 1000))
  /* what coturn will compute for that same name */
  const theirs = createHmac('sha1', secret).update(username).digest('base64')
  ok('the credential is what coturn computes for it', credential === theirs, credential + ' vs ' + theirs)
  const { username: u2 } = await hmacCredential(secret, 'grace', 600)
  ok('another person gets another name', u2.endsWith(':grace'))
  const short = await hmacCredential(secret, 'ada', 1)
  ok('a credential never outlives the shortest life we allow', Number(short.username.split(':')[0]) - Math.floor(Date.now() / 1000) >= 60)
}

/* --- what a browser is handed, and from where --- */
{
  const stunOnly = await iceServers({ env: envOf({}) })('ada', 'r1')
  ok('with nothing set, STUN alone', stunOnly.relay === false && stunOnly.source === 'stun')
  ok('and it is STUN, not nothing', stunOnly.iceServers.length > 0 && /^stun:/.test(stunOnly.iceServers[0].urls))
  const own = await iceServers({ env: envOf({ WEBRTC_STUN: 'stun:stun.example.org:3478' }) })('ada', 'r1')
  ok('a site may name its own STUN', own.iceServers[0].urls === 'stun:stun.example.org:3478' && own.iceServers.length === 1)

  const secret = await iceServers({ env: envOf({ WEBRTC_TURN_URL: 'turn:relay.example.org:3478', WEBRTC_TURN_SECRET: 's3cret' }) })('ada', 'r1', 600)
  ok('a url and a secret make a relay', secret.relay === true && secret.source === 'secret')
  const turn = secret.iceServers.find((x) => String(x.urls).startsWith('turn'))
  ok('minted for the person who asked', turn.username.endsWith(':ada'))
  ok('and it expires', secret.expiry > Math.floor(Date.now() / 1000))

  const pair = await iceServers({ env: envOf({ WEBRTC_TURN_URL: 'turn:relay.example.org:3478', WEBRTC_TURN_USERNAME: 'u', WEBRTC_TURN_PASSWORD: 'p' }) })('ada', 'r1')
  ok('a long-term pair is a relay too', pair.relay === true && pair.source === 'pair')
  const half = await iceServers({ env: envOf({ WEBRTC_TURN_URL: 'turn:relay.example.org:3478' }) })('ada', 'r1')
  ok('a url with no way to authorise against it is not a relay, and says so', half.relay === false && half.source === 'stun')

  /* a site's own module — where a hosted relay with its own endpoint lives, never in the kit */
  const asked = []
  const mod = async ({ person, room }) => { asked.push([person, room]); return [{ urls: 'turn:theirs.example.net:3478', username: 'x', credential: 'y' }] }
  const viaModule = await iceServers({ env: envOf({}), ice: mod })('ada', 'r1')
  ok('a site may answer for itself', viaModule.source === 'module' && viaModule.relay === true)
  ok('and is told who and where it is for', eq(asked, [['ada', 'r1']]))
}

/* --- the provider a room gets --- */
{
  const keyed = envOf({ LIVEKIT_URL: 'wss://x', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' })
  const bare = envOf({})
  const roomType = { where: { kind: 'video' } }
  ok('a cal.com type keeps cal.com’s own', videoIdOf({ scheduler: 'cal' }, keyed) === 'cal-video')
  ok('a url with no scheduler is cal.com’s too', videoIdOf({ url: 'https://cal.com/a/b' }, bare) === 'cal-video')
  ok('a room on a site with an account is LiveKit’s', videoIdOf(roomType, keyed) === 'livekit')
  ok('a room on a site with none is made browser to browser', videoIdOf(roomType, bare) === 'mesh')
  ok('half an account is no account', videoIdOf(roomType, envOf({ LIVEKIT_URL: 'wss://x' })) === 'mesh')
  ok('a session that happens anywhere else has no provider', videoIdOf({ where: { kind: 'phone' } }, keyed) === null)
  ok('the mesh is one of the providers', VIDEO_IDS.includes('mesh'))
}

/* --- the mesh's own answers --- */
{
  const env = envOf({ APP_URL: 'https://site.example', SUPABASE_SERVICE_ROLE_KEY: 'srv' })
  const m = mesh({ db: null, env })
  ok('it needs nothing, so it is always there', m.configured() === true)
  ok('and it is never a mock: there is no service to stand in for', m.mock() === false)
  ok('it carries five, everyone counted the same', m.max === 5 && MESH_MAX === 5)
  ok('it does not pretend to record', !!m.record().error && /not recorded/.test(m.record().error))
  ok('and says so in what it hands out', m.records === false)

  const b = { id: 'h1', uid: 'h1', room: 'chan-1' }
  ok('the room is the site’s own page', m.room(b).join_url === 'https://site.example/app/call/h1')
  const cred = await m.admit(b, { id: 'ada', name: 'Ada' }, 'member')
  ok('a person is admitted to one room', cred.topic === 'call:chan-1' && cred.provider === 'mesh')
  ok('with what a browser needs to find itself', Array.isArray(cred.iceServers) && cred.iceServers.length > 0)
  ok('and is told the call is not recorded', cred.recorded === false)
  ok('and how many it carries', cred.max === 5)

  const read = await readToken('srv', cred.token)
  ok('the token names the person and the room', read && read.id === 'ada' && read.room === 'chan-1')
  ok('and nobody else can have made it', (await readToken('another-secret', cred.token)) === null)
  const tampered = cred.token.split('.')[0] + '.' + 'x'.repeat(43)
  ok('a token with its signature changed is refused', (await readToken('srv', tampered)) === null)
  const stale = await mesh({ db: null, env }).admit(b, { id: 'ada' }, 'member', { ttl: 60 })
  ok('a token expires', (await readToken('srv', stale.token)).exp * 1000 > Date.now())
}

/* --- the rules a mesh call follows in the browser --- */
{
  /* who offers: both sides apply one rule to the same two names and reach opposite answers, which is
     what keeps two offers from colliding without anyone arbitrating */
  ok('of two people, one offers', shouldOffer('aaa', 'bbb') === true && shouldOffer('bbb', 'aaa') === false)
  ok('and the other answers', shouldAnswer('bbb', 'aaa') === true && shouldAnswer('aaa', 'bbb') === false)
  ok('never both, whichever way round', ['aaa', 'bbb'].every((a) => ['aaa', 'bbb'].every((b) => a === b || shouldOffer(a, b) !== shouldOffer(b, a))))
  ok('and never neither', shouldOffer('x', 'y') || shouldOffer('y', 'x'))

  const now = Date.parse('2026-09-22T12:00:00.000Z')
  const at = (mins) => new Date(now - mins * 60000).toISOString()
  const heard = [
    { id: 'me', at: at(0) }, { id: 'a', at: at(0) }, { id: 'a', at: at(2) }, { id: 'b', at: at(0) }, { id: 'old', at: at(5) },
  ]
  const live = livePeers(heard, 'me', now)
  ok('the reader is not their own peer', !live.some((p) => p.id === 'me'))
  ok('one person heard twice is one person', live.filter((p) => p.id === 'a').length === 1)
  ok('and it is the newer hello that counts', live.find((p) => p.id === 'a').at === at(0))
  ok('someone who stopped saying they are here is gone', !live.some((p) => p.id === 'old'))
  ok('so two people are two', live.length === 2)

  ok('a room fills at its cap', roomFull(5, 5) === true && roomFull(4, 5) === false)
  ok('and a cap of nothing never fills', roomFull(99, 0) === false)

  const W = { you: 'You', someone: 'someone' }
  const list = tiles([{ id: 'b', name: 'Zoe' }, { id: 'a', name: 'Ada' }], { id: 'me' }, W)
  ok('the reader is the first tile', list[0].me === true && list[0].name === 'You')
  ok('and the rest are by name', list[1].name === 'Ada' && list[2].name === 'Zoe')
  ok('a person with no name is not a blank', tiles([{ id: 'x' }], { id: 'me' }, W)[1].name === 'someone')

  ok('alone, in a pair, or a grid', layoutOf(1) === 'alone' && layoutOf(2) === 'pair' && layoutOf(3) === 'grid')
  ok('and a shared screen takes the stage', layoutOf(4, true) === 'stage')

  ok('a connection is said in one word', stateOf('connected') === 'connected' && stateOf('completed') === 'connected' && stateOf('checking') === 'connecting' && stateOf('failed') === 'failed' && stateOf('closed') === 'gone')

  ok('a call that connected is fine', reachable({ relay: false, state: 'connected' }).ok === true)
  ok('a call still trying is not yet a problem', reachable({ relay: false, state: 'connecting', seconds: 3 }).waiting === true)
  ok('one that cannot connect with no relay says which', reachable({ relay: false, state: 'connecting', seconds: 20 }).reason === 'no-relay')
  ok('one that failed with a relay says that instead', reachable({ relay: true, state: 'failed' }).reason === 'failed')
  ok('and a relay buys it time rather than a spinner forever', reachable({ relay: true, state: 'connecting', seconds: 20 }).waiting === true)
}

/* --- nothing of anyone else's is named --- */
{
  const here = path.dirname(fileURLToPath(import.meta.url))
  const files = ['ice.js', 'mesh.js', 'choose.js'].map((n) => fs.readFileSync(path.join(here, '../supabase/functions/_shared/video', n), 'utf8'))
  const code = files.join('\n').replace(/\/\*[\s\S]*?\*\//g, '')   /* the comments may name one as an example */
  const vendors = /cloudflare|twilio|xirsys|metered|expressturn|turnix/i
  ok('no relay provider is named in the kit’s code', !vendors.test(code.replace(/stun\.cloudflare\.com/g, '')), (code.match(vendors) || [])[0])
  ok('nor in any variable it reads', !/WEBRTC_[A-Z_]*(CLOUDFLARE|TWILIO|XIRSYS|METERED)/i.test(files.join('\n')))
}

/* --- two browsers, one huddle, no account anywhere --- */
/* Skipped unless a dev server is up: this is the one part that cannot be proven without two real
   browsers exchanging real media. Chromium's fake devices stand in for a camera and a microphone. */
const APP = process.env.HUDDLE_APP || stackOf()?.app || ''
/* THE ROOM IS THE SITE'S, not this file's: every site names its spaces itself, and a path written
   here would only ever open on one of them. The staff space is the one both of these accounts are
   in — its fill is roles — so it is the room, and HUDDLE_ROOM overrides for a site with none. */
const ROOM = process.env.HUDDLE_ROOM || (() => {
  const dir = 'content/spaces'
  if (!fs.existsSync(dir)) return '/spaces/the-team/general'
  const spaces = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  const kindOf = (sl) => (/^kind:\s*(\S+)/m.exec(fs.readFileSync(path.join(dir, sl + '.md'), 'utf8')) || [])[1] || ''
  const space = spaces.find((sl) => kindOf(sl) === 'staff') || spaces[0]
  if (!space) return '/spaces/the-team/general'
  const rooms = fs.existsSync(path.join(dir, space)) ? fs.readdirSync(path.join(dir, space)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort() : []
  return '/spaces/' + space + '/' + (rooms.includes('general') ? 'general' : rooms[0] || 'general')
})()
let appUp = false
try { appUp = (await fetch(APP, { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (process.env.HUDDLE_LIVE === '0' || !appUp) {
  console.log('  (the two-browser call is skipped \u2014 no dev server on ' + APP + ')')
} else {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
  const foreign = []
  const sign = async (page, who) => {
    page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1', 'host.docker.internal'].includes(u.hostname)) foreign.push(u.host) })
    await page.goto(APP + '/', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.DLauth, null, { timeout: 25000 })
    await page.evaluate(() => window.DLauth.open({}))
    await page.waitForSelector('input[type=email]')
    /* each value taken by Vue before the next is typed: filled back to back under load, the form went up half-empty */
    await page.fill('input[type=email]', who)
    await page.waitForFunction((v) => document.querySelector('input[type=email]')?.value === v, who)
    await page.fill('input[type=password]', 'password123')
    await page.waitForFunction(() => document.querySelector('input[type=password]')?.value === 'password123')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.includes('auth-token')), null, { timeout: 25000 })
    /* the room by its own address: a space opens on its home, so clicking about to find a room is
       both slower and a test of the rail rather than of the call */
    await page.goto(APP + ROOM, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
  }
  try {
    const one = await browserContext(browser, { viewport: { width: 1100, height: 800 }, permissions: ['camera', 'microphone'] })
    const two = await browserContext(browser, { viewport: { width: 1100, height: 800 }, permissions: ['camera', 'microphone'] })
    const a = await one.newPage(), b = await two.newPage()
    await sign(a, 'admin@example.com')
    await sign(b, 'coach@example.com')

    await a.locator('.sp-huddle').click()
    /* wait for the thing itself rather than for a number of seconds: a call is timing-sensitive and
       a sleep that is long enough on an idle machine is flaky on a busy one */
    await a.waitForFunction(() => document.querySelectorAll('.sq-tiles li').length >= 1, null, { timeout: 30000 })
    ok('alone in a huddle, the reader sees themselves', (await a.locator('.sq-tiles li').count()) === 1)
    ok('and is told the call is not recorded', /not recorded/i.test(await a.locator('.sq-fine').first().innerText()))
    /* the number, not the wording: the words are the site's to change (spaces.md: carries) */
    ok('and how many it carries', new RegExp('\\b' + MESH_MAX + '\\b').test(await a.locator('.sq-fine').first().innerText()))
    ok('and the huddle is a panel rather than the whole screen', (await a.locator('.sq.big').count()) === 0)

    /* from here on, anything the call reaches for would show. The page's own errands — the web
       fonts, the reader's speech weights — are not the call's and are named so they cannot hide one. */
    foreign.length = 0
    await b.locator('.sp-huddle').click()
    for (const pg of [a, b]) {
      await pg.waitForFunction(() => {
        const v = [...document.querySelectorAll('.sq-tiles video')]
        return v.length === 2 && v.every((x) => x.srcObject && x.videoWidth > 0)
      }, null, { timeout: 60000 }).catch(() => {})
    }
    ok('the two of them see two tiles each', (await a.locator('.sq-tiles li').count()) === 2 && (await b.locator('.sq-tiles li').count()) === 2)
    /* the dock is faces; the names are in the panel opened larger, which is where there is room */
    await a.locator('.sq-ico').first().click()
    await a.waitForTimeout(400)
    const names = await a.locator('.sq-name').allInnerTexts()
    ok('and each other by name once it is opened larger', names.some((n) => /Coach Person/.test(n)) && names.some((n) => /You/.test(n)), names.join(' / '))
    const live = await a.evaluate(() => [...document.querySelectorAll('.sq-tiles video')].map((v) => ({ on: !!v.srcObject, w: v.videoWidth })))
    ok('with media actually flowing between them', live.length === 2 && live.every((v) => v.on && v.w > 0), JSON.stringify(live))
    ok('and no trouble to report', (await a.locator('.sq-trouble').count()) === 0)
    const PAGE_OWN = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|huggingface\.co|hf\.co)$/
    const forCall = [...new Set(foreign)].filter((h) => !PAGE_OWN.test(h))
    ok('nothing left the site to make the call happen', forCall.length === 0, forCall.join(', '))

    await a.locator('.sq-hang').click()
    await b.waitForFunction(() => document.querySelectorAll('.sq-tiles li').length === 1, null, { timeout: 30000 }).catch(() => {})
    ok('when one leaves, the other is alone again', (await b.locator('.sq-tiles li').count()) === 1, String(await b.locator('.sq-tiles li').count()))
  } finally {
    await browser.close()
  }
}

console.log('\nhuddle: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : '') + '\n')
process.exit(fail ? 1 : 0)
