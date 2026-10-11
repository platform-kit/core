/*
 * The spaces' arithmetic, with no imports of its own beyond the chat's day rules and no environment,
 * so the surface and the tests (build/spaces.test.mjs) read the same rules: what is unread, what a
 * catch-up asks for and what it leaves to paging, where the unread divider sits, which message
 * notifies whom, and how a mention is written and read back. Every function takes plain rows as the
 * database returns them.
 *
 * The one rule underneath all of it: unread is a subtraction, never a count. A channel carries the
 * number it has reached and a membership the number it has read to; everything here is arithmetic on
 * those two, so nothing grows with the history.
 */
export { dayLabel, daySections, initials, clock } from '../chat/model.js'
export { inlineParts, messageBlocks, plainMarkup } from '../chat/markup.js'
import { inlineParts, messageBlocks, plainMarkup } from '../chat/markup.js'

const RUN_GAP = 5 * 60 * 1000   /* messages closer than this, from one person, read as one run */

/* first/last of a run: the first carries the avatar and the name, the rest sit close under it. The
   chat's own groupRuns reads sender_id and a space message carries author_id, so this is its own —
   a system line never joins a run, and never lets two messages either side of it join one. */
export function runsOf(messages = []) {
  return messages.map((m, i) => {
    const prev = messages[i - 1], next = messages[i + 1]
    const joins = (a, b) => !!a && !!b && a.kind !== 'system' && b.kind !== 'system'
      && a.author_id === b.author_id && !!a.author_id
      && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < RUN_GAP
    return { ...m, first: !joins(prev, m), last: !joins(m, next) }
  })
}

/* a channel row (last_seq) with the caller's membership (last_read_seq, mention_count) */
export const unreadOf = (row) => Math.max(0, (Number(row?.seq ?? row?.last_seq ?? 0)) - Number(row?.read ?? row?.last_read_seq ?? 0))
export const mentionsOf = (row) => Math.max(0, Number(row?.mentions ?? row?.mention_count ?? 0))

/* is this channel muted right now */
/* is this channel quiet right now — this membership's own snooze (muted_until), or the reader's
   standing mute of the room or of the space it is in, which the read reports as 'hushed' because a
   space muted once must not write a row onto every room in it nor miss the rooms it gains later */
export const mutedNow = (row, now = Date.now()) => !!row?.hushed
  || (!!row?.muted_until && new Date(row.muted_until).getTime() > now)

/* the badge a rail shows: what is unread, and what is owed. A muted channel counts its mentions and
   never its messages — that is what muting means. */
export function badgeOf(rows = [], now = Date.now()) {
  let unread = 0, mentions = 0, channels = 0
  for (const r of rows) {
    const m = mentionsOf(r)
    const u = unreadOf(r)
    mentions += m
    if (!mutedNow(r, now) && r?.notify !== 'none') { unread += u; if (u > 0) channels += 1 }
    else if (m > 0) channels += 1
  }
  return { unread, mentions, channels }
}

/* ONE NUMBER, for the header. A rail can afford three counts; a button in the header can afford
   one, and it has to mean the same thing every time: what is actually waiting for this person.
   That is every unread line of a direct message (somebody wrote to them) plus every mention in a
   room (somebody called them) — never the traffic of a busy channel nobody addressed them in, which
   would sit at 400 by Tuesday and be worth nothing. Discord draws the same line. Muting is honoured
   exactly as badgeOf honours it: a muted room still counts what names you. */
export function waitingOf(rows = [], now = Date.now()) {
  let n = 0
  for (const r of rows) {
    const dm = (r?.kind || r?.channel_kind) === 'dm'
    const quiet = mutedNow(r, now) || r?.notify === 'none'
    n += mentionsOf(r)
    if (dm && !quiet) n += unreadOf(r)
  }
  return n
}

/* the same, per space */
export function badgesBySpace(rows = [], now = Date.now()) {
  const by = new Map()
  for (const r of rows) {
    const k = r?.space || ''
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(r)
  }
  const out = {}
  for (const [k, list] of by) out[k] = badgeOf(list, now)
  return out
}

