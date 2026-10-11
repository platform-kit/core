/*
 * The spaces' state and its traffic with Supabase: the rooms a person is in, their channels and what
 * is unread in each, the open channel and its thread, and the live topics that keep them current.
 * Module-level reactive state like the chat's, guarded like records.js — with no stack or no session
 * it does nothing.
 *
 * Two things are worth knowing before reading it.
 *
 * **Nothing here counts.** Unread comes from the counters (space_unread), history by the key
 * (space_history), and a return from being away by the cursor (space_catchup). No list is walked to
 * answer how much is unread, ever.
 *
 * **Live is one private topic per channel, sent by the database.** The browser receives exactly what
 * was written and filters nothing, because a topic it may not read refuses its subscription. Typing
 * and read receipts are the client's own broadcasts on the same topic and are never written down.
 * supabase-js multiplexes every topic over one socket, so watching forty channels is one connection.
 * A payload too large to carry arrives without its body, and that message is fetched by its id —
 * the rare case, never the rule.
 */
import { reactive, ref } from 'vue'
import { supabase, configured } from '../supabase.js'
import { session, isStaff, beforeSignOut, onIdentity } from '../auth.js'
import { mergeMessages, dividerSeq, unreadOf, mentionsOf, badgeOf, statusOf, myStatus, isStatus } from './model.js'
import { voicePath, filePath, FILE_TYPES, FILE_MAX } from './audio.js'
import { queryArgs } from './query.js'
import { capture } from '../analytics.js'

const PAGE = 50
const TYPING_MS = 3000        /* a keystroke says so at most this often */
const TYPING_FOR = 6000       /* and the dots fade this long after the last word */

const on = () => !!(supabase && configured && session.value)
const uid = () => (session.value && session.value.user && session.value.user.id) || null
const topicOf = (channelId) => 'sp:' + channelId

export const spaces = ref([])        /* the rooms this person is in */
export const channels = ref([])      /* every channel of those rooms they may read */
export const unread = ref([])        /* space_unread() rows: the counters, never a count */
export const unreads = ref([])       /* and what those counters are counting, when it is asked for */
export const booted = ref(false)
export const loading = ref(false)

/* the open channel */
export const open = reactive({
  id: null, mode: 'stream', messages: [], posts: [], reactions: [],
  /* what is pinned to this room: the room's own, not this person's — see `save` for the other one */
  pins: [],
  divider: null, loading: false, done: false, error: null,
})

/* the open thread, beside it */
export const thread = reactive({ root: null, replies: [], loading: false, error: null })

/* who is typing where: { [channelId]: { [userId]: until } } */
export const typing = reactive({})
/* who is here: the space's own topic, never written down, gone when the socket goes */
export const here = reactive({})            /* user id → 'active' | 'away' | 'dnd' */
/* what this person has chosen to say about themselves; kept in this browser, not on the account,
   because it is about the session they are in and not about who they are */
export const status = ref((() => { try { const v = localStorage.getItem('dl.spaces.status'); return isStatus(v) ? v : 'active' } catch (e) { return 'active' } })())
let touched = Date.now()
export const drafts = reactive({})          /* channel id → what was typed and not sent */
export const threads = ref([])              /* every thread the reader is in */
export const mentions = ref([])             /* what has been said to them: every mention */
export const saved = ref([])                /* what they saved to come back to */
export const dms = ref([])                  /* every direct message they are in, across every space */
export const view = ref('channel')          /* channel | home | support | clients | dms | threads | mentions | saved */

const live = new Map()               /* channelId → the realtime channel */
let presence = null                  /* the space's own topic */
const lastTyped = new Map()          /* channelId → when we last said we were typing */
let typingTimer = null

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args || {})
  if (error) throw error
  return data
}

/* ------------------------------------------------------------------ loading */

/* WHO boot() LAST RAN FOR. A view calls boot() when it mounts and the identity broadcast calls it
   when somebody arrives, and on a first load with a session already restored those are the same
   load — so it is remembered here and the second caller does nothing. */
let bootedFor
export async function boot() {
  bootedFor = uid()
  if (!on()) { spaces.value = []; channels.value = []; unread.value = []; booted.value = true; return }
  loading.value = true
  /* a private topic is authorised by the reader's own token, and the client only hands realtime that
     token on a sign-in event — a session restored from storage never fired one. Hand it over here. */
  try { supabase.realtime.setAuth(session.value.access_token) } catch (e) { /* older client */ }
  try {
    const [s, c, u, m] = await Promise.all([
      /* the file's own arrangement, not the alphabet: a space says where it sits (position) and under
         which heading (group), and every member sees the same one */
      supabase.from('spaces').select('*').is('archived_at', null).order('position').order('name'),
      supabase.from('channels').select('*').is('archived_at', null).order('name'),
      rpc('space_unread'),
      /* THE SPACES THIS PERSON IS IN, which is not the same as the spaces they may SELECT: an
         administrator's policy shows them every space on the instance, and the surface listing one
         they are not a member of gives them a row that does nothing when pressed — no rooms, no
         way in, no reason given. The nav is somebody's own places; an administrator looks at every
         space in the admin, which is where that belongs. */
      supabase.from('space_members').select('space_id, dms').eq('user_id', session.value.user.id),
    ])
    if (s.error) throw s.error
    if (c.error) throw c.error
    const mine = new Set((m.data || []).map((r) => r.space_id))
    /* and whether they are willing to be written to in each — their own row, carried on the space
       so the surface has it without a second read */
    const mineDms = new Map((m.data || []).map((r) => [r.space_id, r.dms !== false]))
    /* HIDDEN IS A LISTING RULE. A hidden space or room is one that exists and is used — the place
       an embedded comment thread lands — but that nobody browses to: it is left out of the rail,
       the front page and Find a space. Staff see everything, because somebody has to be able to
       moderate a room there is otherwise no way into. Nothing about what may be READ changes: its
       members read and write in it exactly as before, which is the whole point. */
    const shown = (x) => !x.hidden || isStaff.value
    spaces.value = (s.data || []).filter((x) => mine.has(x.id)).filter(shown)
      .map((x) => ({ ...x, dms_mine: mineDms.get(x.id) !== false }))
    channels.value = (c.data || []).filter(shown)
    unread.value = u || []
    watchAll()
    loadDrafts()
    const first = (s.data || [])[0]
    if (first) watchHere(first.id)
  } finally {
    loading.value = false
    booted.value = true
  }
}

/* what the rail shows */
export const badge = () => badgeOf(unread.value)
export const unreadFor = (channelId) => {
  const row = unread.value.find((r) => r.channel === channelId)
  return row ? { unread: unreadOf(row), mentions: mentionsOf(row) } : { unread: 0, mentions: 0 }
}
export const joined = (channelId) => unread.value.some((r) => r.channel === channelId)
/* whether this room takes a voice from this person: the counters carry the answer, because the
   database worked it out (space_may) when it answered them. The client never decides this — it
   only asks, so the mic is not offered where the insert would be refused. */
export const mayVoice = (channelId) => {
  const row = unread.value.find((r) => r.channel === channelId)
  return !!(row && row.voice)
}
/* and whether it takes a file — the same question, asked the same way, so the clip is not offered
   where the upload and the insert would both be refused */
export const mayFile = (channelId) => {
  const row = unread.value.find((r) => r.channel === channelId)
  return !!(row && row.file)
}
/* and whether they may name the whole channel — the same question, asked the same way, so neither
   is ever decided in the browser */
