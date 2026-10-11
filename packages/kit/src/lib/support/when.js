/*
 * When a chat prompt shows: the `when:` line of a funnel's chat step, read and judged here
 * with no imports and no environment, so the build (which checks it), the admin (which edits
 * and describes it), the widget (which watches for it) and build/support.test.mjs (which pins
 * it) share one rule. Entirely the browser's business — nothing is sent: the widget keeps
 * time and, when every trigger on the line holds, shows the prompt once.
 *
 * The line is triggers separated by commas; each is a key and, for most, a value:
 *   on-site 30s        this long on the site this session (30s, 2m, 1h)
 *   on-page /store/**  the page matches (a glob: * one segment, ** any depth; a bare path is exact)
 *   page-time 10s      this long on the current page
 *   signed-in          only a reader with an account (signed-in false: only a guest)
 *   returning          a browser that has been here before this session
 *   cart               something in the bag
 *   default            not a trigger: the prompt the panel rests on when nothing else is showing
 *                      (the first published one wins); it never pops up on its own
 * Every trigger given must hold. A line with none never shows.
 *
 * A prompt may end with choices — a `- ` list closing its markdown — which the widget shows as
 * buttons; splitChoices takes them off the text, each keyed by its words for the analytics.
 */
export const TRIGGER_KEYS = ['on-site', 'on-page', 'page-time', 'signed-in', 'returning', 'cart', 'default']
const UNIT = { s: 1, m: 60, h: 3600 }

/* "30s" → 30, "2m" → 120, "1h" → 3600, "45" → 45; null when it is not a span */
export function seconds(s) {
  if (typeof s === 'number') return s >= 0 ? s : null
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smh])?\s*$/i.exec(String(s ?? ''))
  return m ? Number(m[1]) * UNIT[(m[2] || 's').toLowerCase()] : null
}
/* 90 → "1m30s"? no — the shortest whole unit: 30 → "30s", 120 → "2m", 3600 → "1h", 90 → "90s" */
export function spanWord(n) {
  n = Number(n) || 0
  if (n && n % 3600 === 0) return n / 3600 + 'h'
  if (n && n % 60 === 0) return n / 60 + 'm'
  return n + 's'
}

/* the line → { 'on-site': 30, 'on-page': '/store/**', 'page-time': 10, 'signed-in': true, returning: true, cart: true };
   an unknown key or a bad value lands in `errors` */
export function parseWhen(line) {
  const out = {}
  const errors = []
  const parts = String(line ?? '').split(',').map((p) => p.trim()).filter(Boolean)
  for (const p of parts) {
    const [key, ...rest] = p.split(/\s+/)
    const k = String(key).toLowerCase()
    const v = rest.join(' ').trim()
    if (!TRIGGER_KEYS.includes(k)) { errors.push(`"${k}" is not a trigger (${TRIGGER_KEYS.join(', ')})`); continue }
    if (k === 'on-site' || k === 'page-time') {
      const n = seconds(v)
      if (n == null) errors.push(`${k} needs a span (30s, 2m, 1h), not "${v}"`); else out[k] = n
    } else if (k === 'on-page') {
      if (!v || !v.startsWith('/')) errors.push(`on-page needs a path (/store, /store/**), not "${v}"`); else out[k] = v
    } else {
      /* a flag: bare means true; "false" / "no" means the opposite */
      out[k] = !(v && /^(false|no|0|off)$/i.test(v))
    }
  }
  return { when: out, errors }
}
/* the object → the line, in the canon's order */
export function serialiseWhen(when) {
  const w = when || {}
  const out = []
  for (const k of TRIGGER_KEYS) {
    if (w[k] == null || w[k] === false && (k === 'returning' || k === 'cart' || k === 'default')) continue
    if (k === 'on-site' || k === 'page-time') out.push(`${k} ${spanWord(w[k])}`)
    else if (k === 'on-page') out.push(`on-page ${w[k]}`)
    else out.push(w[k] === false ? `${k} false` : k)
  }
  return out.join(', ')
}

/* "/store/**" → a RegExp over a pathname: * is one segment, ** any depth (or nothing) */
export function globToRegExp(glob) {
  const g = String(glob || '/').replace(/[?#].*$/, '').replace(/\/+$/, '')
  if (!g) return /^\/$/
  const re = g.split('/').filter(Boolean).map((seg) => (seg === '**' ? '(?:/.*)?' : '/' + seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))).join('')
  return new RegExp('^' + re + '/?$')
}
export const pageMatches = (glob, path) => globToRegExp(glob).test(String(path || '/').replace(/[?#].*$/, '').replace(/\/+$/, '') || '/')

/* every trigger on the line holds for this moment: ctx = { onSite (s), pageTime (s), path,
   signedIn, returning, cart } */
export function holds(when, ctx) {
  const w = when || {}
  const keys = Object.keys(w).filter((k) => TRIGGER_KEYS.includes(k))
  if (!keys.length || w.default) return false
  const c = ctx || {}
  for (const k of keys) {
    if (k === 'on-site' && !((Number(c.onSite) || 0) >= w[k])) return false
    if (k === 'page-time' && !((Number(c.pageTime) || 0) >= w[k])) return false
    if (k === 'on-page' && !pageMatches(w[k], c.path)) return false
    if (k === 'signed-in' && !!c.signedIn !== !!w[k]) return false
    if (k === 'returning' && !!c.returning !== !!w[k]) return false
    if (k === 'cart' && !!c.cart !== !!w[k]) return false
  }
  return true
}

/* the line in words, for the admin's list: "after 30s on the site · on /store/** · signed in" */
export function describeWhen(when) {
  const w = when || {}
  const out = []
  if (w['on-site'] != null) out.push(`after ${spanWord(w['on-site'])} on the site`)
  if (w['on-page']) out.push(`on ${w['on-page']}`)
  if (w['page-time'] != null) out.push(`${spanWord(w['page-time'])} on the page`)
  if (w['signed-in'] != null) out.push(w['signed-in'] ? 'signed in' : 'guests only')
  if (w.returning) out.push('returning visitors')
  if (w.cart) out.push('with something in the bag')
  if (w.default) out.unshift('the panel\'s default')
  return out.join(' · ')
}

/* THE CHOICE GRAMMAR IS NOT THE DESK'S. It began here, because prompts were the only thing that
   offered choices; a bot's answer offers them too now, on every surface, so it lives in
   lib/choices.js and is re-exported here — the desk's own callers, and the function's, unchanged. */
export { choiceKey, joinChoices, splitChoices, findChoice, cutAnswer, offerOf, CHOICE_CAP } from '../../../supabase/functions/_shared/choices.js'