/* what a catch-up asks for: the last seq seen per channel, the rows the client already holds */
export function cursorsOf(rows = []) {
  const out = {}
  for (const r of rows) {
    const id = r?.channel || r?.channel_id
    if (!id) continue
    out[id] = Math.max(Number(out[id] || 0), Number(r?.seen ?? r?.read ?? r?.last_read_seq ?? 0))
  }
  return out
}

/* the answer applied: the messages to add per channel, and the channels too far behind to carry,
   which are paged rather than trusted. */
export function mergeCatchup(answer = []) {
  const add = {}, page = []
  for (const a of answer) {
    const id = a?.channel
    if (!id) continue
    add[id] = Array.isArray(a.messages) ? a.messages.slice() : []
    if (a.more) page.push(id)
  }
  return { add, page }
}

/* messages by seq, one of each, whatever order they arrived in (a broadcast, a page, a catch-up) */
export function mergeMessages(list = [], incoming = []) {
  const by = new Map()
  for (const m of list) if (m && m.id) by.set(m.id, m)
  for (const m of incoming) {
    if (!m || !m.id) continue
    const had = by.get(m.id)
    by.set(m.id, had ? { ...had, ...m } : m)
  }
  return [...by.values()].sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
}

/* where the "new messages" line sits: the first message past what was read that is not the reader's
   own. It is a seq and not an index, so it survives a reload and a page of older messages. */
export function dividerSeq(messages = [], lastReadSeq = 0, me = null) {
  for (const m of messages) {
    if (Number(m?.seq || 0) <= Number(lastReadSeq || 0)) continue
    if (me && m?.author_id === me) continue
    return Number(m.seq)
  }
  return null
}

/* a thread's own state: how many replies, when the last one came, and whether the reader is in it
   (they wrote the root or a reply), which is one of the things that notifies them. */
export function threadOf(root, replies = [], me = null) {
  const count = Number(root?.reply_count ?? replies.length ?? 0)
  const last = root?.last_reply_at || (replies.length ? replies[replies.length - 1].created_at : null)
  const mine = !!me && (root?.author_id === me || replies.some((r) => r?.author_id === me))
  return { count, last, mine }
}

/* A PLATFORM LINE IS A THING TO ACT ON, not a log entry. An order that failed, a membership that
   began, a support thread that has waited too long — each is the start of a piece of work, and the
   place to do that work is a thread hanging off the line that announced it. Without that, a room
   the platform writes into is a worse version of an email alert: read it, then go and talk about
   it somewhere else, where nobody can find the two halves again.
 *
   So a system line the platform wrote FROM AN EVENT takes replies and reactions, and the room's own
   housekeeping — somebody joined, the topic changed — does not, because there is nothing to say
   back to it. What tells them apart is already on the row: an event's line carries what happened
   in its meta. Nobody may edit or withdraw either: they are not anybody's words. */
export const fromEvent = (m) => !!m && m.kind === 'system' && !!(m.meta && m.meta.event)
/* A BOT'S LINE IS NOT AN EVENT. It arrives as a system message because nobody's account wrote it,
   but it is something that was SAID: it carries its own words, it is answered, and it is shown
   with the bot's name over it rather than as a notice from the platform. */
export const fromBot = (m) => !!m && m.kind === 'system' && !!(m.meta && m.meta.bot)
export const canReply = (m) => !!m && !m.deleted_at && (m.kind !== 'system' || fromEvent(m) || fromBot(m))

/*
 * WHAT A LINE SAYS, IN WORDS — for anything that needs the room as prose rather than as rows: a
 * bot being caught up, a transcript, a digest.
 *
 * It has to be this and not `m.body`, because the most interesting lines in a room have no body
 * at all. A platform line carries FACTS and never a sentence (`meta.event` plus the numbers), and
 * the sentence is markdown said at the surface; a voice note's words are its transcript; a file's
 * are its name. Reading `m.body` gives you an empty string for every one of them — which is how a
 * bot came to be handed 181 messages of an orders channel and told there was nothing there.
 *
 * `words` is the `events` group of the spaces scope; `fallback` its `unknown`.
 */