export const mayMention = (channelId) => {
  const row = unread.value.find((r) => r.channel === channelId)
  return !!(row && row.mention)
}

/* ------------------------------------------------------------------ sealed rooms */

/*
 * THE ONE SEAM. A sealed room is read and written here exactly like any other, and NOTHING in this
 * file is cryptographic: it asks `./crypto.js` to turn a body into a cipher and a cipher back into
 * a body, and holds what comes back. No key, no session, no device is named here — which is the
 * only way the guarantee stays checkable, because a second place that knew how to seal would be a
 * second place that could get it wrong.
 *
 * The module is imported on DEMAND, the first time a sealed room is touched, so the wasm is in no
 * chunk an unencrypted route loads.
 */
let crypt = null
async function crypto_() {
  if (!crypt) crypt = await import('./crypto.js')
  return crypt
}

/* whether a room is sealed is the channel's own field, projected from its markdown */
export const isSealed = (channelId) => {
  const c = channels.value.find((x) => x.id === channelId)
  return !!(c && c.encrypted)
}

/*
 * WHO THE KEY GOES TO: everybody in the space, not everybody who has joined the channel. A room is
 * sealed to the people who MAY read it, since somebody who joins tomorrow reads from tomorrow and
 * the people they join are already there; narrowing it to the joined would leave a member who
 * opened the room a minute later with a timeline of ciphertext nobody could ever fix.
 */
async function recipients(channelId) {
  const c = channels.value.find((x) => x.id === channelId)
  if (!c) return []
  const { data } = await supabase.from('space_members').select('user_id').eq('space_id', c.space_id)
  return (data || []).map((r) => r.user_id)
}

/*
 * WHAT A SEALED ATTACHMENT'S MESSAGE CARRIES. The row holds the path in the bucket and a cipher,
 * and everything else about the file — its NAME above all, which says as much as the message —
 * is inside the cipher, sealed to the room. Opened, it is put back on the row exactly where the
 * surface already looks for it, so no component knows the difference.
 */
const WRAP = 'dl.attachment.v1'
const wrapFile = (file, info, said) => JSON.stringify({
  _: WRAP, name: file.name || null, type: file.type || null, size: file.size || null,
  seconds: file.seconds == null ? null : file.seconds, media: info, body: said || null,
})
function unwrapFile(row, text) {
  let w = null
  try { w = JSON.parse(text) } catch { return null }
  if (!w || w._ !== WRAP) return null
  return {
    ...row,
    body: w.body || null,
    attachment_name: w.name || null,
    attachment_type: w.type || null,
    attachment_size: w.size || null,
    seconds: w.seconds == null ? row.seconds : w.seconds,
    media: w.media,          /* the little key the bytes are fetched with; never written anywhere */
  }
}

/* a row as the surface wants it: the words where the words go, or a row that SAYS it cannot be read
   on this device — never a throw, and never an empty bubble, which reads as a bug */
async function unseal(row) {
  if (!row || !row.cipher) return row
  const m = await crypto_()
  const body = await m.open(uid(), row.channel_id || open.id, row.cipher, row.author_id)
  if (body == null) return { ...row, body: null, unreadable: true }
  return unwrapFile(row, body) || { ...row, body }
}
const unsealAll = async (rows) => Promise.all((rows || []).map(unseal))

/*
 * THIS BROWSER'S STANDING IN SEALED ROOMS, which is the whole of what the panel needs and is held
 * here rather than asked for twice: whether the device is set up (`ready`), whether the account has
 * a history to be let into (`backup`), whether THIS browser can open it (`holds`), and how many
 * keys are in it. `key` is the recovery key at the one moment it exists outside the library's
 * store — handed over to be shown, and cleared the moment the reader says they have written it
 * down. It is never written anywhere, by anything.
 */
export const sealing = reactive({
  ready: false, working: false, error: null,
  backup: false, holds: false, keys: 0,
  key: null,          /* the recovery key, while it is being shown and never after */
  wrong: false,       /* the last key handed over did not open it */
  skipped: false,     /* they chose to carry on without it, this browser, this visit */
})

async function readyToSeal() {
  if (sealing.ready || sealing.working) return sealing.ready
  sealing.working = true
  try {
    const m = await crypto_()
    sealing.ready = await m.ready(uid())
    sealing.error = null
    Object.assign(sealing, await m.state(uid()))
  } catch (e) {
    sealing.error = e
  } finally {
    sealing.working = false
  }
  return sealing.ready
}

/* make one, once. The key comes back to be SHOWN — the caller shows it and then calls `keyKept`. */
export async function makeRecoveryKey() {
  if (!on() || sealing.working) return null
  sealing.working = true
  try {
    const m = await crypto_()
    sealing.key = await m.makeBackup(uid())
    Object.assign(sealing, await m.state(uid()))
    return sealing.key
  } catch (e) {
    sealing.error = e
    return null
  } finally { sealing.working = false }
}
/* and it is gone from the page the moment they say they have it */
export function keyKept() { sealing.key = null }

/* hand one back. `false` is a wrong key and is a thing to say, never a thing to throw. */
export async function useRecoveryKey(text) {
  if (!on() || sealing.working) return false
  sealing.working = true
  sealing.wrong = false
  try {
    const m = await crypto_()
    const got = await m.restore(uid(), text)
    sealing.wrong = !got
    if (got) {
      Object.assign(sealing, await m.state(uid()))
      /* the history is readable NOW, so the room is read again rather than waiting for a reload */
      if (open.id) await openChannel(open.id)
    }
    return got
  } catch (e) {
    sealing.error = e
    return false
  } finally { sealing.working = false }
}
/* carrying on without it: this browser, this visit, and nothing is lost that was not already */
export function skipRecoveryKey() { sealing.skipped = true }
/* …and changing their mind about it, which is the way back to the key */
export function unskip() { sealing.skipped = false; sealing.wrong = false }

/* ------------------------------------------------------------------ the open channel */

export async function openChannel(id) {
  if (!on() || !id) return
  const meta = channels.value.find((c) => c.id === id)
  open.id = id
  open.mode = (meta && meta.mode) || 'stream'
  open.messages = []
  open.posts = []
  open.pins = []
  open.divider = null
  open.done = false
  open.error = null
  open.loading = true
  try {
    const row = unread.value.find((r) => r.channel === id)
    /* a sealed room needs this browser's own keys before a single line of it can be read */
    const sealed = isSealed(id)
    if (sealed) await readyToSeal()
    if (open.mode === 'forum') {
      open.posts = await unsealAll((await rpc('space_posts', { p_channel: id })) || [])
    } else {
      const page = await unsealAll((await rpc('space_history', { p_channel: id })) || [])
      open.messages = mergeMessages([], page)
      open.done = page.length < PAGE
      open.divider = dividerSeq(open.messages, row ? row.read : 0, uid())
    }
    await loadReactions(id)
    await loadPins(id)
    watch(id)
    await markRead(id)
  } catch (e) {
    open.error = e
  } finally {
    open.loading = false
  }
}

export async function older() {
  if (!on() || !open.id || open.loading || open.done || (open.mode !== 'stream' && open.mode !== 'feed')) return
  const first = open.messages[0]
  if (!first) return
  open.loading = true
  try {
    const page = await unsealAll((await rpc('space_history', { p_channel: open.id, p_before: first.seq })) || [])
    open.messages = mergeMessages(open.messages, page)
    open.done = page.length < PAGE
  } finally {
    open.loading = false
  }
}

