<script setup>
/*
 * The support inbox — everyone who has written in through the widget, guest or reader, and
 * the prompts they answered — for the staff (an admin, or the support role). The rows come
 * from support_inbox() under the agent's own session (RLS: staff only) and move as the tables
 * move (realtime on support_conversations and support_messages). Two panes: the threads,
 * narrowed by status, by who they are (a guest, a reader, a customer), by whose they are and
 * whether they are unread, in the order chosen — longest waiting first, or by activity — and
 * the open thread with the contact's card — who they are from the ACCOUNT alone: a guest is
 * anonymous and says so, a reader's address is marked until it has answered the app's
 * confirmation, and nothing typed into the chat is ever shown as a fact — the reply box, and what can be done with it:
 * assign, mark pending, resolve, reopen. A reply is an insert under RLS and then a word to
 * the support function, which emails the contact if they are away. The staff are told here,
 * not by email: the inbox stamps the agent's presence (support_agents_seen, every minute while
 * open — the function's escalation stays quiet while someone is at the desk) and, if the agent
 * asks (Alert me: the browser's own permission), raises a notification and a short tone for a
 * contact's line that arrives while the tab is hidden or another thread is open. Ships to production
 * under Engagement → Support of the one admin shell, in production and the CMS alike. Words are
 * content/app/ui/support.md (admin).
 */
import { ref, computed, reactive, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { supabase, configured } from '@platform-kit/kit/lib/supabase.js'
import { session, isSignedIn, isStaff, roleKnown } from '@platform-kit/kit/lib/auth.js'
import { daySections, groupRuns, previewOf, whenOf, spanOf, sortInbox, mergeMessages } from '@platform-kit/kit/lib/chat/model.js'
import ChatBubble from './chat/ChatBubble.vue'
import ChatAvatar from './chat/ChatAvatar.vue'
import SupportComposer from './support/SupportComposer.vue'
import AdminHead from './admin/AdminHead.vue'

const props = defineProps({ name: { type: String, default: '' } })   /* a conversation id in the path */
const emit = defineEmits(['open'])
const A = us('support').admin
const H = A.head, FL = A.filters, R = A.row, T = A.thread
const CANNED = Object.entries(us('support').canned || {}).map(([key, r]) => ({ key, title: r.title, text: r.text })).filter((c) => c.text)
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const uid = () => (session.value && session.value.user && session.value.user.id) || null
const ME = 'agent'

const state = ref('idle')      /* idle | loading | ok | denied | error */
const rows = ref([])
const agents = ref([])
let channel = null, refreshTimer = null

/* the filters, remembered per browser */
const PREF = 'dl.support.inbox'
const read = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}') } catch (e) { return {} } }
const f = reactive({ status: 'open', who: 'all', assignee: 'all', unread: false, sort: 'waiting', ...read() })
watch(f, () => { try { localStorage.setItem(PREF, JSON.stringify({ ...f })) } catch (e) { /* private mode */ } })

async function load() {
  if (!configured || !isSignedIn.value) { state.value = 'idle'; rows.value = []; return }
  if (roleKnown.value && !isStaff.value) { state.value = 'denied'; return }
  if (state.value !== 'ok') state.value = 'loading'
  const { data, error } = await supabase.rpc('support_inbox', { p_status: null, p_limit: 500 })
  if (error) { state.value = /permission|denied/i.test(error.message || '') ? 'denied' : 'error'; return }
  if (data === null) { state.value = 'denied'; return }
  rows.value = data || []
  state.value = 'ok'
  if (!agents.value.length) { const { data: ag } = await supabase.rpc('support_agents'); agents.value = ag || [] }
  listen()
}
const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(load, 250) }

/* ---- presence: I am at the desk ---- */
const SEEN_MS = 60 * 1000
let seenTimer = null
async function seen() {
  if (!uid() || !isStaff.value || document.visibilityState !== 'visible') return
  await supabase.from('support_agents_seen').upsert({ user_id: uid(), last_seen_at: new Date().toISOString() })
}
function startSeen() { if (seenTimer) return; seen(); seenTimer = setInterval(seen, SEEN_MS) }

