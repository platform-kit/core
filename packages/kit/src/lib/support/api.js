/*
 * The support chat's state and its traffic, for the contact's side — the widget on the public
 * site. Everything goes through the `support` Edge Function (never the tables: a guest has no
 * row-level identity), with the session's JWT when there is one and, for a guest, the contact
 * token the first message earned, kept in raw localStorage under dl.support.token — outside
 * the Loro store on purpose, since that is thrown away at sign-out and synced across devices,
 * and a guest's token must be neither. A guest who signs in sends both once: the function
 * links or merges the guest contact into the account's and says so, and the token is dropped.
 *
 * A contact is live through a secret topic: every thread carries a listen key (the function hands it
 * to its owner), the database broadcasts a wake-up on support:<key> whenever a line lands or the
 * thread moves, and the widget fetches what is new through the function — the broadcast carries
 * no words. Polling stays underneath as the fallback, slow (every half minute), for a channel that
 * never comes up. Sending is
 * optimistic, as the coaching chat's is; the rules of what a row means are the coaching chat's
 * model.js, with the author standing in for the sender id.
 */
import { reactive, ref, watch } from 'vue'
import { supabase, configured, url as supabaseUrl } from '../supabase.js'
import { session, beforeSignOut, onIdentity } from '../auth.js'
import { anonId, capture } from '../analytics.js'
import { mergeMessages } from '../chat/model.js'

const TOKEN_KEY = 'dl.support.token'
const ACTIVE_KEY = 'dl.support.active'     /* "this browser has written before": boot asks for the threads */
const POLL_OPEN = 4000, POLL_LIST = 30000, POLL_LIVE = 30000
export const ME = 'contact'

const on = () => !!(supabase && configured)
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' } }
const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch (e) { /* private mode */ } }
const flag = (k, v) => { try { if (v) localStorage.setItem(k, '1'); else localStorage.removeItem(k) } catch (e) { /* private mode */ } }
const has = (k) => { try { return !!localStorage.getItem(k) } catch (e) { return false } }

export const panelOpen = ref(false)
export const contact = ref(null)             /* { id, signed_in, name, email, verified } — the last three from the account, else null */
export const conversations = ref([])         /* the contact's threads, latest first */
export const unread = ref(0)
export const booted = ref(false)
export const staff = ref(false)   /* the signed-in reader is on the desk: no widget for them */
/* the bot a contact may be offered on this desk, as the server described it: { slug, name, offer }
   where offer is 'ask' (they press a button) or 'always' (it answers by itself). Null for none. */
export const bot = ref(null)
export const thread = reactive({ id: null, messages: [], conversation: null, loading: false, error: null })

/* rows as the chat model reads them: the author stands in for the sender */
/* where the site is, seen from the page carrying the widget: empty on the site itself (a path is a path), the site's
   address under the snippet on another origin, where a path of ours would otherwise resolve against their host */
let base = ''
export const setSiteBase = (u) => { base = String(u || '').replace(/\/+$/, '') }
/* a path of the site's own — a prompt's picture, an upload — against the site */
export const siteUrl = (u) => (u && u.startsWith('/') && !u.startsWith('//') ? base + u : u)
/* the function signs a bucket url as a path under the project's host; the site's own paths go to the site */
const fullUrl = (u) => (u && u.startsWith('/storage/') ? supabaseUrl.replace(/\/+$/, '') + u : siteUrl(u))
const asRow = (m) => ({ ...m, sender_id: m.author, kind: m.kind || 'text', url: fullUrl(m.url) })

async function call(action, body = {}, file = null) {
  if (!on()) throw new Error('offline')
  const headers = {}
  const t = getToken()
  if (t) headers['x-support-token'] = t
  let payload = { action, path: location.pathname, anon_id: anonId(), ...body }
  /* a file goes up as a form; supabase-js sends a FormData as multipart */
  if (file) { const fd = new FormData(); for (const [k, v] of Object.entries(payload)) if (v != null) fd.append(k, String(v)); fd.append('file', file, file.name || 'file'); payload = fd }
  const { data, error } = await supabase.functions.invoke('support', { body: payload, headers })
  if (error) {
    /* the function's own answer rides on the error: a refused token, a thread already open */
    let j = null
    try { j = error.context && typeof error.context.json === 'function' ? await error.context.json() : null } catch (e) { /* not json */ }
    const status = error.context && error.context.status
    if (status === 401 && j && (j.error === 'token' || j.error === 'signin')) { setToken(''); }
    const err = new Error((j && j.error) || error.message || 'failed')
    err.status = status; err.data = j
    throw err
  }
  return data
}

