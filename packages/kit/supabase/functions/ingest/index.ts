/*
 * The one door for events. POST { key?, batch: [{ type, props, path, ref, topic_slugs, occurred_at, session_id, anon_id, distinct_id }] }.
 *
 *   The site's own events come with no key: the request carries the anon key and, when the reader is signed in, their
 *   JWT — the user is taken from that alone (never from the body), so on a PlatformKit site a signed-in account is
 *   identified by its session and nothing calls identify.
 *   A source's events (the drop-in script on another site) come with the source's key, registered in the site's config
 *   (analytics.sources → _shared/analytics.json); the request's origin must be one of the source's hosts. The rows carry
 *   the source's name and the distinct_id the script identified, never a user of this site.
 *
 * What the door checks: an event's name is a well-formed one (letters, digits, _ $ : . and spaces, 64 characters), at
 * most 50 rows a batch and 8 KB of props a row, ids that are uuids, a time within a day of now (else now). What it
 * stamps: on a session's first event, the country the host's geo header reports (cf-ipcountry, x-vercel-ip-country,
 * cloudfront-viewer-country, x-country) — none locally, and the reads say unknown; no IP is ever stored. 600 rows a
 * minute per anonymous id, else 429. Nothing here reads a cookie.
 *
 * The door speaks PostHog's wire protocol too, so any official PostHog SDK pointed at the site (api_host) is a source:
 * under the function, /e/, /i/v0/e/, /capture/ and /batch/ take PostHog's events in its encodings (_shared/posthog-wire.js
 * reads them into the same rows, under the registered key the event carries), /flags/ and /decide/ answer with every
 * PostHog feature off and gzip-js welcome, /array/<token>/config(.js) an empty remote config, /s/ (recordings) is
 * dropped, and /static/array.js redirects to the site's own file for the snippet. The origin, the size and name checks,
 * the country and the rate limit are the one code path.
 */
import { admin, getUser } from '../_shared/lib.ts'
import { throughDoor } from '../_shared/doors.ts'
import config from '../_shared/analytics.json' with { type: 'json' }
import { kindOf, decodeBody, decode, toRow, FLAGS, remoteConfigJs } from '../_shared/posthog-wire.js'

type Source = { key: string; name: string; hosts: string[] }
const SOURCES = ((config as { sources?: Source[] }).sources ?? []) as Source[]
const NAME = /^[A-Za-z$][A-Za-z0-9_$:. -]{0,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ROWS = 50, MAX_PROPS = 8192, RATE = 600
const GEO = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'x-country']

const corsFor = (origin: string) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  Vary: 'Origin',
})
/* the path under the function: nothing for the site's own batch, PostHog's paths for its SDKs */
const subpath = (req: Request) => { const p = new URL(req.url).pathname.replace(/^.*?\/ingest(?=\/|$)/, ''); return p.replace(/\/+$/, '') || '/' }
const reply = (body: unknown, status: number, origin: string) => new Response(JSON.stringify(body), { status, headers: { ...corsFor(origin), 'Content-Type': 'application/json' } })

/* the host a request came from (the name, never the port): the Origin header, else the Referer's */
function originHost(req: Request) {
  const o = req.headers.get('origin') ?? ''
  try { if (o) return new URL(o).hostname.toLowerCase() } catch { /* none */ }
  const r = req.headers.get('referer') ?? ''
  try { if (r) return new URL(r).hostname.toLowerCase() } catch { /* none */ }
  return ''
}
const hostOk = (source: Source, host: string) => source.hosts.some((h) => h === '*' || h === host || (h.startsWith('*.') && host.endsWith(h.slice(1))))

/* the rate: rows a minute per anonymous id, in this instance's memory — enough for any page, a wall for a loop */
const seen = new Map<string, { n: number; at: number }>()
function rateOk(anon: string, rows: number) {
  const now = Date.now(), r = seen.get(anon)
  if (!r || now - r.at > 60000) { seen.set(anon, { n: rows, at: now }); if (seen.size > 5000) seen.clear(); return true }
  r.n += rows
  return r.n <= RATE
}

