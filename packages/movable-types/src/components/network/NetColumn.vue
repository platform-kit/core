<script setup>
/*
 * THE NETWORK'S COLUMN — one component for wherever the network is read: the standalone /feed
 * (FeedPage, between its own navigation and what is beside it) and, on a site whose config says
 * community.layout chat (the default) with the spaces on, inside the spaces area (SpacesPage), so Home and the spaces are one place.
 * Which of its four views it shows is the address:
 *
 *   /feed                 Home: Following (the reader's own posts, the people they follow and what
 *                         they reposted, the feeds of the spaces they pinned) and Discover (everything
 *                         on the site they may read), newest first
 *   /feed/explore         people by name, and Discover
 *   /feed/notifications   what has happened to them: likes, reposts, follows, replies, quotes — and,
 *                         where the spaces are on, their mentions, thread replies and the events
 *                         they are going to, as one list with one count (98-community.sql)
 *   /feed/post/<id>       a thread: the post, what it answers, and every answer they may read
 *
 * Nothing here decides who may read what: the database does (93-network.sql), and the store only
 * shapes what came back. Words from network.md.
 */
import { computed, ref, watch, onMounted } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { route, ROUTES, navigate } from '@platform-kit/kit/lib/router.js'
import { isSignedIn, authSettled } from '@platform-kit/kit/lib/auth.js'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import { net, timeline, discover, findPeople, loadThread, notifications, communityNotes, lastSeen, markSeen, loadSpaces, admission } from '@platform-kit/kit/lib/network/api.js'
import { moduleOn } from '@platform-kit/kit/lib/modules.js'
import site from '#site'
import { showsFollowing } from '@platform-kit/kit/lib/community/places.js'
import { plainBody, clockOf } from '@platform-kit/kit/lib/spaces/model.js'
import NetJoinCard from './NetJoinCard.vue'
import { threadOf, agoOf, itemKey, groupNotes, NOTE_FILTERS } from '@platform-kit/kit/lib/network/model.js'
import { unread, refresh as refreshUnread } from '@platform-kit/kit/lib/network/nav.js'
import NetPost from './NetPost.vue'
import NetComposer from './NetComposer.vue'
import NetReport from './NetReport.vue'
import SpaceAvatar from '../spaces/SpaceAvatar.vue'
import NetPersonRow from './NetPersonRow.vue'
import NetForYou from './NetForYou.vue'

const T = computed(() => us('network').timeline.main)
const N = computed(() => us('network').notes.main)
const H = computed(() => us('network').thread.main)
const P = computed(() => us('network').post.main)
const S = computed(() => us('network').shell.main)
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))

const view = computed(() => {
  const p = route.value || ''
  if (p.startsWith(ROUTES.feed + '/post/')) return 'thread'
  if (p === ROUTES.feed + '/notifications') return 'notes'
  if (p === ROUTES.feed + '/explore') return 'explore'
  return 'home'
})
const threadId = computed(() => (view.value === 'thread' ? decodeURIComponent(route.value.slice((ROUTES.feed + '/post/').length).split('/')[0]) : ''))

watch(view, (v) => setHead({ title: v === 'notes' ? N.value.title : v === 'thread' ? H.value.title : v === 'explore' ? S.value['explore-title'] : T.value.title, noindex: true }), { immediate: true })

/* ---------------------------------------------------------------- the timeline */
const tl = timeline()
const ds = discover()
/* Home has two tabs, remembered for the visit: the people followed, or everything on the site */
/* a site that hides following has one Home feed: everything the reader may read */
const FOLLOWING = showsFollowing((site.community || {}).hide)
/* Explore is the For You grid where the site turned it on */
const FOR_YOU = !!(site.community || {}).forYou && !!(site.network)
const tab = ref(!FOLLOWING ? 'discover' : (() => { try { return sessionStorage.getItem('dl.feed.tab') || 'following' } catch { return 'following' } })())
function setTab(t) { tab.value = t; try { sessionStorage.setItem('dl.feed.tab', t) } catch { /* private window */ } ; if (t === 'discover' && !ds.st.items.length) ds.refresh(); window.scrollTo({ top: 0 }) }
const source = computed(() => (view.value === 'explore' || tab.value === 'discover' ? ds : tl))
const items = computed(() => source.value.st.items.map((it) => ({ ...it, post: it.post_id ? net.posts[it.post_id] : net.messages[it.message_id] })).filter((it) => it.post))