export function saidIn(m, { names = {}, words = {}, money = (v) => String(v), unheard = '' } = {}) {
  if (!m || m.deleted_at) return ''
  if (m.kind === 'system') {
    const meta = m.meta || {}
    /* a bot said it: those are its own words */
    if (meta.bot) return plainBody(m.body || '', names)
    if (!meta.event) return plainBody(m.body || '', names)
    const rec = words[meta.event] || words.unknown || {}
    const facts = { ...meta, amount: money(meta.amount, meta.currency) }
    return String(rec.line || '').replace(/\{(\w+)\}/g, (_, k) => (facts[k] == null ? '' : String(facts[k]))).replace(/\s+/g, ' ').trim()
  }
  /* a space voice note carries its words in `body` (lib/spaces/api.js writes the transcript there,
     so it is readable and searchable like any line); the coaching chat's has its own column. Take
     either, and only then say that somebody spoke and we do not know what they said. */
  if (m.kind === 'voice') return String(m.transcript || m.body || '').trim() || String(unheard || '').trim()
  if (m.kind === 'file') return String(m.attachment_name || '').trim()
  if (m.kind === 'poll') return String(m.title || m.body || '').trim()
  return [m.title, plainBody(m.body || '', names)].filter(Boolean).join(' — ')
}

/*
 * A HEADING FOR A POST THAT HAS NO TITLE.
 *
 * A forum card used to show `body.slice(0, 80)` — which cuts mid-word and leaves the markdown in,
 * so a bot's answer became "**Breakthrough co" and "you'll need to contact th". A heading is a
 * sentence, or the start of one, and it never ends mid-word.
 */
export function titleOf(m, names = {}, { max = 80 } = {}) {
  const said = plainMarkup(plainBody((m && m.body) || '', names)).replace(/\s+/g, ' ').trim()
  if (!said) return ''
  /* a first sentence, where there is one short enough to be a heading */
  const stop = said.search(/[.!?](\s|$)/)
  if (stop > 0 && stop + 1 <= max) return said.slice(0, stop + 1)
  if (said.length <= max) return said
  /* otherwise cut on a word, not through one */
  const cut = said.slice(0, max)
  const back = cut.lastIndexOf(' ')
  return (back > max * 0.5 ? cut.slice(0, back) : cut).replace(/[\s,;:]+$/, '') + '…'
}

/* who said it, by name — a space message's author is `author_id`; `sender_id` is the chat's */
export const saidBy = (m, names = {}, someone = 'someone') =>
  (m && m.meta && m.meta.name) || names[m && m.author_id] || someone

/*
 * WHICH LINES A BOT IS GIVEN — the decision, apart from the drawing of it, because this is the
 * part that has been wrong twice.
 *
 * A THREAD IS THE CONVERSATION. A bot summoned inside a thread is answering the thread, so it gets
 * the thread: its opening message and every reply. Handing it the channel instead gives it
 * everything except the exchange it is part of, and a follow-up ("which are best for newbs")
 * arrives with no sign of what it follows up. Worse, a reader who opened a thread directly has no
 * channel list loaded at all, so the context is not merely wrong, it is empty.
 *
 * Outside a thread it is the channel, and a thread's replies are NOT folded in: they are a
 * conversation somebody stepped aside to have, and the channel does not show them either.
 */
export function roomFor({ messages = [], thread = null, threadRoot = null } = {}) {
  const inThread = !!(threadRoot && thread && thread.root && thread.root.id === threadRoot)
  if (!inThread) return { inThread: false, lines: messages || [] }
  return { inThread: true, lines: [thread.root, ...(thread.replies || [])].filter(Boolean) }
}

