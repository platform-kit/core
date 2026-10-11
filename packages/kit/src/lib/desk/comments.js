/*
 * COMMENTS AS A SOURCE of the staff's one list — and only the ones no room owns.
 *
 * A subject that names a forum channel keeps its comments as a post there: they are moderated with
 * everything else in that room, by whoever moderates it, and putting them here too would be two
 * queues for one thing. A subject that names NO channel — a site with no community, an embed on
 * somebody else's domain — has no room's moderators, and without this it would be a conversation
 * nobody is responsible for. That is the whole reason this source exists.
 *
 * What waits here is not an unanswered message but an UNDECIDED one: a comment held for a person,
 * by the surface's approval setting or by the site's flagged words. The desk's shape fits it
 * exactly — somebody is waiting on the business, and the clock runs from when they said it.
 *
 * `rowsOf` is pure — build/desk.test.mjs reads it against real comment_queue rows.
 */

export function rowsOf(raw = [], ctx = {}) {
  const out = []
  for (const r of raw || []) {
    if (!r || !r.id) continue
    if (r.attached) continue   /* a room's own; its moderators answer it there */
    const waiting = r.state === 'waiting'
    out.push({
      key: 'comments:' + r.id,
      source: 'comments',
      id: r.id,
      person: { id: r.author_id || null, name: r.author || null, kind: r.trusted ? 'member' : 'reader' },
      /* what it is attached to, by the name a person reads: a queue listing
         /content/articles/listening-back is a queue nobody scans */
      detail: r.title || r.subject || null,
      last: { body: r.body, at: r.created_at, mine: false },
      unread: waiting ? 1 : 0,
      waiting_since: waiting ? r.created_at : null,
      due: Number(ctx.wait) > 0 ? Number(ctx.wait) : 0,
      /* the word that held it, for the moderator alone — never shown to its author */
      flagged: r.flagged || null,
      state: r.state,
      href: r.href || null,
      kind: r.kind,
      subject: r.subject,
      resolved: !waiting,
      at: r.created_at || null,
      assignee: null,
    })
  }
  return out
}

/* ------------------------------------------------------------------ the traffic */

/* WHAT A COMMENT IS UNDER, by its id. The queue is what answers it, and what the queue returns is
   what this moderator may decide — so one they may not is simply not found, and every caller below
   refuses it without asking a second time. Both states, because a live comment is answered too. */
const CACHE = new Map()
async function rowOf(supabase, id) {
  if (CACHE.has(id)) return CACHE.get(id)
  for (const state of ['waiting', 'live']) {
    const { data } = await supabase.rpc('comment_queue', { p_state: state, p_limit: 500 })
    const found = (data || []).find((r) => r.id === id)
    if (found) { CACHE.set(id, found); return found }
  }
  return null
}

/* everything undecided and everything lately decided, so the desk can show what was finished with
   as well as what waits — narrowed to the conversations no room owns */
export async function list(supabase) {
  const held = await supabase.rpc('comment_queue', { p_state: 'waiting', p_attached: false, p_limit: 200 })
  if (held.error) throw held.error
  const live = await supabase.rpc('comment_queue', { p_state: 'live', p_attached: false, p_limit: 50 })
  return [...(held.data || []), ...(live.error ? [] : live.data || [])]
}

/* the thread the held comment sits in, so a moderator decides in context rather than on one line
   out of the air. The held ones of other people are invisible to everybody but a moderator, which
   is exactly who is reading this. */
export async function messages(supabase, id, me) {
  const found = await rowOf(supabase, id)
  if (!found) return []
  const { data, error } = await supabase.rpc('comments_on', { p_kind: found.kind, p_subject: found.subject, p_limit: 200 })
  if (error) throw error
  return (data || []).map((c) => ({
    id: c.id, body: c.body, kind: 'text', created_at: c.created_at, deleted_at: c.deleted_at,
    mine: c.author_id === me, author: c.name, state: c.state, flagged: c.flagged,
    /* the one being decided, so the pane can say which line the queue was about */
    subject_of: c.id === id,
  }))
}

/* A MODERATOR MAY ANSWER, which is a comment like anybody's — under their own name, in the open,
   never a note that appears to come from the site. */
export async function send(supabase, id, body) {
  const found = await rowOf(supabase, id)
  if (!found) throw new Error('no such comment')
  const { data, error } = await supabase.rpc('comment_say', {
    p_kind: found.kind, p_subject: found.subject, p_body: body, p_parent: id,
  })
  if (error) throw error
  if (data && data.error) throw new Error(data.error)
  return (data && data.id) || null
}

/* FINISHED WITH means DECIDED, and the two ways of deciding are the two acts. Each writes a row of
   the moderation record — a person's name, a moment, a reason where one is given — because this is
   the act that happens before anybody else reads the words, and a moderator who quietly declines to
   release something has made a decision about somebody's voice. */
export async function resolve(supabase, id, done) {
  const { data, error } = await supabase.rpc(done ? 'comment_approve' : 'comment_refuse', { p_comment: id })
  if (error) throw error
  if (data && data.error) throw new Error(data.error)
}
export async function approve(supabase, id, reason = null) {
  const { data, error } = await supabase.rpc('comment_approve', { p_comment: id, p_reason: reason })
  if (error) throw error
  if (data && data.error) throw new Error(data.error)
}
export async function refuse(supabase, id, reason = null) {
  const { data, error } = await supabase.rpc('comment_refuse', { p_comment: id, p_reason: reason })
  if (error) throw error
  if (data && data.error) throw new Error(data.error)
}

/* nothing to mark read: a held comment is read by being decided */
export async function read() {}