/* A FEED'S FIRST ANSWERS: the first few replies under each post a channel read as a feed shows —
   the same rows the thread would show, under the same guards, unsealed here as the thread's are */
export async function firstReplies(roots, n = 2) {
  if (!on() || !roots.length) return {}
  const map = (await rpc('space_first_replies', { p_roots: roots, p_n: n })) || {}
  const out = {}
  for (const [id, rows] of Object.entries(map)) out[id] = await unsealAll(rows || [])
  return out
}

/* a reaction is the same act on a comment as in a room, so the table is one (99-reactions) and a
   row says which surface it was left on. The room's own shape is unchanged — the name is put back
   on the way in, so nothing above here knows the column moved. */
async function loadReactions(id) {
  const { data, error } = await supabase
    .from('reactions').select('message_id:target_id, channel_id, user_id, emoji')
    .eq('surface', 'message').eq('channel_id', id)
  if (!error) open.reactions = data || []
}

export async function openThread(rootId) {
  if (!on() || !rootId) return
  thread.loading = true
  thread.error = null
  try {
    const data = await rpc('space_thread', { p_root: rootId })
    thread.root = (data && data.root) ? await unseal(data.root) : null
    thread.replies = await unsealAll((data && data.replies) || [])
  } catch (e) {
    thread.error = e
  } finally {
    thread.loading = false
  }
}

export function closeThread() { thread.root = null; thread.replies = []; thread.error = null }

/* ------------------------------------------------------------------ writing */

/* optimistic: the row goes in with a client-made id, the insert follows, and the echo the database
   broadcasts lands on the same row — so a message never shows twice and never waits for the trip. */
export async function send(channelId, body, opts = {}) {
  if (!on() || !channelId) return null
  const me = uid()
  const temp = {
    id: 'tmp-' + Math.random().toString(36).slice(2),
    channel_id: channelId, seq: Number.MAX_SAFE_INTEGER, author_id: me,
    kind: opts.kind || 'text', body, title: opts.title || null,
    ...(opts.meta ? { meta: opts.meta } : {}),
    thread_root_id: opts.thread || null, echoed: !!opts.echo,
    created_at: new Date().toISOString(), pending: true, reply_count: 0,
  }
  if (opts.thread) thread.replies = mergeMessages(thread.replies, [temp])
  if (!opts.thread || opts.echo) open.messages = mergeMessages(open.messages, [temp])
  const row = {
    channel_id: channelId, author_id: me, kind: temp.kind, body,
    title: opts.title || null, thread_root_id: opts.thread || null, echoed: !!opts.echo,
    attachment: opts.attachment || null, attachment_type: opts.attachment_type || null,
    seconds: opts.seconds || null,
    ...(opts.meta ? { meta: opts.meta } : {}),
  }
  /*
   * A SEALED ROOM TAKES THE CIPHER AND NOTHING ELSE. The row's own constraint refuses a cipher
   * beside a body, so the words are replaced rather than accompanied — and if the sealing fails the
   * message is NOT sent in the clear, which is the one failure that would quietly break the promise
   * the room makes. The optimistic bubble is dropped and the error is the room's to say.
   */
  if (isSealed(channelId)) {
    try {
      if (!(await readyToSeal())) throw sealing.error || new Error('this device is not set up')
      const m = await crypto_()
      row.cipher = await m.seal(me, channelId, await recipients(channelId), body)
      row.body = null
      row.title = null
    } catch (e) {
      drop(temp.id)
      open.error = e
      console.error('spaces: a message could not be sealed —', String((e && e.message) || e))
      return null
    }
  }
  const { data, error } = await supabase.from('space_messages').insert(row).select().single()
  drop(temp.id)
  if (error) { open.error = error; console.error('spaces: the message was not written —', error.message, error.details || '', error.hint || ''); return null }
  land(await unseal(data))
  return data
}

/* A POLL IS A MESSAGE. Its question is the body, its options ride on meta — which the database's
   own edit guard refuses every client-side change to, so an option can never be reworded under
   somebody's vote. The keys are made here and are random, never indexes: an option removed while
   somebody is voting would otherwise quietly move every vote after it. */
export async function makePoll(channelId, question, options, opts = {}) {
  const clean = (options || []).map((s) => String(s || '').trim()).filter(Boolean)
  if (!channelId || !String(question || '').trim() || clean.length < 2) return null
  const key = () => Math.random().toString(36).slice(2, 8)
  const seen = new Set()
  const made = clean.map((text) => { let k = key(); while (seen.has(k)) k = key(); seen.add(k); return { key: k, text } })
  return send(channelId, String(question).trim(), {
    ...opts, kind: 'poll', meta: { poll: { options: made, multi: !!opts.multi } },
  })
}

/* the votes of the messages on screen — read as rows, counted in the browser by tallyPoll */
export const votes = ref([])
export async function loadVotes(ids = []) {
  const want = (ids || []).filter(Boolean)
  if (!on() || !want.length) { votes.value = []; return [] }
  const { data } = await supabase.from('space_poll_votes').select('message_id, option_key, user_id').in('message_id', want)
  votes.value = data || []
  return votes.value
}

/* A vote is the voter's own row and nothing else. Voting again where only one answer is allowed
   MOVES the vote, which is what somebody means by pressing another option — the old row goes first,
   because the policy would refuse the second one while the first still stands. */
export async function vote(messageId, optionKey, { multi = false } = {}) {
  if (!on() || !messageId || !optionKey) return false
  const me = uid()
  if (!multi) {
    await supabase.from('space_poll_votes').delete().eq('message_id', messageId).eq('user_id', me)
    votes.value = votes.value.filter((v) => !(v.message_id === messageId && v.user_id === me))
  }
  const { error } = await supabase.from('space_poll_votes').insert({ message_id: messageId, option_key: optionKey, user_id: me })
  if (error) return false
  votes.value = [...votes.value, { message_id: messageId, option_key: optionKey, user_id: me }]
  return true
}

export async function unvote(messageId, optionKey) {
  if (!on() || !messageId) return false
  const me = uid()
  const { error } = await supabase.from('space_poll_votes').delete()
    .eq('message_id', messageId).eq('user_id', me).eq('option_key', optionKey)
  if (error) return false
  votes.value = votes.value.filter((v) => !(v.message_id === messageId && v.user_id === me && v.option_key === optionKey))
  return true
}

/* closing keeps the result: the author's to do, and whoever the space granted keeping the room */
export async function closePoll(messageId) {
  if (!on() || !messageId) return false
  const { data } = await supabase.rpc('space_poll_close', { p_message: messageId })
  if (!data) return false
  const at = new Date().toISOString()
  open.messages = open.messages.map((m) => (m.id === messageId ? { ...m, poll_closed_at: at } : m))
  thread.replies = thread.replies.map((m) => (m.id === messageId ? { ...m, poll_closed_at: at } : m))
  if (thread.root && thread.root.id === messageId) thread.root = { ...thread.root, poll_closed_at: at }
  return true
}

