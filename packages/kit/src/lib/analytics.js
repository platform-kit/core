/*
 * Analytics — a PostHog-shaped surface over this site's own door.
 *
 *   capture(type, props, cols)   pageview(path)   contentView(…)
 *
 * Every event ALWAYS goes to our Supabase `events` table (the source of truth the
 * admin KPIs read) — through the one door, the ingest function (<site>/api/events, or
 * the project's functions host), which takes the signed-in user from the session's
 * token, never from the body, and stamps the country the host reports.
 *
 * The surface is PostHog's so that a page written for PostHog needs no rewriting, and the wire
 * protocol is PostHog's so that their own SDK can report to this site — but posthog-js itself is
 * never loaded here. A drop-in is written for OTHER people's code; this site runs on its own.
 *
 * The queue, the batches, the session and the anonymous id are the shared core's (sdk/core.js — the same one the
 * drop-in script on another site runs): events batch in memory and flush on a short interval, on size, and on
 * pagehide/hidden via a keepalive fetch with the session's token, which the door reads the user from. Network failure
 * drops the batch: analytics must never block or break the app.
 *
 * Identity: the anonymous id is a fingerprint (FingerprintJS's visitorId, cached in the Loro store as dl.fp — the
 * same browser is the same visitor across storage cleared and a private window), or a random id (dl.anon) where none
 * can be computed or the reader has opted out; a session_id rolls after 30 idle minutes (sessionStorage). The
 * signed-in user is the session's, taken by the door from the token, never sent in the body. A session's first
 * event (session_start) records what is known on arrival and nowhere else — the
 * entry path, the referrer, the UTM tags, the device, browser and system families,
 * the time zone and the language (lib/arrival.js) — which is what the dashboard's
 * channels, campaigns, devices and hours are read from.
 */
import { configured, publicFunctionsUrl } from './supabase.js'
import { session } from './auth.js'
import { get as storeGet, set as storeSet } from './store.js'
import { recordView } from './ads.js'
import { createCore } from '../sdk/core.js'

/* the door: the site's own domain where the host rewrites /v1 to the functions, else the project's functions host */
/* the analytics door is an API door and lives with the rest of them, under /api: <site>/api/events.
   PUBLIC_FUNCTIONS_URL is the mail's /v1 and is not it, so the site's own origin is taken instead
   where the host has the rewrites, and the function's own address where it has not. */
const door = () => (publicFunctionsUrl ? publicFunctionsUrl.replace(/\/v1\/?$/, '') + '/api/events' : (import.meta.env.VITE_SUPABASE_URL + '/functions/v1').replace(/\/+$/, '') + '/ingest')
/* the core over the Loro store (dl.fp, dl.anon, dl.super, dl.optout, dl.distinct) and the session's token */
const core = createCore({
  endpoint: typeof window !== 'undefined' && configured ? door() : '',
  apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  token: () => (session.value && session.value.access_token) || null,
  prefix: 'dl.',
  store: { get: (k) => storeGet('dl.' + k), set: (k, v) => storeSet('dl.' + k, v), remove: (k) => storeSet('dl.' + k, null) },
})
export const anonId = () => core.anonId()

let started = false


/* the admin's live-preview frame renders real pages (with their CTAs) for an
   editor's eyes only: nothing that happens in it is a reader's behaviour */
export const IN_PREVIEW = (typeof location !== 'undefined' && location.pathname === '/__preview')
  || (typeof navigator !== 'undefined' && /PlatformKitPrerender/.test(navigator.userAgent))   /* build/prerender.mjs */

export function capture(type, props = {}, cols = {}) {
  if (typeof window === 'undefined' || IN_PREVIEW) return
  core.capture(type, props || {}, cols)
}

/* the admin is a place of work, not an audience: its routes are never a page view */
const IS_ADMIN = (p) => /^\/(admin|__preview)(\/|$)/.test(p || '')
export function pageview(path) { if (IS_ADMIN(path)) return; if (reading && reading.path !== path) endReading(); capture('pageview', {}, { path }) }

/* a piece of content opened — carries the canonical topic slugs for targeting — and, from then until the reader
   leaves it, how long they stayed and how far down they went (a content_read event when they leave: the next piece
   opened, a page view elsewhere, the page gone; the clock runs only while they are at the keyboard, see the tracker) */
export function contentView({ kind, id, title, topics, tags }) {
  endReading()
  capture('content_view', { kind, id, title: title || '', tags: Array.isArray(tags) ? tags : [] },
    { topic_slugs: Array.isArray(topics) ? topics : null })
  recordView(topics)   /* the local tally the CTA targeting reads */
  startReading({ kind, id, title: title || '', tags: Array.isArray(tags) ? tags : [], topics: Array.isArray(topics) ? topics : null })
}

/* the reading tracker: one piece at a time. Seconds count while the reader is there — the tab visible and the
   person at the keyboard: a pointer move, a key, a scroll, a touch or a wheel says so, and a minute with none of them
   (AWAY_MS) pauses the clock at the moment the last signal's minute ran out, the next signal starting it again — so a
   piece left open in a tab counts the reading and not the lunch, and a long read is as long as it was, never capped.
   Depth is the furthest the viewport's foot reached as a share of the page (100 when the whole page fits). A read is
   sent once, when it ends. */
let reading = null
const AWAY_MS = 60000
const SIGNALS = ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel']
let lastSignal = 0, idleTimer = null
const depthNow = () => { const h = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); return h <= 1 ? 100 : Math.min(100, Math.round(((window.scrollY || 0) / h) * 100)) }
function startReading(meta) {
  reading = { ...meta, path: location.pathname, since: null, seconds: 0, depth: depthNow(), idle: false }
  lastSignal = Date.now()
  if (document.visibilityState !== 'hidden') reading.since = lastSignal
  for (const ev of SIGNALS) window.addEventListener(ev, onReadSignal, { passive: true })
  armIdle()
}
function armIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(goIdle, AWAY_MS) }
/* a minute without a signal: the clock stops at the end of that minute */
function goIdle() {
  if (!reading || reading.idle) return
  if (reading.since) { reading.seconds += Math.max(0, lastSignal + AWAY_MS - reading.since) / 1000; reading.since = null }
  reading.idle = true
}
function onReadSignal(e) {
  if (!reading) return
  lastSignal = Date.now()
  if (e.type === 'scroll') reading.depth = Math.max(reading.depth, depthNow())
  if (reading.idle) { reading.idle = false; if (document.visibilityState !== 'hidden') reading.since = lastSignal }
  armIdle()
}
function pauseReading() { if (reading && reading.since) { reading.seconds += (Date.now() - reading.since) / 1000; reading.since = null } }
function resumeReading() { if (reading && !reading.since && !reading.idle) reading.since = Date.now() }
export function endReading() {
  if (!reading) return
  pauseReading()
  clearTimeout(idleTimer)
  const r = reading; reading = null
  for (const ev of SIGNALS) window.removeEventListener(ev, onReadSignal)
  const seconds = Math.round(r.seconds)
  if (seconds < 1) return   /* a bounce off the address bar is not a read */
  capture('content_read', { kind: r.kind, id: r.id, title: r.title, tags: r.tags, seconds, depth: r.depth }, { path: r.path, topic_slugs: r.topics })
}

export function init() {
  if (started || typeof window === 'undefined') return
  started = true
  core.start()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { pauseReading(); core.flush() } else resumeReading() })
  window.addEventListener('pagehide', () => { endReading(); capture('session_end', {}); core.flush() })
}
