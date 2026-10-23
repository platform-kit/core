/*
 * Spaces are markdown, and this is their grammar.
 *
 * A space IS a declaration: what rooms a site has, who is let into them, what roles it invents and
 * what those roles may do is part of what the site is, not a record of what anybody did. So it is a
 * file, like a funnel or a product, and the database holds only a projection of it
 * (build/spaces-push.mjs). What people DID — who joined, who holds which role, what was said, what
 * was read — stays rows and is never written here.
 *
 *   content/spaces/<slug>.md            the space
 *   content/spaces/<slug>/<slug>.md     a channel of it (its space is its folder)
 *
 * A space's frontmatter: `name`, `kind` (staff · community · server), `published`, `fill` (what
 * fills its membership — `role: [admin, support]` · `tier: <slug>` · `bought: <sku>` ·
 * `entitlement: <key>` · `course: <slug>` with `cohort: <key>` (enrolled in a course, or one cohort of it); absent or empty means invitation only), `roles` (each a `slug`, `name`,
 * `colour`, `rank` and optionally `can`, the capabilities holding it grants) and `grants` (the ones
 * that are about somebody's standing rather than their role). The body is what the place is, shown
 * wherever somebody is offered or invited to it.
 *
 * A space also says where IT sits in a person's column — `group`, the heading it is gathered under,
 * and `position`, its place among the others — which is the site's own arrangement and the same for
 * every member, unlike a channel's group, which each of them can collapse.
 *
 * A space open to people who did not sign a contract says four more things: `discoverable`, whether
 * a reader who is not in it is shown that it exists and what it would take; `welcome`, the one room
 * a new member should read first; and `groups`, the headings its rooms are gathered under. (A space no
 * longer names sessions to book — booking lives with coaching, `coaching.where` — and a file that
 * still says `sessions:` is refused by the compile, so the line is taken out rather than ignored.)
 *
 * A channel's frontmatter: `name`, `topic`, `mode` (stream · forum), `visibility` (open · private),
 * `published`, `order`, `group` (the heading it sits under), `hears` (the platform's own events
 * written into this room) and `grants` (the ones that are about this room). The body is the room's
 * own description.
 *
 * A GRANT SAYS WHO, NEVER WHICH PERSON. `to` is one of `everyone` (whoever is in the space, or in
 * the channel where it is declared), `tier:<slug>`, `role:<slug>` or `bought:<sku>` — with `days`,
 * how long after the purchase it lasts. A declaration names classes of people; naming a person is
 * an act, and an act is a row the admin writes by hand (`source: 'hand'`), which the projection
 * never touches.
 */
import { asStore } from './store/index.mjs'
import matter from 'gray-matter'

export const SPACES_DIR = 'content/spaces'
const DUMP = { lineWidth: -1 }

export const KINDS = ['staff', 'community', 'server']
/* a feed is the same messages read as a group's feed — and only where the network module is on
   (spaces.mjs refuses it otherwise, naming the module) */
export const MODES = ['stream', 'forum', 'feed']
export const VISIBILITIES = ['open', 'private']

/* IS THIS CHANNEL ENCRYPTED? One reading, in the browser-safe model so the admin asks the same
   question the build does — a second copy of this is how the admin comes to show a different
   answer from the room. Re-exported here because the build's callers import it from this file. */
/* imported AND re-exported: a bare `export … from` makes the name available to importers without
   binding it in this module, and `sealedRooms` below calls it */
import { encryptedOf } from '../src/lib/spaces/model.js'
export { encryptedOf }
/*
 * EVERY SEALED ROOM, AS `<space>/<channel>` — the one answer the build and the admin share.
 *
 * A bot cannot be put in a sealed room: it would have to read the room to answer in it, and
 * nothing on this side can. So the build refuses a bot whose schedule points into one, and the
 * admin does not offer one when a room is being chosen. Both ask here, which is why it is a pure
 * function over the declaration rather than a query one of them makes and the other repeats.
 *
 * It takes what `readSpaces` gives — spaces each carrying their channels — so a caller with the
 * declaration in hand needs nothing else.
 */