/* ---- alerts: the browser's notification and a short tone, on the agent's say-so ---- */
const ALERT_KEY = 'dl.support.alerts'
const alerts = ref(false)
const alertState = computed(() => (typeof Notification === 'undefined' ? 'none' : Notification.permission))
try { alerts.value = localStorage.getItem(ALERT_KEY) === '1' && alertState.value === 'granted' } catch (e) { /* private mode */ }
async function toggleAlerts() {
  if (alerts.value) { alerts.value = false; try { localStorage.setItem(ALERT_KEY, '0') } catch (e) { /* */ } return }
  if (typeof Notification === 'undefined') return
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (p === 'granted') { alerts.value = true; try { localStorage.setItem(ALERT_KEY, '1') } catch (e) { /* */ } tone() }
}
function tone() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    const o = ac.createOscillator(), g = ac.createGain()
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.0001
    o.connect(g); g.connect(ac.destination); o.start()
    g.gain.exponentialRampToValueAtTime(0.08, ac.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35)
    o.stop(ac.currentTime + 0.4)
  } catch (e) { /* no audio */ }
}
function alert(row) {
  if (!alerts.value) return
  if (document.visibilityState === 'visible' && thread.id === row.conversation_id) return
  tone()
  try {
    const r = rows.value.find((x) => x.id === row.conversation_id)
    const n = new Notification(H['alert-title'], { body: (r ? nameOf(r.contact) : H['alert-guest']) + ': ' + String(row.body || '').slice(0, 120), tag: row.conversation_id })
    n.onclick = () => { window.focus(); open(row.conversation_id); n.close() }
  } catch (e) { /* the browser refused */ }
}
function listen() {
  if (channel || !supabase) return
  channel = supabase.channel('support:inbox')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, (p) => {
      if (p.new && thread.id === p.new.id) thread.conversation = { ...thread.conversation, ...p.new }
      /* a keystroke on the other side is not worth a reload */
      if (p.new && p.old && p.new.contact_typing_at !== p.old.contact_typing_at && p.new.last_message_at === p.old.last_message_at && p.new.status === p.old.status && p.new.assignee_id === p.old.assignee_id) { const r = rows.value.find((x) => x.id === p.new.id); if (r) r.contact_typing_at = p.new.contact_typing_at; return }
      refresh()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, ({ new: row }) => {
      if (thread.id === row.conversation_id) { withUrls([asRow(row)]).then((r) => { if (thread.id === row.conversation_id) { thread.messages = mergeMessages(thread.messages, r); toFoot() } }); if (row.author === 'contact') markRead() }
      if (row.author === 'contact') alert(row)
      refresh()
    })
    /* a guest signing in links their contact to the account: who they are changes without a line being written */
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_contacts' }, refresh)
    .subscribe()
  /* an address confirmed is on the profile, which no channel carries here: read again on return to the tab */
  document.addEventListener('visibilitychange', onVisible)
  startSeen()
}
function onVisible() { if (document.visibilityState === 'visible' && state.value === 'ok') { refresh(); seen() } }
onMounted(load)
watch([isSignedIn, roleKnown, isStaff], load)
onBeforeUnmount(() => { if (channel) supabase.removeChannel(channel); channel = null; clearTimeout(refreshTimer); clearInterval(seenTimer); seenTimer = null; document.removeEventListener('visibilitychange', onVisible) })

/* ---- the list ---- */
const counts = computed(() => ({ all: rows.value.length, open: rows.value.filter((r) => r.status === 'open').length, pending: rows.value.filter((r) => r.status === 'pending').length, resolved: rows.value.filter((r) => r.status === 'resolved').length }))
/* the search: names, addresses and notes on the rows in hand at once; every line by the server, a beat later */
const q = ref(''), hits = ref(null), searching = ref(false)
let qTimer = null
watch(q, (v) => { clearTimeout(qTimer); const t = v.trim(); if (t.length < 2) { hits.value = null; searching.value = false; return } searching.value = true; qTimer = setTimeout(async () => { const { data } = await supabase.rpc('support_search', { q: t, lim: 200 }); hits.value = new Set(data || []); searching.value = false }, 300) })
const matches = (r) => { const t = q.value.trim().toLowerCase(); if (t.length < 2) return true; const k = r.contact || {}; return (hits.value && hits.value.has(r.id)) || String(k.name || '').toLowerCase().includes(t) || String(k.email || '').toLowerCase().includes(t) || String(k.notes || '').toLowerCase().includes(t) || preview(r).toLowerCase().includes(t) }
const shown = computed(() => {
  let list = rows.value.filter((r) => matches(r) && (f.status === 'all' || r.status === f.status)
    && (f.who === 'all' || r.contact.kind === f.who)
    && (f.assignee === 'all' || (f.assignee === 'mine' ? r.assignee_id === uid() : !r.assignee_id))
    && (!f.unread || r.unread > 0))
  /* the model's "awaiting" order reads awaiting_since */
  return sortInbox(list.map((r) => ({ ...r, awaiting_since: r.waiting_since })), f.sort === 'waiting' ? 'awaiting' : 'activity')
})
const now = ref(Date.now())
let clock = setInterval(() => { now.value = Date.now() }, 30000)
onBeforeUnmount(() => clearInterval(clock))
const waiting = (r) => (r.waiting_since ? fill(R.waiting, { span: spanOf(now.value - new Date(r.waiting_since).getTime()) }) : '')
const when = (d) => whenOf(d, now.value, { yesterday: H.yesterday })
const kindWord = (k) => R[k] || k
/* a guest has no name — nothing is known about them; a reader's comes from the account */
const nameOf = (c) => (c && c.name) || R.anonymous
const unverified = (c) => !!(c && c.user_id && !c.verified)
const preview = (r) => previewOf(r.last, { deleted: T.withdrawn })

