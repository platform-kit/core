/*
 * The analytics core the site and the drop-in script share: the anonymous id (a fingerprint — FingerprintJS's
 * visitorId, the same for a browser across storage cleared, a private window and a return weeks later — or, opted out
 * or where none can be computed, a random id kept in the store), the session (rolls after 30 idle minutes), the
 * super properties, the identified person, the queue and its batches to the one door (the ingest function), the
 * standard $-properties of a page view, and the arrival facts (lib/arrival.js). No Vue, no Supabase client, no DOM
 * at import time: a caller makes one with what it has — the door's address, a bearer, a store — and the site's
 * lib/analytics.js sits on top of it, as does sdk/posthog.js.
 *
 * Opting out turns the fingerprint off, not the events: the id becomes a random one kept in the store, the payload
 * is otherwise the same. Nothing of what the fingerprint was computed from is kept or sent.
 */
import { arrivalHere } from '../lib/arrival.js'

const IDLE_MS = 30 * 60 * 1000
const FLUSH_MS = 8000
const MAX_BATCH = 40
const FP_WAIT_MS = 2500

export const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16) }))

/* a fingerprint's 32 hex characters as the uuid the events table holds */
const asUuid = (hex) => { const h = String(hex || '').replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(32, '0').slice(0, 32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }

/* a store adapter over localStorage under a prefix (the drop-in's); the site passes its own */
export function localStore(prefix = 'pk.') {
  const ok = () => { try { return typeof localStorage !== 'undefined' } catch (e) { return false } }
  return {
    get: (k) => { try { const v = localStorage.getItem(prefix + k); return v == null ? null : JSON.parse(v) } catch (e) { return null } },
    set: (k, v) => { try { if (ok()) localStorage.setItem(prefix + k, JSON.stringify(v)) } catch (e) { /* private mode */ } },
    remove: (k) => { try { if (ok()) localStorage.removeItem(prefix + k) } catch (e) { /* none */ } },
  }
}
const memoryStore = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) } }

/* the standard properties of a page, as PostHog names them */
export function pageProps() {
  if (typeof location === 'undefined') return {}
  return { $current_url: location.href, $host: location.host, $pathname: location.pathname, $referrer: (typeof document !== 'undefined' && document.referrer) || '$direct', $referring_domain: (() => { try { return document.referrer ? new URL(document.referrer).host : '$direct' } catch (e) { return '$direct' } })() }
}

/**
 * @param {object} o
 * @param {string} o.endpoint   the door — <host>/api/events
 * @param {string} [o.apikey]   the project's anon key (the site's own events)
 * @param {function} [o.token]  () => the signed-in reader's JWT, or null
 * @param {string} [o.key]      a source's key (the drop-in on another site)
 * @param {object} [o.store]    { get, set, remove } — where the id, the super properties and the opt-out live
 * @param {boolean} [o.fingerprint=true]
 * @param {function} [o.beforeSend]  (row) => row | null
 * @param {boolean} [o.debug]
 */