function countUnread() { unread.value = conversations.value.reduce((n, c) => n + (Number(c.unread) || 0), 0) }
function take(hello) {
  contact.value = hello.contact || null
  conversations.value = hello.conversations || []
  staff.value = !!hello.staff
  /* what the server says is on offer here — the widget never reads a bot's file */
  if (hello.bot !== undefined) bot.value = hello.bot || null
  if (hello.linked) setToken('')
  flag(ACTIVE_KEY, conversations.value.length > 0)
  countUnread()
}

/* who I am and my threads — asked only when this browser has history (a token, the flag) or
   a session, so a fresh guest costs nothing until they write */
let hello = null
export async function boot() {
  if (!on()) return
  if (!getToken() && !has(ACTIVE_KEY) && !session.value) { booted.value = true; return }
  try { take(await call('hello')) } catch (e) { /* offline, or a token the server no longer knows */ }
  booted.value = true
}
export async function refreshList() {
  if (!on() || (!getToken() && !session.value && !has(ACTIVE_KEY))) return
  try { take(await call('hello')) } catch (e) { /* keep what we had */ }
}

/* ---- the open thread's channel: a wake-up, then a fetch ---- */
let channel = null, live = false, wakeTimer = null
function listen(conv) {
  if (!conv || !conv.listen_key || !supabase) return
  const topic = 'support:' + conv.listen_key
  if (channel && channel.topic === 'realtime:' + topic) return
  unlisten()
  channel = supabase.channel(topic, { config: { broadcast: { self: false }, private: false } })
    /* a line and the thread's own move arrive as two nudges a moment apart: one fetch */
    .on('broadcast', { event: '*' }, () => { if (thread.id !== conv.id) return; clearTimeout(wakeTimer); wakeTimer = setTimeout(poll, 80) })
    .subscribe((status) => { live = status === 'SUBSCRIBED'; if (live) poll(); schedule() })
}
function unlisten() { if (channel) { try { supabase.removeChannel(channel) } catch (e) { /* gone */ } channel = null } live = false }

/* ---- the open thread ---- */
export async function openThread(id) {
  if (!id) return
  if (thread.id !== id) { thread.id = id; thread.messages = []; thread.conversation = null; thread.error = null }
  thread.loading = true
  try {
    const r = await call('messages', { conversation_id: id })
    if (thread.id !== id) return
    thread.conversation = r.conversation
    thread.messages = mergeMessages([], (r.messages || []).map(asRow))
    markRead()
    listen(r.conversation)
  } catch (e) {
    /* THE THREAD IS GONE — resolved away, purged by the desk, or removed while this tab had it
       open. Sitting on a dead id means every send fails and nothing says why, which reads as a
       widget that has stopped working. Let it go and put them back where they can simply type. */
    if (/404|no such conversation/i.test(String(e && e.message))) {
      thread.id = null; thread.messages = []; thread.conversation = null; thread.error = null
      conversations.value = conversations.value.filter((c) => c.id !== id)
    } else thread.error = e.message
  }
  thread.loading = false
  schedule()
}
export function closeThread() { unlisten(); thread.id = null; thread.messages = []; thread.conversation = null; schedule() }