/* ---------------------------------------------------------------- explore: people by name */
const q = ref('')
const found = ref([])
const finding = ref(false)
let findTick = 0
async function find() {
  const n = ++findTick
  const s = q.value.trim()
  if (!s) { found.value = []; return }
  finding.value = true
  try { const ids = await findPeople(s); if (n === findTick) found.value = ids } finally { if (n === findTick) finding.value = false }
}
let findTimer = null
watch(q, () => { clearTimeout(findTimer); findTimer = setTimeout(find, 250) })

/* ---------------------------------------------------------------- the notifications */
/* where the spaces are on, the list is the community's: the spaces' part stands even for a reader
   outside a sold network's read grant, whose network part the database leaves out */
const SPACES = moduleOn('spaces')
const EVENTS = SPACES && moduleOn('events')
const emit = defineEmits(['open-message', 'open-event'])
const PAGE = 60
const notes = ref([])
const notesBusy = ref(false)
const notesErr = ref(false)
const notesDone = ref(false)
const seenAt = ref(null)
const noteFilter = ref('all')
const fetchNotes = (before) => (SPACES ? communityNotes(before) : notifications(before).then((r) => r.map((n) => ({ ...n, source: 'network' }))))
async function loadNotes() {
  notesBusy.value = true; notesErr.value = false
  try {
    seenAt.value = await lastSeen()
    const rows = await fetchNotes(null)
    notes.value = rows; notesDone.value = rows.length < (SPACES ? PAGE : 50)
    await markSeen(); refreshUnread()
  } catch { notesErr.value = true; notes.value = [] } finally { notesBusy.value = false }
}
async function moreNotes() {
  if (notesBusy.value || notesDone.value || !notes.value.length) return
  notesBusy.value = true
  try {
    const rows = await fetchNotes(notes.value[notes.value.length - 1].at)
    notes.value = notes.value.concat(rows); notesDone.value = rows.length < (SPACES ? PAGE : 50)
  } catch { notesErr.value = true } finally { notesBusy.value = false }
}
/* the filters this site has: mentions and events only where their modules are, the network's own
   only where the reader may read it */
const noteFilters = computed(() => (!SPACES && !net.access.read ? [] : NOTE_FILTERS.filter((f) => f === 'all' || f === 'replies'
  || (f === 'mentions' && SPACES) || (f === 'events' && EVENTS) || ((f === 'reactions' || f === 'follows') && net.access.read))))
