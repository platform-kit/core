/*
 * UNSPLASH, as one image source among the class in ./index.js.
 *
 * Plain fetch and nothing else, so the same file runs in the dev middleware, in the Edge Function
 * and under Node in the test — the arrangement the printers and the schedulers already use.
 *
 * THREE THINGS THE LICENCE ASKS, and each is a line here rather than a note somebody has to
 * remember:
 *
 *   1. The download endpoint is hit when a picture is actually CHOSEN — not when it is searched,
 *      not when a thumbnail is drawn. That is how a photographer's downloads are counted, it is
 *      a condition of the API, and `take()` is the only moment we know a choice was made.
 *   2. The photographer is credited, with a link, and the link carries the referral tag Unsplash
 *      asks for. The credit travels with the picture into the library so the site still has it
 *      long after this module forgot.
 *   3. The key stays on the server. Every call here is made by the pipe.
 *
 * The Unsplash Licence permits commercial use and does not REQUIRE attribution the way CC-BY
 * does — but the API's terms do ask for it, and a photographer whose picture is on somebody's
 * book cover should be named regardless.
 */

const API = 'https://api.unsplash.com'
/* Unsplash asks that links back carry the application's name */
const REF = '?utm_source=platformkit&utm_medium=referral'

export const key = 'unsplash'
export const needs = ['UNSPLASH_ACCESS_KEY']
export const configured = (env = (typeof process !== 'undefined' ? process.env : {})) =>
  !!String(env.UNSPLASH_ACCESS_KEY || '').trim()

const accessKey = (env) => String((env || (typeof process !== 'undefined' ? process.env : {})).UNSPLASH_ACCESS_KEY || '').trim()
const headers = (env) => ({ Authorization: `Client-ID ${accessKey(env)}`, 'Accept-Version': 'v1' })

/* one of theirs → one of ours. `meta` is theirs and comes back untouched at take() time. */
const shape = (it) => ({
  id: it.id,
  thumb: it.urls && (it.urls.small || it.urls.thumb),
  full: it.urls && (it.urls.regular || it.urls.full),
  width: it.width,
  height: it.height,
  alt: it.alt_description || it.description || '',
  credit: {
    name: (it.user && it.user.name) || 'Unknown',
    url: (it.user && it.user.links && it.user.links.html ? it.user.links.html + REF : ''),
    source: 'Unsplash',
    sourceUrl: 'https://unsplash.com' + REF,
  },
  meta: { download: (it.links && it.links.download_location) || '', full: it.urls && (it.urls.full || it.urls.regular) },
})

export async function search(q, { page = 1, perPage = 24, env, orientation = '' } = {}) {
  const term = String(q || '').trim()
  if (!term) return { total: 0, results: [] }
  const u = new URL(API + '/search/photos')
  u.searchParams.set('query', term)
  u.searchParams.set('page', String(page))
  u.searchParams.set('per_page', String(Math.min(30, Math.max(1, perPage))))
  u.searchParams.set('content_filter', 'high')
  if (orientation) u.searchParams.set('orientation', orientation)

  const r = await fetch(u, { headers: headers(env), signal: AbortSignal.timeout(15000) })
  if (!r.ok) {
    /* a refusal that says which, because "search failed" sends somebody to the wrong place */
    const why = r.status === 401 ? 'the key was refused' : r.status === 403 ? 'the hourly allowance is spent' : `Unsplash answered ${r.status}`
    return { total: 0, results: [], error: why }
  }
  const j = await r.json()
  return { total: j.total || 0, results: (j.results || []).map(shape) }
}

/*
 * THE MOMENT A PICTURE IS CHOSEN. The download endpoint is hit first — it is what counts toward
 * the photographer, and it is asked of us by the terms — and then the bytes are fetched, so that
 * a failure to count never leaves us with a picture we did not report.
 */
export async function take(result, { env } = {}) {
  const meta = (result && result.meta) || {}
  if (meta.download) {
    try {
      await fetch(meta.download, { headers: headers(env), signal: AbortSignal.timeout(15000) })
    } catch { /* counted or not, the person still chose it; never fail a pick on this */ }
  }
  const from = meta.full || result.full
  if (!from) throw new Error('that picture has no address to fetch')
  const r = await fetch(from, { signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`Unsplash would not serve the picture (${r.status})`)
  const type = r.headers.get('content-type') || 'image/jpeg'
  const bytes = new Uint8Array(await r.arrayBuffer())
  return { bytes, type, credit: result.credit }
}