/*
 * TAKING AN OFFER A BOT MADE. The database does it in one statement, so of two people pressing at
 * the same moment exactly one takes it; the other is told it is gone and sees what was chosen.
 *
 * What the press SAYS is the offer's own words, read off its row — never sent from here. A client
 * that could name its own words could put a sentence in somebody's mouth in a room, in their name,
 * and start a bot on it.
 *
 * The answer is a message like any other, so the mention, the notification and the ear all work on
 * it with no new path; the caller summons the bot with it exactly as it would for anything typed.
 */
export async function chooseOffer(messageId, key) {
  if (!on() || !messageId || !key) return null
  const { data } = await supabase.rpc('space_choose', { p_message: messageId, p_key: key })
  if (!data) return null
  const was = [...open.messages, thread.root, ...thread.replies].find((m) => m && m.id === messageId)
  /* the same act, said the same way, wherever it happened */
  capture('bot_choice', { surface: 'spaces', bot: (was && was.meta && was.meta.bot) || null, choice: key, channel: open.id })
  const at = new Date().toISOString()
  const mark = (m) => (m.id === messageId ? { ...m, choice_at: at, choice_key: key } : m)
  open.messages = open.messages.map(mark)
  thread.replies = thread.replies.map(mark)
  if (thread.root) thread.root = mark(thread.root)
  return data
}

/* A voice note: the sound goes up first, under the message's own id, and the row follows — so a
   row never points at a file that is not there. If the insert is refused (the grant was taken away
   between asking and sending) the object is removed again rather than left as litter. */
/* the transcript is the message's body: it makes a voice note readable at a glance, searchable by
   the same index every other message uses (the stored tsvector), and there for anybody who cannot
   play sound where they are — and it costs no column */
export async function sendVoice(channelId, blob, seconds, opts = {}) {
  if (!on() || !channelId || !blob) return null
  const me = uid()
  const id = newId()
  const path = voicePath(channelId, id)
  const temp = {
    id, channel_id: channelId, seq: Number.MAX_SAFE_INTEGER, author_id: me, kind: 'voice',
    body: opts.transcript || null, attachment: path, attachment_type: 'audio/mpeg', seconds,
    thread_root_id: opts.thread || null, echoed: !!opts.echo,
    created_at: new Date().toISOString(), pending: true, reply_count: 0, blob,
  }
  if (opts.thread) thread.replies = mergeMessages(thread.replies, [temp])
  if (!opts.thread || opts.echo) open.messages = mergeMessages(open.messages, [temp])
  /* SEALED: the bucket gets the ciphertext, and what it is — how long, whose voice, what was said
     with it — travels in the message. What is uploaded is bytes nobody can play. */
  let body = { id, channel_id: channelId, author_id: me, kind: 'voice', attachment: path,
    attachment_type: 'audio/mpeg', seconds, body: opts.transcript || null,
    thread_root_id: opts.thread || null, echoed: !!opts.echo }
  let put = blob, type = 'audio/mpeg'
  if (isSealed(channelId)) {
    try {
      if (!(await readyToSeal())) throw sealing.error || new Error('this device is not set up')
      const m = await crypto_()
      const { data: bytes, info } = await m.sealBytes(await blob.arrayBuffer())
      put = new Blob([bytes], { type: 'application/octet-stream' })
      type = 'application/octet-stream'
      const wrapped = wrapFile({ name: null, type: 'audio/mpeg', size: blob.size, seconds }, info, opts.transcript)
      body = { id, channel_id: channelId, author_id: me, kind: 'voice', attachment: path,
        thread_root_id: opts.thread || null, echoed: !!opts.echo,
        cipher: await m.seal(me, channelId, await recipients(channelId), wrapped) }
    } catch (e) {
      drop(id); open.error = e
      console.error('spaces: a voice note could not be sealed —', String((e && e.message) || e))
      return null
    }
  }
  const up = await supabase.storage.from('spaces').upload(path, put, { contentType: type, upsert: false })
  if (up.error) { drop(id); open.error = up.error; return null }
  const { data, error } = await supabase.from('space_messages').insert(body).select().single()
  if (error) {
    await supabase.storage.from('spaces').remove([path]).catch(() => {})
    drop(id)
    open.error = error
    return null
  }
  /* the blob stays on the row so this browser plays what it just made without a round trip — the
     one it made, not the sealed one, and the row keeps the name and length the cipher carries */
  land({ ...data, blob, attachment_type: 'audio/mpeg', seconds, body: opts.transcript || null })
  return data
}

/* An attached file, sent exactly as a voice note is: the bytes go up first, under the message's
   own id, and the row follows, so a row never points at nothing; a refused insert takes the object
   with it rather than leaving litter. The words a person typed beside it ride on the body, which
   is what makes an attachment searchable and what a caption is. */
export async function sendFile(channelId, file, opts = {}) {
  if (!on() || !channelId || !file) return null
  const type = String(file.type || '').toLowerCase()
  const ext = FILE_TYPES[type]
  if (!ext) { open.error = new Error('kind'); return null }
  if (file.size > FILE_MAX) { open.error = new Error('size'); return null }
  const me = uid()
  const id = newId()
  const path = filePath(channelId, id, ext)
  const said = String(opts.body || '').trim() || null
  const row = {
    id, channel_id: channelId, seq: Number.MAX_SAFE_INTEGER, author_id: me, kind: 'file',
    body: said, attachment: path, attachment_type: type, attachment_name: file.name, attachment_size: file.size,
    thread_root_id: opts.thread || null, echoed: !!opts.echo,
    created_at: new Date().toISOString(), pending: true, reply_count: 0, blob: file,
  }
  if (opts.thread) thread.replies = mergeMessages(thread.replies, [row])
  if (!opts.thread || opts.echo) open.messages = mergeMessages(open.messages, [row])
  /* SEALED: as for a voice note, and the file's NAME goes inside — "severance-agreement.pdf" says
     most of what the message said, and the row's own check refuses a name beside a cipher anyway. */
  let body = { id, channel_id: channelId, author_id: me, kind: 'file', attachment: path,
    attachment_type: type, attachment_name: file.name, attachment_size: file.size, body: said,
    thread_root_id: opts.thread || null, echoed: !!opts.echo }
  let put = file, putType = type
  if (isSealed(channelId)) {
    try {
      if (!(await readyToSeal())) throw sealing.error || new Error('this device is not set up')
      const m = await crypto_()
      const { data: bytes, info } = await m.sealBytes(await file.arrayBuffer())
      put = new Blob([bytes], { type: 'application/octet-stream' })
      putType = 'application/octet-stream'
      const wrapped = wrapFile(file, info, said)
      body = { id, channel_id: channelId, author_id: me, kind: 'file', attachment: path,
        thread_root_id: opts.thread || null, echoed: !!opts.echo,
        cipher: await m.seal(me, channelId, await recipients(channelId), wrapped) }
    } catch (e) {
      drop(id); open.error = e
      console.error('spaces: a file could not be sealed —', String((e && e.message) || e))
      return null
    }
  }
  const up = await supabase.storage.from('spaces').upload(path, put, { contentType: putType, cacheControl: '31536000', upsert: false })
  if (up.error) { drop(id); open.error = up.error; return null }
  const { data, error } = await supabase.from('space_messages').insert(body).select().single()
  if (error) {
    await supabase.storage.from('spaces').remove([path]).catch(() => {})
    drop(id); open.error = error; return null
  }
  land({ ...data, blob: file, attachment_name: file.name, attachment_type: type, attachment_size: file.size, body: said })
  return data
}