function setNoteFilter(f) { noteFilter.value = f; window.scrollTo({ top: 0 }) }
const grouped = computed(() => groupNotes(notes.value, seenAt.value))
const shownNotes = computed(() => (noteFilter.value === 'all' ? grouped.value : grouped.value.filter((g) => g.kind === noteFilter.value)))
const nameOf = (p) => (p && (p.name || p.username)) || P.value.someone
const nameOfId = (id) => nameOf(net.people[id])
const names = computed(() => Object.fromEntries(Object.entries(net.people).map(([k, v]) => [k, nameOf(v)])))
/* a line's words as runs, the names and the room in bold — the words are the file's, whole */
function runs(tpl, map, bold) {
  const out = []
  String(tpl || '').split(/(\{\w+\})/).forEach((bit) => {
    const m = bit.match(/^\{(\w+)\}$/)
    if (m) out.push({ t: map[m[1]] == null ? '' : String(map[m[1]]), b: bold.includes(m[1]) })
    else if (bit) out.push({ t: bit, b: false })
  })
  return out
}
function noteRuns(g) {
  const W = N.value
  if (g.source === 'event') {
    const it = g.item || {}
    const start = new Date(it.starts_at)
    const now = new Date()
    const key = start <= now ? 'event-on' : start.toDateString() === now.toDateString() ? 'event-today' : 'event-tomorrow'
    return runs(W[key], { title: it.title, time: clockOf(it.starts_at) }, ['title'])
  }
  if (g.source !== 'network') {
    const it = g.item || {}
    const room = it.channel_kind === 'dm' ? W['in-dm'] : '#' + (it.channel || '')
    return runs(W[g.reason] || W['mention-user'], { name: it.author || nameOfId(g.actor_id), room }, ['name', 'room'])
  }
  const n = g.actors.length
  const key = n > 2 ? g.reason + '-many' : n === 2 ? g.reason + '-two' : g.reason
  return runs(W[key] || W[g.reason], { name: nameOfId(g.actors[0]), other: nameOfId(g.actors[1]), n: n - 1 }, ['name', 'other'])
}
const noteText = (g) => {
  if (g.source === 'network') { const p = net.posts[g.post_id || g.subject_post_id]; return p ? p.text : '' }
  if (g.source === 'event') return ''
  return plainBody((g.item && g.item.body) || '', names.value)
}
const noteWhere = (g) => (g.item && g.item.space) || ''
const noteHref = (g) => {
  if (g.source === 'network') {
    if (g.reason === 'follow') { const p = net.people[g.actors[0]] || {}; return g.actors.length === 1 && p.page ? ROUTES.people + '/' + p.username : '' }
    return ROUTES.feed + '/post/' + (g.post_id || g.subject_post_id)
  }
  if (g.source === 'event') return ROUTES.spaces || ''
  return ROUTES.spaces || ''
}
function openNote(g, e) {
  if (g.source === 'network') return
  e.preventDefault()
  if (g.source === 'event') emit('open-event', (g.item || {}).slug)
  else emit('open-message', { channel: g.item.channel_id, thread: g.item.thread_root_id || null })
}

/* ---------------------------------------------------------------- a thread */
const thread = ref(null)
const threadBusy = ref(false)
const replying = ref(false)
async function openThread(id) {
  threadBusy.value = true; thread.value = null
  try { thread.value = await loadThread(id) } finally { threadBusy.value = false }
  replying.value = wantReply.value === id
  wantReply.value = ''
}
/* where a press on Reply came from: the thread opens with the box ready under that post */
const wantReply = ref('')
const rows = computed(() => (thread.value ? threadOf(thread.value.root, thread.value.replies.map((r) => net.posts[r.id] || r)) : []))
const focusPost = computed(() => (thread.value ? net.posts[thread.value.focus] : null))

/* ---------------------------------------------------------------- what drives each view */
async function show() {
  await authSettled
  /* where the site sells the network, whether this reader is inside its grants */
  await admission().catch(() => {})
  if (!net.access.read && !(SPACES && view.value === 'notes')) return
  if (view.value === 'home') { if (isSignedIn.value) { if (tab.value === 'discover') ds.refresh(); else tl.refresh(); loadSpaces() } }
  else if (view.value === 'explore') { try { q.value = new URLSearchParams(window.location.search).get('q') || '' } catch { q.value = '' } ; if (!FOR_YOU) ds.refresh() }
  else if (view.value === 'notes') { if (isSignedIn.value) loadNotes() }
  else openThread(threadId.value)
}
onMounted(show)
watch([view, threadId, isSignedIn], show)

/* answering from a card: open its thread with the reply box ready */
function replyTo(post) { wantReply.value = post.id; navigate(ROUTES.feed + '/post/' + post.id) }
function back() { if (window.history.length > 1) window.history.back(); else navigate(ROUTES.feed) }
async function posted(out) {
  if (view.value === 'thread') openThread(threadId.value)
  else source.value.refresh()
}
/* a report, over whatever view raised it */
const reporting = ref(null)
const removed = (id) => { tl.st.items = tl.st.items.filter((it) => it.post_id !== id); if (view.value === 'thread' && id === threadId.value) navigate(ROUTES.feed) }

const signIn = () => { if (window.DLauth) window.DLauth.open() }
/* a post made elsewhere — the post window — lands in whatever this column is showing */
defineExpose({ refresh: () => posted() })
</script>