/* the room as prose, newest last: what a person would have read, for something that was not here */
export function roomAsProse(messages = [], { names = {}, words = {}, money, someone = 'someone', limit = 60, who, unheard = '' } = {}) {
  /* `who` lets a surface label a line by SIDE rather than by person — a support desk has two of
     them and no names — while what was SAID stays the one function, so a voice note or an
     attachment is never silently dropped from one surface's transcript and not another's. */
  const name = who || ((m) => saidBy(m, names, someone))
  return messages.slice(-limit)
    .map((m) => ({ notice: fromEvent(m), who: name(m), said: saidIn(m, { names, words, money, unheard }) }))
    .filter((l) => l.said)
    .map((l) => (l.notice ? l.said : `${l.who}: ${l.said}`))
    .join('\n')
}
export const canReact = canReply

/* ------------------------------------------------------------------ rooms */

/* HOW A ROOM IS READ DECIDES HOW IT IS DRAWN, and there are exactly two ways.
 *
 * A room where anybody may be talking is read by AUTHOR: the eye goes down one column and the name
 * at the head of each run says who is speaking, so every line begins at the same edge — the
 * reader's own among them. Sorting those lines by side would say nothing (there are more than two
 * sides) and would cost the column that makes a room scannable.
 *
 * A conversation between two people is read by SIDE: there is no third person to confuse, the side
 * IS the answer to who said it, and a name over every line is noise. So the other person's lines sit
 * at the left and the reader's own at the right, as every messaging app has drawn two people since
 * they were on paper.
 *
 * Direct messages are the second kind; so are the desk's two queues, which draw their own lines.
 * Channels — a stream or a forum, open or private, a staff room or a community's — are the first,
 * however few people are in one: what decides it is that anybody MAY speak, not who did today. */
export const sidedRoom = (channel) => !!channel && channel.kind === 'dm'

/* A direct message has no name of its own: it is who is in it. One other person is their name; two
   or more are their names in order; and a room with nobody else in it is the reader talking to
   themselves, which is a real thing people do and deserves its own word rather than a blank. */
export function dmTitle(members = [], names = {}, me = null, words = {}) {
  const others = members.filter((id) => id !== me)
  if (!others.length) return words.self || (names[me] || '') + ' (you)'
  const said = others.map((id) => names[id] || words.someone || 'someone').sort((a, b) => a.localeCompare(b))
  if (said.length <= 3) return said.join(', ')
  return said.slice(0, 2).join(', ') + ' ' + (words.more || '+{n}').replace('{n}', said.length - 2)
}

/* the rooms of a space, split the way a sidebar shows them */
export function railSections(channels = [], rows = [], spaceId = null, groups = []) {
  const row = (id) => rows.find((r) => r.channel === id) || null
  const mine = channels.filter((c) => !spaceId || c.space_id === spaceId)
  const starred = [], open = [], dms = []
  for (const c of mine) {
    const r = row(c.id)
    if (c.kind === 'dm') { if (r) dms.push(c); continue }
    if (r && r.starred) starred.push(c)
    else open.push(c)
  }
  /* Fourteen rooms need headings. A room's place and its heading are both its own file's
     (`order`, `group`), so the rail draws what the site wrote rather than an alphabet: the
     declared groups in their declared order, each with its rooms, and whatever sits under no
     heading last under none. A space that declares no group has one run, as it always did. */
  const place = (a, b) => ((a.position ?? 99) - (b.position ?? 99)) || String(a.name || '').localeCompare(String(b.name || ''))
  const named = (groups || []).filter((g) => open.some((c) => c.group === g))
  const grouped = named.map((g) => ({ name: g, channels: open.filter((c) => c.group === g).sort(place) }))
  const loose = open.filter((c) => !c.group || !named.includes(c.group)).sort(place)
  return { starred: starred.sort(place), channels: loose, groups: grouped, dms }
}

/* how many drafts are waiting, for the line that says so */
export const draftCount = (drafts = {}) => Object.values(drafts).filter((t) => String(t || '').trim()).length

/* ------------------------------------------------------------------ who is about

   A status is a thing about a session, not about a person: it lives on the socket beside presence,
   it is gone when the tab is, and it is never written down. Three of them, because a fourth is a
   thing to maintain rather than a thing to read: here, away, and not now. "Away" is also what the
   surface decides on its own after a while of nobody touching anything — but only over "here",
   since somebody who said they are not to be disturbed has not stopped meaning it by going quiet. */
