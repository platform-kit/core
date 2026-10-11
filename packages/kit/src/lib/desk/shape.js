/*
 * The desk's one shape, and the arithmetic over a list that mixes sources.
 *
 * A member of staff answers all day out of three systems — a guest at the support desk, a member in
 * their coaching thread, a colleague naming them in a channel — and none of that difference is
 * theirs. The desk is one list, and this is the only file that says what a row of it looks like:
 *
 *   {
 *     key,            the source and the id, unique across the whole list
 *     source,         which adapter made it; the surface says W['source-' + source] and names none
 *     id,             the conversation, thread or channel in its own system
 *     person: { id, name, kind },   kind: guest | reader | customer | member | colleague
 *     detail,         what to say beside the source: the page they are on, the channel's name
 *     last: { body, at, mine },
 *     unread,         how many of theirs are unanswered
 *     waiting_since,  when the unanswered run began, or null
 *     due,            the minutes promised for a reply, 0 where nothing is promised
 *     at,             the last activity, which is the second order
 *   }
 *
 * No imports but the chat's own span, so build/desk.test.mjs reads exactly what the surface does.
 * Every function takes plain rows and a `now`, and nothing here ever asks the clock itself.
 */
export { spanOf } from '../chat/model.js'
import { spanOf } from '../chat/model.js'

const MIN = 60 * 1000

/* the sources, in the order a list ties by */
/* WHO IS WAITING ON THE BUSINESS, by where they wrote from. A space is not among them: what waits
   in one is a mention or an unanswered direct message, and each of those is a place of the
   person's own. A queue is people outside asking something of the business. */
export const SOURCES = ['support', 'coaching', 'comments']

const QUEUE_SOURCES = {
  support: 'support',
  clients: 'coaching',
  comments: 'comments',
  social: 'social',
  'social-comments': 'social',
  'social-dms': 'social',
}
export const sourceForQueue = (queue) => QUEUE_SOURCES[queue] || 'support'
const SOCIAL_QUEUE_KINDS = { 'social-comments': 'comment', 'social-dms': 'dm' }

export function filterQueue(rows = [], queue, done = false) {
  const source = sourceForQueue(queue)
  const kind = SOCIAL_QUEUE_KINDS[queue]
  return filterDesk(rows, source, done).filter((row) => !kind || row.conversationKind === kind)
}

/* which adapters a site runs: a module that is off is not a source, and nothing about it is said
   anywhere. The desk itself is part of spaces, so with spaces off there is no desk at all. */
export function sourcesOn(modules = {}, registered = []) {
  if (modules.spaces === false) return []
  const builtIn = SOURCES.filter((s) => {
    if (s === 'support') return modules.support !== false
    /* THE CONVERSATIONS NO ROOM OWNS. A comment whose subject names a forum channel is moderated
       in that room by whoever moderates it; one that names none — a site with no community, an
       embed on somebody else's domain — would otherwise be nobody's job. That is why it is a
       source here and why only the unattached ones appear. */
    if (s === 'comments') return true
    return modules.coaching !== false
  })
  const custom = [...new Map(registered
    .filter((adapter) => adapter && typeof adapter.id === 'string' && adapter.id && !SOURCES.includes(adapter.id))
    .map((adapter) => [adapter.id, adapter])).values()]
    .filter((adapter) => modules[adapter.module || adapter.id] !== false)
    .map((adapter) => adapter.id)
  return [...builtIn, ...custom]
}

/* what is owed: the promise the row carries, run from when the run began. A row that promises
   nothing owes nothing — it is still waiting, and that is a different sentence. */
export function dueOf(row, now = Date.now()) {
  if (!row || !row.waiting_since || !(Number(row.due) > 0)) return null
  const since = new Date(row.waiting_since).getTime()
  if (!isFinite(since)) return null
  const due = since + Number(row.due) * MIN
  return { since, due, left: due - now, over: now > due }
}

/* the one badge, in one set of words: overdue, due, or simply waiting. A row waiting on nobody
   says nothing rather than showing an empty clock. */
export function owedOf(row, words = {}, now = Date.now()) {
  const d = dueOf(row, now)
  if (d) return { text: (d.over ? words['due-over'] : words['due-in'] || '').replace('{span}', spanOf(d.left)), over: d.over, soft: false }
  /* a wait is at least a minute: "waiting 0m" is not a thing anyone says */
  if (row && row.waiting_since) return { text: (words.waiting || '').replace('{span}', spanOf(Math.max(MIN, now - new Date(row.waiting_since).getTime()))), over: false, soft: true }
  return null
}

/* longest wait first, and the rest by what was last said. A row with no wait is not owed and sits
   under every row that is, however recent it is. */
