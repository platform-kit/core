/*
 * THE NETWORK'S ARITHMETIC — pure, no imports, pinned by build/network.test.mjs. What an answer may
 * be read by, how a thread hangs together, how a page of the timeline joins the last, and how a
 * post's words are cut into what is drawn plainly and what is a link. The guards that decide who
 * may READ are the database's (93-network.sql); this only shapes what came back.
 */

/* the audiences a post on the network may have, widest first. A post to a SPACE is not one of
   these: it is a message in the space's feed channel, under the space's own guards. */
export const AUDIENCES = ['everyone', 'here']
const RANK = { everyone: 2, here: 1 }
export const rankOf = (a) => RANK[a] || 0

/* what an answer to this post may be read by: never more people than the post it answers.
   Nothing to answer means the whole choice; a space's message is answered in the space. */
export function answerAudiences(parent) {
  if (!parent) return AUDIENCES.slice()
  if (parent.kind === 'space') return []
  const r = rankOf(parent.audience)
  return AUDIENCES.filter((a) => rankOf(a) <= r)
}

/* the audience an answer starts on: the parent's own, which is the widest it may have */
export function defaultAudience(parent, fallback = 'here') {
  const allowed = answerAudiences(parent)
  if (!parent) return allowed.includes(fallback) ? fallback : allowed[0]
  return allowed.includes(parent.audience) ? parent.audience : allowed[0]
}

/* the longest post the database takes */
export const MAX_TEXT = 3000
/* what a post may carry: up to ten pictures and videos, shown at their own shape (the one rule, shared
   with the functions) */
export { MEDIA, shapeOf, refuseMedia, kindOf, kindOfType, planEmbed } from '../../../supabase/functions/_shared/atproto/media.js'

/* the key an item of the timeline is told apart by: a post may appear once as itself and again as
   somebody's repost, and both belong in the list */
export const itemKey = (it) => `${it.kind}:${it.post_id || it.message_id}:${it.reposted_by || ''}`

/* a further page joined to what is already shown: nothing twice, newest first */
export function joinPages(have, more) {
  const seen = new Set(have.map(itemKey))
  const out = have.slice()
  for (const it of more) if (!seen.has(itemKey(it))) { seen.add(itemKey(it)); out.push(it) }
  return out.sort((a, b) => new Date(b.at) - new Date(a.at))
}

/* the cursor for the page after this one: the oldest moment shown */
export const cursorOf = (items) => (items.length ? items[items.length - 1].at : null)

/*
 * A THREAD, drawn: the root, then every answer under what it answers, oldest first within each
 * answer's siblings, indented to a depth and no further — past that the run is flat, since a
 * column eight words wide is not a conversation. Answers whose parent is not in hand (removed,
 * blocked, or out of reach) hang off the root, so nothing anybody said is lost.
 */
export function threadOf(root, replies, maxDepth = 4) {
  if (!root) return []
  const byParent = new Map()
  const ids = new Set([root.id, ...replies.map((r) => r.id)])
  for (const r of replies) {
    const parent = r.reply_parent_id && ids.has(r.reply_parent_id) ? r.reply_parent_id : root.id
    if (!byParent.has(parent)) byParent.set(parent, [])
    byParent.get(parent).push(r)
  }
  for (const list of byParent.values()) list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const out = [{ post: root, depth: 0 }]
  const walk = (id, depth) => {
    for (const r of byParent.get(id) || []) {
      out.push({ post: r, depth: Math.min(depth, maxDepth) })
      walk(r.id, depth + 1)
    }
  }
  walk(root.id, 1)
  return out
}

/*
 * A POST'S WORDS, cut into what is drawn as it is and what is a link — never HTML, so nothing
 * anybody typed is ever markup. A link is an http(s) address; the full stop or bracket that ends a
 * sentence after it is not part of it.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi
export function segmentsOf(text) {
  const s = String(text || '')
  const out = []
  let at = 0
  for (const m of s.matchAll(URL_RE)) {
    let href = m[0]
    while (/[.,;:!?)\]]$/.test(href)) href = href.slice(0, -1)
    if (m.index > at) out.push({ kind: 'text', text: s.slice(at, m.index) })
    out.push({ kind: 'link', text: href.replace(/^https?:\/\//, ''), href })
    at = m.index + href.length
  }
  if (at < s.length) out.push({ kind: 'text', text: s.slice(at) })
  return out
}

/* how long ago, in the reader's own language: the browser's words, not ours */
export function agoOf(iso, now = Date.now(), locale) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const s = Math.round((then - now) / 1000)
  const abs = Math.abs(s)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' })
  if (abs < 45) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day')
  return new Date(then).toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(new Date(then).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) })
}