let polling = false, pollAgain = false
async function poll() {
  if (!thread.id) return
  if (polling) { pollAgain = true; return }
  polling = true
  try { await pollOnce() } finally { polling = false; if (pollAgain) { pollAgain = false; poll() } }
}
async function pollOnce() {
  const id = thread.id
  const last = thread.messages[thread.messages.length - 1]
  try {
    const r = await call('messages', { conversation_id: id, since: last ? last.created_at : undefined })
    if (thread.id !== id) return
    thread.conversation = r.conversation
    if (r.messages && r.messages.length) {
      thread.messages = mergeMessages(thread.messages, r.messages.map(asRow))
      const agent = r.messages.filter((m) => m.author === 'agent').pop()
      if (agent) { markRead(); const c = conversations.value.find((x) => x.id === id); if (c) { c.last = agent; c.last_message_at = agent.created_at; if (agent.agent_name) c.agent_name = agent.agent_name } }
    }
  } catch (e) { /* next time */ }
}

let timer = null
function schedule() {
  clearTimeout(timer); timer = null
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  const wait = thread.id && panelOpen.value ? (live ? POLL_LIVE : POLL_OPEN) : POLL_LIST
  const active = thread.id || getToken() || session.value || has(ACTIVE_KEY)
  if (!active) return
  timer = setTimeout(async () => { if (thread.id && panelOpen.value) await poll(); else await refreshList(); schedule() }, wait)
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (thread.id) poll(); else refreshList(); } schedule() })
watch(panelOpen, schedule)

/* the reader has seen the thread: the server's cursor, and the badge */
let readTimer = null
export function markRead() {
  const id = thread.id
  if (!id) return
  const row = conversations.value.find((c) => c.id === id)
  if (row && row.unread) { row.unread = 0; countUnread() }
  clearTimeout(readTimer)
  readTimer = setTimeout(() => { call('read', { conversation_id: id }).catch(() => {}) }, 300)
}

/* ---- writing ---- */
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random())

/* a new thread — a guest's first (anonymous: a guest types no name and no address; the account is
   the identity, and the panel offers the site's sign-in for it), or another, or a prompt's answer */
export async function start({ body, prompt_id, choice, attach }) {
  const text = String(body || '').trim()
  if (!text && !choice && !attach) return null
  const r = await call('start', { body: text, prompt_id, choice, attach: attach ? 1 : undefined })
  if (r.token) setToken(r.token)
  contact.value = r.contact || contact.value
  const conv = { ...r.conversation, last: r.messages[r.messages.length - 1], unread: 0 }
  conversations.value = [conv].concat(conversations.value.filter((c) => c.id !== conv.id))
  flag(ACTIVE_KEY, true)
  thread.id = conv.id; thread.conversation = r.conversation; thread.messages = mergeMessages([], r.messages.map(asRow)); thread.error = null
  listen(r.conversation)
  schedule()
  return conv.id
}

/* a line — words, or one of the prompt's choices by its key (its words are the line) */
export async function send(body, { prompt_id, choice, offer, text: shown } = {}) {
  const text = String(body || shown || '').trim()
  if (!thread.id || (!text && !choice)) return null
  const row = { id: newId(), author: ME, sender_id: ME, kind: 'text', body: text, created_at: new Date().toISOString(), pending: true }
  thread.messages = mergeMessages(thread.messages, [row])
  /* and the offer is taken here and now, so the buttons go with the press rather than a beat later
     when the server answers — the row the server sends back says the same thing */
  if (offer) thread.messages = thread.messages.map((m) => (m.id === offer ? { ...m, choice_at: row.created_at, choice_key: choice } : m))
  /* A PRESS IS AN ACT, like a prompt's choice: who, what, and on which answer. Without it the one
     thing a bot's choices are for — knowing which of the ways forward people actually take — is a
     click that vanished. */
  if (offer) { const m = thread.messages.find((x) => x.id === offer); capture('bot_choice', { surface: 'support', bot: (m && m.bot) || null, choice, text: String(shown || ''), conversation: thread.id }) }
  try {
    /* an offer a BOT made is taken by naming its message: the row says what the words are, so a
       client cannot put a sentence in somebody's mouth and start a run with it */
    const r = await call('send', offer ? { conversation_id: thread.id, offer, choice }
      : choice ? { conversation_id: thread.id, prompt_id, choice }
      : { conversation_id: thread.id, body: text })
    thread.messages = mergeMessages(thread.messages.filter((m) => m.id !== row.id), [asRow(r.message)].concat((r.extra || []).map(asRow)))
    thread.conversation = r.conversation
    const c = conversations.value.find((x) => x.id === thread.id)
    if (c) { const last = (r.extra || [])[0] || r.message; c.last = last; c.last_message_at = last.created_at; c.status = r.conversation.status }
    conversations.value = conversations.value.slice().sort((a, b) => new Date(b.last_message_at || b.created_at) - new Date(a.last_message_at || a.created_at))
    return r.message.id
  } catch (e) {
    thread.messages = thread.messages.filter((m) => m.id !== row.id)
    /* the same: a thread that has gone takes its id with it rather than failing for ever */
    if (/404|no such conversation/i.test(String(e && e.message))) {
      const gone = thread.id
      thread.id = null; thread.messages = []; thread.conversation = null
      conversations.value = conversations.value.filter((c) => c.id !== gone)
    }
    throw e
  }
}