export function sortDesk(rows = []) {
  const at = (r) => new Date(r?.at || 0).getTime() || 0
  const w = (r) => (r?.waiting_since ? new Date(r.waiting_since).getTime() || null : null)
  return rows.slice().sort((a, b) => {
    const wa = w(a), wb = w(b)
    if (wa != null && wb != null) return wa - wb || String(a.key).localeCompare(String(b.key))
    if (wa != null) return -1
    if (wb != null) return 1
    return at(b) - at(a) || String(a.key).localeCompare(String(b.key))
  })
}

/* what the rail shows: how many are waiting, and how many of those are past what was promised */
/* what each queue is owed, counted apart: a place badges its own rows and nobody else's */
export function badgeBySource(rows = [], now = Date.now(), sources = SOURCES) {
  const by = {}
  for (const s of sources) by[s] = deskBadge(rows.filter((r) => r && r.source === s), now)
  return by
}

export function deskBadge(rows = [], now = Date.now()) {
  let waiting = 0, overdue = 0
  for (const r of rows) {
    if (!r || !r.waiting_since || r.resolved) continue
    waiting += 1
    const d = dueOf(r, now)
    if (d && d.over) overdue += 1
  }
  return { waiting, overdue }
}

/* the list narrowed to one source, and to what is still open or what has been finished with. Those
   are the only two narrowings the desk has: everything else about a row — who is waiting, how long
   — is what the order already says. */
export function filterDesk(rows = [], source = null, done = false) {
  return rows.filter((r) => r && (!source || r.source === source) && !!r.resolved === !!done)
}

/* The marks the database keeps, as something to ask: source and id to when it was finished with. */
export function doneSet(rows = []) {
  const out = {}
  for (const r of rows) if (r && r.source && r.ref) out[r.source + ':' + r.ref] = r.resolved_at || null
  return out
}

/* Is this row finished with? The support desk carries a real status its own inbox reads, so that is
   the answer there. The other two are marked by the person who finished with them — and a mark only
   holds until the other party says something else: if the run they are waiting on began after the
   mark, they are waiting again. That is the same rule the support desk's own trigger keeps when a
   contact writes on a resolved thread, said once here for the sources that have no trigger. */
export function isDone(row, marks = {}) {
  if (!row) return false
  if (row.source === 'support') return row.status === 'resolved'
  const at = marks[row.source + ':' + row.id]
  if (at === undefined) return false
  if (!row.waiting_since || !at) return true
  return new Date(row.waiting_since).getTime() <= new Date(at).getTime()
}

/* the sources a list actually holds, for the filter's own chips */
export const sourcesIn = (rows = []) => [
  ...SOURCES.filter((s) => rows.some((r) => r && r.source === s)),
  ...new Set(rows.map((r) => r && r.source).filter((s) => s && !SOURCES.includes(s))),
]

/* ------------------------------------------------------------------ tickets

   The work, as against the conversation. A chat is a conversation — it starts, it wanders, it goes
   quiet; a ticket is a piece of work with a state and an owner, not finished until it is finished.
   The arithmetic below is the desk's own, said once so a queue and a ticket can never disagree
   about what "late" means. Pinned by build/tickets.test.mjs; the reads are tickets.js. */

/* the five states a piece of work is in, in the order a desk thinks about them */
/* A TICKET IS OPEN OR IT IS RESOLVED, and that is the whole state machine.
   It used to have five — open · doing · waiting · resolved · closed — and three of those were a
   guess about how a particular business works. "In hand" and "With them" assume a queue with a
   handover in it; "Closed" assumes a distinction from resolved that most desks never make. A ticket
   here may be a SaaS bug, a coaching question or a lost parcel, and none of those is the first-class
   case, so the shape says only the thing that is true of all of them: somebody asked, and it is
   either answered or it is not.
   What "With them" was reaching for survives as what it always was — a FACT, not a state:
   waiting_since is set when the contact speaks and cleared when the desk answers, so the desk can
   still sort by who has been waiting longest without anybody having to remember to press a button.
   Urgency is three, because three is what people can hold: low, normal, high. */
export const STATES = ['open', 'resolved']
export const LIVE = ['open']
export const PRIORITIES = ['high', 'normal', 'low']
/* what an old row said, and what it says now. Kept so a ticket written before this is still read. */
export const WAS = { doing: 'open', waiting: 'open', closed: 'resolved', urgent: 'high' }
export const statusOfTicket = (t) => WAS[t && t.status] || (t && t.status) || 'open'
export const priorityOf = (t) => WAS[t && t.priority] || (t && t.priority) || 'normal'

export const isLive = (t) => !!t && LIVE.includes(statusOfTicket(t))
/* "waiting" means waiting on THEM: the desk has answered and the ball is in the contact's court,
   so it is live work but nothing is owed on it today */