/* a like or a repost pressed before the database has answered: the count moves at once, and moves
   back if the answer is no */
export function toggled(post, which, on) {
  const field = which === 'like' ? 'like_count' : 'repost_count'
  const mine = which === 'like' ? 'liked' : 'reposted'
  if (!!post[mine] === !!on) return post
  return { ...post, [mine]: !!on, [field]: Math.max(0, (post[field] || 0) + (on ? 1 : -1)) }
}

/* a space's message, shaped as a post so one card draws both */
export function postOfMessage(m, space) {
  return {
    id: m.id, kind: 'space', author_id: m.author_id, text: m.body || '', title: m.title || null, channel_id: m.channel_id || null,
    created_at: m.created_at, reply_count: m.reply_count || 0, audience: 'space',
    space: space ? { id: space.id, slug: space.slug, name: space.name, channel: m.channel_slug || null } : null,
    attachment: m.attachment || null, attachment_type: m.attachment_type || null, media: m.media || [],
  }
}

/* the people a set of posts names, for one read of their names and faces */
export function peopleIn(posts, extra = []) {
  const ids = new Set(extra.filter(Boolean))
  for (const p of posts) { if (p && p.author_id) ids.add(p.author_id) }
  return [...ids]
}

/* ---------------------------------------------------------------- the one notification list */

/* which filter a row answers to: what was said to them, what answered them, what was pressed on
   their posts, who followed them, and what is coming up */
export const NOTE_FILTERS = ['all', 'mentions', 'replies', 'reactions', 'follows', 'events']
export function noteKind(n) {
  if (n.source === 'mention') return 'mentions'
  if (n.source === 'reply' || n.reason === 'reply' || n.reason === 'quote') return 'replies'
  if (n.source === 'event') return 'events'
  if (n.reason === 'follow') return 'follows'
  return 'reactions'
}

/* THE LIST AS IT IS READ: likes and reposts of one post folded into one row ("Ada and 3 others
   liked your post"), follows into one row, everything else one row each; a group stands where its
   newest member stood, and is new when any of it is. `seen` is when the reader last opened it. */
export function groupNotes(rows, seen = null) {
  const since = seen ? new Date(seen).getTime() : -Infinity
  const out = []
  const at = new Map()
  for (const n of rows) {
    const fresh = new Date(n.at).getTime() > since
    const key = n.source === 'network' && (n.reason === 'like' || n.reason === 'repost') ? `${n.reason}:${n.subject_post_id}`
      : n.source === 'network' && n.reason === 'follow' ? 'follow' : null
    if (key && at.has(key)) {
      const g = out[at.get(key)]
      if (n.actor_id && !g.actors.includes(n.actor_id)) g.actors.push(n.actor_id)
      g.fresh = g.fresh || fresh
      continue
    }
    if (key) at.set(key, out.length)
    out.push({ ...n, key: key || `${n.source}:${n.reason}:${n.post_id || (n.item && n.item.id) || n.subject_post_id || ''}:${n.at}`,
      kind: noteKind(n), actors: n.actor_id ? [n.actor_id] : [], fresh })
  }
  return out
}

/* FOR YOU'S SPREAD: the ranked page arranged so no person has more than `most` tiles in any `run`
   in a row — the next best tile that keeps the rule, each time; only when nothing left can keep it
   (everything remaining is one person's) does the order give way */
export function spread(rows, most = 2, run = 6) {
  const left = [...rows]
  const out = []
  while (left.length) {
    const recent = out.slice(-(run - 1))
    const i = left.findIndex((r) => recent.filter((x) => x.author_id === r.author_id).length < most)
    out.push(left.splice(i < 0 ? 0 : i, 1)[0])
  }
  return out
}