export function createCore(o = {}) {
  const store = o.store || (o.persistence === 'memory' ? memoryStore() : localStore())
  const log = (...a) => { if (o.debug) console.log('[analytics]', ...a) }
  let queue = [], timer = null, distinctId = store.get('distinct') || null, superProps = store.get('super') || {}, optedOut = !!store.get('optout')
  let anon = null, fpReady = null, arrivalCache = null

  /* ---- the anonymous id: the fingerprint, or the random one in the store ---- */
  const randomId = () => { let id = store.get('anon'); if (!id) { id = uuid(); store.set('anon', id) } return id }
  async function fingerprint() {
    if (o.fingerprint === false || optedOut) return null
    const cached = store.get('fp')
    if (cached) return cached
    try {
      const mod = await import('@fingerprintjs/fingerprintjs')
      const agent = await (mod.default || mod).load()
      const r = await agent.get()
      const id = asUuid(r.visitorId)
      store.set('fp', id)
      return id
    } catch (e) { log('no fingerprint', e); return null }
  }
  function ready() {
    if (fpReady) return fpReady
    fpReady = Promise.race([fingerprint(), new Promise((r) => setTimeout(() => r(null), FP_WAIT_MS))]).then((id) => { anon = id || randomId(); return anon })
    return fpReady
  }
  const anonId = () => anon || (optedOut || o.fingerprint === false ? randomId() : (store.get('fp') || randomId()))

  /* ---- the session ---- */
  const SID = 'sid'
  const ss = { get: () => { try { return JSON.parse(sessionStorage.getItem((o.prefix || 'pk.') + SID)) } catch (e) { return null } }, set: (v) => { try { sessionStorage.setItem((o.prefix || 'pk.') + SID, JSON.stringify(v)) } catch (e) { /* none */ } } }
  let memSession = null
  function session() {
    const now = Date.now()
    const s = ss.get() || memSession
    if (s && now - s.t < IDLE_MS) { s.t = now; ss.set(s); memSession = s; return { id: s.id, fresh: false } }
    const n = { id: uuid(), t: now }; ss.set(n); memSession = n
    return { id: n.id, fresh: true }
  }

  /* ---- the queue ---- */
  async function send(rows) {
    if (!rows.length || !o.endpoint) return
    const headers = { 'Content-Type': 'application/json' }
    if (o.apikey) { headers.apikey = o.apikey; const t = o.token && o.token(); headers.Authorization = 'Bearer ' + (t || o.apikey) }
    try { await fetch(o.endpoint, { method: 'POST', keepalive: true, headers, body: JSON.stringify(o.key ? { key: o.key, batch: rows } : { batch: rows }) }) } catch (e) { log('dropped', e) }
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!queue.length) return
    const rows = queue; queue = []
    /* the first events wait for the id; a page that leaves before then goes with the random one, which the door takes */
    if (!anon) { const fallback = anonId(); const fixed = rows.map((r) => ({ ...r, anon_id: r.anon_id || fallback })); return send(fixed) }
    send(rows.map((r) => ({ ...r, anon_id: r.anon_id || anon })))
  }
  const schedule = () => { if (!timer) timer = setTimeout(flush, FLUSH_MS) }

  /* ---- capture ---- */
  function capture(type, props = {}, cols = {}) {
    if (typeof window === 'undefined') return
    const sid = session()
    if (sid.fresh && type !== 'session_start' && type !== '$pageview' && !cols.noStart) {
      capture(cols.startType || 'session_start', { entry: typeof location !== 'undefined' ? location.pathname : '', ...arrival() }, { ref: (typeof document !== 'undefined' && document.referrer) || null, noStart: true })
    }
    /* a session's first row carries the arrival facts, whatever event begins it */
    const first = sid.fresh ? arrival() : null
    let row = {
      session_id: sid.id, anon_id: anon || null, type,
      path: cols.path || (typeof location !== 'undefined' ? location.pathname : null),
      topic_slugs: Array.isArray(cols.topic_slugs) && cols.topic_slugs.length ? cols.topic_slugs : null,
      ref: cols.ref || (first && typeof document !== 'undefined' && document.referrer) || null,
      props: { ...(first || {}), ...superProps, ...(props || {}) },
      occurred_at: new Date().toISOString(),
    }
    if (distinctId) row.distinct_id = distinctId
    if (o.beforeSend) { row = o.beforeSend(row); if (!row) return }
    queue.push(row)
    log(type, row.props)
    if (queue.length >= MAX_BATCH) flush(); else schedule()
    if (!anon) ready().then(() => { if (queue.length) schedule() })
  }
  const arrival = () => (arrivalCache = arrivalCache || arrivalHere())

  /* ---- identity, super properties, the opt-out ---- */
  const identify = (id) => { distinctId = id ? String(id).slice(0, 200) : null; if (distinctId) store.set('distinct', distinctId); else store.remove('distinct') }
  const register = (props, once = false) => { const next = { ...superProps }; for (const [k, v] of Object.entries(props || {})) if (!once || !(k in next)) next[k] = v; superProps = next; store.set('super', superProps) }
  const unregister = (k) => { const next = { ...superProps }; delete next[k]; superProps = next; store.set('super', superProps) }
  const reset = () => { distinctId = null; superProps = {}; store.remove('distinct'); store.remove('super'); memSession = null; try { sessionStorage.removeItem((o.prefix || 'pk.') + SID) } catch (e) { /* none */ } }
  const optOut = () => { optedOut = true; store.set('optout', true); store.remove('fp'); anon = randomId(); fpReady = Promise.resolve(anon) }
  const optIn = () => { optedOut = false; store.remove('optout'); anon = null; fpReady = null; ready() }

  /* ---- the page's lifetime ---- */
  let started = false
  function start() {
    if (started || typeof window === 'undefined') return
    started = true
    ready()
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
    window.addEventListener('pagehide', flush)
  }

  return { capture, flush, start, ready, anonId, session: () => session().id, identify, distinctId: () => distinctId, register, unregister, superProps: () => ({ ...superProps }), reset, optOut, optIn, optedOut: () => optedOut, pageProps, arrival, store }
}