/* ---- the open thread ---- */
const thread = reactive({ id: null, conversation: null, messages: [], loading: false })
const scroller = ref(null)
const asRow = (m) => ({ ...m, sender_id: m.author, kind: m.kind || 'text' })
/* an attachment's url: the site's own for a prompt's picture, the bucket's signed (an hour) otherwise */
const signed = new Map()
async function withUrls(rows) {
  const out = []
  for (const m of rows) {
    if (!m.attachment_path) { out.push(m); continue }
    if (/^(https?:)?\//.test(m.attachment_path)) { out.push({ ...m, url: m.attachment_path }); continue }
    if (!signed.has(m.attachment_path)) {
      const { data } = await supabase.storage.from('support').createSignedUrl(m.attachment_path, 3600)
      signed.set(m.attachment_path, (data && data.signedUrl) || null)
    }
    out.push({ ...m, url: signed.get(m.attachment_path) })
  }
  return out
}
const current = computed(() => rows.value.find((r) => r.id === thread.id) || null)
function toFoot() { nextTick(() => { const el = scroller.value; if (el) el.scrollTop = el.scrollHeight }) }
async function open(id) {
  if (!id) return
  thread.id = id; thread.messages = []; thread.loading = true
  const { data } = await supabase.from('support_messages').select('*').eq('conversation_id', id).order('created_at', { ascending: true }).limit(500)
  if (thread.id !== id) return
  thread.messages = mergeMessages([], await withUrls((data || []).map(asRow)))
  thread.loading = false
  markRead(); toFoot()
  emit('open', id)
}
watch(() => props.name, (n) => { if (n && n !== thread.id && /^[0-9a-f-]{36}$/i.test(n)) open(n) }, { immediate: true })
watch(state, (s) => { if (s === 'ok' && props.name && !thread.id) open(props.name) })
function markRead() {
  const r = current.value
  if (!r || !thread.id) return
  const last = thread.messages[thread.messages.length - 1]
  if (!last) return
  if (r.agent_read_at && new Date(r.agent_read_at) >= new Date(last.created_at)) return
  const at = new Date().toISOString()
  r.agent_read_at = at; r.unread = 0
  supabase.from('support_conversations').update({ agent_read_at: at }).eq('id', thread.id).then(() => {})
}
const sections = computed(() => daySections(thread.messages, now.value, { today: H.today, yesterday: H.yesterday }).map((s) => ({ ...s, messages: groupRuns(s.messages) })))
/* a system line after the contact's is the desk's acknowledgement, not the prompt */
const isAck = (m) => { const i = thread.messages.findIndex((x) => x.id === m.id); return i > 0 && thread.messages[i - 1].author === 'contact' }
const contactReadAt = computed(() => (current.value && current.value.contact_read_at) || null)

const busy = ref(false), said = ref('')
async function reply(text) {
  if (!thread.id || !text) return
  busy.value = true; said.value = ''
  const id = crypto.randomUUID()
  const row = { id, conversation_id: thread.id, author: ME, sender_id: ME, kind: 'text', agent_id: uid(), body: text, created_at: new Date().toISOString(), pending: true }
  thread.messages = mergeMessages(thread.messages, [row])
  const { error } = await supabase.from('support_messages').insert({ id, conversation_id: thread.id, author: 'agent', agent_id: uid(), body: text })
  if (error) { thread.messages = thread.messages.filter((m) => m.id !== id); said.value = error.message; busy.value = false; return }
  thread.messages = mergeMessages(thread.messages, [{ ...row, pending: false }])
  toFoot()
  try { const { data } = await supabase.functions.invoke('support', { body: { action: 'notify', message_id: id } }); if (data && data.sent) said.value = T['notify-sent'] } catch (e) { /* a courtesy */ }
  busy.value = false
}
const MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf', 'text/plain': 'txt' }
async function sendFile(file, { kind = 'file', seconds = 0, transcript = '' } = {}) {
  if (!thread.id || !file) return
  const type = kind === 'voice' ? 'audio/mpeg' : String(file.type || '').toLowerCase()
  const ext = MIME[type]
  if (!ext) { said.value = T['not-allowed']; return }
  if (file.size > 10 * 1024 * 1024) { said.value = T['too-big']; return }
  busy.value = true; said.value = ''
  const id = crypto.randomUUID(), path = thread.id + '/' + id + '.' + ext
  const name = kind === 'voice' ? 'voice.mp3' : file.name
  const row = { id, conversation_id: thread.id, author: ME, sender_id: ME, kind, agent_id: uid(), body: kind === 'file' ? name : (transcript || null), attachment_path: path, attachment_type: type, attachment_name: name, attachment_size: file.size, seconds: kind === 'voice' ? seconds : null, blob: kind === 'voice' ? file : null, url: kind === 'file' ? URL.createObjectURL(file) : null, created_at: new Date().toISOString(), pending: true }
  thread.messages = mergeMessages(thread.messages, [row])
  const up = await supabase.storage.from('support').upload(path, file, { contentType: type, cacheControl: '31536000', upsert: false })
  if (up.error) { thread.messages = thread.messages.filter((m) => m.id !== id); said.value = up.error.message; busy.value = false; return }
  const { error } = await supabase.from('support_messages').insert({ id, conversation_id: thread.id, author: 'agent', agent_id: uid(), kind, body: row.body, attachment_path: path, attachment_type: type, attachment_name: name, attachment_size: file.size, seconds: row.seconds })
  if (error) { thread.messages = thread.messages.filter((m) => m.id !== id); said.value = error.message; busy.value = false; return }
  thread.messages = mergeMessages(thread.messages, [{ ...row, pending: false }])
  toFoot()
  try { const { data } = await supabase.functions.invoke('support', { body: { action: 'notify', message_id: id } }); if (data && data.sent) said.value = T['notify-sent'] } catch (e) { /* a courtesy */ }
  busy.value = false
}
/* a private note on the contact, saved when the field is left */
const noteSaved = ref('')
async function saveNote(e) {
  const r = current.value; if (!r) return
  const notes = String(e.target.value || '').trim() || null
  if ((r.contact.notes || null) === notes) return
  r.contact.notes = notes
  const { error } = await supabase.from('support_contacts').update({ notes }).eq('id', r.contact.id)
  noteSaved.value = error ? error.message : T['notes-saved']
  setTimeout(() => { noteSaved.value = '' }, 2000)
}
/* a canned reply into the box */
const composer = ref(null)
const cannedOpen = ref(false)
function canned(c) { cannedOpen.value = false; if (composer.value && composer.value.insert) composer.value.insert(c.text) }
/* the transcript, as a text file */
function exportThread() {
  const r = current.value; if (!r) return
  const who = (m) => (m.author === 'contact' ? nameOf(r.contact) : m.author === 'agent' ? (m.agent_name || agentNameOf(m.agent_id) || R.you) : T.system)
  const lines = thread.messages.map((m) => `[${new Date(m.created_at).toLocaleString()}] ${who(m)}: ${m.deleted_at ? T.withdrawn : m.kind === 'text' ? m.body : (m.attachment_name || m.kind)}`)
  const blob = new Blob([`${nameOf(r.contact)}${r.contact.email ? ' <' + r.contact.email + '>' : ''}\n${new Date(r.created_at).toLocaleString()}\n\n` + lines.join('\n') + '\n'], { type: 'text/plain' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'support-' + r.id.slice(0, 8) + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  said.value = T['export-done']
}
const agentNameOf = (id) => { const a = agents.value.find((x) => x.id === id); return a ? a.name : '' }
/* a thread and its files, gone */
async function deleteThread() {
  const r = current.value; if (!r || !window.confirm(T['delete-confirm'])) return
  const { error } = await supabase.functions.invoke('support', { body: { action: 'purge', conversation_id: r.id } })
  if (error) { said.value = error.message; return }
  rows.value = rows.value.filter((x) => x.id !== r.id); thread.id = null; thread.messages = []
}
/* my own line, taken back */
async function takeBack(id) {
  thread.messages = mergeMessages(thread.messages, [{ id, deleted_at: new Date().toISOString(), body: null, url: null, attachment_path: null }])
  await supabase.functions.invoke('support', { body: { action: 'withdraw', message_id: id } }).catch(() => {})
}
/* I am writing: stamped every few seconds; the contact is: read off the row */
let typedAt = 0
function typing() { if (!thread.id || Date.now() - typedAt < 2500) return; typedAt = Date.now(); supabase.from('support_conversations').update({ agent_typing_at: new Date().toISOString() }).eq('id', thread.id).then(() => {}) }
const contactTyping = computed(() => { void now.value; const r = current.value; const t = r && (thread.conversation && thread.conversation.contact_typing_at || r.contact_typing_at); return !!t && Date.now() - new Date(t).getTime() < 5000 })
onMounted(() => { const t = setInterval(() => { now.value = Date.now() }, 1000); onBeforeUnmount(() => clearInterval(t)) })
async function setStatus(status) { if (!thread.id) return; await supabase.from('support_conversations').update({ status }).eq('id', thread.id); refresh() }
async function assign(to) { if (!thread.id) return; await supabase.from('support_conversations').update({ assignee_id: to || null }).eq('id', thread.id); refresh() }
function openAuth() { if (window.DLauth) window.DLauth.open() }
</script>

<template>
  <div class="ui-page su">
    <AdminHead :title="H.title" :sub="H.subtitle">
      <template #actions>
        <div v-if="state === 'ok'" class="su-tools">
          <input v-model="q" type="search" class="su-search" :placeholder="FL.search" :aria-label="FL.search" />
          <div class="su-seg" role="tablist">
            <button v-for="s in ['open', 'pending', 'resolved', 'all']" :key="s" type="button" :class="{ on: f.status === s }" @click="f.status = s">{{ FL['status-' + s] }} <i>{{ counts[s] }}</i></button>
          </div>
          <label class="su-sel"><span>{{ FL.who }}</span><select v-model="f.who"><option v-for="w in ['all', 'guest', 'user', 'customer']" :key="w" :value="w">{{ FL['who-' + w] }}</option></select></label>
          <label class="su-sel"><span>{{ FL.assignee }}</span><select v-model="f.assignee"><option value="all">{{ FL['assignee-all'] }}</option><option value="mine">{{ FL['assignee-mine'] }}</option><option value="none">{{ FL['assignee-none'] }}</option></select></label>
          <label class="su-sel"><span>{{ FL.sort }}</span><select v-model="f.sort"><option value="waiting">{{ FL['sort-waiting'] }}</option><option value="activity">{{ FL['sort-activity'] }}</option></select></label>
          <label class="su-check"><input v-model="f.unread" type="checkbox" /> {{ FL.unread }}</label>
          <button v-if="alertState !== 'none'" type="button" class="su-alerts" :class="{ on: alerts }" :disabled="alertState === 'denied'" :title="alertState === 'denied' ? FL['notify-denied'] : ''" @click="toggleAlerts">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13z"/><path d="M8.5 17a1.5 1.5 0 0 0 3 0"/></svg>
            {{ alerts ? FL['notify-on'] : FL.notify }}
          </button>
          <button type="button" class="su-refresh" @click="load">{{ H.refresh }}</button>
        </div>
      </template>
    </AdminHead>

    <div v-if="state === 'idle'" class="su-note"><h2>{{ H['signin-heading'] }}</h2><p>{{ H['signin-subtitle'] }}</p><button type="button" class="su-cta" @click="openAuth">{{ H['signin-cta'] }}</button></div>
    <div v-else-if="state === 'denied'" class="su-note"><h2>{{ H['denied-heading'] }}</h2><p>{{ H['denied-subtitle'] }}</p></div>
    <div v-else-if="state === 'loading'" class="su-loading">…</div>
    <div v-else-if="state === 'error'" class="su-note"><p>{{ H.error }}</p></div>

    <div v-else class="su-panes">
      <!-- the threads -->
      <div class="su-list">
        <p class="su-count">{{ fill(H.count, { n: shown.length }) }}</p>
        <p v-if="!shown.length" class="su-empty">{{ H.empty }}</p>
        <button v-for="r in shown" :key="r.id" type="button" class="su-row" :class="{ on: r.id === thread.id, unread: r.unread > 0, ['st-' + r.status]: true }" @click="open(r.id)">
          <ChatAvatar :name="nameOf(r.contact)" :size="36" :coach="r.contact.kind === 'customer'" />
          <span class="su-rowmain">
            <span class="su-rowtop">
              <b>{{ nameOf(r.contact) }}</b>
              <i class="su-kind" :class="'k-' + r.contact.kind">{{ kindWord(r.contact.kind) }}</i>
              <i v-if="unverified(r.contact)" class="su-kind k-unverified">{{ R.unverified }}</i>
              <time>{{ when(r.last_message_at || r.created_at) }}</time>
            </span>
            <span class="su-rowline"><em v-if="r.last && r.last.author === 'agent'">{{ R.you }}: </em>{{ preview(r) }}</span>
            <span class="su-rowfoot">
              <i v-if="r.waiting_since" class="su-wait">{{ waiting(r) }}</i>
              <i v-if="r.source === 'prompt'" class="su-tag">{{ R.prompt }}</i>
              <i v-if="r.status !== 'open'" class="su-tag">{{ T['status-' + r.status] }}</i>
              <i class="su-tag su-who">{{ r.assignee ? (r.assignee_id === uid() ? R.you : r.assignee) : R.unassigned }}</i>
              <i v-if="r.unread > 0" class="su-n">{{ r.unread }}</i>
            </span>
          </span>
        </button>
      </div>

      <!-- the open thread -->
      <div class="su-thread">
        <p v-if="!current" class="su-pick">{{ H.pick }}</p>
        <template v-else>
          <div class="su-tophead">
            <ChatAvatar :name="nameOf(current.contact)" :size="40" :coach="current.contact.kind === 'customer'" />
            <div class="su-topwho">
              <b>{{ nameOf(current.contact) }} <i class="su-kind" :class="'k-' + current.contact.kind">{{ kindWord(current.contact.kind) }}</i><i v-if="unverified(current.contact)" class="su-kind k-unverified">{{ R.unverified }}</i></b>
              <small>
                <template v-if="current.contact.user_id">
                  <a v-if="current.contact.email" :href="'mailto:' + current.contact.email">{{ current.contact.email }}</a>
                  <span v-if="unverified(current.contact)" class="su-warn"> · {{ T.unverified }}</span>
                  <span> · {{ current.contact.orders ? fill(T.orders, { n: current.contact.orders }) : T['no-orders'] }}</span>
                </template>
                <span v-else>{{ T.guest }}</span>
                <span v-if="current.contact.last_seen_at"> · {{ fill(T['last-seen'], { when: when(current.contact.last_seen_at) }) }}</span>
                <span v-if="current.contact.last_path"> · {{ fill(T['last-page'], { path: current.contact.last_path }) }}</span>
              </small>
              <!-- what a page set on the contact through $chatwidget / the Client API (support-api): key: value, the desk reads them and never edits them -->
              <small v-if="current.contact.custom_attributes && Object.keys(current.contact.custom_attributes).length" class="su-attrs"><span v-for="(v, k) in current.contact.custom_attributes" :key="k" class="su-attr"><b>{{ k }}</b> {{ v }}</span></small>
            </div>
            <div class="su-acts">
              <select class="su-assign" :value="current.assignee_id || ''" :title="T.assign" @change="assign($event.target.value)">
                <option value="">{{ R.unassigned }}</option>
                <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.id === uid() ? R.you : a.name }}</option>
              </select>
              <button type="button" class="su-btn ghost" :title="T.export" @click="exportThread">{{ T.export }}</button>
              <button type="button" class="su-btn ghost danger" :title="T.delete" @click="deleteThread">{{ T.delete }}</button>
              <button v-if="current.status === 'resolved'" type="button" class="su-btn" @click="setStatus('open')">{{ T.reopen }}</button>
              <template v-else>
                <button v-if="current.status !== 'pending'" type="button" class="su-btn ghost" @click="setStatus('pending')">{{ T.pending }}</button>
                <button v-else type="button" class="su-btn ghost" @click="setStatus('open')">{{ T.reopen }}</button>
                <button type="button" class="su-btn" @click="setStatus('resolved')">{{ T.resolve }}</button>
              </template>
            </div>
          </div>
          <div class="su-memo"><label><span>{{ T.notes }} <i v-if="noteSaved">{{ noteSaved }}</i></span><textarea :key="current.id" :value="current.contact.notes || ''" rows="1" :placeholder="T['notes-placeholder']" @blur="saveNote" /></label></div>
          <div ref="scroller" class="su-msgs">
            <template v-for="s in sections" :key="s.key">
              <div class="su-day"><span>{{ s.label }}</span></div>
              <template v-for="m in s.messages" :key="m.id">
                <a v-if="m.author === 'system' && m.kind === 'file'" class="su-sysimg" :href="m.url" target="_blank" rel="noopener"><img :src="m.url" alt="" loading="lazy" /></a>
                <div v-else-if="m.author === 'system'" class="su-sys"><small>{{ isAck(m) ? T.auto : T.system }}</small><p>{{ m.body }}</p></div>
                <ChatBubble v-else :message="m" :me="ME" :peer-read-at="contactReadAt" :actions="['remove']" @remove="takeBack(m.id)" />
              </template>
            </template>
            <div v-if="contactTyping" class="su-typing" :aria-label="fill(T.typing, { name: nameOf(current.contact) })"><span /><span /><span /></div>
            <p v-if="current.status === 'resolved'" class="su-resolved">{{ fill(T['resolved-at'], { when: when(current.resolved_at) }) }}</p>
          </div>
          <div class="su-foot">
            <p v-if="said" class="su-said">{{ said }}</p>
            <div class="su-canned">
              <button type="button" class="su-cannedbtn" :aria-expanded="cannedOpen" @click="cannedOpen = !cannedOpen">{{ T.canned }}</button>
              <div v-if="cannedOpen" class="su-cannedlist">
                <button v-for="c in CANNED" :key="c.key" type="button" class="su-cannedrow" @click="canned(c)"><b>{{ c.title }}</b><span>{{ c.text }}</span></button>
                <p v-if="!CANNED.length" class="su-cannednone">{{ T['canned-none'] }}</p>
              </div>
            </div>
            <SupportComposer ref="composer" :busy="busy" :placeholder="T.placeholder" @send="reply" @typing="typing" @file="sendFile($event)" @voice="sendFile(new File([$event.blob], 'voice.mp3', { type: 'audio/mpeg' }), { kind: 'voice', seconds: $event.seconds, transcript: $event.transcript })" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.su { color: var(--ink); display: flex; flex-direction: column; min-height: 0; height: 100%; box-sizing: border-box }
.su-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 18px }
.su-title { font-family: var(--fd); font-weight: 600; font-size: 30px; letter-spacing: -.02em; margin: 0 0 4px }
.su-subtitle { margin: 0; color: var(--ink2); font-size: 14.5px }
.su-tools { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; justify-content: flex-end; max-width: 100%; min-width: 0 }
.su-seg { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--hair); border-radius: 999px; background: var(--card) }
.su-seg button { border: 0; background: transparent; color: var(--ink2); font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; cursor: pointer; white-space: nowrap }
.su-seg button i { font-style: normal; color: var(--ink3); font-size: 11.5px; margin-left: 2px }
.su-seg button.on { background: var(--ink); color: var(--paper) } .su-seg button.on i { color: var(--paper); opacity: .7 }
.su-sel { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink2) }
.su-sel select, .su-assign { font: inherit; font-size: 13px; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 999px; padding: 6px 10px }
.su-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink2); cursor: pointer }
.su-search { font: inherit; font-size: 13px; color: var(--ink); background: var(--card); border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px; flex: 0 1 220px; min-width: 130px }
.su-search:focus { outline: none; border-color: var(--ink3) }
.su-btn.danger { color: #b45309 }
.su-topwho .su-attrs { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 4px; color: var(--ink3); font-size: 12px } .su-attr { display: inline-flex; gap: 4px; align-items: baseline } .su-attr b { font-weight: 600; color: var(--ink2) }
.su-memo { padding: 8px 16px; border-bottom: 1px solid var(--hair); background: var(--card) }
.su-memo label { display: flex; align-items: flex-start; gap: 10px } .su-memo span { flex: none; font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); padding-top: 6px } .su-memo span i { font-style: normal; color: #3a8f5c; margin-left: 6px }
.su-memo textarea { flex: 1; font: inherit; font-size: 13px; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 10px; padding: 5px 10px; resize: vertical; min-height: 30px }
.su-typing { display: inline-flex; gap: 4px; align-self: flex-start; margin: 10px 0 0; padding: 12px 14px; border-radius: 18px; border-bottom-left-radius: 6px; background: var(--chat-peer) }
.su-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--ink3); animation: su-dot 1.2s ease-in-out infinite } .su-typing span:nth-child(2) { animation-delay: .15s } .su-typing span:nth-child(3) { animation-delay: .3s }
@keyframes su-dot { 0%, 60%, 100% { transform: translateY(0); opacity: .5 } 30% { transform: translateY(-4px); opacity: 1 } }
.su-canned { position: relative; margin: 0 0 6px 6px }
.su-cannedbtn { font: inherit; font-size: 12px; color: var(--ink2); background: none; border: 1px solid var(--hair); border-radius: 999px; padding: 4px 10px; cursor: pointer }
.su-cannedlist { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 5; width: min(520px, 90%); max-height: 300px; overflow-y: auto; background: var(--paper); border: 1px solid var(--hair); border-radius: 14px; box-shadow: 0 20px 50px -24px #000c; padding: 6px }
.su-cannedrow { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; font: inherit; color: var(--ink); background: none; border: 0; border-radius: 10px; padding: 8px 10px; cursor: pointer }
.su-cannedrow:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) } .su-cannedrow b { font-size: 13px } .su-cannedrow span { font-size: 12.5px; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.su-cannednone { margin: 8px 10px; font-size: 12.5px; color: var(--ink3) }
.su-refresh { border: 0; background: none; color: var(--accent2); font: inherit; font-size: 13px; cursor: pointer }
.su-alerts { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; color: var(--ink2); background: var(--card); border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px; cursor: pointer }
.su-alerts.on { color: var(--paper); background: var(--ink); border-color: var(--ink) }
.su-alerts:disabled { opacity: .5; cursor: default }
.su-note { max-width: 520px; margin: 40px auto; text-align: center; padding: 34px 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--card) }
.su-note h2 { font-family: var(--fd); font-weight: 600; font-size: 24px; margin: 0 0 8px } .su-note p { color: var(--ink2); margin: 0 0 16px }
.su-cta { border: 0; background: var(--ink); color: var(--paper); font: inherit; padding: 10px 18px; border-radius: 999px; cursor: pointer }
.su-loading { color: var(--ink3); text-align: center; padding: 40px 0 }
.su-panes { flex: 1; min-height: 0; display: grid; grid-template-columns: 380px 1fr; gap: 16px; height: calc(100vh - 210px); min-height: 480px }
.su-list { min-height: 0; overflow-y: auto; border: 1px solid var(--hair); border-radius: 16px; background: var(--card); padding: 8px }
.su-count { margin: 6px 10px 8px; font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.su-empty { margin: 30px 0; text-align: center; color: var(--ink3); font-size: 14px }
.su-row { display: flex; gap: 12px; width: 100%; text-align: left; font: inherit; color: inherit; padding: 12px 10px; border: 0; border-radius: 12px; background: none; cursor: pointer; align-items: flex-start }
.su-row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent) }
.su-row.on { background: var(--paper); box-shadow: inset 0 0 0 1px var(--hair) }
.su-rowmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px }
.su-rowtop { display: flex; align-items: center; gap: 8px }
.su-rowtop b { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.su-rowtop time { margin-left: auto; font-family: var(--m); font-size: 10.5px; color: var(--ink3); flex: none }
.su-rowline { font-size: 13.5px; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.su-rowline em { font-style: normal; color: var(--ink3) }
.su-row.unread .su-rowline { color: var(--ink); font-weight: 500 }
.su-rowfoot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px }
.su-kind { font-style: normal; font-family: var(--m); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--hair); color: var(--ink3); flex: none }
.su-kind.k-customer { border-color: var(--accent2); color: var(--accent2) }
.su-kind.k-user { color: var(--ink2) }
.su-kind.k-unverified { border-color: #b45309; color: #b45309 }
.su-warn { color: #b45309 }
.su-tag { font-style: normal; font-family: var(--m); font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3) }
.su-wait { font-style: normal; font-family: var(--m); font-size: 10px; letter-spacing: .04em; color: #b45309; font-weight: 600 }
.su-n { font-style: normal; margin-left: auto; font-family: var(--m); font-size: 10.5px; font-weight: 700; color: var(--paper); background: var(--ink); border-radius: 999px; min-width: 18px; height: 18px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center }
.su-thread { --chat-peer: color-mix(in srgb, var(--ink) 7%, var(--paper)); --chat-field: color-mix(in srgb, var(--ink) 5%, var(--paper)); --chat-own: var(--ink); --chat-own-ink: var(--paper); min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--hair); border-radius: 16px; background: var(--paper); overflow: hidden }
.su-pick { margin: auto; color: var(--ink3); font-size: 14px }
/* the who and the actions share the head; where the pane is narrow the actions wrap under the who, never squeezing it */
.su-tophead { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; padding: 12px 16px; border-bottom: 1px solid var(--hair); background: var(--card) }
.su-topwho { flex: 1 1 240px; min-width: 0 }
.su-topwho b { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600 }
.su-topwho small { display: block; font-size: 12.5px; line-height: 1.4; color: var(--ink2); margin-top: 2px }
.su-topwho small a { color: var(--accent2); text-decoration: none }
.su-acts { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; flex: 0 1 auto; margin-left: auto }
.su-btn { border: 0; background: var(--ink); color: var(--paper); font: inherit; font-size: 13px; padding: 7px 13px; border-radius: 999px; cursor: pointer; white-space: nowrap }
.su-btn.ghost { background: transparent; color: var(--ink2); border: 1px solid var(--hair) }
.su-msgs :deep(.cb-tick.read) { color: var(--ink2) }
/* the inbox's pane is wide: a picture keeps to a bubble's width there */
.su-sysimg { display: block; align-self: center; width: min(100%, 420px); margin: 6px 0; border-radius: 16px; overflow: hidden; line-height: 0; border: 1px solid var(--hair) } .su-sysimg img { display: block; width: 100%; height: auto }
.su-msgs :deep(.cb.media) { width: min(100%, 420px) }
/* the tail on the last of a run, as a phone draws it: a curve out of the corner, cut by the ground */
.su-msgs :deep(.cb.last .cb-bubble) { position: relative }
.su-msgs :deep(.cb.last:not(.own):not(.media) .cb-bubble) { border-bottom-left-radius: 18px }
.su-msgs :deep(.cb.last:not(.own):not(.media) .cb-bubble::before) { content: ''; position: absolute; left: -7px; bottom: 0; width: 20px; height: 20px; background: var(--chat-peer); border-bottom-right-radius: 16px }
.su-msgs :deep(.cb.last:not(.own):not(.media) .cb-bubble::after) { content: ''; position: absolute; left: -10px; bottom: 0; width: 10px; height: 20px; background: var(--paper); border-bottom-right-radius: 10px }
.su-msgs :deep(.cb.own.last:not(.media) .cb-bubble) { border-bottom-right-radius: 18px }
.su-msgs :deep(.cb.own.last:not(.media) .cb-bubble::before) { content: ''; position: absolute; right: -7px; bottom: 0; width: 20px; height: 20px; background: var(--chat-own); border-bottom-left-radius: 16px }
.su-msgs :deep(.cb.own.last:not(.media) .cb-bubble::after) { content: ''; position: absolute; right: -10px; bottom: 0; width: 10px; height: 20px; background: var(--paper); border-bottom-left-radius: 10px }

.su-msgs { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 18px 16px; display: flex; flex-direction: column }
.su-day { display: flex; justify-content: center; margin: 10px 0 4px }
.su-day span { font-family: var(--m); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3) }
.su-sys { margin: 8px 0; padding: 10px 14px; border-radius: 14px; border: 1px dashed var(--hair); background: color-mix(in srgb, var(--ink) 4%, var(--paper)); align-self: center; max-width: 80% }
.su-sys small { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin-bottom: 4px }
.su-sys p { margin: 0; font-size: 14px; line-height: 1.45 }
.su-resolved { margin: 14px 0 0; text-align: center; font-size: 12.5px; color: var(--ink3) }
.su-foot { flex: none; padding: 10px 12px 12px; border-top: 1px solid var(--hair) }
.su-said { margin: 0 0 6px 14px; font-size: 12px; color: var(--ink3) }
@media (max-width: 900px) { .su-panes { grid-template-columns: 1fr; height: auto } .su-list { max-height: 40vh } .su-thread { min-height: 480px } }
</style>
