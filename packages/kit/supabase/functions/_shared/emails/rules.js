/*
 * Who an email may go to, as a funnel's or blast's markdown says it and as the database asks
 * it. The markdown is written for a person — `inactive: 7d+`, `since-purchase: none`,
 * `subscription: [none]` — and `normalizeRules` turns it into the jsonb `email_audience(rules)`
 * takes (migration 20260916120000); `describeRules` says a rule set back in words for the
 * admin's cards. Plain JavaScript, no imports: the build, the admin and the functions share it.
 *
 * A span: `7d+` (at least seven days), `3d-` (within three days), `7d-30d` (between), `none`
 * where it means never (a purchase, a session). Units: d (days), w (weeks), h (hours, as a
 * fraction of a day).
 */
/* ONE VOCABULARY. A bot says who it serves in one set of words (role:, tier:, bought:, customer)
   and an email audience said who it reaches in another, so "the coaches" was sayable to one and not
   to the other. "role" and "grant" close that: a role somebody holds on the site, and a capability
   somebody has been granted in a space — the two things the rest of the product already gates on. */
export const RULE_KEYS = ['inactive', 'signed-up', 'since-purchase', 'since-session', 'subscription', 'interest', 'level', 'answered', 'bought', 'not-bought', 'role', 'grant', 'verified']
const SPAN_KEYS = { inactive: 'inactive', 'signed-up': 'signed_up', 'since-purchase': 'since_purchase', 'since-session': 'since_session' }
const LIST_KEYS = { subscription: 'subscription', interest: 'interest', level: 'level', bought: 'bought', 'not-bought': 'not_bought', role: 'role', grant: 'grant' }
const UNIT = { d: 1, w: 7, h: 1 / 24, m: 30 }

/* "3d" → 3, "2w" → 14, "12h" → 0.5; a bare number is days; null when it is not a span */
export function days(s) {
  if (typeof s === 'number') return s
  const m = /^\s*(\d+(?:\.\d+)?)\s*([dwhm])?\s*$/i.exec(String(s ?? ''))
  return m ? Number(m[1]) * UNIT[(m[2] || 'd').toLowerCase()] : null
}
/* "7d+" | "3d-" | "7d-30d" | "none" | "7d" (exactly: treated as at least) → { min, max, none } */
export function span(s) {
  const t = String(s ?? '').trim().toLowerCase()
  if (!t) return null
  if (t === 'none' || t === 'never') return { none: true }
  const between = /^(\S+?)\s*-\s*(\S+)$/.exec(t)
  if (between && days(between[1]) != null && days(between[2]) != null) return { min: days(between[1]), max: days(between[2]) }
  if (t.endsWith('+')) { const d = days(t.slice(0, -1)); return d == null ? null : { min: d } }
  if (t.endsWith('-')) { const d = days(t.slice(0, -1)); return d == null ? null : { max: d } }
  const d = days(t); return d == null ? null : { min: d }
}
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(/[,\s]+/)).map((x) => String(x).trim()).filter(Boolean)

/* the markdown's `audience` → the query's rules; `skusOf(slug)` widens a book's slug to its
   skus for bought / not-bought (the build knows the catalog; the admin passes it through) */
export function normalizeRules(audience, { skusOf = null } = {}) {
  const a = audience && typeof audience === 'object' ? audience : {}
  const out = {}
  for (const [k, key] of Object.entries(SPAN_KEYS)) if (a[k] != null && a[k] !== '') { const s = span(a[k]); if (s) out[key] = s }
  for (const [k, key] of Object.entries(LIST_KEYS)) {
    if (a[k] == null || a[k] === '') continue
    let l = list(a[k])
    if ((k === 'bought' || k === 'not-bought') && skusOf) l = [...new Set(l.flatMap((x) => { const s = skusOf(x); return s && s.length ? s : [x] }))]
    if (l.length) out[key] = l
  }
  if (Array.isArray(a.answered)) {
    const l = a.answered.map((r) => (typeof r === 'string' ? parseAnswered(r) : r && r.item ? { item: String(r.item), ...(r.truth ? { truth: String(r.truth) } : {}), ...(r.charge ? { charge: String(r.charge) } : {}) } : null)).filter(Boolean)
    if (l.length) out.answered = l
  }
  if (a.verified === true || a.verified === false) out.verified = a.verified
  else if (typeof a.verified === 'string' && /^(true|false)$/i.test(a.verified)) out.verified = /^true$/i.test(a.verified)
  return out
}
/* "abundance.da569750 = yes" | "abundance.da569750 charge" | "abundance.da569750 = no, clear" */
function parseAnswered(s) {
  const m = /^\s*([\w-]+\.[\w-]+)\s*(?:=\s*(yes|no|partly))?\s*,?\s*(charge|clear|cognitive|emotional|somatic|behavioral)?\s*$/i.exec(String(s))
  if (!m) return null
  const r = { item: m[1] }
  if (m[2]) r.truth = m[2].toLowerCase()
  if (m[3]) r.charge = m[3].toLowerCase()
  return r
}