export function sealedRooms(declared = []) {
  const out = new Set()
  for (const s of declared || []) {
    for (const c of (s && s.channels) || []) {
      if (encryptedOf((c && c.data) || c || {}, (s && s.data) || {})) out.add(`${s.slug}/${c.slug}`)
    }
  }
  return out
}
/* What a grant may give. Speaking is membership and needs none of these; every one of them is
   something a site may want to give to some people and not others — a voice note (it costs storage
   and is harder to moderate), naming the whole room, keeping the room civil, and letting somebody
   in. MODERATING AND INVITING ARE GRANTS LIKE ANY OTHER: there is no list of privileged role names
   anywhere in the code, so a site may give either to a role it invented and call it what it likes.
   The schema's own check is the other copy; build/spaces.test.mjs holds them equal. */
export const CAPABILITIES = ['voice', 'file', 'mention-channel', 'moderate', 'invite', 'announce']
/* what the platform already knows and a room may be told (space_hook_post in 90-spaces.sql) */
export const EVENTS = ['purchase.paid', 'subscription.started', 'print.failed', 'account.new', 'support.escalated']
/* what may fill a membership, in the file's words → the column's */
export const FILLS = { role: 'role', tier: 'tier', entitlement: 'entitlement', bought: 'product', booking: 'booking', course: 'course', cohort: 'cohort' }

/*
 * A WINDOW ON A CONDITION, and why there are two words rather than one.
 *
 * A condition may say that matching it admits somebody for a TIME rather than for good. For a
 * purchase one word would do — a purchase has no future. For a booking it would not: a session a
 * week from now and a session a week ago are both "within 7 days" and they are opposite rules, one
 * letting somebody in BEFORE the call and the other keeping them in AFTER it. One word would mean a
 * file's meaning depended on whether the booking happened to be in the future when the sweep ran.
 *
 * So: `withinLast` is the past and `withinNext` is the future. The pair matters more than either —
 * same shape, one syllable apart, and the syllable is the direction — so a file carrying both reads
 * as one window round the call rather than as two unrelated settings.
 */
export const SPANS = ['withinLast', 'withinNext']
/* the conditions a window may hang on. A tier, a role and an entitlement expire by themselves (an
   entitlement has its own expires_at, a tier lapses), so a span on one of those would be a second
   clock disagreeing with the first. */
export const WINDOWED = ['bought', 'booking']

/* A SPAN AS PEOPLE WRITE IT → whole minutes, or null for one nobody can read. Minutes because an
   hour matters for a window round a call (in from midday, out at midnight) and nothing finer ever
   will: the sweep is hourly, and a span is only ever as sharp as the sweep. A bare number is days,
   which is what somebody writing `7` means. */
export function spanMinutes(v) {
  if (v == null || v === '' || v === true || v === false) return null
  const s = String(v).trim().toLowerCase()
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)?$/.exec(s)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const per = { m: 1, h: 60, d: 1440, w: 10080 }[m[2] || 'd']
  const mins = Math.round(n * per)
  /* a year is the most anybody means by a window; beyond it they meant "for good" and should say so
     by leaving the span off */
  return mins > 0 && mins <= 527040 ? mins : null
}

/* AND BACK, for a control that has a number and a unit rather than a string. It never says weeks:
   somebody means "7 days", not "1 week", and a writer that turned one into the other would rewrite
   a file nobody asked it to touch. The FILE keeps whatever its author wrote — the parse validates
   and does not canonicalise — so this is only ever used where a span is being made, never where one
   is being read back. */
export function spanText(mins) {
  const n = Number(mins)
  if (!Number.isFinite(n) || n <= 0) return ''
  for (const [unit, per] of [['d', 1440], ['h', 60]]) if (n % per === 0) return (n / per) + unit
  return n + 'm'
}