<template>
<div class="fd-main" role="main">
  <!-- THE PAGE'S NAME, for a screen reader: the navigation already says where the reader is -->
  <h1 class="fd-sr">{{ view === 'notes' ? N.title : view === 'thread' ? H.title : view === 'explore' ? S['explore-title'] : T.title }}</h1>
  <!-- THE STICKY HEADER: Home's tabs, Explore's search, a thread's way back — and nothing where there is nothing to hold -->
  <div v-if="view === 'thread' || view === 'explore' || (view === 'home' && isSignedIn && net.access.read && FOLLOWING) || (view === 'notes' && isSignedIn && noteFilters.length > 1)" class="fd-bar">
    <div v-if="view === 'thread'" class="fd-bar-row">
      <a class="fd-back" :href="ROUTES.feed" :aria-label="H.back" @click.prevent="back">
        <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
        <span class="fd-back-word">{{ H.back }}</span>
      </a>
    </div>
    <nav v-if="view === 'home' && isSignedIn && net.access.read && FOLLOWING" class="fd-tabs" :aria-label="T.title">
      <button type="button" :class="{ on: tab === 'following' }" :aria-pressed="tab === 'following'" @click="setTab('following')"><span>{{ T['tab-following'] }}</span></button>
      <button type="button" :class="{ on: tab === 'discover' }" :aria-pressed="tab === 'discover'" @click="setTab('discover')"><span>{{ T['tab-discover'] }}</span></button>
    </nav>
    <nav v-if="view === 'notes' && isSignedIn && noteFilters.length > 1" class="fd-tabs fd-tabs-scroll" :aria-label="N.filters">
      <button v-for="f in noteFilters" :key="f" type="button" :class="{ on: noteFilter === f }" :aria-pressed="noteFilter === f" @click="setNoteFilter(f)"><span>{{ N['filter-' + f] }}</span></button>
    </nav>
    <form v-if="view === 'explore'" class="fd-find" role="search" @submit.prevent="find">
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
      <input v-model="q" type="search" :placeholder="S.search" :aria-label="S.search" />
    </form>
  </div>

  <!-- NOT SIGNED IN: what this is, and the way in -->
  <!-- OUTSIDE THE NETWORK'S READ GRANT: the join card, and nothing of it -->
  <NetJoinCard v-if="net.access.known && !net.access.read && !(SPACES && view === 'notes')" />

  <div v-else-if="view !== 'thread' && view !== 'explore' && !isSignedIn" class="fd-card">
    <h2>{{ T['signin-title'] }}</h2>
    <p>{{ T['signin-line'] }}</p>
    <button type="button" class="fd-go" @click="signIn">{{ T.signin }}</button>
  </div>

  <!-- HOME, and EXPLORE's posts -->
  <!-- FOR YOU (community.forYou): people by name when searched, else the grid -->
  <template v-else-if="view === 'explore' && FOR_YOU && isSignedIn">
    <div v-if="q.trim()" class="fd-people">
      <h2 class="fd-sub">{{ S['explore-people'] }}</h2>
      <NetPersonRow v-for="id in found" :key="id" :id="id" about />
      <p v-if="!finding && !found.length" class="fd-none">{{ S['search-empty'] }}</p>
    </div>
    <NetForYou v-else />
  </template>

  <template v-else-if="view === 'home' || view === 'explore'">
    <NetComposer v-if="view === 'home' && net.access.write" @posted="posted" />
    <NetJoinCard v-else-if="view === 'home' && net.access.known" compact />
    <template v-if="view === 'explore'">
      <div v-if="q.trim()" class="fd-people">
        <h2 class="fd-sub">{{ S['explore-people'] }}</h2>
        <NetPersonRow v-for="id in found" :key="id" :id="id" about />
        <p v-if="!finding && !found.length" class="fd-none">{{ S['search-empty'] }}</p>
      </div>
      <p v-else class="fd-intro">{{ S['explore-line'] }}</p>
    </template>
    <p v-if="source.st.error" class="fd-err">{{ T.error }}</p>
    <div v-if="items.length" class="fd-list">
      <NetPost v-for="it in items" :key="itemKey(it)" :post="it.post" :reposted-by="it.kind === 'repost' ? it.reposted_by : ''"
        @reply="replyTo" @report="(p) => reporting = p" @removed="removed" />
    </div>
    <div v-else-if="!source.st.loading" class="fd-card fd-empty">
      <span class="fd-empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v3.5A1.5 1.5 0 0 1 19 12H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5zM5 14.5h9M5 18.5h12" /></svg></span>
      <h2>{{ source === ds ? T['empty-discover-title'] : T['empty-title'] }}</h2>
      <p>{{ source === ds ? T['empty-discover'] : T.empty }}</p>
      <a v-if="source !== ds" class="fd-go" :href="ROUTES.feed + '/explore'" @click.prevent="navigate(ROUTES.feed + '/explore')">{{ T['empty-find'] }}</a>
    </div>
    <div v-else-if="!items.length" class="fd-skel" :aria-label="T.loading" role="status">
      <div v-for="i in 4" :key="i" class="fd-skel-row" :style="{ '--d': i * 0.08 + 's' }"><i class="fd-skel-face"></i><span><i style="width: 34%"></i><i style="width: 92%"></i><i style="width: 70%"></i></span></div>
    </div>
    <div v-if="(source.st.loading && items.length) || (items.length && !source.st.done)" class="fd-foot">
      <span v-if="source.st.loading" class="fd-spin" :aria-label="T.loading"></span>
      <button v-else type="button" class="fd-more" @click="source.more()">{{ T.more }}</button>
    </div>
  </template>

  <!-- NOTIFICATIONS: the one list, its filters above -->
  <template v-else-if="view === 'notes'">
    <ul v-if="shownNotes.length" :key="noteFilter" class="fd-notes">
      <li v-for="g in shownNotes" :key="g.key" :class="{ 'is-new': g.fresh }">
        <a class="fd-note" :href="noteHref(g) || undefined" @click="openNote(g, $event)">
          <span class="fd-note-ic" :class="'is-' + g.kind + ' is-' + g.reason" aria-hidden="true">
            <svg v-if="g.reason === 'like'" viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 20.5s-8-4.7-8-10.2A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.7c0 5.5-8 10.2-8 10.2z" /></svg>
            <svg v-else-if="g.reason === 'repost'" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10V8a3 3 0 0 1 3-3h10l-3-3M19 14v2a3 3 0 0 1-3 3H6l3 3" /></svg>
            <svg v-else-if="g.reason === 'follow'" viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><circle cx="10" cy="8" r="4" /><path d="M2.5 20a7.5 7.5 0 0 1 15 0zM19 7v6M16 10h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            <svg v-else-if="g.kind === 'mentions'" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.6" /><path d="M15.6 8.4v4.8a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7" /></svg>
            <svg v-else-if="g.kind === 'events'" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
            <svg v-else viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4h1.5A2.5 2.5 0 0 1 4 13.5z" /></svg>
          </span>
          <span class="fd-note-body">
            <span v-if="g.actors.length" class="fd-note-who">
              <SpaceAvatar v-for="id in g.actors.slice(0, 7)" :key="id" :person="net.people[id] || null" :name="(g.item && g.item.author) || nameOfId(id)" :size="32" />
            </span>
            <span class="fd-note-line"><template v-for="(r, i) in noteRuns(g)" :key="i"><b v-if="r.b">{{ r.t }}</b><template v-else>{{ r.t }}</template></template></span>
            <span v-if="noteText(g)" class="fd-note-text">{{ noteText(g) }}</span>
            <span class="fd-note-meta"><time v-if="g.source !== 'event'" :datetime="g.at">{{ agoOf(g.at) }}</time><template v-if="noteWhere(g)">{{ g.source !== 'event' ? ' · ' : '' }}{{ noteWhere(g) }}</template><template v-if="g.source === 'event'">{{ noteWhere(g) ? ' · ' : '' }}<span class="fd-note-go">{{ N['event-open'] }}</span></template></span>
          </span>
          <i v-if="g.fresh" class="fd-note-dot" :aria-label="N.new"></i>
        </a>
      </li>
    </ul>
    <div v-else-if="notesErr" class="fd-card fd-empty">
      <p>{{ N.error }}</p>
      <button type="button" class="fd-more" @click="loadNotes">{{ N.retry }}</button>
    </div>
    <div v-else-if="!notesBusy" :key="'empty-' + noteFilter" class="fd-card fd-empty">
      <span class="fd-empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10a6 6 0 1 1 12 0c0 4.5 2 6 2 6H4s2-1.5 2-6M10 20a2.2 2.2 0 0 0 4 0" /></svg></span>
      <h2>{{ noteFilter === 'all' ? N.title : N['filter-' + noteFilter] }}</h2>
      <p>{{ N['empty-' + noteFilter] || N.empty }}</p>
    </div>
    <div v-if="notesBusy && !shownNotes.length" class="fd-skel" :aria-label="T.loading" role="status">
      <div v-for="i in 5" :key="i" class="fd-skel-row" :style="{ '--d': i * 0.08 + 's' }"><i class="fd-skel-ic"></i><span><i class="fd-skel-face"></i><i style="width: 58%"></i><i style="width: 84%"></i></span></div>
    </div>
    <div v-if="(notesBusy && shownNotes.length) || (shownNotes.length && !notesDone)" class="fd-foot">
      <span v-if="notesBusy" class="fd-spin" :aria-label="T.loading"></span>
      <button v-else type="button" class="fd-more" @click="moreNotes">{{ T.more }}</button>
    </div>
  </template>

  <!-- A THREAD -->
  <template v-else>
    <div v-if="threadBusy" class="fd-foot"><span class="fd-spin" :aria-label="T.loading"></span></div>
    <div v-else-if="!thread" class="fd-card fd-empty">
      <h2>{{ H.title }}</h2>
      <p>{{ P.gone }}</p>
    </div>
    <template v-else>
      <template v-for="r in rows" :key="r.post.id">
        <NetPost :post="r.post" :depth="r.depth" :focus="r.post.id === thread.focus"
          @reply="replyTo"
          @report="(p) => reporting = p" @removed="removed" />
        <NetComposer v-if="isSignedIn && net.access.write && r.post.id === thread.focus && focusPost" :key="'reply-' + r.post.id"
          :reply-to="focusPost" :autofocus="replying" @posted="posted" />
      </template>
      <div v-if="rows.length === 1" class="fd-none fd-center">{{ H.none }}</div>
    </template>
  </template>
  <NetReport v-if="reporting" :post="reporting" @close="reporting = null" />