/*
 * A FEED POST WITH PICTURES AND VIDEOS (streamline-social-layout): up to ten, put under the channel's
 * id in the spaces bucket (read by whoever may read the room), a video's first frame beside it, then
 * one message carrying them as `media` — the shape a network post carries. A sealed room takes no
 * media (it would have to seal each file); the composer offers none there.
 */
export async function sendMedia(channelId, files, opts = {}) {
  if (!on() || !channelId || !files || !files.length || isSealed(channelId)) return null
  const { probe } = await import('../network/probe.js')
  const { MEDIA, kindOfType } = await import('../../../supabase/functions/_shared/atproto/media.js')
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
  const me = uid()
  const put = []
  const media = []
  try {
    for (const f of files.slice(0, MEDIA.max)) {
      const type = String(f.type || '').toLowerCase()
      if (!kindOfType(type)) continue
      const id = newId()
      const path = channelId + '/' + id + '.' + EXT[type]
      const info = await probe(f)
      const up = await supabase.storage.from('spaces').upload(path, f, { contentType: type, cacheControl: '31536000', upsert: false })
      if (up.error) throw up.error
      put.push(path)
      let poster
      if (info.poster) {
        poster = channelId + '/' + id + '.poster.jpg'
        const pu = await supabase.storage.from('spaces').upload(poster, info.poster, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
        if (pu.error) poster = undefined; else put.push(poster)
      }
      media.push({ kind: info.kind || 'image', path, alt: '', mime: type, size: f.size,
        ...(info.width && info.height ? { width: info.width, height: info.height } : {}),
        ...(info.duration ? { duration: info.duration } : {}), ...(poster ? { poster } : {}) })
    }
    const body = String(opts.body || '').trim()
    const { data, error } = await supabase.from('space_messages').insert({ id: newId(), channel_id: channelId, author_id: me, kind: 'text', body, media }).select().single()
    if (error) throw error
    land(data)
    return data
  } catch (e) {
    if (put.length) await supabase.storage.from('spaces').remove(put).catch(() => {})
    open.error = e
    return null
  }
}

/* a message's pictures and videos, signed for an hour from the spaces bucket: path → address */
export const mediaUrls = reactive({})
export async function signMedia(messages) {
  const paths = []
  for (const m of messages || []) for (const im of (m && m.media) || []) for (const at of [im.path, im.poster]) if (at && !mediaUrls[at]) paths.push(at)
  if (!paths.length || !on()) return
  const { data } = await supabase.storage.from('spaces').createSignedUrls(paths, 3600)
  for (const x of data || []) if (x.signedUrl && x.path) mediaUrls[x.path] = x.signedUrl
}

export async function edit(id, body, title) {
  if (!on() || !id) return
  const patch = { body }
  if (title !== undefined) patch.title = title
  const { data, error } = await supabase.from('space_messages').update(patch).eq('id', id).select().single()
  if (!error && data) land(data)
}

export async function withdraw(id) {
  if (!on() || !id) return
  const { data, error } = await supabase.from('space_messages').update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single()
  if (!error && data) land(data)
}

/* ------------------------------------------------------------------ pinned to the room
 *
 * What a room needs everybody to have read. A pin is the ROOM's — put there by whoever keeps it,
 * outliving them — which is what makes it a different thing from Saved, where one person keeps a
 * message for themselves and nobody else ever sees it.
 */
export async function loadPins(channelId) {
  if (!on() || !channelId) return []
  const { data } = await supabase.rpc('space_pinned', { p_channel: channelId })
  if (open.id === channelId) open.pins = data || []
  return data || []
}

/* pin or unpin: one call, because "is it pinned" is a state and the surface holds a switch. The
   channel is the message's, decided in the database — a client that could name both could pin a
   message of one room into another. */
export async function pin(messageId, onOff = true, note = null) {
  if (!on() || !messageId) return { error: 'no message' }
  const { data, error } = await supabase.rpc('space_pin', { p_message: messageId, p_on: !!onOff, p_note: note })
  if (error) return { error: error.message }
  await loadPins(open.id)
  return data || {}
}

export async function react(messageId, emoji) {
  if (!on() || !messageId) return
  const me = uid()
  const had = open.reactions.find((r) => r.message_id === messageId && r.user_id === me && r.emoji === emoji)
  const channelId = open.id
  if (had) {
    open.reactions = open.reactions.filter((r) => r !== had)
    await supabase.from('reactions').delete()
      .eq('surface', 'message').eq('target_id', messageId).eq('user_id', me).eq('emoji', emoji)
  } else {
    open.reactions = [...open.reactions, { message_id: messageId, channel_id: channelId, user_id: me, emoji }]
    await supabase.from('reactions').insert({ surface: 'message', target_id: messageId, channel_id: channelId, user_id: me, emoji })
  }
}

/* WHETHER THIS PERSON WILL BE WRITTEN TO IN THIS SPACE — their own row, set through the function
   that owns it (space_members also carries counters a member must never write). Declining stops a
   NEW conversation and nothing else: every thread already open keeps working, on both sides. */
export async function setDms(spaceId, want) {
  if (!on() || !spaceId) return null
  try {
    const said = await rpc('space_set_dms', { p_space: spaceId, p_on: !!want })
    const row = (spaces.value || []).find((s) => s.id === spaceId)
    if (row) row.dms_mine = !!said
    return !!said
  } catch (e) { return null }
}

export async function markRead(channelId, seq) {
  if (!on() || !channelId) return
  const last = seq != null ? seq : lastSeqOf(channelId)
  await rpc('space_read', { p_channel: channelId, p_seq: last })
  const row = unread.value.find((r) => r.channel === channelId)
  if (row) { row.read = Math.max(row.read || 0, last || 0); row.mentions = 0 }
  say(channelId, 'read', { user: uid(), seq: last })
}

export async function setNotify(channelId, notify) {
  if (!on() || !channelId) return
  await supabase.from('channel_members').update({ notify }).eq('channel_id', channelId).eq('user_id', uid())
  const row = unread.value.find((r) => r.channel === channelId)
  if (row) row.notify = notify
}

/* WHAT THIS PERSON HAS ASKED NOT TO HEAR: a room, a space (every room in it, and every room it
   gains later), or somebody, whose lines stop naming them anywhere and whose direct message stops
   carrying a number. Muting hides nothing — a muted room is still read by opening it — so none of
   this is a policy; it is what arrives with a noise and what does not. */
/* NOTE ON THE WORD. space_moderation has a `mute` too — a moderator silencing somebody, which
   stops them WRITING. This is the opposite act and the reader owns it: it stops them HEARING, and it
   is called a hush in the code so the two can never be confused at a call site. Both are "Mute" to a
   reader, because to a reader they are never in the same menu. */
export const hushes = ref([])
export async function loadHushes() { if (on()) hushes.value = (await rpc('space_my_mutes')) || [] }
export const hushOf = (kind, ref) => (hushes.value || []).find((m) => m.kind === kind && m.ref === ref) || null
export const isHushed = (kind, ref) => !!hushOf(kind, ref)

export async function hush(kind, ref, until = null) {
  if (!on() || !kind || !ref) return
  const { error } = await supabase.rpc('space_mute', { p_kind: kind, p_ref: ref, p_until: until })
  if (error) return
  const had = hushOf(kind, ref)
  if (had) had.until = until
  else hushes.value = [...hushes.value, { kind, ref, until }]
  /* the rooms this touches go quiet at once rather than at the next read */
  if (kind !== 'person') unread.value = (await rpc('space_unread')) || []
}
export async function unhush(kind, ref) {
  if (!on() || !kind || !ref) return
  const { error } = await supabase.rpc('space_unmute', { p_kind: kind, p_ref: ref })
  if (error) return
  hushes.value = hushes.value.filter((m) => !(m.kind === kind && m.ref === ref))
  if (kind !== 'person') unread.value = (await rpc('space_unread')) || []
}

export async function join(channelId) {
  if (!on() || !channelId) return
  const { error } = await supabase.from('channel_members').insert({ channel_id: channelId, user_id: uid() })
  if (!error) { unread.value = (await rpc('space_unread')) || []; watch(channelId) }
}

export async function leave(channelId) {
  if (!on() || !channelId) return
  await supabase.from('channel_members').delete().eq('channel_id', channelId).eq('user_id', uid())
  unwatch(channelId)
  unread.value = unread.value.filter((r) => r.channel !== channelId)
}

/* the credentials for this channel's huddle: who the caller is on it, the topic to signal on, where
   to find themselves and a relay where the site was given one. The one call that needs a function,
   because it needs a secret; everything else here is the database's own gate. */
export async function callFor(channelId) {
  if (!on() || !channelId) return null
  const { data, error } = await supabase.functions.invoke('spaces', { body: { action: 'call', channel: channelId } })
  if (error) throw error
  return data
}

/* ------------------------------------------------------------------ the other rooms */

/* the one direct message between these people, made if there is none — never inserted by a client,
   so the same set of people always finds the same room however they ask for it */
/* WHY A DIRECT MESSAGE WOULD NOT OPEN, if it would not. The database refuses in words and this
   keeps them, because a control that does nothing and says nothing is worse than a refusal: the
   space has none at all, or the person has said they would rather not be written to. */
export const dmRefused = ref('')
export async function openDm(spaceId, peers) {
  if (!on() || !spaceId) return null
  dmRefused.value = ''
  let id
  try { id = await rpc('space_dm_open', { p_space: spaceId, p_with: peers }) }
  catch (e) {
    const said = String((e && e.message) || '')
    dmRefused.value = /no direct messages here/.test(said) ? 'space'
      : /not taking direct messages/.test(said) ? 'person' : 'other'
    return null
  }
  if (!id) return null
  unread.value = (await rpc('space_unread')) || []
  channels.value = ((await supabase.from('channels').select('*').is('archived_at', null)).data) || []
  watch(id)
  return id
}

export async function loadThreads() { if (on()) threads.value = (await rpc('space_threads')) || [] }
/* the read keeps the database's own name — it answers the mention rows, which is what this is */
export async function loadMentions() { if (on()) mentions.value = (await rpc('space_activity')) || [] }
/* everything not read yet, across every room: the other half of the question the rail's counters
   answer — not how many, but what. Muted rooms and one's own messages are left out in the read. */
export async function loadUnreads() { if (on()) unreads.value = (await rpc('space_unseen')) || [] }
/* the read keeps the database's own name; what it answers is what they saved */
export async function loadSaved() { if (on()) saved.value = (await rpc('space_later')) || [] }
/* the DMs view: one read for every direct message, whichever space it is in. It brings the other
   people's names with it, because a name a page holds belongs to the space it has open. */
export async function loadDms() { if (on()) dms.value = (await rpc('space_dms')) || [] }

export async function save(message) {
  if (!on() || !message) return
  await supabase.from('space_saved').insert({ user_id: uid(), message_id: message.id, channel_id: message.channel_id })
  await loadSaved()
}
export async function unsave(messageId) {
  if (!on()) return
  await supabase.from('space_saved').delete().eq('user_id', uid()).eq('message_id', messageId)
  await loadSaved()
}
export const isSaved = (id) => saved.value.some((x) => x.id === id)

export async function star(channelId, on_) {
  if (!on() || !channelId) return
  await supabase.from('channel_members').update({ starred: !!on_ }).eq('channel_id', channelId).eq('user_id', uid())
  const row = unread.value.find((r) => r.channel === channelId)
  if (row) row.starred = !!on_
}

/* a draft is the reader's own and nobody's business: it stays in this browser until it is sent */
export function draft(channelId, text) {
  if (!channelId) return
  if (text) drafts[channelId] = text
  else delete drafts[channelId]
  try { localStorage.setItem('dl.spaces.drafts', JSON.stringify(drafts)) } catch (e) { /* a private window */ }
}
function loadDrafts() {
  try {
    const held = JSON.parse(localStorage.getItem('dl.spaces.drafts') || '{}')
    for (const k of Object.keys(held)) drafts[k] = held[k]
  } catch (e) { /* nothing kept */ }
}

/* who else is here, on the space's own topic */
function watchHere(spaceId) {
  if (!on() || !spaceId || presence) return
  presence = supabase.channel('here:' + spaceId, { config: { private: true, presence: { key: uid() } } })
    .on('presence', { event: 'sync' }, () => {
      const state = presence.presenceState()
      for (const k of Object.keys(here)) delete here[k]
      for (const k of Object.keys(state)) here[k] = statusOf(state[k])
    })
    .subscribe((s) => { if (s === 'SUBSCRIBED') say_() })
  watchIdle()
}

/* what this session is saying about itself, said again whenever it changes */
let saying = null
function say_() {
  if (!presence) return
  const now = myStatus(status.value, touched)
  if (now === saying) return
  saying = now
  presence.track({ at: Date.now(), status: now }).catch(() => {})
}

/* chosen by hand: kept for this browser, and said at once */
export function setStatus(s) {
  if (!isStatus(s)) return
  status.value = s
  touched = Date.now()
  try { localStorage.setItem('dl.spaces.status', s) } catch (e) { /* a private window */ }
  say_()
}

/* and on its own: a while with nobody touching anything reads as away, and anything at all reads as
   back. Only over "active" — somebody who said not now has not stopped meaning it by going quiet. */
let idleTimer = null
function watchIdle() {
  if (idleTimer || typeof window === 'undefined') return
  const back = () => { touched = Date.now(); say_() }
  for (const e of ['pointerdown', 'keydown', 'focus']) window.addEventListener(e, back, { passive: true })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') back() })
  idleTimer = setInterval(say_, 30000)
}

/*
 * SEARCH, AND WHAT IT COULD NOT LOOK IN.
 *
 * A sealed room leaves nothing in the index, so it is missed with no exception anywhere in the
 * search path — which is free and correct and, said silently, is the fault. Somebody who knows a
 * thing was written, searches for it and finds nothing concludes the search is broken, or that the
 * thing was never written. So the answer carries a COUNT of the rooms that could not be looked in,
 * and the surface says so beside the result count.
 *
 * It is a count and never a list: "it is not in #payroll" is a thing a search should not be made
 * to say about a room somebody is in.
 */
export async function search(query) {
  if (!on()) return { rows: [], sealed: 0 }
  const a = queryArgs(query)
  const [rows, sealed] = await Promise.all([
    rpc('space_search', {
      p_q: a.q, p_space: null, p_channel: a.in || null, p_from: a.from || null,
      p_after: a.after, p_before: a.before,
    }),
    /* an older database has no such function; a search that works and says nothing extra beats a
       search that throws because one deployment is a migration behind */
    rpc('space_sealed_rooms', { p_space: null, p_channel: a.in || null }).catch(() => 0),
  ])
  return { rows: rows || [], sealed: Number(sealed) || 0 }
}

/* ------------------------------------------------------------------ live */

const lastSeqOf = (channelId) => {
  let n = 0
  for (const m of open.id === channelId ? open.messages : []) if (Number(m.seq) < Number.MAX_SAFE_INTEGER) n = Math.max(n, Number(m.seq) || 0)
  const row = unread.value.find((r) => r.channel === channelId)
  return Math.max(n, row ? Number(row.seq) || 0 : 0)
}

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
  : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)))