export const STATUSES = ['active', 'away', 'dnd']
export const AWAY_AFTER = 5 * 60 * 1000

export const isStatus = (s) => STATUSES.includes(s)

/* what to show for somebody, from what their sessions are saying: any session that is here wins,
   because a person with two tabs open is here. Nobody on the topic at all is away. */
export function statusOf(sessions, now = Date.now()) {
  const list = (Array.isArray(sessions) ? sessions : []).filter(Boolean)
  if (!list.length) return 'away'
  if (list.some((s) => s.status === 'active')) return 'active'
  if (list.some((s) => s.status === 'dnd')) return 'dnd'
  return 'away'
}

/* what this session should be saying, given what was chosen and how long ago anything was touched */
export function myStatus(chosen, lastSeen, now = Date.now()) {
  const want = isStatus(chosen) ? chosen : 'active'
  if (want !== 'active') return want
  return now - Number(lastSeen || now) > AWAY_AFTER ? 'away' : 'active'
}

/* ------------------------------------------------------------------ mentions */

/* the composer writes a token and never a name, so a mention resolves exactly and survives a rename */
export const writeMention = (id) => '<@' + id + '>'
export const CHANNEL_MENTION = '<!channel>'

/*
 * A BOT IS MENTIONED LIKE ANYBODY ELSE. It has no account, so it has no uuid — its token carries
 * `bot:<slug>` where a person's carries an id, and everything else about a mention is unchanged:
 * the same token shape, the same parser, the same drawing, the same names map (whose key for a bot
 * is `bot:<slug>`). One grammar, not two, so a bot's name can no more be pasted into a body than
 * a person's can — what is stored is the slug, and what is shown is looked up when it is drawn.
 */
export const BOT_PICK = (slug) => 'bot:' + slug
export const isBotPick = (id) => typeof id === 'string' && id.startsWith('bot:')
/*
 * AND A ROLE IS A GROUP YOU CAN NAME. `@coaches` reaches whoever holds the role in this space and
 * is in this room. Same token shape again, same parser, same names map — the third thing that can
 * be named, and not a third grammar. The slug is what is stored, so renaming the role does not
 * silently stop the mention working.
 */
export const ROLE_PICK = (slug) => 'role:' + slug
export const isRolePick = (id) => typeof id === 'string' && id.startsWith('role:')
const TOKEN = /<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|bot:[a-z0-9-]{1,60}|role:[a-z0-9-]{1,48})>/g

/* every role a body names, once each — for a surface that wants to say so, never for notifying:
   who holds a role is the database's answer and is resolved there */
