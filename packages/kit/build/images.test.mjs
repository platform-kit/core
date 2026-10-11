/* THE IMAGE SOURCES: the class, not any one source.
 *
 * Every rule here is a rule about the shape, so a generator added next month is held to the same
 * terms Unsplash is — which is the whole point of there being a class rather than an Unsplash
 * button somewhere. Nothing here reaches the network: a source's search() and take() are its own
 * and are exercised against a fake fetch, so the test is as fast and as offline as any other.
 *
 * Run from a site's root; in npm test.
 */
import { SOURCES, sourceOf, configuredSources, missingFor, assetName } from './images/index.js'

let pass = 0, fail = 0
const ok = (msg, cond, detail) => { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg + (detail ? ' — ' + detail : '')) } }

/* ---- the shape every source wears ---- */
ok('there is at least one source', SOURCES.length > 0)
for (const s of SOURCES) {
  ok(`${s.key}: a key that is a slug`, typeof s.key === 'string' && /^[a-z][a-z0-9-]*$/.test(s.key), s.key)
  ok(`${s.key}: names what it needs`, Array.isArray(s.needs) && s.needs.length > 0 && s.needs.every((n) => /^[A-Z][A-Z0-9_]*$/.test(n)), JSON.stringify(s.needs))
  for (const fn of ['configured', 'search', 'take']) ok(`${s.key}: ${fn}() is a function`, typeof s[fn] === 'function')
  /* configured() is asked BEFORE anything is offered, so it must answer on an environment that
     holds nothing rather than reaching for process.env or throwing */
  ok(`${s.key}: configured({}) is false and does not throw`, s.configured({}) === false)
  const all = Object.fromEntries(s.needs.map((n) => [n, 'x']))
  ok(`${s.key}: configured() is true once its needs are set`, s.configured(all) === true)
  /* a key with nothing but spaces in it is not a key */
  ok(`${s.key}: blank is not configured`, s.configured(Object.fromEntries(s.needs.map((n) => [n, '   ']))) === false)
}
ok('the keys are distinct', new Set(SOURCES.map((s) => s.key)).size === SOURCES.length)

/* ---- the registry ---- */
ok('a source is found by key', sourceOf(SOURCES[0].key) === SOURCES[0])
ok('an unknown key is null, never a throw', sourceOf('nothing-like-this') === null && sourceOf('') === null)
ok('with no keys, nothing is offered', configuredSources({}).length === 0)
const one = SOURCES[0]
const env = Object.fromEntries(one.needs.map((n) => [n, 'x']))
const offered = configuredSources(env)
ok('with a key, that source is offered', offered.some((s) => s.key === one.key))
ok('what is offered carries only the key and its needs', offered.every((s) => Object.keys(s).sort().join() === 'key,needs'), JSON.stringify(offered))
ok('missingFor names what is unset', missingFor(one.key, {}).join() === one.needs.join())
ok('missingFor is empty once set', missingFor(one.key, env).length === 0)
/* never empty for a source that does not exist: empty reads as "nothing missing" and would
   offer a source nobody wrote */
ok('missingFor on an unknown source is not empty', missingFor('nope', {}).length > 0)

/* ---- the name a picture lands in the library under ----
   It must be a plain, readable file name whatever a source hands back: the library shows it, a
   person reads it, and the build resolves an address made of it. */
const n = assetName('unsplash', { id: 'aB3xY', alt: 'A quiet desk by a window' }, 'image/jpeg')
ok('the name says where it came from and what it is', n === 'unsplash-a-quiet-desk-by-a-window-aB3xY.jpg', n)
ok('a name is always a safe file name', [
  { id: '../../etc/passwd', alt: 'x' },
  { id: 'a', alt: 'Ünicode — and "quotes", and/slashes' },
  { id: 'b', alt: '' },
  { id: 'c' },
  { id: 'd', alt: 'a'.repeat(400) },
].every((r) => { const v = assetName('unsplash', r, 'image/png'); return /^[a-z0-9][a-z0-9-]*\.(png|jpg|webp|gif|avif)$/.test(v) && v.length <= 90 && !v.includes('..') }))
ok('the type decides the extension', assetName('unsplash', { id: 'q' }, 'image/webp').endsWith('.webp') && assetName('unsplash', { id: 'q' }, '').endsWith('.jpg'))
ok('the same picture twice is the same name', assetName('unsplash', { id: 'aB3xY', alt: 'A quiet desk' }, 'image/jpeg') === assetName('unsplash', { id: 'aB3xY', alt: 'A quiet desk' }, 'image/jpeg'))

