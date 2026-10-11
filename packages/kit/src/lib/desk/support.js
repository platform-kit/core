/*
 * The support desk as a source of the staff's one list.
 *
 * A contact is not a row-level principal and never will be while a guest has no account, so reading
 * the list is the staff's own RLS view (support_inbox) and everything a contact must be told about
 * goes back through the support function exactly as the inbox does it. Nothing here is new: this
 * file is a translation, and the guards on the other side are the ones that were already there.
 *
 * `rowsOf` is pure — build/desk.test.mjs reads it against real support_inbox rows.
 */

/* what the desk shows of a contact. The inbox's own words for who they are are already the right
   three; a signed-in reader is a reader here because the desk says it beside a member and a
   colleague, where "user" would say nothing. */
const KIND = { guest: 'guest', user: 'reader', customer: 'customer' }

/* every thread waiting on the desk: open, and the contact has said something since the last agent
   did. A resolved thread waits on nobody, and neither does one already answered. */
export function rowsOf(raw = [], ctx = {}) {
  const wait = Number(ctx.wait) > 0 ? Number(ctx.wait) : 0
  const out = []
  for (const r of raw || []) {
    if (!r || !r.id) continue
    /* waiting on the desk, or finished with — an open thread nobody is waiting on is neither, and
       belongs to the support inbox's own list rather than to a list of what is owed */
    if (!r.waiting_since && r.status !== 'resolved') continue
    const k = r.contact || {}
    out.push({
      key: 'support:' + r.id,
      source: 'support',
      id: r.id,
      person: { id: k.user_id || k.id || null, name: k.name || null, kind: KIND[k.kind] || 'guest' },
      detail: k.last_path || null,
      last: r.last ? { body: r.last.body, at: r.last.created_at, mine: r.last.author === 'agent', kind: r.last.kind, deleted_at: r.last.deleted_at } : null,
      unread: Number(r.unread) || 0,
      waiting_since: r.status === 'resolved' ? null : r.waiting_since,
      due: wait,
      status: r.status,
      resolved: r.status === 'resolved',
      at: r.last_message_at || r.created_at || null,
      assignee: r.assignee_id || null,
    })
  }
  return out
}

/* ------------------------------------------------------------------ the traffic */

/* every status, because the desk shows what was finished with as well as what is waiting */
export async function list(supabase) {
  const { data, error } = await supabase.rpc('support_inbox', {})
  if (error) throw error
  return data || []
}

/* A LINE MAY BE A FILE, and the queue has to be handed it or it draws a word where a picture
   should be. The bucket is private, so a path in it is signed for an hour and the signature is
   kept for the session; a prompt's picture is a path on this site and is passed as it is. */
const signed = new Map()
async function urlOf(supabase, path) {
  if (!path) return null
  if (/^(https?:)?\//.test(path)) return path
  if (!signed.has(path)) {
    const { data } = await supabase.storage.from('support').createSignedUrl(path, 3600)
    signed.set(path, (data && data.signedUrl) || null)
  }
  return signed.get(path)
}

export async function messages(supabase, id) {
  const { data, error } = await supabase.from('support_messages').select('*')
    .eq('conversation_id', id).order('created_at', { ascending: true }).limit(500)
  if (error) throw error
  const out = []
  for (const m of data || []) {
    out.push({
      id: m.id, body: m.body, kind: m.kind, created_at: m.created_at, deleted_at: m.deleted_at,
      mine: m.author === 'agent', author: m.author, agent_id: m.agent_id, seconds: m.seconds,
      name: m.attachment_name, type: m.attachment_type, size: m.attachment_size,
      url: await urlOf(supabase, m.attachment_path),
    })
  }
  return out
}

/* an agent's line under the desk's own guards — the insert the inbox makes, and the same courtesy
   email after it, so a contact who has gone away is told whichever surface the reply came from */
export async function send(supabase, id, body, me) {
  const mid = newId()
  const { error } = await supabase.from('support_messages').insert({ id: mid, conversation_id: id, author: 'agent', agent_id: me, body })
  if (error) throw error
  try { await supabase.functions.invoke('support', { body: { action: 'notify', message_id: mid } }) } catch (e) { /* the email is a courtesy */ }
  return mid
}

/* A REPLY IS NOT ALWAYS WORDS. The desk sends what the desk's own inbox has always sent — the
   file goes up first, under the message's own id, so a row never points at nothing — and the same
   courtesy email follows it. The shapes the bucket takes are the bucket's, and a file it would
   refuse is refused here, by name, rather than at the far end as a failure. */
export const FILE_TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'application/pdf': 'pdf', 'text/plain': 'txt',
}
export const FILE_MAX = 10 * 1024 * 1024

export async function sendFile(supabase, id, file, me, { kind = 'file', seconds = 0, said = '' } = {}) {
  const type = kind === 'voice' ? 'audio/mpeg' : String((file && file.type) || '').toLowerCase()
  const ext = FILE_TYPES[type]
  if (!ext) throw new Error('kind')
  if (file.size > FILE_MAX) throw new Error('size')
  const mid = newId()
  const path = id + '/' + mid + '.' + ext
  const name = kind === 'voice' ? 'voice.mp3' : file.name
  const up = await supabase.storage.from('support').upload(path, file, { contentType: type, cacheControl: '31536000', upsert: false })
  if (up.error) throw up.error
  const { error } = await supabase.from('support_messages').insert({
    id: mid, conversation_id: id, author: 'agent', agent_id: me, kind,
    body: said || null,
    attachment_path: path, attachment_type: type, attachment_name: name, attachment_size: file.size,
    seconds: kind === 'voice' ? seconds : null,
  })
  if (error) throw error
  try { await supabase.functions.invoke('support', { body: { action: 'notify', message_id: mid } }) } catch (e) { /* the email is a courtesy */ }
  return { id: mid, path, name, type, size: file.size }
}

/* the desk's real status, which its own inbox reads: resolving here resolves it there, which is
   what answering through the system that holds it means */
export async function resolve(supabase, id, done) {
  const patch = done
    ? { status: 'resolved', resolved_at: new Date().toISOString() }
    : { status: 'open', resolved_at: null }
  const { error } = await supabase.from('support_conversations').update(patch).eq('id', id)
  if (error) throw error
}

/* the desk can take a thread as well as finish it — the one source with an assignee of its own */
export async function assign(supabase, id, userId) {
  const { error } = await supabase.from('support_conversations').update({ assignee_id: userId || null }).eq('id', id)
  if (error) throw error
}

export async function read(supabase, id) {
  await supabase.from('support_conversations').update({ agent_read_at: new Date().toISOString() }).eq('id', id)
}

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
  : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)))