/*
 * THE TWO BUTTONS.
 *
 * askBot: for a bot offered as `ask`, nothing runs until somebody presses. It answers whether a run
 * actually started, because it may be refused — the bot may not serve this person, or they may have
 * spent what they are allowed — and a button that appears to do nothing is worse than one that says
 * it cannot.
 *
 * wantHuman: available whenever a bot is in play, and it is a ROW rather than a request the bot is
 * asked to honour. Once it is set, nothing starts a run on this thread again until a person has it.
 * A bot you cannot get away from is a bad bot.
 */
export async function askBot() {
  if (!thread.id) return false
  const r = await call('bot', { conversation_id: thread.id })
  return !!(r && r.started)
}

export async function wantHuman() {
  if (!thread.id) return
  const r = await call('human', { conversation_id: thread.id })
  if (r && r.conversation) {
    thread.conversation = r.conversation
    const c = conversations.value.find((x) => x.id === thread.id)
    if (c) c.bot_off_at = r.conversation.bot_off_at
  }
}

/* their own question answered, by their own say-so. Writing again reopens it. */
export async function markSorted() {
  if (!thread.id) return
  const r = await call('sorted', { conversation_id: thread.id })
  if (r && r.conversation) {
    thread.conversation = r.conversation
    const c = conversations.value.find((x) => x.id === thread.id)
    if (c) c.status = r.conversation.status
  }
}

/* my own line taken back: a placeholder stays */
export async function withdraw(id) {
  if (!thread.id || !id) return
  const at = new Date().toISOString()
  thread.messages = mergeMessages(thread.messages, [{ id, deleted_at: at, body: null, url: null, attachment_path: null }])
  await call('withdraw', { message_id: id }).catch(() => {})
}
/* I am writing: said at most every few seconds, so the desk can show it */
let typedAt = 0
export function typing() {
  if (!thread.id || Date.now() - typedAt < 2500) return
  typedAt = Date.now()
  call('typing', { conversation_id: thread.id }).catch(() => {})
}
/* the desk is writing: within the last few seconds */
export const agentTyping = () => { const t = thread.conversation && thread.conversation.agent_typing_at; return !!t && Date.now() - new Date(t).getTime() < 5000 }

/* a voice note or a file in the open thread: a placeholder row while it goes up (a voice note
   plays from its blob meanwhile), the server's row in its place */
export async function upload(file, { kind = 'file', seconds = 0, transcript = '' } = {}) {
  if (!thread.id || !file) return null
  const row = { id: newId(), author: ME, sender_id: ME, kind, body: kind === 'file' ? file.name : (transcript || null), attachment_name: file.name, attachment_type: file.type, seconds, blob: kind === 'voice' ? file : null, url: kind === 'file' ? URL.createObjectURL(file) : null, created_at: new Date().toISOString(), pending: true }
  thread.messages = mergeMessages(thread.messages, [row])
  try {
    const r = await call('upload', { conversation_id: thread.id, kind, seconds: kind === 'voice' ? seconds : undefined, transcript: transcript || undefined }, file)
    thread.messages = mergeMessages(thread.messages.filter((m) => m.id !== row.id), [asRow({ ...r.message, blob: row.blob })].concat((r.extra || []).map(asRow)))
    thread.conversation = r.conversation
    const c = conversations.value.find((x) => x.id === thread.id)
    if (c) { c.last = r.message; c.last_message_at = r.message.created_at; c.status = r.conversation.status }
    return r.message.id
  } catch (e) {
    thread.messages = thread.messages.filter((m) => m.id !== row.id)
    throw e
  }
}