const drop = (id) => {
  open.messages = open.messages.filter((m) => m.id !== id)
  thread.replies = thread.replies.filter((m) => m.id !== id)
}

/* a row from anywhere — our own insert, the database's broadcast, a page — put where it belongs */
function land(row) {
  if (!row || !row.id) return
  if (row.channel_id === open.id && (!row.thread_root_id || row.echoed)) open.messages = mergeMessages(open.messages, [row])
  if (thread.root && row.thread_root_id === thread.root.id) thread.replies = mergeMessages(thread.replies, [row])
  if (thread.root && row.id === thread.root.id) thread.root = { ...thread.root, ...row }
  const u = unread.value.find((r) => r.channel === row.channel_id)
  if (u && Number(row.seq) > Number(u.seq || 0)) {
    u.seq = Number(row.seq)
    u.last_message_at = row.created_at || row.at
    if (row.author_id === uid()) u.read = Number(row.seq)
  }
}

function watchAll() {
  for (const row of unread.value) watch(row.channel)
}

function watch(channelId) {
  if (!on() || !channelId || live.has(channelId)) return
  const ch = supabase.channel(topicOf(channelId), { config: { private: true, broadcast: { self: false } } })
    .on('broadcast', { event: 'message' }, ({ payload }) => arrived(channelId, payload))
    .on('broadcast', { event: 'edited' }, ({ payload }) => arrived(channelId, payload))
    .on('broadcast', { event: 'withdrawn' }, ({ payload }) => arrived(channelId, payload))
    .on('broadcast', { event: 'reaction' }, ({ payload }) => reacted(channelId, payload))
    /* a pin is the room's, so everybody looking at the room learns of it at once */
    .on('broadcast', { event: 'pins' }, () => { if (open.id === channelId) loadPins(channelId) })
    .on('broadcast', { event: 'typing' }, ({ payload }) => saw(channelId, payload))
    .on('broadcast', { event: 'read' }, ({ payload }) => saw(channelId, payload, true))
    /* A subscription is acknowledged a moment before the server is actually sending on the topic, so
       a message written in that window is never broadcast to us. Nothing is lost: on being told we
       are subscribed we ask for anything newer than what we hold, which is the cursor doing what it
       is for. Never a sleep — the window is not a fixed length. */
    .subscribe((status) => { if (status === 'SUBSCRIBED') catchUpChannel(channelId) })
  live.set(channelId, ch)
}