</div>
</template>

<style scoped>
.fd-main { --e: cubic-bezier(.2, .8, .2, 1); min-width: 0; min-height: calc(100vh - 86px); border-left: 1px solid var(--hair); border-right: 1px solid var(--hair); background: var(--paper) }
/* WHAT ARRIVES, arrives: a list rises in a short cascade, a card settles, a tab's ink grows under it */
@keyframes fd-rise { from { opacity: 0; transform: translateY(8px) } }
.fd-list > *, .fd-notes > li { animation: fd-rise .45s var(--e) both }
.fd-list > :nth-child(2), .fd-notes > li:nth-child(2) { animation-delay: .04s }
.fd-list > :nth-child(3), .fd-notes > li:nth-child(3) { animation-delay: .08s }
.fd-list > :nth-child(4), .fd-notes > li:nth-child(4) { animation-delay: .12s }
.fd-list > :nth-child(5), .fd-notes > li:nth-child(5) { animation-delay: .16s }
.fd-list > :nth-child(n+6), .fd-notes > li:nth-child(n+6) { animation-delay: .2s }
.fd-card, .fd-people, .fd-intro { animation: fd-rise .45s var(--e) both }
/* LOADING is the shape of what is coming, shimmering — never a bare spinner on an empty page */
.fd-skel-row { display: flex; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--hair); animation: fd-rise .4s var(--e) both; animation-delay: var(--d) }
.fd-skel-row > span { flex: 1; display: flex; flex-direction: column; gap: 9px; padding-top: 4px }
.fd-skel-row i { display: block; height: 11px; border-radius: 6px }
.fd-skel-row .fd-skel-face { flex: none; width: 40px; height: 40px; border-radius: 999px }
.fd-skel-row > span .fd-skel-face { width: 32px; height: 32px }
.fd-skel-row .fd-skel-ic { flex: none; width: 40px; height: 26px; border-radius: 8px; opacity: .6 }
.fd-skel-row i { background: linear-gradient(90deg, color-mix(in srgb, var(--ink) 6%, transparent) 0%, color-mix(in srgb, var(--ink) 11%, transparent) 40%, color-mix(in srgb, var(--ink) 6%, transparent) 80%);
  background-size: 300% 100%; animation: fd-shimmer 1.4s ease-in-out infinite }