/* what a fill is, in or out: a mapping (one set, every key of which must match) or a list of them
   (any one is enough). Anything else is nothing at all. */
export const fillSets = (fill) => (Array.isArray(fill) ? fill : fill && typeof fill === 'object' ? [fill] : [])
  .filter((s) => s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length)
export function fillOf(fill) {
  if (Array.isArray(fill)) {
    const sets = fillSets(fill)
    return sets.length > 1 ? sets : sets[0] || {}
  }
  return fill && typeof fill === 'object' ? fill : {}
}
export function fillOut(fill) {
  const sets = fillSets(fill)
  if (!sets.length) return {}
  return sets.length === 1 ? sets[0] : sets
}

export const slugOk = (s) => /^[a-z0-9][a-z0-9-]{0,48}$/.test(String(s || '')) && !/--/.test(String(s))
export const roleSlugOk = (s) => /^[a-z0-9][a-z0-9-]{0,38}$/.test(String(s || '')) && !/--/.test(String(s))

/* ---- a grant's target, the one bit of grammar in the file ---- */
/* 'everyone' | 'tier:inner' | 'role:founder' | 'bought:guild-pass' → { scope, tier, role, sku } */
export function parseTarget(to) {
  const t = String(to == null ? 'everyone' : to).trim()
  if (!t || t === 'everyone') return { scope: 'everyone' }
  const i = t.indexOf(':')
  if (i < 1) return { scope: null, bad: t }
  const kind = t.slice(0, i).trim(), rest = t.slice(i + 1).trim()
  if (kind === 'tier' && rest) return { scope: 'tier', tier: rest }
  if (kind === 'role' && rest) return { scope: 'role', role: rest }
  if (kind === 'bought' && rest) return { scope: 'product', sku: rest }
  return { scope: null, bad: t }
}
export function serialiseTarget(t) {
  if (!t || !t.scope || t.scope === 'everyone') return 'everyone'
  if (t.scope === 'tier') return 'tier:' + t.tier
  if (t.scope === 'role') return 'role:' + t.role
  if (t.scope === 'product') return 'bought:' + t.sku
  return 'everyone'
}

/* ---- the files ---- */
const clean = (o) => { const out = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) out[k] = v; return out }

/* A FLAIR IS A BADGE A SPACE INVENTS AND A PERSON IS GIVEN — "Founding member", "Answered fifty
   questions", "Read the whole shelf". What the badges ARE is the space's own declaration, like its
   roles; WHO WEARS ONE is an act, and lives in the database. The glyph is a name from the surface's
   own set, never an uploaded picture, so a wall of flair stays a wall of flair. */
export function normFlair(x) {
  const o = x || {}
  const out = { slug: String(o.slug || '').trim(), name: String(o.name || '').trim() }
  if (o.colour) out.colour = String(o.colour)
  if (o.icon) out.icon = String(o.icon)
  if (o.note) out.note = String(o.note)
  /* inline is where it shows: beside the name in a room as well as on the card. True is the common
     case and writes nothing; a badge that is only for the card says so. */
  if (o.inline === false) out.inline = false
  if (Number.isFinite(Number(o.position))) out.position = Number(o.position)
  return out
}

/* the door as a record, or nothing at all where the file did not open one */
const JOIN_HOW = ['none', 'open', 'request', 'approve']
export function joinOf(j) {
  if (!j || typeof j !== 'object') return { how: 'none' }
  const how = JOIN_HOW.includes(j.how) ? j.how : 'none'
  if (how === 'none') return { how: 'none' }
  const out = { how }
  if (j.form) out.form = String(j.form)
  if (j.terms) out.terms = String(j.terms)
  if (j.question) out.question = String(j.question)
  return out
}

