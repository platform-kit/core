/*
 * The chat's arithmetic, with no imports and no environment, so the page and
 * the tests (build/chat.test.mjs) read the same rules: how a thread is cut
 * into days and runs, what tick a message shows, how a reaction toggles, how a
 * name becomes initials and seconds become a clock. Every function takes plain
 * rows as the database returns them.
 */

const MIN = 60 * 1000
const RUN_GAP = 5 * MIN     /* messages closer than this, from one sender, read as one run */

const dayKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

/* the label a day divider carries: today, yesterday, else a date */
export function dayLabel(date, now, words = {}, locale = undefined) {
  const d = new Date(date), n = new Date(now)
  const k = dayKey(d), today = dayKey(n)
  if (k === today) return words.today || 'Today'
  const y = new Date(n); y.setDate(y.getDate() - 1)
  if (k === dayKey(y)) return words.yesterday || 'Yesterday'
  const sameYear = d.getFullYear() === n.getFullYear()
  return d.toLocaleDateString(locale, sameYear ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/* messages (oldest first) → [{ key, label, messages }] one per calendar day */
export function daySections(messages, now = Date.now(), words = {}, locale = undefined) {
  const out = []
  let cur = null
  for (const m of messages) {
    const k = dayKey(new Date(m.created_at))
    if (!cur || cur.key !== k) { cur = { key: k, label: dayLabel(m.created_at, now, words, locale), messages: [] }; out.push(cur) }
    cur.messages.push(m)
  }
  return out
}

/* first/last flags for a run of messages from one sender close in time: the
   first carries the avatar, the last the tail and the time */
export function groupRuns(messages) {
  return messages.map((m, i) => {
    const prev = messages[i - 1], next = messages[i + 1]
    const joins = (a, b) => a && b && a.sender_id === b.sender_id && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < RUN_GAP
    return { ...m, first: !joins(prev, m), last: !joins(m, next) }
  })
}

/* pending: not yet on the server · sent: on the server · read: the peer's
   cursor has passed it. Only one's own messages carry a tick. */
export function tickOf(m, me, peerReadAt) {
  if (!m || m.sender_id !== me) return null
  if (m.pending) return 'pending'
  if (peerReadAt && new Date(peerReadAt) >= new Date(m.created_at)) return 'read'
  return 'sent'
}

/* reactions on one message → chips: [{ emoji, count, mine }] in first-seen order */
export function reactionChips(reactions, me) {
  const by = new Map()
  for (const r of reactions) {
    const c = by.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false }
    c.count += 1
    if (r.user_id === me) c.mine = true
    by.set(r.emoji, c)
  }
  return [...by.values()]
}

/* the list after I toggle an emoji: mine goes if it was there, comes if not */
export function toggleReaction(reactions, message_id, me, emoji) {
  const has = reactions.some((r) => r.message_id === message_id && r.user_id === me && r.emoji === emoji)
  return has
    ? reactions.filter((r) => !(r.message_id === message_id && r.user_id === me && r.emoji === emoji))
    : reactions.concat([{ message_id, user_id: me, emoji }])
}

/* "Ada Lovelace" → "AL"; "ada" → "A"; "" → "?" */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const take = (parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]]).map((p) => p[0].toUpperCase())
  return take.join('')
}

/* 65 → "1:05"; 3600 → "60:00"; anything odd → "0:00" */
export function clock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/* the one line an inbox row shows for a message */
export function previewOf(m, words = {}) {
  if (!m) return ''
  if (m.deleted_at) return words.deleted || ''
  if (m.kind === 'voice') return (words['voice-label'] || 'Voice note') + (m.seconds ? ' · ' + clock(m.seconds) : '')
  if (m.kind === 'file') return m.body || m.attachment_name || words['file-label'] || 'Attachment'
  return String(m.body || '').replace(/\s+/g, ' ').trim()
}

/* the time of day a bubble shows */
export function timeOf(date, locale = undefined) {
  return new Date(date).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

/* the moment an inbox row shows: a time today, a weekday this week, else a date */
export function whenOf(date, now = Date.now(), words = {}, locale = undefined) {
  if (!date) return ''
  const d = new Date(date), n = new Date(now)
  if (dayKey(d) === dayKey(n)) return timeOf(date, locale)
  const y = new Date(n); y.setDate(y.getDate() - 1)
  if (dayKey(d) === dayKey(y)) return words.yesterday || 'Yesterday'
  if (n - d < 6 * 24 * 60 * MIN) return d.toLocaleDateString(locale, { weekday: 'short' })
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/* the quick-reaction set, from the strings file's one line */
/* ---- what a coach owes: the reply the member's membership promises ----
   hoursFor(peer) is the promise for that person (from the product files, via the
   page); a thread whose last word is the member's is "awaiting" since their run
   began. dueOf gives the deadline and how far past or before it we are. */
export function dueOf(conv, hours, now = Date.now()) {
  if (!conv || !conv.awaiting_since || !(hours > 0)) return null
  const since = new Date(conv.awaiting_since).getTime()
  const due = since + hours * 60 * MIN
  return { since, due, left: due - now, over: now > due, hours }
}
/* a span as words: "4h", "2d", "35m" — for a badge */
export function spanOf(ms) {
  const m = Math.round(Math.abs(ms) / MIN)
  if (m < 60) return m + 'm'
  const h = Math.round(m / 60)
  if (h < 48) return h + 'h'
  return Math.round(h / 24) + 'd'
}
/* the inbox in one of three orders: by activity (the default), by when the thread
   was made, or by who is waiting — the longest wait first, then the rest by activity */
export function sortInbox(list, mode = 'activity') {
  const at = (c) => new Date(c.last_message_at || c.created_at || 0).getTime()
  const rows = list.slice()
  if (mode === 'created') return rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  if (mode === 'awaiting') return rows.sort((a, b) => {
    const wa = a.awaiting_since ? new Date(a.awaiting_since).getTime() : null, wb = b.awaiting_since ? new Date(b.awaiting_since).getTime() : null
    if (wa != null && wb != null) return wa - wb
    if (wa != null) return -1
    if (wb != null) return 1
    return at(b) - at(a)
  })
  return rows.sort((a, b) => at(b) - at(a))
}

export function reactionSet(line) {
  return String(line || '').split(/\s+/).filter(Boolean)
}

/* rows merged by id, kept in time order: the echo of an optimistic send lands
   on the row it was, older pages slot in before */
export function mergeMessages(have, more) {
  const by = new Map(have.map((m) => [m.id, m]))
  for (const m of more) by.set(m.id, { ...(by.get(m.id) || {}), ...m, pending: !!m.pending })
  return [...by.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || (a.id < b.id ? -1 : 1))
}