@keyframes fd-shimmer { from { background-position: 100% 0 } to { background-position: -100% 0 } }

.fd-bar { position: sticky; top: 0; z-index: 6; border-bottom: 1px solid var(--hair);
  background: color-mix(in srgb, var(--paper) 86%, transparent); backdrop-filter: blur(14px) saturate(1.4) }
.fd-bar-row { display: flex; align-items: center; padding: 8px 12px }
.fd-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0 }
.fd-back-word { font-size: 15px; font-weight: 700; color: var(--ink) }
.fd-back { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px 0 6px; border-radius: 999px; color: var(--ink); text-decoration: none }
.fd-back:hover { background: color-mix(in srgb, var(--ink) 7%, transparent) }
/* TABS, underlined: the bar under the chosen one, the way every timeline marks it */
.fd-tabs { display: flex }
.fd-tabs button { flex: 1; display: flex; justify-content: center; padding: 0; border: 0; background: transparent; font: inherit; font-size: 15px; font-weight: 600;
  color: var(--ink3); cursor: pointer; transition: background .2s cubic-bezier(.2, .8, .2, 1) }
.fd-tabs button:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.fd-tabs button span { position: relative; padding: 14px 4px }
.fd-tabs button.on { color: var(--ink); font-weight: 700 }
.fd-tabs button.on span::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--accent);
  animation: fd-ink .35s var(--e) }