export function rolesMentioned(body) {
  const out = []
  for (const m of String(body || '').matchAll(TOKEN)) {
    const slug = m[1].startsWith('role:') ? m[1].slice(5) : null
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}

/* every bot a body names, once each, in the order they appear */
export function botsMentioned(body) {
  const out = []
  for (const m of String(body || '').matchAll(TOKEN)) {
    const slug = m[1].startsWith('bot:') ? m[1].slice(4) : null
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}

/* every id a body names, once each, in the order they appear */
export function mentionIds(body) {
  const out = []
  const seen = new Set()
  for (const m of String(body || '').matchAll(TOKEN)) {
    /* a bot is named but nobody is notified; a role is resolved to its holders in the database,
       never here, because a client does not know who holds it */
    if (m[1].startsWith('bot:') || m[1].startsWith('role:')) continue
    if (seen.has(m[1])) continue
    seen.add(m[1]); out.push(m[1])
  }
  return out
}

export const mentionsChannel = (body) => String(body || '').includes(CHANNEL_MENTION)

/* the body cut into pieces for drawing: text and mentions, so a name is never pasted into a string */
export function mentionParts(body, names = {}, words = {}) {
  const s = String(body || '')
  const out = []
  let last = 0
  const push = (t) => { if (t) out.push({ kind: 'text', text: t }) }
  const re = new RegExp(TOKEN.source + '|' + CHANNEL_MENTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  for (const m of s.matchAll(re)) {
    push(s.slice(last, m.index))
    if (m[1]) out.push({ kind: 'mention', id: m[1], name: names[m[1]] || words.someone || 'someone' })
    else out.push({ kind: 'mention', id: null, name: words.channel || 'channel' })
    last = m.index + m[0].length
  }
  push(s.slice(last))
  return out
}

/* ------------------------------------------------------------------ writing one

   A message carries a token so a mention survives a rename, but the person writing it must never
   see one: a uuid in the box they are typing into is the file's grammar showing through, which is
   exactly what the rules of this project forbid. So the composer holds "@Sam Support" — the name,
   as text — and remembers which id it stood for; these two turn that into the token on the way out
   and back into pieces to draw on the way in.

   A name that is edited after it was picked simply stops being a mention. That is the honest
   behaviour: the writer changed the words, so the words are what they get. */

/* A LINE IS CUT ONCE, by one grammar: the people it names (which are tokens only this surface
   writes) and then the marks everybody may type (lib/chat/markup.js, shared with the desk and the
   widget). The component draws the parts; nothing here makes html. */
export const lineBlocks = (body, names = {}, words = {}) => messageBlocks(body, (line) =>
  mentionParts(line, names, words).flatMap((p) => (p.kind === 'mention' ? [p] : inlineParts(p.text))))

export const CHANNEL_PICK = '#channel'   /* what picked holds for the whole-channel mention */

/* the names longest first, so "Sam Support" is matched before a "Sam" who is also in the room */
const pickedNames = (picked) => Object.keys(picked || {}).filter(Boolean).sort((a, b) => b.length - a.length)

/* what is typed → what is stored */
export function toTokens(text, picked = {}) {
  let out = String(text || '')
  for (const name of pickedNames(picked)) {
    const id = picked[name]
    const token = id === CHANNEL_PICK ? CHANNEL_MENTION : writeMention(id)
    out = out.split('@' + name).join(token)
  }
  return out
}

/* what is stored → what is typed, for a draft written before this composer was opened */
export function fromTokens(body, names = {}, words = {}) {
  const picked = {}
  const text = mentionParts(body, names, words).map((p) => {
    if (p.kind !== 'mention') return p.text
    picked[p.name] = p.id || CHANNEL_PICK
    return '@' + p.name
  }).join('')
  return { text, picked }
}

/* what is typed → the pieces to draw, so a mention reads as a mention while it is being written */
export function mentionSpans(text, picked = {}) {
  const s = String(text || '')
  const names = pickedNames(picked)
  const out = []
  let i = 0, plain = ''
  outer: while (i < s.length) {
    if (s[i] === '@') {
      for (const name of names) {
        if (s.startsWith('@' + name, i)) {
          if (plain) { out.push({ kind: 'text', text: plain }); plain = '' }
          out.push({ kind: 'at', text: '@' + name, id: picked[name] })
          i += name.length + 1
          continue outer
        }
      }
    }
    plain += s[i]
    i += 1
  }
  if (plain) out.push({ kind: 'text', text: plain })
  return out
}

/* the plain reading of a body, for a preview or a notification */
export const plainBody = (body, names = {}, words = {}) =>
  mentionParts(body, names, words).map((p) => (p.kind === 'text' ? p.text : '@' + p.name)).join('')

/* ------------------------------------------------------------------ notification */

/* A notification follows a mention, not an unread message. Everything else about a channel is a
   badge. The reader's own message never notifies them, a muted channel never does, and a channel set
   to nothing never does whatever the message says.
   ctx: { me, notify, muted_until, now, mentioned, inThread, mentionsChannel, mayMentionChannel } */
export function notifies(message, ctx = {}) {
  const now = ctx.now ?? Date.now()
  if (!message || message.deleted_at) return false
  if (ctx.me && message.author_id === ctx.me) return false
  if (ctx.notify === 'none') return false
  if (mutedNow({ muted_until: ctx.muted_until }, now)) return false
  if (ctx.notify === 'all') return true
  /* the default: mentions, a thread the reader is in, and nothing else */
  if (ctx.mentioned) return true
  if (ctx.mentionsChannel && ctx.mayMentionChannel !== false) return true
  if (ctx.inThread && message.thread_root_id) return true
  return false
}

/* ------------------------------------------------------------------ what somebody is here

   A member of a space holds ROLES, plural — a moderator who is also a founding member, somebody who
   is both a mentor and a host. The names are the SITE'S, not the kit's: a role is a record of the
   space it belongs to, so there is no vocabulary here to keep in step with a database, and nothing
   in this file decides what a role may do. What somebody may do is one question with one answer
   (space_may), asked of the database, carried on the counters, and read below. */

/* the slugs somebody holds, whatever shape they arrive in, tidied and without repeats */
export function rolesOf(v) {
  const list = (Array.isArray(v) ? v : v ? [v] : []).map((r) => String(r || '').trim()).filter(Boolean)
  return [...new Set(list)]
}

export const holdsRole = (v, role) => rolesOf(v).includes(role)

/* Naming the whole channel is a capability, granted to a role by a row somebody can read and change
   — never a pair of names hidden in here. The answer rides on the channel's own counters, so the
   composer is told before somebody sends, and the message goes all the same: it simply notifies
   nobody by being that. */
export const mayMentionChannel = (row) => !!(row && row.mention)

/* ---- a poll: what was asked, what came back ----------------------------------------------- */
/* The question is the message's body and the options ride on its meta, which nothing may rewrite;
   the votes are rows. This is all the arithmetic there is, and it is pure — the surface draws what
   it returns and asks the database for nothing else.

   A poll with no votes has shares of zero and not NaN, which is the one trap in here. */
export function pollOf(message) {
  const p = message && message.meta && message.meta.poll
  if (!p || !Array.isArray(p.options) || !p.options.length) return null
  return { options: p.options, multi: !!p.multi, closed: !!(message.poll_closed_at) }
}

export function tallyPoll(message, votes = [], me = '') {
  const poll = pollOf(message)
  if (!poll) return null
  const mine = new Set()
  const counts = new Map()
  const by = new Map()
  for (const v of votes) {
    if (!v || v.message_id !== message.id) continue
    counts.set(v.option_key, (counts.get(v.option_key) || 0) + 1)
    if (!by.has(v.option_key)) by.set(v.option_key, [])
    by.get(v.option_key).push(v.user_id)
    if (me && v.user_id === me) mine.add(v.option_key)
  }
  /* the total is people where one answer is allowed and answers where several are, because those
     are the two different things a share can be a share OF */
  const cast = [...counts.values()].reduce((n, x) => n + x, 0)
  const people = new Set(votes.filter((v) => v && v.message_id === message.id).map((v) => v.user_id)).size
  const whole = poll.multi ? cast : people
  const options = poll.options.map((o) => {
    const n = counts.get(o.key) || 0
    return { key: o.key, text: o.text, votes: n, share: whole ? n / whole : 0, mine: mine.has(o.key), who: by.get(o.key) || [] }
  })
  const top = options.reduce((m, o) => (o.votes > m ? o.votes : m), 0)
  return {
    options: options.map((o) => ({ ...o, leads: !!top && o.votes === top })),
    multi: poll.multi, closed: poll.closed, cast, people, voted: mine.size > 0,
  }
}

/* ------------------------------------------------------------------ what is on

   A community's calendar, in the terms the person reading it thinks in: what day something falls
   on where THEY are, whether that is today, how long until it starts, whether it is on now, and
   the gathering by day that makes a list of times a calendar. Pure, and pinned by
   build/calendar.test.mjs; the reads that fetch the occurrences are calendar.js. */

const DAY = 86400000

/* the day something falls on, as the reader's own clock reads it — which is what decides whether
   they are told "today" */
export const dayOf = (when, zone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(when))

/* today · tomorrow · the weekday · the date, in the reader's own terms */
export function whenWord(when, now = Date.now(), words = {}, zone) {
  const w = { today: 'Today', tomorrow: 'Tomorrow', ...words }
  const d = dayOf(when, zone)
  if (d === dayOf(now, zone)) return w.today
  if (d === dayOf(now + DAY, zone)) return w.tomorrow
  const soon = when - now < DAY * 6
  return new Intl.DateTimeFormat(undefined, soon
    ? { timeZone: zone || undefined, weekday: 'long' }
    : { timeZone: zone || undefined, day: 'numeric', month: 'short' }).format(new Date(when))
}

export const clockOf = (when, zone) => new Intl.DateTimeFormat(undefined, {
  timeZone: zone || undefined, hour: 'numeric', minute: '2-digit',
}).format(new Date(when))

/* WHEN SOMETHING HAPPENED, on a thing that may be months old: the time alone while it is today,
   and the day in front of it once it is not. A ticket's timeline runs for weeks — a column of bare
   times on it says nothing at all — while a chat's is nearly always one afternoon. */
export function stampOf(when, now = Date.now(), zone) {
  if (!when) return ''
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return ''
  const time = clockOf(d, zone)
  if (dayOf(d, zone) === dayOf(now, zone)) return time
  const sameYear = new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric' }).format(d)
    === new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric' }).format(new Date(now))
  const day = new Intl.DateTimeFormat(undefined, sameYear
    ? { timeZone: zone || undefined, day: 'numeric', month: 'short' }
    : { timeZone: zone || undefined, day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  return day + ', ' + time
}

/* how long until it starts, said the way a person would say it; null once it has */
export function untilWord(when, now = Date.now(), words = {}) {
  const w = { now: 'On now', mins: 'in {n}m', hours: 'in {n}h', days: 'in {n}d', ...words }
  const ms = when - now
  if (ms <= 0) return w.now
  const mins = Math.round(ms / 60000)
  if (mins < 60) return w.mins.replace('{n}', Math.max(1, mins))
  if (mins < 60 * 24) return w.hours.replace('{n}', Math.round(mins / 60))
  return w.days.replace('{n}', Math.round(mins / (60 * 24)))
}

/* on now: between its start and its end, with a few minutes' grace either side so somebody who is
   early is not told it has not begun */
export function isOn(o, now = Date.now(), grace = 10 * 60000) {
  if (!o || !o.starts_at) return false
  const start = new Date(o.starts_at).getTime()
  const end = o.ends_at ? new Date(o.ends_at).getTime() : start + 3600000
  return now >= start - grace && now <= end + grace
}

/* the occurrences gathered under the day they fall on, which is how a calendar reads */
export function byDay(list = [], zone) {
  const days = new Map()
  for (const o of list) {
    const key = dayOf(o.starts_at, zone)
    if (!days.has(key)) days.set(key, { day: key, at: new Date(o.starts_at).getTime(), items: [] })
    days.get(key).items.push(o)
  }
  return [...days.values()].sort((a, b) => a.at - b.at)
}

/*
 * IS THIS CHANNEL ENCRYPTED? One reading, so the build, the push step and the admin cannot differ.
 *
 * The channel's own answer when it gives one, the space's otherwise. A channel that says nothing
 * is not "false" — it is "whatever the space says", which is how a space can seal every room under
 * it in one line and let one of them out again.
 *
 * Note which way round the test goes: `typeof === 'boolean'`, not truthiness. A channel declaring
 * `encrypted: false` inside a space that declares `true` must come out false, and `!channel.encrypted`
 * would have thrown that away along with "said nothing".
 */
export const encryptedOf = (channel = {}, space = {}) =>
  typeof channel.encrypted === 'boolean' ? channel.encrypted : !!space.encrypted

/*
 * A RECOVERY KEY AS A PERSON READS IT. Groups of four, which is the only way a 43-character secret
 * is copied off a screen by hand without a mistake, and whitespace thrown away on the way back in
 * — the reader may type it with the spaces, without them, or with a line break where they turned
 * the page of their notebook, and all three are the same key.
 */
export const spaceOut = (key) => String(key || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
export const tighten = (key) => String(key || '').replace(/\s+/g, '')
