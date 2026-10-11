/*
 * The coaching chat as a source of the staff's one list.
 *
 * A coach's inbox already knows who is waiting and what their membership promises; this reads the
 * same rows through the same policies and says them in the desk's shape. The promise is the
 * `chat-hours` on the product files — the highest live tier's, or the paid session's week of chat —
 * which is exactly the rule the coach's own inbox keeps, factored out here so both read one copy.
 *
 * `hoursTable`, `hoursFor` and `rowsOf` are pure: build/desk.test.mjs reads them against real
 * chat_inbox rows and real product records.
 */

import { isDone } from './shape.js'

/* the promises the offers make, gathered once: the longest a tier promises (a tier that appears on
   two offers keeps the kinder number), and the shortest a paid session does */
export function hoursTable(products = []) {
  const t = { tier: {}, session: 0 }
  for (const p of products || []) {
    const h = Number(p && p['chat-hours']) || 0
    if (!(h > 0)) continue
    if (p.kind === 'membership' && p.tier) t.tier[p.tier] = Math.max(t.tier[p.tier] || 0, h)
    if (p.kind === 'session') t.session = t.session ? Math.min(t.session, h) : h
  }
  return t
}

/* what this person is promised: their highest live tier, else the session's week of chat, else
   nothing — and nothing is a real answer, not a zero to be drawn as a clock */
export function hoursFor(table, peer, rank = () => 0) {
  if (!peer) return 0
  const tiers = (peer.tiers || []).filter((x) => table.tier[x]).sort((a, b) => rank(b) - rank(a))
  if (tiers.length) return table.tier[tiers[0]]
  return peer.session_chat ? table.session : 0
}

/* every thread whose last word is the member's. The caller is the coach: chat_inbox already answers
   from their side, and `awaiting_since` is the first line of the run they have not answered. */
export function rowsOf(raw = [], ctx = {}) {
  const table = ctx.table || hoursTable(ctx.products)
  const rank = ctx.rank || (() => 0)
  const marks = ctx.marks || {}
  const out = []
  for (const r of raw || []) {
    if (!r || !r.id) continue
    const mark = marks['coaching:' + r.id]
    /* waiting on them, or a thread they marked finished with — nothing else is the desk's business */
    if (!r.awaiting_since && mark === undefined) continue
    const p = r.peer || {}
    out.push({
      key: 'coaching:' + r.id,
      source: 'coaching',
      id: r.id,
      person: { id: p.id || null, name: p.name || null, kind: 'member' },
      detail: null,
      last: r.last ? { body: r.last.body, at: r.last.created_at, mine: r.last.sender_id === ctx.me, kind: r.last.kind, deleted_at: r.last.deleted_at } : null,
      unread: Number(r.unread) || 0,
      waiting_since: r.awaiting_since,
      due: hoursFor(table, p, rank) * 60,
      resolved: isDone({ source: 'coaching', id: r.id, waiting_since: r.awaiting_since }, marks),
      at: r.last_message_at || r.created_at || null,
    })
  }
  return out
}

/* ------------------------------------------------------------------ the traffic */

export async function list(supabase) {
  const { data, error } = await supabase.rpc('chat_inbox')
  if (error) throw error
  return data || []
}

/* the chat bucket is private: a recording is fetched through the signed-in client (lib/chat/
   audio.js), but a picture has to be an address a browser can put in an img, so a file's path is
   signed for an hour and the signature kept for the session. */
const signed = new Map()
async function urlOf(supabase, path) {
  if (!path) return null
  if (!signed.has(path)) {
    const { data } = await supabase.storage.from('chat').createSignedUrl(path, 3600)
    signed.set(path, (data && data.signedUrl) || null)
  }
  return signed.get(path)
}

export async function messages(supabase, id, me) {
  const { data, error } = await supabase.from('messages').select('*')
    .eq('conversation_id', id).order('created_at', { ascending: true }).limit(500)
  if (error) throw error
  /* a voice note keeps its path: the chat bucket is private and lib/chat/audio.js fetches it
     through the signed-in client, which the two parties' policies admit */
  const out = []
  for (const m of data || []) {
    out.push({
      id: m.id, body: m.body, kind: m.kind, created_at: m.created_at, deleted_at: m.deleted_at,
      mine: m.sender_id === me, author: m.sender_id, seconds: m.seconds, audio_path: m.audio_path,
      name: m.attachment_name, type: m.attachment_type, size: m.attachment_size,
      url: m.kind === 'file' ? await urlOf(supabase, m.attachment_path) : null,
    })
  }
  return out
}

export async function send(supabase, id, body, me) {
  const mid = newId()
  const { error } = await supabase.from('messages').insert({ id: mid, conversation_id: id, sender_id: me, kind: 'text', body })
  if (error) throw error
  try { await supabase.functions.invoke('chat-notify', { body: { message_id: mid } }) } catch (e) { /* the email is a courtesy */ }
  return mid
}

/* A REPLY IS NOT ALWAYS WORDS: the bytes go up first, under the message's own id, so a row never
   points at nothing, and a refused insert takes the object with it. A voice note is an mp3 on the
   same path — the recorder's own — and its body is the transcript the browser wrote down. */
export const FILE_TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'application/pdf': 'pdf', 'text/plain': 'txt',
}
export const FILE_MAX = 20 * 1024 * 1024

export async function sendFile(supabase, id, file, me, { kind = 'file', seconds = 0, said = '' } = {}) {
  const type = kind === 'voice' ? 'audio/mpeg' : String((file && file.type) || '').toLowerCase()
  const ext = FILE_TYPES[type]
  if (!ext) throw new Error('kind')
  if (file.size > FILE_MAX) throw new Error('size')
  const mid = newId()
  const path = id + '/' + mid + '.' + ext
  const name = kind === 'voice' ? 'voice.mp3' : file.name
  const up = await supabase.storage.from('chat').upload(path, file, { contentType: type, cacheControl: '31536000', upsert: false })
  if (up.error) throw up.error
  const row = kind === 'voice'
    ? { id: mid, conversation_id: id, sender_id: me, kind: 'voice', audio_path: path, seconds, body: said || null }
    : { id: mid, conversation_id: id, sender_id: me, kind: 'file', body: said || null,
        attachment_path: path, attachment_type: type, attachment_name: name, attachment_size: file.size }
  const { error } = await supabase.from('messages').insert(row)
  if (error) {
    await supabase.storage.from('chat').remove([path]).catch(() => {})
    throw error
  }
  try { await supabase.functions.invoke('chat-notify', { body: { message_id: mid } }) } catch (e) { /* the email is a courtesy */ }
  return { id: mid, path, name, type, size: file.size }
}

/* neither of these systems has a status anybody agreed on, so being finished with one is this
   member of staff's own mark (desk_done) and nothing the other party ever sees */
export async function resolve(supabase, id, done, me) {
  if (done) {
    const { error } = await supabase.from('desk_done').upsert({ user_id: me, source: 'coaching', ref: String(id) })
    if (error) throw error
  } else {
    const { error } = await supabase.from('desk_done').delete().eq('user_id', me).eq('source', 'coaching').eq('ref', String(id))
    if (error) throw error
  }
}

export async function read(supabase, id, me) {
  await supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', id).eq('user_id', me)
}

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
  : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)))