export function parseSpace(text) {
  const f = matter(String(text || ''))
  const d = f.data || {}
  return {
    data: {
      name: d.name || '',
      kind: d.kind || 'community',
      published: d.published !== false,
      /* a community says it exists to somebody who is not in it; a staff space never does */
      discoverable: d.discoverable === true,
      /* every room under it is sealed unless the room says otherwise — one line to seal a space,
         and a plain false here, because a space is the top of the question and has nothing to
         fall through to */
      encrypted: d.encrypted === true,
      /* its own pictures: a face on the front page, and one in a list. Both optional. */
      cover: d.cover ? String(d.cover) : '',
      thumb: d.thumb ? String(d.thumb) : '',
      /* the room a new member is pointed at first, by its slug */
      welcome: d.welcome ? String(d.welcome) : '',
      /* the headings its rooms are gathered under, in the order they are drawn */
      groups: Array.isArray(d.groups) ? d.groups.map(String) : [],
      /* WHERE THE SPACE ITSELF SITS in a person's column. A site with four spaces wants them under
         headings — "Cohorts", "The team", "Open to everyone" — for the same reason a space with
         fifteen rooms wants its groups, and for the same reason it is declared and not clicked: it
         is part of what the site IS. Unlike a channel's group, which each member can collapse, this
         is the site's own arrangement and every member sees the same one. A space naming none sits
         in the ungrouped run at the foot, which is where a site with three spaces leaves them all. */
      /* HOW FAR BACK EACH KIND OF PERSON MAY READ, as a list of rules: who (a space role, a
         membership tier, an entitlement — or nothing, which is everybody) and how many days.
         0 is no limit, the most generous matching rule wins, and a space that says nothing keeps
         everything for everybody. Enforced in the reads, and never against the staff. */
      history: Array.isArray(d.history) ? d.history.map(normSpan).filter(Boolean) : [],
      group: d.group ? String(d.group) : '',
      position: Number.isFinite(Number(d.position)) ? Number(d.position) : 99,
      /* the default its rooms inherit, each of which may differ; left out, the platform's */
      reactions: d.reactions == null ? null : d.reactions !== false,
      votes: d.votes == null ? null : d.votes === true,
      /* keys a space no longer has, kept only so the compile can name them and refuse the file */
      ...(d.sessions !== undefined ? { retired: ['sessions'] } : {}),
      /* HOW SOMEBODY WHO IS NOT IN IT GETS IN. 'none' is the default and means the fill rule is the
         only way: a staff space must never grow a Join button because a default moved. 'open' lets
         anybody signed in walk in, 'request' keeps the ask and lets them in at once, 'approve' makes
         them wait for a yes — and either of the last two may ask a form of them and hold them to
         terms. What is asked is enforced in the database, never here. */
      join: joinOf(d.join),
      /* WHETHER THIS SPACE HAS DIRECT MESSAGES AT ALL. On unless the file says otherwise. It is the
         space's own decision and the same for everybody in it — a site whose community is rooms and
         not private messages has decided that for everyone, staff included. Whether one PERSON
         wants to be written to is a different question and a row of theirs, never a file's. */
      dms: d.dms == null ? true : d.dms !== false && d.dms !== 'off',
      /* A FILL IS ONE SET OF CONDITIONS, OR A LIST OF THEM AND ANY ONE IS ENOUGH. A mapping is
         kept a mapping so that nothing already written is rewritten or changes meaning; a list of
         one is flattened for the same reason. */
      fill: fillOf(d.fill),
      roles: Array.isArray(d.roles) ? d.roles.map(normRole) : [],
      /* the badges this space invents; who wears one is an act and is not in the file */
      flair: Array.isArray(d.flair) ? d.flair.map(normFlair).filter((x) => x.slug && x.name) : [],
      grants: Array.isArray(d.grants) ? d.grants.map(normGrant) : [],
    },
    content: String(f.content || '').trim(),
  }
}
/* one history rule, as written: a who and a number of days. Anything else is dropped rather than
   half-honoured — a rule nobody can read is worse than no rule. */