/* the rules in words, one line per rule — for a card, never for a reader */
export function describeRules(rules) {
  const r = rules || {}
  const out = []
  const spanWords = (what, s) => s.none ? `never ${what}` : s.min != null && s.max != null ? `${what} ${fmt(s.min)}–${fmt(s.max)} ago` : s.min != null ? `${what} ${fmt(s.min)}+ ago` : `${what} within ${fmt(s.max)}`
  if (r.inactive) out.push(r.inactive.min != null && r.inactive.max == null ? `inactive ${fmt(r.inactive.min)}+` : spanWords('last active', r.inactive))
  if (r.signed_up) out.push(spanWords('signed up', r.signed_up))
  if (r.since_purchase) out.push(spanWords('bought', r.since_purchase))
  if (r.since_session) out.push(spanWords('had a session', r.since_session))
  if (r.subscription) out.push(r.subscription.map((t) => (t === 'none' ? 'no membership' : t === 'any' ? 'any membership' : t)).join(' or '))
  if (r.interest) out.push('interested in ' + r.interest.join(', '))
  if (r.level) out.push('working at ' + r.level.join(' or '))
  if (r.answered) out.push(r.answered.map((x) => `answered ${x.item}${x.truth ? ' = ' + x.truth : ''}${x.charge ? ' (' + x.charge + ')' : ''}`).join('; '))
  if (r.bought) out.push('bought ' + r.bought.join(' or '))
  if (r.not_bought) out.push('never bought ' + r.not_bought.join(', '))
  if (r.role) out.push(r.role.join(' or '))
  if (r.grant) out.push('may ' + r.grant.join(' or '))
  if (r.verified != null) out.push(r.verified ? 'address confirmed' : 'address not confirmed')
  return out.length ? out : ['everyone reachable']
}
const fmt = (d) => (d < 1 ? Math.round(d * 24) + 'h' : d % 7 === 0 && d >= 14 ? d / 7 + 'w' : d + 'd')

/* the global policy (content/emails/policy.md) and a funnel's own cooldown, as days */
export function normalizePolicy(p) {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d }
  const q = p && typeof p === 'object' ? p : {}
  /* the hours before a native session at which the reader is reminded: a list (or a comma string from an older file), each 0 < h ≤ 720, unique, largest first; absent = 24 and 1; an empty list = none */
  const reminders = (v) => { if (v === undefined || v === null) return [24, 1]; const list = Array.isArray(v) ? v : String(v).split(/[,\s]+/); const out = [...new Set(list.map(Number).filter((x) => Number.isFinite(x) && x > 0 && x <= 720))]; return out.sort((a, b) => b - a) }
  /* the support desk's two clocks, in minutes: how long a thread may wait on us before the staff are
     emailed about it, and how recently an agent must have been in the inbox to count as present */
  return { daily: n(q.daily, 1), weekly: n(q.weekly, 3), monthly: n(q.monthly, 8), 'blasts-respect-cooldown': q['blasts-respect-cooldown'] !== false && q['blasts-respect-cooldown'] !== 'false', 'support-wait': n(q['support-wait'], 15), 'support-presence': n(q['support-presence'], 5), 'support-keep-files': n(q['support-keep-files'], 90), 'recordings-keep': n(q['recordings-keep'], 0), 'session-reminders': reminders(q['session-reminders']) }   /* recordings-keep: days a call's recording is kept, 0 forever */
}