function country(req: Request) {
  for (const h of GEO) { const v = (req.headers.get(h) ?? '').trim().toUpperCase(); if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return v }
  return null
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? ''
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(origin) })
  const url = new URL(req.url), q: Record<string, string> = {}; url.searchParams.forEach((v, k) => { q[k] = v })
  const kind = kindOf(subpath(req))

  /* ---- PostHog's protocol: what its SDKs ask beside the events ---- */
  if (kind === 'flags') { let token = q.token ?? ''; try { const j = await decodeBody(new Uint8Array(await req.arrayBuffer()), { contentType: req.headers.get('content-type') ?? '', query: q, contentEncoding: req.headers.get('content-encoding') ?? '' }); token = String(j?.token ?? j?.api_key ?? token) } catch { /* an empty body */ } return reply(FLAGS(token), 200, origin) }
  if (kind === 'config') { const m = /^\/array\/([^/]+)\/config(\.js)?$/.exec(subpath(req)) as RegExpExecArray; const token = decodeURIComponent(m[1]); return m[2] ? new Response(remoteConfigJs(token), { status: 200, headers: { ...corsFor(origin), 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' } }) : reply({ config: FLAGS(token), siteApps: [] }, 200, origin) }
  if (kind === 'recordings') return reply({ status: 1 }, 200, origin)
  if (kind === 'asset') { const site = (Deno.env.get('APP_URL') ?? Deno.env.get('VITE_APP_URL') ?? '').replace(/\/+$/, ''); return new Response(null, { status: 302, headers: { ...corsFor(origin), Location: site + '/static/array.js' } }) }
  if (req.method !== 'POST') return reply({ error: 'method' }, 405, origin)
  if (kind === null && subpath(req) !== '/') return reply({ error: 'route' }, 404, origin)

  let body: { key?: string; batch?: unknown[] }
  let posthog = false
  if (kind === 'events') {
    /* PostHog's events, in any of its encodings, become the site's own batch under the key the event carries */
    let json: unknown
    try { json = await decodeBody(new Uint8Array(await req.arrayBuffer()), { contentType: req.headers.get('content-type') ?? '', query: q, contentEncoding: req.headers.get('content-encoding') ?? '' }) } catch { return reply({ status: 0, error: 'json' }, 400, origin) }
    const d = decode(json, q)
    if (!d.key) return reply({ status: 0, error: 'token', message: 'a registered key as the event\'s token or the batch\'s api_key' }, 401, origin)
    body = { key: d.key, batch: d.events.map(toRow) }
    posthog = true
  } else {
    try { body = await req.json() } catch { return reply({ error: 'json' }, 400, origin) }
  }
  const batch = Array.isArray(body?.batch) ? body.batch : []
  if (!batch.length) return reply({ ok: true, n: 0 }, 200, origin)
  if (batch.length > MAX_ROWS) return reply({ error: 'batch', message: `at most ${MAX_ROWS} rows a batch` }, 400, origin)

  /* whose events: a source's, by its key and origin; else this site's, by the caller's session */
  let source: Source | null = null, userId: string | null = null
  const key = String(body.key ?? '').trim()
  if (key) {
    source = SOURCES.find((s) => s.key === key) ?? null
    if (!source) return reply(posthog ? { status: 0, error: 'token', message: 'no such source' } : { error: 'key', message: 'no such source' }, posthog ? 401 : 403, origin)
    if (!hostOk(source, originHost(req))) return reply({ error: 'origin', message: 'this origin may not send under that key' }, 403, origin)
  } else {
    const user = await getUser(req)
    userId = user?.id ?? null
  }

  const geo = country(req)
  const now = Date.now()
  const rows: Record<string, unknown>[] = []
  let anonForRate = ''
  for (const raw of batch) {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const type = String(e.type ?? '')
    if (!NAME.test(type)) return reply({ error: 'type', message: `"${type.slice(0, 40)}" is not an event name` }, 400, origin)
    const session = String(e.session_id ?? ''), anon = String(e.anon_id ?? '')
    if (!UUID.test(session) || !UUID.test(anon)) return reply({ error: 'id', message: 'session_id and anon_id are uuids' }, 400, origin)
    const props = e.props && typeof e.props === 'object' && !Array.isArray(e.props) ? e.props as Record<string, unknown> : {}
    if (JSON.stringify(props).length > MAX_PROPS) return reply({ error: 'props', message: `props over ${MAX_PROPS} bytes` }, 400, origin)
    let at = Date.parse(String(e.occurred_at ?? ''))
    if (!Number.isFinite(at) || Math.abs(now - at) > 86400e3) at = now
    /* the country on a session's first event alone; never anything of the address itself */
    const first = type === 'session_start' || type === '$pageview'
    const p = first && geo && !('country' in props) ? { ...props, country: geo } : props
    const topics = Array.isArray(e.topic_slugs) && e.topic_slugs.length ? e.topic_slugs.slice(0, 20).map(String) : null
    rows.push({
      session_id: session, anon_id: anon, user_id: source ? null : userId, type,
      path: e.path == null ? null : String(e.path).slice(0, 2048), ref: e.ref == null ? null : String(e.ref).slice(0, 2048),
      topic_slugs: topics, props: p, occurred_at: new Date(at).toISOString(),
      source: source ? source.name : null, distinct_id: source && e.distinct_id != null ? String(e.distinct_id).slice(0, 200) : null,
    })
    anonForRate = anon
  }
  if (!rateOk(anonForRate, rows.length)) return reply({ error: 'rate' }, 429, origin)
  /* and per visitor, where every isolate counts: the id above is the caller's to choose, the address is not */
  if ((await throughDoor(req, 'analytics')).over) return reply({ error: 'rate' }, 429, origin)
  const { error } = await admin.from('events').insert(rows)
  if (error) { console.warn('ingest:', error.message); return reply({ error: 'write' }, 500, origin) }
  return reply(posthog ? { status: 1 } : { ok: true, n: rows.length }, 200, origin)
})
