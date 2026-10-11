/*
 * The chat's state and its traffic with Supabase: the inbox, the people one
 * can write to, the open thread (its messages, reactions and cursors) and the
 * realtime channel that keeps it current. Module-level reactive state, like
 * auth.js — one thread is open at a time. Every call is guarded like
 * records.js: with no stack or no session it does nothing.
 *
 * Sending is optimistic: the row goes into the list with a client-made id and
 * `pending`, the insert follows, and the echo that realtime brings back lands
 * on the same row (mergeMessages) — so a message never shows twice and never
 * waits for the round trip. The rules of what a row means are in model.js.
 */
import { reactive, ref } from 'vue'
import { supabase, configured } from '../supabase.js'
import { session, beforeSignOut, onIdentity } from '../auth.js'
import { mergeMessages, toggleReaction } from './model.js'
import { bump as bumpUnread, refresh as refreshUnread } from './unread.js'

const PAGE = 50
const SEEN_MS = 60 * 1000

const on = () => !!(supabase && configured && session.value)
const uid = () => (session.value && session.value.user && session.value.user.id) || null

export const inbox = ref([])          /* chat_inbox() rows */
export const people = ref([])         /* chat_people() rows */
export const members = ref([])        /* chat_members(q) rows, coaches only: the page that matches the search */
export const membersTotal = ref(0)    /* how many members there are in all */
export const loadingInbox = ref(false)

/* the open thread */
export const thread = reactive({
  id: null, messages: [], reactions: [], members: [], peer: null,
  loading: false, done: false, error: null,
})

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args || {})
  if (error) throw error
  return data
}

export async function loadInbox() {
  if (!on()) { inbox.value = []; return }
  loadingInbox.value = true
  try { inbox.value = (await rpc('chat_inbox')) || [] } catch (e) { /* offline: keep what we had */ }
  loadingInbox.value = false
}
export async function loadPeople() {
  if (!on()) { people.value = []; return }
  try { people.value = (await rpc('chat_people')) || [] } catch (e) { /* offline */ }
}
/* the members matching a search, a page at a time; the newest call wins */
let membersSeq = 0
export async function loadMembers(q = '', lim = 30) {
  if (!on()) { members.value = []; membersTotal.value = 0; return }
  const seq = ++membersSeq
  try {
    const r = await rpc('chat_members', { q: String(q || ''), lim })
    if (seq !== membersSeq) return
    members.value = (r && r.items) || []
    membersTotal.value = (r && r.total) || 0
  } catch (e) { /* offline */ }
}

/* the conversation with this person, made if there is none; its id */
export async function open(peerId) {
  if (!on()) return null
  const id = await rpc('chat_open', { peer: peerId })
  await loadInbox()
  return id
}

/* ---- the open thread ---- */
let channel = null
let seenTimer = null

function peerOf(id) {
  const row = inbox.value.find((c) => c.id === id)
  return row ? row.peer : null
}

export async function openThread(id) {
  if (!on() || !id) return
  if (thread.id !== id) {
    closeThread()
    thread.id = id
    thread.messages = []; thread.reactions = []; thread.members = []; thread.done = false; thread.error = null
  }
  thread.peer = peerOf(id)
  thread.loading = true
  try {
    const [{ data: msgs, error: e1 }, { data: mem, error: e2 }] = await Promise.all([
      supabase.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: false }).limit(PAGE),
      supabase.from('conversation_members').select('*').eq('conversation_id', id),
    ])
    if (e1) throw e1
    if (e2) throw e2
    const rows = (msgs || []).reverse()
    thread.messages = mergeMessages(thread.messages, rows)
    thread.done = rows.length < PAGE
    thread.members = mem || []
    const ids = thread.messages.map((m) => m.id)
    if (ids.length) {
      const { data: rx } = await supabase.from('message_reactions').select('*').eq('conversation_id', id)
      thread.reactions = rx || []
    }
    subscribe(id)
    seen()
    if (!seenTimer) seenTimer = setInterval(() => { if (document.visibilityState === 'visible') seen() }, SEEN_MS)
  } catch (e) {
    thread.error = e
  }
  thread.loading = false
}

export async function loadEarlier() {
  if (!on() || !thread.id || thread.done || thread.loading || !thread.messages.length) return
  thread.loading = true
  const before = thread.messages[0].created_at
  const { data } = await supabase.from('messages').select('*').eq('conversation_id', thread.id)
    .lt('created_at', before).order('created_at', { ascending: false }).limit(PAGE)
  const rows = (data || []).reverse()
  thread.messages = mergeMessages(thread.messages, rows)
  thread.done = rows.length < PAGE
  thread.loading = false
}