function unwatch(channelId) {
  const ch = live.get(channelId)
  if (ch) { supabase.removeChannel(ch); live.delete(channelId) }
}

/* the database's own send. A payload without its body is a message too large to carry: fetch it. */
async function arrived(channelId, payload) {
  if (!payload || !payload.id) return
  /* a sealed message's words ARE its cipher, which the wake carries, so it is not a payload that
     lost its body and must not be fetched again */
  if (payload.cipher == null && payload.body === null && payload.kind !== 'system' && payload.deleted_at == null && payload.title == null) {
    const { data } = await supabase.from('space_messages').select('*').eq('id', payload.id).single()
    if (data) land(await unseal(data))
    return
  }
  land(await unseal({
    id: payload.id, channel_id: payload.channel || channelId, seq: payload.seq,
    thread_root_id: payload.root || null, author_id: payload.author || null,
    kind: payload.kind, title: payload.title, body: payload.body,
    attachment: payload.attachment, attachment_type: payload.attachment_type,
    seconds: payload.seconds, meta: payload.meta, created_at: payload.at,
    edited_at: payload.edited_at, deleted_at: payload.deleted_at,
    cipher: payload.cipher || null,
  }))
}

function reacted(channelId, p) {
  if (!p || !p.message || channelId !== open.id) return
  if (p.on) open.reactions = [...open.reactions.filter((r) => !(r.message_id === p.message && r.user_id === p.user && r.emoji === p.emoji)), { message_id: p.message, channel_id: channelId, user_id: p.user, emoji: p.emoji }]
  else open.reactions = open.reactions.filter((r) => !(r.message_id === p.message && r.user_id === p.user && r.emoji === p.emoji))
}

/* typing and read receipts: the client's own, never written down */
function saw(channelId, p, isRead) {
  if (!p || !p.user || p.user === uid()) return
  if (isRead) return
  if (!typing[channelId]) typing[channelId] = {}
  typing[channelId][p.user] = Date.now() + TYPING_FOR
  if (!typingTimer) typingTimer = setInterval(sweepTyping, 1000)
}

function sweepTyping() {
  const now = Date.now()
  let any = false
  for (const id of Object.keys(typing)) {
    for (const u of Object.keys(typing[id])) { if (typing[id][u] < now) delete typing[id][u]; else any = true }
    if (!Object.keys(typing[id]).length) delete typing[id]
  }
  if (!any && typingTimer) { clearInterval(typingTimer); typingTimer = null }
}

const say = (channelId, event, payload) => {
  const ch = live.get(channelId)
  if (ch) ch.send({ type: 'broadcast', event, payload }).catch(() => {})
}

/* a keystroke, at most every few seconds */
export function saidSomething(channelId) {
  const now = Date.now()
  if ((lastTyped.get(channelId) || 0) + TYPING_MS > now) return
  lastTyped.set(channelId, now)
  say(channelId, 'typing', { user: uid() })
}

export const whoIsTyping = (channelId) => Object.keys(typing[channelId] || {})

/* ------------------------------------------------------------------ catching up */

/* one channel, from what we hold to what there is */
async function catchUpChannel(channelId) {
  if (!on() || !channelId) return
  const row = unread.value.find((r) => r.channel === channelId)
  const from = channelId === open.id
    ? open.messages.reduce((n, m) => (Number(m.seq) < Number.MAX_SAFE_INTEGER ? Math.max(n, Number(m.seq) || 0) : n), 0)
    : Number((row && row.seq) || 0)
  const answer = (await rpc('space_catchup', { p_cursors: { [channelId]: from }, p_lim: PAGE })) || []
  for (const a of answer) for (const m of a.messages || []) land(m)
}

/* a return from being away: one question with a cursor per channel, and the channels too far behind
   are paged rather than trusted to the answer. */
export async function catchUp() {
  if (!on()) return
  const cursors = {}
  for (const r of unread.value) cursors[r.channel] = Number(r.seq) || 0
  const answer = (await rpc('space_catchup', { p_cursors: cursors, p_lim: PAGE })) || []
  for (const a of answer) {
    for (const m of a.messages || []) land(m)
    if (a.more && a.channel === open.id) await openChannel(open.id)
  }
  unread.value = (await rpc('space_unread')) || []
}