/* ---- Unsplash, against a fake fetch: the licence conditions are code, not a note ---- */
const unsplash = sourceOf('unsplash')
if (unsplash) {
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (u, o) => {
    calls.push({ url: String(u), auth: (o && o.headers && o.headers.Authorization) || '' })
    if (String(u).includes('/search/photos')) return { ok: true, json: async () => ({ total: 1, results: [{
      id: 'pic1', width: 4000, height: 3000, alt_description: 'A still lake',
      urls: { small: 'https://i/small.jpg', regular: 'https://i/regular.jpg', full: 'https://i/full.jpg' },
      links: { download_location: 'https://api/photos/pic1/download' },
      user: { name: 'A Photographer', links: { html: 'https://u/a' } },
    }] }) }
    if (String(u).includes('/download')) return { ok: true, json: async () => ({ url: 'https://i/full.jpg' }) }
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  }
  try {
    const env2 = { UNSPLASH_ACCESS_KEY: 'k' }
    const got = await unsplash.search('lake', { env: env2, perPage: 24 })
    ok('a search comes back in our own shape', got.results.length === 1 && got.results[0].id === 'pic1' && got.results[0].thumb === 'https://i/small.jpg')
    ok('the photographer is credited, with a link', got.results[0].credit.name === 'A Photographer' && got.results[0].credit.url.startsWith('https://u/a'))
    ok('a link back carries the referral tag', got.results[0].credit.url.includes('utm_source=') && got.results[0].credit.sourceUrl.includes('utm_source='))
    ok('the search asks for safe pictures', calls[0].url.includes('content_filter=high'))
    ok('the key travels as the header, never in the url', calls[0].auth.includes('Client-ID') && calls[0].auth.includes('k') && !/[?&][^=]*=[^&]*\bk\b/.test(calls[0].url.replace('lake', '')))
    ok('a blank search asks nothing of anybody', (await unsplash.search('   ', { env: env2 })).results.length === 0 && calls.length === 1)

    /* THE CONDITION: the download endpoint is hit when a picture is CHOSEN, and before its bytes
       are fetched. This is what counts toward the photographer and it is asked of us by the API's
       terms — a pick that skipped it would be a licence breach, so it is a test and not a comment. */
    const before = calls.length
    const taken = await unsplash.take(got.results[0], { env: env2 })
    const after = calls.slice(before)
    ok('choosing hits the download endpoint first', after[0] && after[0].url.includes('/download'), JSON.stringify(after.map((c) => c.url)))
    ok('the download is counted as us', after[0] && after[0].auth.includes('Client-ID'))
    ok('then the bytes come back with their type', taken.bytes.length === 3 && taken.type === 'image/jpeg')
    ok('the credit travels with the picture', taken.credit && taken.credit.name === 'A Photographer')

    /* a refusal says WHICH, because "search failed" sends somebody to the wrong place */
    globalThis.fetch = async () => ({ ok: false, status: 401 })
    ok('a refused key says so', /key/.test((await unsplash.search('x', { env: env2 })).error || ''))
    globalThis.fetch = async () => ({ ok: false, status: 403 })
    ok('a spent allowance says so', /allowance/.test((await unsplash.search('x', { env: env2 })).error || ''))
  } finally { globalThis.fetch = real }
}

console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} checks passed`)
process.exit(fail ? 1 : 0)
