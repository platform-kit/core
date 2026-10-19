/*
 * PostHog's wire protocol, read into the site's own rows — plain JavaScript (no environment, no imports) shared by the
 * ingest function and its test. What an official PostHog SDK sends when its api_host is this site:
 *
 *   /e/, /i/v0/e/, /capture/   an event, or an array of them: { uuid, event, properties: { token, distinct_id,
 *                              $device_id, $session_id, $current_url, $pathname, $referrer, … }, timestamp }
 *   /batch/                    { api_key, batch: [{ event, distinct_id, properties, timestamp, uuid, type }], sent_at }
 *                              (the server SDKs)
 *   the body                   gzip-js (a gzipped JSON body, `?compression=gzip-js`), base64 (`data=` form-encoded,
 *                              `?compression=base64`), a plain JSON body, or `data=` holding plain JSON; a server SDK
 *                              gzips with Content-Encoding: gzip
 *
 * `decode` gives the key and PostHog's events; `toRow` maps one event to the row the door writes: the event name as
 * the type, $device_id as the anonymous id and $session_id as the session (each a uuid, or made one by a stable hash
 * so a browser keeps its id), distinct_id as the person when it is not the device, $pathname and $referrer as the
 * path and referrer, the timestamp, and the properties less the ids and the token.
 */
export const PATHS = { events: ['/e', '/i/v0/e', '/capture', '/batch'], flags: ['/flags', '/decide'], config: /^\/array\/([^/]+)\/config(\.js)?$/, recordings: ['/s'], asset: /^\/static\/array\.js$/ }
export const kindOf = (path) => {
  const p = String(path || '').replace(/\/+$/, '') || '/'
  if (PATHS.events.includes(p)) return 'events'
  if (PATHS.flags.includes(p)) return 'flags'
  if (PATHS.config.test(p)) return 'config'
  if (PATHS.recordings.includes(p)) return 'recordings'
  if (PATHS.asset.test(p)) return 'asset'
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/* an id that is not a uuid (an SDK's own) becomes one by FNV-1a over it, twice, so it stays the same id */
function asUuid(v) {
  const s = String(v == null ? '' : v)
  if (UUID.test(s)) return s.toLowerCase()
  if (!s) return null
  const h = (seed) => { let x = seed; for (const b of new TextEncoder().encode(s)) { x ^= b; x = Math.imul(x, 0x01000193) >>> 0 } return x.toString(16).padStart(8, '0') }
  const a = h(0x811c9dc5), b = h(0x01000193), c = h(0x9e3779b9), d = h(0x7f4a7c15)
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4, 8)}${d}`
}

/* the most a compressed body may open to: a batch is fifty rows of 8 KB at most, and a few KB of gzip can
   otherwise open to gigabytes */
export const MAX_DECODED = 1 << 20

/* the JSON of a PostHog body, whatever its encoding; `body` is the raw bytes, `contentType` and `query` the request's */
export async function decodeBody(body, { contentType = '', query = {}, contentEncoding = '' } = {}) {
  let bytes = body instanceof Uint8Array ? body : new Uint8Array(body)
  const gz = query.compression === 'gzip-js' || /gzip/i.test(contentEncoding) || (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)
  if (gz) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
    const parts = []; let size = 0
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      size += value.length
      if (size > MAX_DECODED) { await reader.cancel().catch(() => {}); throw new Error('body too large') }
      parts.push(value)
    }
    bytes = new Uint8Array(size); let at = 0; for (const p of parts) { bytes.set(p, at); at += p.length }
  }
  let text = new TextDecoder().decode(bytes)
  if (/x-www-form-urlencoded/i.test(contentType) || /^data=/.test(text)) {
    const data = new URLSearchParams(text).get('data') || ''
    text = query.compression === 'base64' || !/^[\s\[{]/.test(data) ? b64(data) : data
  }
  return JSON.parse(text)
}
const b64 = (s) => { const bin = atob(s.replace(/\s/g, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return new TextDecoder().decode(out) }

/* the key and the events of a decoded body: an event, an array, or a batch */
export function decode(json, query = {}) {
  const list = Array.isArray(json) ? json : json && Array.isArray(json.batch) ? json.batch : json ? [json] : []
  const key = String((json && !Array.isArray(json) && json.api_key) || (list[0] && list[0].properties && list[0].properties.token) || (list[0] && list[0].api_key) || query.token || '').trim()
  return { key, events: list.filter((e) => e && typeof e === 'object') }
}

const DROP = new Set(['token', 'distinct_id', '$device_id', '$session_id'])
/* one PostHog event as the door's row (the type, the ids, the path and referrer, the time, the properties) */
export function toRow(e) {
  const p = e.properties && typeof e.properties === 'object' ? e.properties : {}
  const device = asUuid(p.$device_id || p.$anon_distinct_id || p.distinct_id || e.distinct_id)
  const session = asUuid(p.$session_id) || device
  const who = String(e.distinct_id ?? p.distinct_id ?? '')
  const distinct = who && who !== String(p.$device_id ?? '') && !UUID.test(who) ? who.slice(0, 200) : (who && who !== String(p.$device_id ?? '') && asUuid(who) !== device ? who.slice(0, 200) : null)
  const props = {}
  for (const [k, v] of Object.entries(p)) if (!DROP.has(k)) props[k] = v
  return {
    session_id: session, anon_id: device, type: String(e.event ?? ''),
    path: p.$pathname != null ? String(p.$pathname) : (p.$current_url ? safePath(p.$current_url) : null),
    ref: p.$referrer && p.$referrer !== '$direct' ? String(p.$referrer) : null,
    props, occurred_at: e.timestamp || null, distinct_id: distinct,
  }
}
const safePath = (u) => { try { return new URL(String(u)).pathname } catch { return null } }

/* what the SDK is told about flags, recording, surveys and compression: everything off, gzip-js welcome */
export const FLAGS = (token) => ({
  flags: {}, featureFlags: {}, featureFlagPayloads: {}, errorsWhileComputingFlags: false, hasFeatureFlags: false,
  sessionRecording: false, surveys: false, heatmaps: false, autocapture_opt_out: true, capturePerformance: false, autocaptureExceptions: false,
  supportedCompression: ['gzip-js'], config: { enable_collect_everything: false }, siteApps: [], toolbarParams: {}, isAuthenticated: false, elementsChainAsString: false, token,
})
export const remoteConfigJs = (token) => `window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {};\nwindow._POSTHOG_REMOTE_CONFIG[${JSON.stringify(token)}] = { config: ${JSON.stringify(FLAGS(token))}, siteApps: [] };\n`
