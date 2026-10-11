/*
 * WHAT IS ON, compiled and projected.
 *
 * An event is a file (content/events/*.md). Two things come out of it:
 *
 *   .velite/events.json                      what the site draws (read through #content)
 *   the `events` + `event_occurrences` rows   what the database answers a community's home with
 *
 * The occurrences are DERIVED — expanded from the repeat by lib/recurrence.js over a rolling
 * window (a year by default) and rewritten whenever the file changes. Nobody edits one, so the
 * projection deletes what it no longer makes; an occurrence somebody has said they are coming to
 * is kept even so, because an RSVP is state and a file must never take one away silently. One
 * moved or called off keeps its cancelled_at and its note through the rewrite, for the same
 * reason.
 *
 * `--check` compiles and validates without writing anything, which is what `npm test` runs:
 * a repeat that is not a repeat, a space or channel the site does not have, an audience written
 * in a grammar nothing reads, a booking type named that is not sold.
 */
import { asStore } from './store/index.mjs'
import { occurrences, problems, describe } from '../src/lib/recurrence.js'
import matter from 'gray-matter'

export const OUT = '.velite/events.json'
/* how far ahead the projection reaches. A year is long enough that a community always shows the
   next thing, and short enough that a weekly call is a few hundred rows rather than a million. */
export const WINDOW_DAYS = 365

/* ------------------------------------------------------------------ the record */

/* `for:` in every shape people write it, as the list of ways in that space_fill_matches takes */
export function audienceOf(v) {
  if (v == null || v === '' || v === 'anyone') return []
  const one = (x) => {
    if (x == null) return null
    if (typeof x === 'string') {
      const s = x.trim()
      if (!s || s === 'anyone') return null
      if (s === 'authenticated' || s === 'everyone') return { entitlement: 'account' }
      if (s === 'subscribed') return { entitlement: 'subscribed' }
      if (s.startsWith('tier:')) return { tier: s.slice(5) }
      if (s.startsWith('role:')) return { role: [s.slice(5)] }
      if (s.startsWith('bought:')) return { product: s.slice(7) }
      /* a bare word is a tier, which is how a site writes it everywhere else */
      return { tier: s }
    }
    if (Array.isArray(x)) return null
    return x
  }
  const list = Array.isArray(v) ? v : [v]
  return list.map(one).filter(Boolean)
}

/*
 * `where:` — a huddle in one of this site's rooms, a link somewhere else, a place you go to, or
 * nothing said. The short forms stay because most events are one of them and a file should not have
 * to write a block to say "the usual room":
 *
 *   where: room                          a huddle here
 *   where: https://meet.example/abc      a link
 *   where: The Hall, 12 Example Street   a place
 *
 * and the long form says the rest — which an in-person event needs and a link cannot carry:
 *
 *   where:
 *     kind: place
 *     address: The Hall, 12 Example Street, London E1
 *     details: Ring the bell for the second floor. The lift is out.
 *     map: https://maps.example/...
 */
export function placeOf(v) {
  if (v == null || v === '') return {}
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === 'room' || s === 'huddle') return { kind: 'room' }
    if (/^https?:\/\//.test(s)) return { kind: 'link', url: s }
    return { kind: 'place', address: s }
  }
  const o = { ...v }
  /* `where` was the old name for an address; a file that used it still works */
  if (o.where && !o.address) { o.address = o.where; delete o.where }
  if (!o.kind) o.kind = o.url ? 'link' : o.address ? 'place' : 'room'
  return o
}

/*
 * `rsvp:` — true or false as it always was, or a block saying how the asking works:
 *
 *   rsvp:
 *     answers: [going, maybe]     which buttons (going · maybe · out); all three by default
 *     reason: true                may somebody say why
 *     list: going                 is who is coming shown — off (default) · going · hosts
 *     capacity: 40
 *
 * A class takes yes or no; a D&D night wants maybe, because a table of five needs to know who is
 * wavering. And where the list is shown it is a first name and a last initial: "who else is coming"
 * is fair to want; a roster of everybody at a recovery meeting, with surnames, is not.
 */