export function closeThread() {
  if (channel) { try { supabase.removeChannel(channel) } catch (e) { /* gone */ } channel = null }
  if (seenTimer) { clearInterval(seenTimer); seenTimer = null }
  thread.id = null; thread.peer = null
  thread.messages = []; thread.reactions = []; thread.members = []; thread.done = false
}

/* the peer's cursor, for the ticks */
export function peerReadAt() {
  const me = uid()
  const row = thread.members.find((m) => m.user_id !== me)
  return row ? row.last_read_at : null
}
export function myMember() {
  const me = uid()
  return thread.members.find((m) => m.user_id === me) || null
}

function subscribe(id) {
  if (channel) return
  const filter = 'conversation_id=eq.' + id
  channel = supabase.channel('chat:' + id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, ({ new: row }) => {
      thread.messages = mergeMessages(thread.messages, [row])
      touchInbox(row)
      if (row.sender_id !== uid()) { if (document.visibilityState === 'visible' && wantsRead) markRead(); else bumpUnread(1) }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, ({ new: row }) => {
      thread.messages = mergeMessages(thread.messages, [row])
      lastInInbox(row)
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter }, ({ new: row }) => {
      if (!thread.reactions.some((r) => r.message_id === row.message_id && r.user_id === row.user_id && r.emoji === row.emoji)) thread.reactions = thread.reactions.concat([row])
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, ({ old: row }) => {
      thread.reactions = thread.reactions.filter((r) => !(r.message_id === row.message_id && r.user_id === row.user_id && r.emoji === row.emoji))
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter }, ({ new: row }) => {
      thread.members = thread.members.filter((m) => m.user_id !== row.user_id).concat([row])
    })
    /* anything that landed between the first read and the join */
    .subscribe((status) => { if (status === 'SUBSCRIBED') catchUp(id) })
}

async function catchUp(id) {
  if (thread.id !== id) return
  const last = thread.messages[thread.messages.length - 1]
  const q = supabase.from('messages').select('*').eq('conversation_id', id).order('created_at', { ascending: true }).limit(PAGE)
  const { data } = await (last ? q.gt('created_at', last.created_at) : q)
  if (data && data.length && thread.id === id) {
    thread.messages = mergeMessages(thread.messages, data)
    for (const row of data) touchInbox(row)
    if (data.some((r) => r.sender_id !== uid())) { if (wantsRead && document.visibilityState === 'visible') markRead(); else refreshUnread() }
  }
}

/* the page says whether the reader is looking at the foot of the thread; a
   message that arrives then is read at once */
let wantsRead = false
export function setWantsRead(v) { wantsRead = !!v; if (v) markRead() }

let readTimer = null
export function markRead() {
  if (!on() || !thread.id) return
  const me = myMember()
  const last = thread.messages[thread.messages.length - 1]
  if (!last || !me) return
  if (new Date(me.last_read_at) >= new Date(last.created_at)) return
  const at = new Date().toISOString()
  me.last_read_at = at
  clearTimeout(readTimer)
  readTimer = setTimeout(async () => {
    await supabase.from('conversation_members').update({ last_read_at: at }).eq('conversation_id', thread.id).eq('user_id', uid())
    const row = inbox.value.find((c) => c.id === thread.id)
    if (row) row.unread = 0
    refreshUnread()
  }, 300)
}

/* the reader is on the page: the email stays quiet */
export async function seen() {
  if (!on() || !thread.id) return
  const at = new Date().toISOString()
  await supabase.from('conversation_members').update({ last_seen_at: at }).eq('conversation_id', thread.id).eq('user_id', uid())
}

/* ---- sending ---- */
async function notify(message_id) {
  try { await supabase.functions.invoke('chat-notify', { body: { message_id } }) } catch (e) { /* the email is a courtesy */ }
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)))

export async function sendText(body, replyTo) {
  const text = String(body || '').trim()
  if (!on() || !thread.id || !text) return null
  const row = { id: newId(), conversation_id: thread.id, sender_id: uid(), kind: 'text', body: text, reply_to: replyTo || null, created_at: new Date().toISOString(), deleted_at: null, pending: true }
  thread.messages = mergeMessages(thread.messages, [{ ...row }])
  const { error } = await supabase.from('messages').insert({ id: row.id, conversation_id: row.conversation_id, sender_id: row.sender_id, kind: 'text', body: text, reply_to: row.reply_to })
  if (error) { thread.messages = thread.messages.filter((m) => m.id !== row.id); throw error }
  thread.messages = mergeMessages(thread.messages, [{ ...row, pending: false }])
  touchInbox(row)
  notify(row.id)
  return row.id
}

/* a voice note: the file first, under the message's own id, then the row */
/* the transcript is the message's body: a voice note readable at a glance, searchable like every
   other message, and there for anybody who cannot play sound where they are */