/* ------------------------------------------------------------------ a community

   The member's half. Every one of these is an RPC over a definer function, for the same reason the
   rest of the module is policies: a reader who is not in a space has no policy that reaches it, so
   what a space would take to get into cannot be a select. The token of an invitation never reaches
   the database — the browser makes it and its sha256, the way it makes an API key's — so the link
   is the only place it exists. */

/* every space this reader could be in, with what each would take and whether it is already theirs */
export const discover = () => rpc('space_discover')
/* knocking on a space's own door, and — for whoever keeps it — what is waiting there. What the
   door asks (terms, a form) is enforced by space_ask, never by the page that draws it. */
export const askToJoin = (space, { note = null, response = null, agreed = false } = {}) =>
  rpc('space_ask', { p_space: space, p_note: note, p_response: response, p_agreed: agreed })
export const asksOf = (space) => rpc('space_asks', { p_space: space })
/* the badges a space has, and giving one to somebody or taking it back (a moderator's act) */
export const flairsOf = (space) => rpc('space_flairs', { p_space: space })
export const giveFlair = (flair, user, on = true) => rpc('space_give_flair', { p_flair: flair, p_user: user, p_on: on })
export const answerAsk = (id, yes) => rpc('space_answer', { p_request: id, p_yes: yes })

/* what has happened lately in a space, for its home: the rooms this reader can read, and no others */
export const latelyIn = (space, lim = 8) => rpc('space_lately', { p_space: space, p_lim: lim })
/* what has been said lately ACROSS every space this person is in — the front page's own question,
   which asking per space and merging in the browser would answer slowly and in a different order
   every time */
export const everywhere = (lim = 30) => rpc('space_everywhere', { p_lim: lim })

/* THE GROUPS THIS SPACE HAS: its roles, which are the things `@coaches` names. Read straight from
   the table (a member may), because a role is part of what the space IS — it is declared in the
   space's own file — and not something the surface has to be told. */
export const groups = ref([])
export async function loadGroups(spaceId) {
  if (!on() || !spaceId) { groups.value = []; return [] }
  const { data } = await supabase.from('space_roles').select('slug, name, colour, rank').eq('space_id', spaceId).order('rank')
  groups.value = data || []
  return groups.value
}

/* who else is in a space: a name, the roles they hold, and whether they are here now */
export const peopleOf = (space) => rpc('space_people', { p_space: space })

/* A PERSON'S CARD. The public half — who they are, what this space calls them, when they arrived,
   how much they have said here and the line they wrote about themselves — refused outright unless
   the caller and the subject are both in that space. The answer carries `more`: whether this
   reader may be shown the second half at all, so the surface asks the database rather than guessing
   from a role it happens to know about. */
export const memberCard = (space, user) => rpc('space_member_card', { p_space: space, p_user: user })

/* the line a person writes about themselves: their own profile row and nobody else's, which the
   table's own policy enforces — this is only the way to write it */
export async function setAbout(text) {
  const id = session.value && session.value.user && session.value.user.id
  if (!id) return false
  const about = String(text || '').trim().slice(0, 280)
  const { error } = await supabase.from('profiles').update({ about: about || null }).eq('id', id)
  return !error
}

/* an invitation. The token is made here, answered here, and stored nowhere. */
export const inviteToken = () => {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const tokenHash = async (token) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
export async function makeInvite(space, { role = null, uses = 1, days = null, note = null } = {}) {
  const token = inviteToken()
  await rpc('space_invite', { p_space: space, p_hash: await tokenHash(token), p_role: role, p_uses: uses, p_days: days, p_note: note })
  return token
}
export const invitesOf = (space) => rpc('space_invites_of', { p_space: space })
export const dropInvite = (id) => rpc('space_invite_drop', { p_id: id })
export const lookInvite = async (token) => rpc('space_invite_look', { p_hash: await tokenHash(token) })
export const acceptInvite = async (token) => rpc('space_invite_accept', { p_hash: await tokenHash(token) })

/* moderation: a report by anybody, three acts by whoever the space granted it, and the record */
export const report = (message, reason, note = null) => rpc('space_report', { p_message: message, p_reason: reason, p_note: note })
export const reportsOf = (space, open = true) => rpc('space_reports', { p_space: space, p_open: open })
export const answerReport = (id) => rpc('space_report_answered', { p_id: id })
export const recordOf = (space) => rpc('space_record', { p_space: space })
export const myRecord = () => rpc('space_my_record')
export const removeMessage = (space, message, reason = null) => rpc('space_moderate', { p_kind: 'remove-message', p_space: space, p_message: message, p_reason: reason })
export const mute = (space, user, minutes, reason = null) => rpc('space_moderate', { p_kind: 'mute', p_space: space, p_user: user, p_minutes: minutes, p_reason: reason })
export const removeMember = (space, user, reason = null) => rpc('space_moderate', { p_kind: 'remove-member', p_space: space, p_user: user, p_reason: reason })
/* whether this person may moderate or invite here, asked of one of the space's rooms */
export const mayModerate = (channel) => rpc('space_may', { p_channel: channel, p_capability: 'moderate' })
export const mayInvite = (channel) => rpc('space_may', { p_channel: channel, p_capability: 'invite' })

export function stop() {
  for (const [, ch] of live) supabase.removeChannel(ch)
  live.clear()
  if (presence) { supabase.removeChannel(presence); presence = null; saying = null }
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null }
  if (typingTimer) { clearInterval(typingTimer); typingTimer = null }
}

const forget = () => {
  stop()
  spaces.value = []; channels.value = []; unread.value = []
  open.id = null; open.messages = []; open.posts = []; open.reactions = []
  thread.root = null; thread.replies = []
  booted.value = false
}
/* the drain before the session ends: signing out reloads the page straight after, so this is only
   about letting the live channels go before the socket does */
beforeSignOut.push(forget)
/* AND THE OTHER HALF. Somebody arrived (or left, or is somebody else): throw away what belonged to
   whoever was here and load what belongs to whoever is here now. Without this a member who signs in
   on the community page is told they are not in a space yet until they navigate. */
onIdentity((id) => {
  if (id && id === bootedFor) return   /* the view already booted this load for this person */
  forget()
  if (id) boot()
})

/* ------------------------------------------------------------------ sent later
 *
 * A DRAFT AND A SCHEDULED MESSAGE ARE DIFFERENT THINGS. A draft is unfinished and lives in a
 * browser; nobody has decided about it. This is a decision already made — the words are final and
 * the only open question is when — so it is a row on the server, where it will still be at nine
 * whatever happened to the laptop. Cancelling one is deleting the row; it is the author's alone
 * until it goes, because a message that has not been sent has not been said.
 */
export const scheduled = ref([])

export async function loadScheduled() {
  if (!on()) return []
  scheduled.value = (await rpc('space_scheduled_mine')) || []
  return scheduled.value
}

export async function sendLater(channelId, body, when, { thread = null } = {}) {
  if (!on() || !channelId) return { error: 'no room' }
  const at = when instanceof Date ? when.toISOString() : String(when)
  const { data, error } = await supabase.rpc('space_schedule', {
    p_channel: channelId, p_body: String(body || ''), p_at: at, p_thread: thread,
  })
  if (error) return { error: error.message }
  await loadScheduled()
  return data || {}
}

/* taking one back. The policy is the same rule: theirs and nobody else's. */
export async function unschedule(id) {
  if (!on() || !id) return
  await supabase.from('space_scheduled').delete().eq('id', id)
  scheduled.value = scheduled.value.filter((s) => s.id !== id)
}