/* the panel: opened on a thread from the away email's link (?support=<id>) */
export function open(id) {
  panelOpen.value = true
  if (id) openThread(id)
}
export function close() { panelOpen.value = false }
/* the guest forgotten, as $chatwidget.reset does: the token dropped, the panel closed, nothing else (an account signs out on its own) */
export function forget() { closeThread(); conversations.value = []; contact.value = null; unread.value = 0; panelOpen.value = false; flag(ACTIVE_KEY, false); setToken(''); try { sessionStorage.removeItem('dl.support.nudge') } catch (e) { /* private mode */ } }
export const token = () => getToken()

/* a session arriving (a sign-in, a sign-up) links the guest's threads to the account */
watch(session, (s, was) => { if (s && !was && booted.value) refreshList() })
/* signing out leaves the device as a fresh guest: no threads, no token (a linked account's token is
   already gone; one that never linked goes too — the next person here must not find the last one's
   conversations), nothing that says there is history; auth.js then resets the store and reloads */
beforeSignOut.push(forget)
/*
 * The other half — and it is NOT forget(), which would be a bug.
 *
 * A guest has threads here too, kept against a token in raw localStorage rather than an account,
 * and forget() drops that token: right when somebody signs out (they become a fresh guest), wrong
 * on every other occasion. The broadcast also fires on a first load, when the identity has merely
 * become known rather than changed — and wiping the token there would lose a returning guest's
 * threads every time they opened the site.
 *
 * So this clears what is on screen and re-reads; whose threads those are is boot()'s question, and
 * linking a guest's contact to an account is the function's. The token is only ever dropped by a
 * deliberate sign-out.
 */
onIdentity(() => {
  closeThread(); conversations.value = []; contact.value = null; unread.value = 0
  boot()
})

/* ------------------------------------------------------------------ the contact's own tickets
 *
 * A ticket is not a chat, and the widget says so: a conversation is something you are having, a
 * ticket is something somebody owes you. A person should be able to see how theirs is going
 * without writing in to ask — which is the whole of what a customer wants from a ticket system.
 *
 * Everything here goes through the function, scoped to this contact, because a contact (a guest
 * especially) has no row-level identity for RLS to hang on. The desk's internal notes are filtered
 * in the query there, never here.
 */
export const tickets = ref([])
export const ticket = reactive({ id: null, row: null, timeline: [], loading: false, error: null })

export async function loadTickets() {
  const out = await call('tickets')
  tickets.value = (out && out.tickets) || []
  return tickets.value
}
/* how many are still going — the number on the widget's own tab */
export const openTickets = () => tickets.value.filter((t) => !['resolved', 'closed'].includes(t.status)).length

export async function openTicket(id) {
  ticket.id = id
  ticket.loading = true
  ticket.error = null
  const out = await call('ticket', { ticket_id: id })
  ticket.loading = false
  if (!out || out.error) { ticket.error = (out && out.error) || 'error'; return null }
  ticket.row = out.ticket
  ticket.timeline = out.timeline || []
  return out
}
export function closeTicket() { ticket.id = null; ticket.row = null; ticket.timeline = [] }

export async function sayOnTicket(body) {
  const said = String(body || '').trim()
  if (!said || !ticket.id) return false
  const out = await call('ticket_say', { ticket_id: ticket.id, body: said })
  if (!out || out.error) return false
  await openTicket(ticket.id)
  await loadTickets()
  return true
}

export async function raiseTicket({ title, body }) {
  const out = await call('ticket_open', { title, body })
  if (!out || out.error) return out || { error: 'error' }
  await loadTickets()
  await openTicket(out.id)
  return out
}