export const ANSWERS = ['going', 'interested', 'out']
export function rsvpOf(v) {
  if (v === false) return { on: false, answers: [], reason: false, list: 'off' }
  const o = v && typeof v === 'object' ? v : {}
  const said = (Array.isArray(o.answers) ? o.answers : []).map((s) => String(s).trim().toLowerCase())
    /* the words people write, in the words the rows use */
    .map((s) => (s === 'yes' ? 'going' : s === 'maybe' ? 'interested' : s === 'no' ? 'out' : s))
    .filter((s) => ANSWERS.includes(s))
  return {
    on: true,
    answers: said,                                   /* empty: all of them */
    reason: o.reason === true,
    list: ['off', 'going', 'hosts'].includes(String(o.list || '').toLowerCase()) ? String(o.list).toLowerCase() : 'off',
    capacity: o.capacity == null ? null : Number(o.capacity),
  }
}

/*
 * `cost:` — what it costs, where it costs anything. An event with a cost is a thing somebody BUYS,
 * and what it takes to turn up — the address, the joining link — is not shown until they have. A
 * listing anybody can read is not the same as a door anybody can walk through.
 *
 *   cost: 20                       twenty, in the site's own currency
 *   cost: { price: 20, currency: usd, sku: retreat-day }
 */
export function costOf(v) {
  if (v == null || v === false || v === '') return null
  if (typeof v === 'number' || (typeof v === 'string' && /^[\d.]+$/.test(v.trim()))) return { price: Number(v), currency: 'usd' }
  if (typeof v !== 'object') return null
  const price = Number(v.price)
  if (!(price > 0)) return null
  return { price, currency: String(v.currency || 'usd').toLowerCase(), ...(v.sku ? { sku: String(v.sku) } : {}) }
}

/* who may say something on it: off · everyone · members (whoever may see it) · hosts */
export const commentsOf = (v) => (['off', 'everyone', 'members', 'hosts'].includes(String(v || '').toLowerCase())
  ? String(v).toLowerCase() : v === false ? 'off' : 'members')

/*
 * `hosts:` — one or more people running it. A role (every holder of it hosts), or a person by the
 * address they sign in with. `host: coach` is the older single-role form and still works.
 */
export function hostsOf(e) {
  const out = []
  const one = (h) => {
    if (!h) return
    if (typeof h === 'string') {
      const s = h.trim()
      if (!s) return
      out.push(s.includes('@') ? { email: s.toLowerCase() } : { role: s.toLowerCase() })
    } else if (typeof h === 'object') out.push(h)
  }
  for (const h of Array.isArray(e.hosts) ? e.hosts : e.hosts ? [e.hosts] : []) one(h)
  if (!out.length && e.host) one(e.host)
  return out
}

/* what the database holds of an event, from what the file says */
export function rowOf(e, { spaces = [], channels = [] } = {}) {
  const space = e.space ? spaces.find((s) => s.slug === e.space) : null
  const channel = e.channel && space
    ? channels.find((c) => c.space === space.slug && (c.slug === e.channel || c.slug.endsWith('/' + e.channel)))
    : null
  return {
    slug: e.slug,
    title: e.title,
    sub: e.sub || null,
    body: e.body || null,
    cover: e.cover || null,
    space: space ? space.slug : null,
    channel: channel ? channel.slug : null,
    audience: audienceOf(e.for),
    host_role: e.host || null,
    hosts: hostsOf(e),
    place: placeOf(e.where),
    capacity: e.capacity == null ? null : Number(e.capacity),
    rsvp: e.rsvp !== false,
    rsvp_answers: rsvpOf(e.rsvp).answers,
    rsvp_reason: rsvpOf(e.rsvp).reason,
    rsvp_list: rsvpOf(e.rsvp).list,
    comments: commentsOf(e.comments),
    cost: costOf(e.cost),
    /* the same rich media an article carries, played by the same component */
    thumb: e.thumb || null,
    gallery: Array.isArray(e.gallery) ? e.gallery : e.gallery ? [e.gallery] : [],
    media: e.media || null,
    repeats: e.repeats || null,
    starts_at: e.starts ? new Date(e.starts.length <= 10 ? e.starts + 'T00:00:00Z' : e.starts).toISOString() : null,
    ends_at: e.ends ? new Date(e.ends.length <= 10 ? e.ends + 'T00:00:00Z' : e.ends).toISOString() : null,
    zone: e.zone || (e.repeats && e.repeats.zone) || null,
    order: Number(e.order || 0),
    published: e.published !== false,
  }
}