const normSpan = (r) => {
  if (!r || typeof r !== 'object') return null
  const days = Number(r.days)
  if (!Number.isFinite(days) || days < 0) return null
  const out = { days: Math.round(days) }
  if (r.role) out.role = String(r.role)
  if (r.tier) out.tier = String(r.tier)
  if (r.entitlement) out.entitlement = String(r.entitlement)
  return out
}

export function serialiseSpace(data, content = '') {
  const d = data || {}
  const out = clean({
    name: d.name || '',
    kind: d.kind || 'community',
    ...(d.published === false ? { published: false } : {}),
    ...(d.discoverable ? { discoverable: true } : {}),
    /* a space that seals its rooms says so; one that does not grows no line */
    ...(d.encrypted ? { encrypted: true } : {}),
    ...(d.cover ? { cover: String(d.cover) } : {}),
    ...(d.thumb ? { thumb: String(d.thumb) } : {}),
    ...(d.welcome ? { welcome: String(d.welcome) } : {}),
    groups: (d.groups || []).map(String),
    history: (d.history || []).map(normSpan).filter(Boolean),
    ...(d.group ? { group: String(d.group) } : {}),
    ...(Number(d.position) === 99 || d.position === undefined || d.position === null ? {} : { position: Number(d.position) }),
    /* written only when it is OFF: a space that never thought about direct messages grows no line */
    ...(d.dms === false ? { dms: false } : {}),
    /* the default its rooms inherit, written only where the space said it */
    ...(d.reactions == null ? {} : { reactions: d.reactions !== false }),
    ...(d.votes == null ? {} : { votes: d.votes === true }),
    /* a space that opened no door writes none, so nothing that never thought about it grows one */
    ...(d.join && d.join.how && d.join.how !== 'none' ? { join: joinOf(d.join) } : {}),
    fill: fillOut(d.fill),
    roles: (d.roles || []).map((r) => clean(normRole(r))),
    flair: (d.flair || []).map((x) => clean(normFlair(x))).filter((x) => x.slug && x.name),
    grants: (d.grants || []).map((g) => clean(normGrant(g))),
  })
  return matter.stringify('\n' + String(content || '').trim() + '\n', out, DUMP)
}