@keyframes fd-ink { from { transform: scaleX(.2); opacity: 0 } }
.fd-find { display: flex; align-items: center; gap: 10px; margin: 12px 16px; padding: 0 16px; height: 44px; border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 6%, var(--paper)); color: var(--ink3); border: 1px solid transparent }
.fd-find:focus-within { border-color: var(--accent); background: var(--paper); color: var(--accent) }
.fd-find input { flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; font-size: 15px; color: var(--ink) }
.fd-find input:focus { outline: none }

.fd-card { margin: 18px; padding: 28px 22px; border: 1px solid var(--hair); border-radius: 16px; background: var(--card, var(--paper)); text-align: center }
.fd-card h2 { margin: 0 0 6px; max-width: none; font-family: var(--fd); font-size: 22px; font-weight: 800; color: var(--ink) }
.fd-card p { margin: 0 auto; max-width: 44ch; font-size: 15px; line-height: 1.55; color: var(--ink2) }
.fd-empty { border: 0; background: transparent; padding-top: 48px }
.fd-go { display: inline-block; margin-top: 18px; font: inherit; font-size: 15px; font-weight: 700; padding: 11px 24px; border: 0; border-radius: 999px; color: var(--on-accent, var(--paper)); cursor: pointer; text-decoration: none;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 82%, #fff) 0%, var(--accent) 60%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .28), 0 10px 22px -12px color-mix(in srgb, var(--accent) 85%, transparent);
  transition: transform .25s var(--e), filter .25s var(--e) }