/* SOMEBODY IS WAITING ON US: the contact has spoken since the desk last did, and the ticket is not
   resolved. A fact the rows carry, never a state anybody sets. */
export const isOwed = (t) => !!t && statusOfTicket(t) === 'open' && !!t.waiting_since

/* WHAT A LIST IS SORTED BY, said once. Urgency first, because that is what priority is for; then
   what somebody is waiting on, because a person waiting is the thing a desk exists to stop; then
   whatever moved last. A sort spread across a template is a sort nobody can check. */
const RANK = { urgent: 0, high: 0, normal: 1, low: 2 }
export function sortTickets(list = [], mode = 'busy') {
  const at = (t) => new Date(t.last_at || t.created_at || 0).getTime()
  const rows = [...(list || [])]
  if (mode === 'new') return rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  if (mode === 'waiting') {
    return rows.sort((a, b) => {
      const wa = a.waiting_since ? new Date(a.waiting_since).getTime() : Infinity
      const wb = b.waiting_since ? new Date(b.waiting_since).getTime() : Infinity
      return wa - wb || at(b) - at(a)
    })
  }
  if (mode === 'due') {
    return rows.sort((a, b) => {
      const da = a.due_at ? new Date(a.due_at).getTime() : Infinity
      const db = b.due_at ? new Date(b.due_at).getTime() : Infinity
      return da - db || at(b) - at(a)
    })
  }
  return rows.sort((a, b) => (RANK[a.priority] ?? 9) - (RANK[b.priority] ?? 9) || at(b) - at(a))
}

/* what is owed on one, in the words the desk already uses for a chat: overdue by, due in, waiting.
   One vocabulary across the desk, so a queue and a ticket never disagree about what "late" is. */
export function owedOn(t, words = {}, now = Date.now()) {
  if (!t || !isLive(t)) return null
  const w = { 'due-in': 'Due in {span}', 'due-over': 'Overdue by {span}', waiting: 'Waiting {span}', ...words }
  if (t.due_at) {
    const left = new Date(t.due_at).getTime() - now
    return left < 0
      ? { text: w['due-over'].replace('{span}', spanOf(-left)), over: true }
      : { text: w['due-in'].replace('{span}', spanOf(left)), over: false }
  }
  if (t.waiting_since) {
    return { text: w.waiting.replace('{span}', spanOf(now - new Date(t.waiting_since).getTime())), over: false, soft: true }
  }
  return null
}

/* how long a piece of work has been open, for the line under its title */
export const ageOf = (t, now = Date.now()) => (t && t.created_at ? spanOf(now - new Date(t.created_at).getTime()) : '')

/* the counts a desk wants at a glance: what is live, what is owed, what is mine */
export function tally(list = [], me = null) {
  const rows = list || []
  return {
    live: rows.filter(isLive).length,
    owed: rows.filter(isOwed).length,
    mine: rows.filter((t) => isLive(t) && (t.assignees || []).some((a) => a.id === me)).length,
    unassigned: rows.filter((t) => isLive(t) && !(t.assignees || []).length).length,
  }
}

/* the narrowing a list offers, applied in one place so the chips and the rows can never disagree */
export function narrow(list = [], { status = 'open', assignee = null, priority = null, q = '', answer = null } = {}, me = null) {
  const want = String(q || '').trim().toLowerCase().replace(/^#/, '')
  return (list || []).filter((t) => {
    /* 'owed' is not a state a row holds: it is the derived fact that the contact has spoken since
       the desk last did. It narrows like a state because that is how a person thinks about it. */
    if (status === 'owed') { if (!isOwed(t)) return false }
    else if (status === 'open' && !isLive(t)) return false
    else if (status && status !== 'open' && status !== 'all' && statusOfTicket(t) !== status) return false
    if (priority && priorityOf(t) !== priority) return false
    /* AN ANSWER NARROWS IT TOO — a field this kit has never heard of, with a value a site invented:
       "the billing ones", "the urgent ones", "the ones about the reader". It is the whole of what
       makes a form worth asking before a ticket is raised. */
    if (answer && answer.field) { const v = (t.answers || {})[answer.field]; if (String(v == null ? '' : v) !== String(answer.value)) return false }
    if (assignee === 'mine' && !(t.assignees || []).some((a) => a.id === me)) return false
    if (assignee === 'nobody' && (t.assignees || []).length) return false
    if (assignee && assignee !== 'mine' && assignee !== 'nobody' && !(t.assignees || []).some((a) => a.id === assignee)) return false
    if (!want) return true
    return String(t.ref) === want
      || String(t.title || '').toLowerCase().includes(want)
      || String(t.body || '').toLowerCase().includes(want)
      || ((t.contact || {}).name || '').toLowerCase().includes(want)
  })
}