export async function sendVoice(blob, seconds, replyTo, transcript) {
  if (!on() || !thread.id || !blob) return null
  const id = newId()
  const path = thread.id + '/' + id + '.mp3'
  const row = { id, conversation_id: thread.id, sender_id: uid(), kind: 'voice', body: transcript || null, audio_path: path, seconds, reply_to: replyTo || null, created_at: new Date().toISOString(), deleted_at: null, pending: true, blob }
  thread.messages = mergeMessages(thread.messages, [{ ...row }])
  const up = await supabase.storage.from('chat').upload(path, blob, { contentType: 'audio/mpeg', cacheControl: '31536000', upsert: false })
  if (up.error) { thread.messages = thread.messages.filter((m) => m.id !== id); throw up.error }
  const { error } = await supabase.from('messages').insert({ id, conversation_id: thread.id, sender_id: uid(), kind: 'voice', body: transcript || null, audio_path: path, seconds, reply_to: row.reply_to })
  if (error) { thread.messages = thread.messages.filter((m) => m.id !== id); throw error }
  thread.messages = mergeMessages(thread.messages, [{ ...row, pending: false }])
  touchInbox(row)
  notify(id)
  return id
}

/* A FILE, the same way: the bytes first under the message's own id, then the row. The coaching
   chat's messages table has taken a file since the support desk's did — what it lacked was a way
   to send one, which meant a coach could be sent a screenshot and could not send one back. */
export async function sendFile(file, replyTo) {
  if (!on() || !thread.id || !file) return null
  const id = newId()
  const clean = String(file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file'
  /* NAMED FOR ITS MESSAGE AND NOTHING ELSE — the bucket's policy says so, and a path carrying the
     reader's own file name would be refused by it. What they called it is kept on the row. */
  const ext = (clean.match(/\.([a-z0-9]+)$/i) || [, 'bin'])[1].toLowerCase()
  const path = thread.id + '/' + id + '.' + ext
  const row = { id, conversation_id: thread.id, sender_id: uid(), kind: 'file', body: null,
    attachment_path: path, attachment_name: clean, attachment_type: file.type || null, attachment_size: file.size || null,
    reply_to: replyTo || null, created_at: new Date().toISOString(), deleted_at: null, pending: true }
  thread.messages = mergeMessages(thread.messages, [{ ...row }])
  const up = await supabase.storage.from('chat').upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (up.error) { thread.messages = thread.messages.filter((m) => m.id !== id); throw up.error }
  const { error } = await supabase.from('messages').insert({
    id, conversation_id: thread.id, sender_id: uid(), kind: 'file', attachment_path: path,
    attachment_name: clean, attachment_type: row.attachment_type, attachment_size: row.attachment_size, reply_to: row.reply_to })
  if (error) { thread.messages = thread.messages.filter((m) => m.id !== id); throw error }
  thread.messages = mergeMessages(thread.messages, [{ ...row, pending: false }])
  touchInbox(row)
  notify(id)
  return id
}

function touchInbox(row) {
  const c = inbox.value.find((x) => x.id === row.conversation_id)
  if (c) { c.last = { id: row.id, kind: row.kind, body: row.body, sender_id: row.sender_id, created_at: row.created_at, deleted_at: null }; c.last_message_at = row.created_at }
  inbox.value = inbox.value.slice().sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at))
}

export async function react(message_id, emoji) {
  if (!on() || !thread.id) return
  const me = uid()
  const had = thread.reactions.some((r) => r.message_id === message_id && r.user_id === me && r.emoji === emoji)
  thread.reactions = toggleReaction(thread.reactions, message_id, me, emoji).map((r) => (r.conversation_id ? r : { ...r, conversation_id: thread.id }))
  if (had) await supabase.from('message_reactions').delete().match({ message_id, user_id: me, emoji })
  else await supabase.from('message_reactions').insert({ message_id, user_id: me, emoji })
}

/* withdraw one's own message; the row stays as a placeholder */
export async function remove(message_id) {
  if (!on() || !thread.id) return
  const at = new Date().toISOString()
  thread.messages = mergeMessages(thread.messages, [{ id: message_id, deleted_at: at }])
  await supabase.from('messages').update({ deleted_at: at }).eq('id', message_id)
  lastInInbox({ id: message_id, conversation_id: thread.id, deleted_at: at })
}

/* a change to the message an inbox row shows */
function lastInInbox(row) {
  const c = inbox.value.find((x) => x.id === row.conversation_id)
  if (c && c.last && c.last.id === row.id) c.last = { ...c.last, ...row }
}

const forget = () => { closeThread(); inbox.value = []; people.value = []; members.value = [] }
beforeSignOut.push(forget)
/* the other half: whoever is here now has their own inbox, and it is not the last person's */
onIdentity((id) => { forget(); if (id) { loadInbox(); loadPeople() } })