.fd-go:hover { transform: translateY(-1px); filter: brightness(1.05) }
.fd-go:active { transform: scale(.98) }
.fd-err { margin: 12px 18px 0; font-size: 13px; color: #c8382f }
.fd-intro { max-width: none; margin: 0; padding: 14px 18px; border-bottom: 1px solid var(--hair); font-size: 14px; color: var(--ink3) }
.fd-sub { margin: 0; padding: 14px 16px 4px; max-width: none; font-family: var(--fd); font-size: 19px; font-weight: 800; color: var(--ink) }
.fd-people { border-bottom: 1px solid var(--hair); padding-bottom: 6px }
.fd-none { max-width: none; margin: 0; padding: 12px 16px; font-size: 14.5px; color: var(--ink3) }
.fd-center { text-align: center; padding: 28px 16px }
.fd-foot { display: flex; justify-content: center; padding: 22px }
.fd-spin { width: 24px; height: 24px; border-radius: 999px; border: 3px solid color-mix(in srgb, var(--accent) 22%, transparent); border-top-color: var(--accent);
  animation: fd-spin .8s linear infinite }
@keyframes fd-spin { to { transform: rotate(360deg) } }
.fd-more { font: inherit; font-size: 14.5px; font-weight: 600; padding: 9px 20px; border: 0; border-radius: 999px; background: transparent; color: var(--accent); cursor: pointer }
.fd-more:hover { background: color-mix(in srgb, var(--accent) 10%, transparent) }

.fd-tabs-scroll { overflow-x: auto; scrollbar-width: none }
.fd-tabs-scroll::-webkit-scrollbar { display: none }
.fd-tabs-scroll button { flex: 1 0 auto; padding: 0 12px }
.fd-empty-ic { display: inline-grid; place-items: center; width: 64px; height: 64px; margin-bottom: 16px; border-radius: 20px; color: var(--accent);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 16%, var(--paper)), color-mix(in srgb, var(--accent) 5%, var(--paper)));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent), 0 12px 28px -18px color-mix(in srgb, var(--accent) 80%, transparent) }
.fd-notes { list-style: none; margin: 0; padding: 0 }
.fd-notes li.is-new { background: color-mix(in srgb, var(--accent) 3.5%, transparent) }
.fd-notes li { border-bottom: 1px solid var(--hair) }
.fd-note { position: relative; display: flex; gap: 12px; padding: 14px 18px; text-decoration: none; color: inherit; transition: background .2s cubic-bezier(.2, .8, .2, 1) }
a.fd-note:hover { background: color-mix(in srgb, var(--ink) 2.5%, transparent) }
.fd-note-ic { flex: none; display: grid; place-items: start end; width: 40px; color: var(--ink3) }
.fd-note-ic.is-like { color: #e0245e }
.fd-note-ic.is-repost { color: #17a46b }
.fd-note-ic.is-follow, .fd-note-ic.is-mentions, .fd-note-ic.is-events { color: var(--accent) }
.fd-note-ic.is-replies { color: #1d9bf0 }
.fd-note-body { display: flex; flex-direction: column; gap: 8px; min-width: 0 }
.fd-note-who { display: flex; flex-wrap: wrap; gap: 4px; line-height: 0 }
.fd-note-line { font-size: 15px; color: var(--ink) }
.fd-note-line b { font-weight: 700 }
.fd-note-line { line-height: 1.4; overflow-wrap: anywhere }
.fd-note-meta { font-size: 13.5px; color: var(--ink3) }
.fd-note-go { color: var(--accent); font-weight: 600 }
.fd-note-dot { position: absolute; top: 20px; right: 18px; width: 8px; height: 8px; border-radius: 999px; background: var(--accent) }
.fd-note-text { font-size: 15px; line-height: 1.45; color: var(--ink3); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; white-space: pre-wrap }

/* THE POST WINDOW, over a dimmed page */
@media (max-width: 700px) { .fd-main { border: 0 } }
@media (prefers-reduced-motion: reduce) {
  .fd-list > *, .fd-notes > li, .fd-card, .fd-people, .fd-intro, .fd-skel-row, .fd-tabs button.on span::after, .fd-go { animation: none; transition: none }
  .fd-skel-row i { animation: none }
  .fd-tabs button, .fd-note { transition: none }
  .fd-spin { animation-duration: 3s }
}
</style>