export function parseChannel(text) {
  const f = matter(String(text || ''))
  const d = f.data || {}
  return {
    data: {
      name: d.name || '',
      topic: d.topic || '',
      mode: d.mode || 'stream',
      visibility: d.visibility || 'open',
      published: d.published !== false,
      order: Number.isFinite(d.order) ? d.order : 99,
      group: d.group ? String(d.group) : '',
      /* a room's own pictures: one shown whole where the room is introduced, one beside its name */
      cover: d.cover ? String(d.cover) : '',
      thumb: d.thumb ? String(d.thumb) : '',
      hears: Array.isArray(d.hears) ? d.hears.map(String) : [],
      grants: Array.isArray(d.grants) ? d.grants.map(normGrant) : [],
      /* WHAT THE ROOM TAKES BESIDES WORDS. Left out, it is the space's answer; the space left out,
         the platform's — reactions on, votes off, because a score changes what people write as
         well as what they read. A comment subject is set apart from both and inherits nothing
         from here: wanting a scored forum says nothing about wanting scored book chapters. */
      reactions: d.reactions == null ? null : d.reactions !== false,
      votes: d.votes == null ? null : d.votes === true,
      /* IS THIS ROOM SEALED. `undefined` and not `null`, and not `false`: a channel that says
         nothing must fall through to its space, and `encryptedOf` tells the three apart by
         `typeof === 'boolean'`. A default here would make every room say "no" out loud and no
         space could ever seal the rooms under it. */
      encrypted: d.encrypted == null ? undefined : d.encrypted === true,
      /* A ROOM MAY BE FILLED BY A RULE OF ITS OWN, in the space's own grammar — so "this room is for
         tier-3" is a line in a file rather than rows somebody inserts by hand. It is NARROWER,
         NEVER WIDER: a channel's fill does not grant the space, because a room inside a space you
         are not in is a room with no people, no directory and no way to be mentioned. A channel
         that declares none behaves exactly as it always has — open to the space, or private and
         joined by hand. */
      fill: fillOf(d.fill),
    },
    content: String(f.content || '').trim(),
  }
}
export function serialiseChannel(data, content = '') {
  const d = data || {}
  const out = clean({
    name: d.name || '',
    topic: d.topic || '',
    mode: d.mode || 'stream',
    visibility: d.visibility || 'open',
    ...(d.published === false ? { published: false } : {}),
    ...(Number.isFinite(d.order) && d.order !== 99 ? { order: d.order } : {}),
    ...(d.group ? { group: String(d.group) } : {}),
    ...(d.cover ? { cover: String(d.cover) } : {}),
    ...(d.thumb ? { thumb: String(d.thumb) } : {}),
    hears: (d.hears || []).map(String),
    grants: (d.grants || []).map((g) => clean(normGrant(g))),
    /* only what differs from what it would inherit is written: a file full of the defaults is a
       file nobody can see the decisions in */
    ...(d.reactions == null ? {} : { reactions: d.reactions !== false }),
    ...(d.votes == null ? {} : { votes: d.votes === true }),
    /* and the same rule for the seal: written only where the room gave an answer of its own, so a
       room that inherits its space's keeps inheriting it rather than being frozen at today's */
    ...(d.encrypted == null ? {} : { encrypted: d.encrypted === true }),
    fill: fillOut(d.fill),
  })
  return matter.stringify('\n' + String(content || '').trim() + '\n', out, DUMP)
}

const normRole = (r) => ({
  slug: String((r && r.slug) || ''),
  name: String((r && r.name) || ''),
  ...(r && r.colour ? { colour: String(r.colour) } : {}),
  rank: Number.isFinite(r && r.rank) ? r.rank : 0,
  ...(r && Array.isArray(r.can) && r.can.length ? { can: r.can.map(String) } : {}),
})
const normGrant = (g) => ({
  capability: String((g && g.capability) || ''),
  to: String((g && g.to) || 'everyone'),
  ...(g && Number.isFinite(g.days) ? { days: g.days } : {}),
  ...(g && g.note ? { note: String(g.note) } : {}),
})

/* ---- reading a site's declaration ---- */
/* the space slugs: every .md directly under content/spaces */
export async function spaceNames(store) {
  const st = asStore(store)
  return (await st.list(SPACES_DIR, { ext: 'md' })).filter((n) => !n.includes('/'))
}
/* the channel slugs of one space: every .md under its folder */
export async function channelNames(store, space) {
  const st = asStore(store)
  return (await st.list(`${SPACES_DIR}/${space}`, { ext: 'md' })).filter((n) => !n.includes('/'))
}
export async function readSpace(store, name) {
  const st = asStore(store)
  const text = await st.read(`${SPACES_DIR}/${name}.md`)
  if (text == null) return null
  return { slug: name, ...parseSpace(text) }
}
export async function readChannel(store, space, name) {
  const st = asStore(store)
  const text = await st.read(`${SPACES_DIR}/${space}/${name}.md`)
  if (text == null) return null
  return { slug: name, space, ...parseChannel(text) }
}
/* the whole declaration, spaces in slug order, each with its channels in `order` then name */
export async function readSpaces(store) {
  const st = asStore(store)
  const out = []
  for (const name of await spaceNames(st)) {
    const s = await readSpace(st, name)
    if (!s) continue
    const channels = []
    for (const c of await channelNames(st, name)) { const ch = await readChannel(st, name, c); if (ch) channels.push(ch) }
    channels.sort((a, b) => (a.data.order - b.data.order) || a.slug.localeCompare(b.slug))
    out.push({ ...s, channels })
  }
  return out
}
