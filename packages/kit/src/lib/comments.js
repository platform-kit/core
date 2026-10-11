/*
 * COMMENTS, from the browser. One module for the page's own component and for the embed, because
 * they are the same conversation read the same way — the embed is not a second product, it is this
 * with a different host.
 *
 * Nothing here knows what a subject IS. A kind and an id go in; a thread comes back. Whether that
 * thread lives in the comments table or as a post in a forum channel is the database's business
 * (comments_on), and a caller that had to know would be a caller that could get it wrong.
 */
import { supabase, configured } from './supabase.js'

const on = () => !!supabase && configured

/* the thread, oldest first. A withdrawn comment comes back with a null body and is kept as a
   placeholder: a conversation with holes in it reads as one somebody has tampered with. */
export async function commentsOn(kind, subject, limit = 200) {
  if (!on()) return []
  const { data, error } = await supabase.rpc('comments_on', { p_kind: kind, p_subject: subject, p_limit: limit })
  return error ? [] : (data || [])
}

/* how many, for a listing. One call for fifty things, which is what a count badge needs and what
   Disqus's own count script asks for. */
export async function commentCounts(kind, subjects = []) {
  if (!on() || !subjects.length) return {}
  const { data, error } = await supabase.rpc('comment_counts', { p_kind: kind, p_subjects: subjects })
  return error ? {} : (data || {})
}

/* SAYING SOMETHING. The title and the address are only ever used where the subject does not exist
   yet and its KIND is open — an embed naming the page it is on. Everything of the site's own is
   projected and already has both. A caller may name a thread; it may not rename one. */
export async function say(kind, subject, body, parent = null, title = null, href = null) {
  if (!on()) return { error: 'offline' }
  const { data, error } = await supabase.rpc('comment_say', {
    p_kind: kind, p_subject: subject, p_body: body, p_parent: parent, p_title: title, p_href: href,
  })
  return error ? { error: error.message } : (data || {})
}

export async function unsay(id) {
  if (!on()) return { error: 'offline' }
  const { data, error } = await supabase.rpc('comment_unsay', { p_comment: id })
  return error ? { error: error.message } : (data || {})
}

/* ---------------------------------------------------------------------------------------------
 * WHAT CAN BE DONE WITHOUT WRITING A REPLY. Both go straight at the tables: the policies decide
 * whether the surface takes them and whether this person may (signal_may), so there is nothing for
 * a function to add and nothing here that could be got wrong in a second place.
 * ------------------------------------------------------------------------------------------- */

/* an emoji, several per person. Pressing one already left takes it back. */
export async function react(id, emoji, on_ = true, surface = 'comment') {
  if (!on()) return { error: 'offline' }
  const me = (await supabase.auth.getUser()).data.user
  if (!me) return { error: 'sign-in' }
  const row = { surface, target_id: id, user_id: me.id, emoji }
  const { error } = on_
    ? await supabase.from('reactions').insert(row)
    : await supabase.from('reactions').delete().match(row)
  return error ? { error: error.message } : { ok: true }
}

/* UP OR DOWN, ONE PER PERSON. `next` is what the press comes to (voteAfter in comments/model.js
   works it out): 0 withdraws, and the row goes rather than being kept at nought — a vote nobody
   holds is not a vote of nought, it is no vote. */
export async function vote(id, next, surface = 'comment') {
  if (!on()) return { error: 'offline' }
  const me = (await supabase.auth.getUser()).data.user
  if (!me) return { error: 'sign-in' }
  const key = { surface, target_id: id, user_id: me.id }
  const { error } = next
    ? await supabase.from('votes').upsert({ ...key, vote: next }, { onConflict: 'surface,target_id,user_id' })
    : await supabase.from('votes').delete().match(key)
  return error ? { error: error.message } : { ok: true }
}

/* WHAT THIS CONVERSATION IS, before its lines: whether it exists at all, whether this reader may
   join it, and — where it is also a post in the community — the address of that post. One read, so
   a component that draws a thread needs to know nothing about kinds, channels or policies.
   Null means the thing takes no comments, which is not an error: most things do not. */
export async function commentSubject(kind, subject) {
  if (!on()) return null
  const { data, error } = await supabase.rpc('comment_subject', { p_kind: kind, p_subject: subject })
  return error ? null : (data || null)
}