/* every occurrence of one event in the window, as rows */
export function occurrencesOf(e, { from = Date.now(), days = WINDOW_DAYS } = {}) {
  const to = from + days * 86400000
  if (e.repeats) {
    const zone = e.zone || e.repeats.zone
    return occurrences({ ...e.repeats, zone: zone || e.repeats.zone }, { from, to, limit: 1000 })
      .map((o) => ({ starts_at: new Date(o.start).toISOString(), ends_at: o.end > o.start ? new Date(o.end).toISOString() : null }))
  }
  if (!e.starts) return []
  const start = new Date(e.starts.length <= 10 ? e.starts + 'T00:00:00Z' : e.starts).getTime()
  if (Number.isNaN(start) || start > to) return []
  return [{ starts_at: new Date(start).toISOString(), ends_at: e.ends ? new Date(e.ends).toISOString() : null }]
}

/* ------------------------------------------------------------------ what is wrong with one */

export function faults(e, { spaces = [], channels = [], sessions = [] } = {}) {
  const out = []
  const where = `events/${e.slug}.md`
  if (!e.title) out.push(`${where}: an event has a title.`)
  if (!e.repeats && !e.starts) out.push(`${where}: an event says when it is — a date, or a repeat.`)
  if (e.repeats) for (const p of problems(e.repeats)) out.push(`${where}: ${p}`)
  if (e.starts && Number.isNaN(Date.parse(e.starts.length <= 10 ? e.starts + 'T00:00:00Z' : e.starts))) {
    out.push(`${where}: "${e.starts}" is not a date and time.`)
  }
  if (e.space && !spaces.some((s) => s.slug === e.space)) out.push(`${where}: no space called "${e.space}".`)
  if (e.channel && !channels.some((c) => c.slug === e.channel || c.slug.endsWith('/' + e.channel))) {
    out.push(`${where}: no room called "${e.channel}".`)
  }
  const place = placeOf(e.where)
  if (place.kind && !['room', 'link', 'place', 'phone'].includes(place.kind)) {
    out.push(`${where}: "${place.kind}" is not somewhere an event can be — a room, a link, a place or a phone.`)
  }
  if (e.capacity != null && !(Number(e.capacity) > 0)) out.push(`${where}: a capacity is how many people fit, so it is at least one.`)
  return out
}

/* ------------------------------------------------------------------ the compile */

export async function compileEvents({ root = process.cwd(), store, check = false, write = true } = {}) {
  const st = asStore(store || root)
  /* the store lists a collection by name, without its directory or its extension */
  const files = await st.list('content/events')
  const spaces = (await st.list('content/spaces')).map((slug) => ({ slug }))
  const channels = []
  for (const s of spaces) {
    for (const slug of await st.list(`content/spaces/${s.slug}`)) channels.push({ space: s.slug, slug: `${s.slug}/${slug}` })
  }
  const events = []
  const said = []
  for (const slug of files) {
    const parsed = matter(String((await st.read(`content/events/${slug}.md`)) || ''))
    const e = { ...parsed.data, slug, body: String(parsed.content || '').trim() }
    said.push(...faults(e, { spaces, channels }))
    events.push(e)
  }
  events.sort((a, b) => (Number(a.order || 0) - Number(b.order || 0)) || String(a.title).localeCompare(String(b.title)))
  if (said.length) {
    if (check) { for (const s of said) console.log('  ' + s); throw new Error(`events: ${said.length} fault(s)`) }
    for (const s of said) console.log('  ! ' + s)
  }
  const out = events.filter((e) => e.published !== false).map((e) => ({
    ...rowOf(e, { spaces, channels }),
    said: e.repeats ? describe(e.repeats) : null,
    occurrences: occurrencesOf(e).slice(0, 12),
  }))
  if (write && !check) await st.write(OUT, JSON.stringify(out, null, 2))
  return { events, rows: out, faults: said }
}

/* ------------------------------------------------------------------ run it */

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check')
  const { rows, faults: f } = await compileEvents({ check })
  console.log(`events: ${rows.length} on${f.length ? `, ${f.length} fault(s)` : ''}`)
  const soon = rows.flatMap((r) => r.occurrences.slice(0, 1).map((o) => `  ${r.title} — ${o.starts_at}${r.said ? ` (${r.said})` : ''}`))
  for (const s of soon.slice(0, 8)) console.log(s)
}
