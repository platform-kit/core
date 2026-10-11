<script setup>
/*
 * The far column: this PERSON. Their four places across every space they are in, then every space
 * they are in by name, then the way to find another — and at its foot, who they are and what they
 * are saying about themselves.
 *
 * It is always here, in every view, which is the point of it: whatever somebody has navigated to,
 * the way back to a space is in the same place it always was. It holds nothing that belongs to a
 * space, so nothing in it changes as they move between rooms.
 *
 * This column and the rail beside it were one column once. They should not have been: a person's
 * places and a space's rooms are two different things, and interleaving them in one narrow column
 * made fifteen rows of the same weight with no way to tell which belonged to what. Two columns say
 * it with structure instead of with indentation, which at this width is invisible.
 *
 * A space is named. It was two-letter tiles once — TP, TT — which is no way to find anything.
 * Words from spaces.md (rail, chrome).
 */
import { computed, ref } from 'vue'
import site, { places as SITE_PLACES } from '#site'
import { isSignedIn } from '@platform-kit/kit/lib/auth.js'
import { us } from '@platform-kit/kit/lib/content.js'
import { net } from '@platform-kit/kit/lib/network/api.js'
import { chatNavigation, lockedPlaces } from '@platform-kit/kit/lib/community/places.js'
import SpaceIcon from './SpaceIcon.vue'
import SpaceAvatar from './SpaceAvatar.vue'

const props = defineProps({
  /* the reader's OWN record, so the chip draws the face they designed and not one made from their name */
  myPerson: { type: Object, default: null },
  spaces: { type: Array, default: () => [] },
  badges: { type: Object, default: () => ({}) },   /* space id → what is owed there */
  openId: { type: String, default: '' },           /* the space being read, if any */
  view: { type: String, default: 'channel' },
  inSpace: { type: Boolean, default: true },
  /* this reader may talk to a coach here (coaching.where: 'spaces'; places.js coachingPlace) */
  coaching: { type: Boolean, default: false },
  coachingUnread: { type: Number, default: 0 },
  events: { type: Boolean, default: true },
  work: { type: Array, default: () => [] },
  saved: { type: Number, default: 0 },
  drafts: { type: Number, default: 0 },
  /* a customer's own tickets, where they have any */
  myTickets: { type: Number, default: 0 },
  mentions: { type: Number, default: 0 },
  dmUnread: { type: Number, default: 0 },          /* how many direct messages have something unread */
  /* how many messages are waiting across every room — the count on the Unreads place */
  unreads: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  me: { type: String, default: '' },
  names: { type: Object, default: () => ({}) },
  myself: { type: String, default: '' },   /* what this person is called, from their own account */
  /* THE NETWORK, where the site makes it one place with the spaces (in the chat layout, community.layout): its feed and
     what has happened to the reader, under Home, with the count of what is new */
  network: { type: Boolean, default: false },
  networkUnread: { type: Number, default: 0 },
})
const emit = defineEmits(['view', 'open-space', 'status'])
const W = computed(() => us('spaces').rail.main)
const C = computed(() => us('spaces').chrome.main)
const P = computed(() => us('spaces').page.main)
const S = computed(() => us('network').shell.main)
const picking = ref(false)
const STATUSES = ['active', 'away', 'dnd']
/* the names map is the open space's own, and somebody in no space has none — so their own name
   comes from their account rather than reading 'You' at the foot of their own column */
const myName = computed(() => props.names[props.me] || props.myself || P.value.you)
const myPerson = computed(() => props.myPerson)

const SITE_COMMUNITY = (site && site.community) || {}
const NAV = computed(() => chatNavigation({
  network: props.network,
  events: props.events,
  forYou: !!SITE_COMMUNITY.forYou,
  hide: SITE_COMMUNITY.hide || [],
  signedIn: isSignedIn.value,
  coaching: props.coaching,
  places: SITE_PLACES || [],
  counts: {
    dms: props.dmUnread,
    coaching: props.coachingUnread,
    notes: props.networkUnread,
    mentions: props.mentions,
    saved: props.saved,
    drafts: props.drafts,
    tickets: props.myTickets,
  },
  work: props.work,
  locked: isSignedIn.value ? lockedPlaces({
    home: !(props.network && net.access.known && !net.access.read),
    admitted: net.places,
  }) : [],
}))
const MINE = computed(() => [
  ...NAV.value.first,
  ...(props.unreads ? [{ key: 'unreads', icon: 'unread', word: 'unreads', count: props.unreads }] : []),
])
const QUEUE_ICON = { support: 'inbox', tickets: 'ticket', clients: 'people', comments: 'thread', 'social-comments': 'thread', 'social-dms': 'dm' }
const count = (n) => n > 99 ? '99+' : n || ''
const wordOf = (m) => {
  if (m.key === 'index') return W.value.home
  if (m.key === 'net') return W.value.home
  if (m.place || ['saved', 'drafts', 'my-tickets', 'coaching', 'unreads'].includes(m.key)) return W.value[m.word] || m.word
  return S.value[m.word] || W.value[m.word] || m.word
}
const ALWAYS = ['index', 'net', 'net-explore', 'events', 'coaching', 'dms', 'net-notes', 'mentions']
const earned = (m) => ALWAYS.includes(m.key) || m.place || Number(m.count) > 0 || props.view === m.key
const SHOWN = computed(() => MINE.value.filter(earned))
const MORE = computed(() => [
  ...MINE.value.filter((m) => !earned(m)),
  ...(props.view === 'drafts' && !MINE.value.some((m) => m.key === 'drafts') ? [{ key: 'drafts', icon: 'pencil', word: W.value.drafts }] : []),
  ...(props.view === 'my-tickets' && !MINE.value.some((m) => m.key === 'my-tickets') ? [{ key: 'my-tickets', icon: 'ticket', word: W.value['my-tickets'] }] : []),
  ...(props.unreads || props.view === 'unreads' ? [{ key: 'unreads', icon: 'unread', word: W.value.unreads, count: props.unreads }] : []),
  { key: 'threads', icon: 'thread', word: W.value.threads },
  ...(!MINE.value.some((m) => m.key === 'saved') ? [{ key: 'saved', icon: 'star', word: W.value.saved }] : []),
])
const WORK = computed(() => NAV.value.work)
const readSet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
const writeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } }
const workPinned = ref(readSet('pk.nav.work').length > 0)
const workOpen = computed(() => workPinned.value || !!(WORK.value && WORK.value.rows.some((r) => r.key === props.view)))
function toggleWork() { workPinned.value = !workOpen.value; writeSet('pk.nav.work', workPinned.value ? [1] : []) }
const expanded = ref(false)
/* a place somebody is actually looking at is never hidden behind More */
const showMore = computed(() => expanded.value || MORE.value.some((m) => m.key === props.view))
/* THE SPACES, UNDER THEIR OWN HEADINGS. A site with four of them wants them gathered — "Cohorts",
   "The team", "Open to everyone" — for the same reason a space with fifteen rooms wants its groups.
   The heading is the space's own (its file's 'group'), so every member sees the same arrangement:
   unlike a channel's group this is not a thing a person collapses, it is how the site is laid out.
   A site whose spaces name no group gets one unheaded run, which is what three spaces should be. */
const runs = computed(() => {
  const out = []
  for (const sp of props.spaces) {
    const g = (sp.group || '').trim()
    let run = out.find((r) => r.key === g)
    if (!run) { run = { key: g, label: g, list: [] }; out.push(run) }
    run.list.push(sp)
  }
  /* the ungrouped go last whatever order they arrived in: a heading over nothing reads as a mistake,
     and a run with no heading above two that have one reads as a list that lost its first heading */
  return [...out.filter((r) => r.key), ...out.filter((r) => !r.key)]
})
const grouped = computed(() => runs.value.some((r) => r.key))
const here = (s) => props.inSpace && s.id === props.openId
</script>

<template>
  <nav class="sbar" :aria-label="C.spaces">
    <header class="sbar-head"><h2>{{ C.title || P.title }}</h2></header>

    <div class="sbar-body">
      <h3 class="sbar-title">{{ W['mine-title'] }}</h3>
      <ul class="sbar-list">
        <li v-for="m in SHOWN" :key="m.key">
          <button type="button" class="sbar-row" :class="{ on: view === m.key }" @click="emit('view', m.key)">
            <SpaceIcon :name="m.icon" :size="15" /><span class="sbar-label">{{ wordOf(m) }}</span>
            <em v-if="m.count" class="sbar-badge">{{ count(m.count) }}</em>
            <span v-else-if="m.locked" class="sbar-lock" aria-hidden="true"><SpaceIcon name="lock" :size="14" /></span>
          </button>
        </li>
        <li v-if="WORK">
          <button type="button" class="sbar-row sbar-work" :class="{ open: workOpen }" :aria-expanded="workOpen" aria-controls="sbar-work" @click="toggleWork">
            <SpaceIcon name="inbox" :size="15" /><span class="sbar-label">{{ S.work }}</span>
            <span class="sbar-end">
              <em v-if="WORK.count && !workOpen" class="sbar-badge">{{ count(WORK.count) }}</em>
              <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
            </span>
          </button>
          <div id="sbar-work" class="sbar-fold" :class="{ open: workOpen }">
            <ul class="sbar-list sbar-fold-in" :inert="!workOpen || null">
              <li v-for="row in WORK.rows" :key="row.key">
                <button type="button" class="sbar-row sbar-work-item" :class="{ on: view === row.key }" :aria-current="view === row.key ? 'page' : undefined" @click="emit('view', row.key)">
                  <SpaceIcon :name="QUEUE_ICON[row.key] || 'dm'" :size="14" /><span class="sbar-label">{{ W[row.key] }}</span>
                  <em v-if="row.count" class="sbar-badge">{{ count(row.count) }}</em>
                </button>
              </li>
            </ul>
          </div>
        </li>
        <template v-if="showMore">
          <li v-for="m in MORE" :key="m.key">
            <button type="button" class="sbar-row" :class="{ on: view === m.key }" @click="emit('view', m.key)">
              <SpaceIcon :name="m.icon" :size="15" /><span class="sbar-label">{{ wordOf(m) }}</span>
              <em v-if="m.count" class="sbar-badge">{{ count(m.count) }}</em>
            </button>
          </li>
        </template>
        <li>
          <button type="button" class="sbar-row sbar-more" @click="expanded = !expanded">
            <!-- 'chevron-up'/'chevron-down' are not glyphs this set has, so this row drew NOTHING and
                 sat in the column as bare text beside eight rows that all wear one. -->
            <SpaceIcon name="more" :size="15" />
            <span class="sbar-label">{{ showMore ? W['fewer-shortcuts'] : W['more-shortcuts'] }}</span>
          </button>
        </li>
      </ul>

      <template v-for="run in runs" :key="run.key || '_'">
        <!-- one heading over the lot where the site groups none of them; the group's own where it
             does, and the ungrouped run keeps the plain heading at the foot -->
        <h3 class="sbar-title">{{ run.key || W.spaces }}</h3>
        <ul class="sbar-list">
          <li v-for="s in run.list" :key="s.id">
            <button
              type="button" class="sbar-row sbar-space" :class="{ on: here(s) }"
              :aria-current="here(s) ? 'true' : undefined" @click="emit('open-space', s.id)">
              <img v-if="s.thumb" class="sbar-thumb" :src="s.thumb" alt="" loading="lazy" />
              <span class="sbar-label">{{ s.name }}</span>
              <em v-if="(badges[s.id] || {}).mentions" class="sbar-badge">{{ badges[s.id].mentions }}</em>
              <i v-else-if="(badges[s.id] || {}).unread" class="sbar-pip"></i>
            </button>
          </li>
        </ul>
      </template>
      <p v-if="!spaces.length" class="sbar-none">{{ W['none-yet'] }}</p>

      <button type="button" class="sbar-row sbar-find" :class="{ on: view === 'discover' }" @click="emit('view', 'discover')">
        <SpaceIcon name="search" :size="15" /><span class="sbar-label">{{ W['find-space'] }}</span>
      </button>
    </div>

    <footer class="sbar-foot">
      <button type="button" class="sbar-me" :title="W.status + ': ' + W['status-' + status]" @click="picking = !picking">
        <span class="sbar-face">
          <SpaceAvatar :name="myName" :person="myPerson" :size="24" />
          <i class="sbar-dot" :class="'is-' + status"></i>
        </span>
        <span class="sbar-label">{{ myName }}</span>
      </button>
      <ul v-if="picking" class="sbar-menu">
        <li v-for="s in STATUSES" :key="s">
          <button type="button" :class="{ on: status === s }" @click="emit('status', s); picking = false">
            <i class="sbar-dot" :class="'is-' + s"></i>{{ W['status-' + s] }}
          </button>
        </li>
      </ul>
    </footer>
  </nav>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
/* columns and gap said outright: the site's global stylesheet owns bare class names, and it had
   a .sb of its own (a two-column grid with a 26px gap) that laid this column out sideways. */
.sbar { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; min-height: 0;
  background: var(--sp-rail); color: var(--sp-side-ink) }
.sbar-head { display: flex; align-items: center; padding: 0 14px; height: 49px; border: 0;
  border-bottom: 1px solid color-mix(in srgb, #fff 9%, transparent) }
.sbar-head h2 { margin: 0; font-weight: 800; font-size: 16px; letter-spacing: -.01em; color: #fff;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sbar-body { overflow-y: auto; padding: 12px 0 16px }
/* the two runs are told apart by a heading above each, not by indenting one under the other */
.sbar-title { margin: 0 0 5px; padding: 0 14px; font-size: 10px; font-weight: 800; letter-spacing: .09em;
  text-transform: uppercase; color: color-mix(in srgb, var(--sp-side-ink) 48%, transparent) }
.sbar-title + .sbar-list { margin-bottom: 18px }
.sbar-list { list-style: none; margin: 0; padding: 0 8px }
.sbar-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px;
  width: 100%; font: inherit; font-size: 14px; line-height: 1.35; text-align: left; cursor: pointer;
  color: color-mix(in srgb, var(--sp-side-ink) 82%, transparent); background: transparent; border: 0;
  border-radius: 7px; padding: 6px 9px; transition: background .12s ease, color .12s ease }
.sbar-row:hover { color: #fff; background: color-mix(in srgb, #fff 8%, transparent) }
.sbar-row.on { color: #fff; background: color-mix(in srgb, #fff 11%, transparent) }
.sbar-end { display: flex; align-items: center; gap: 5px }
.sbar-work svg { color: var(--sp-side-ink); transition: transform .3s cubic-bezier(.2, .8, .2, 1) }
.sbar-work.open svg { transform: rotate(180deg) }
.sbar-work-item { padding-left: 28px; font-size: 13px }
.sbar-fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .35s cubic-bezier(.2, .8, .2, 1) }
.sbar-fold.open { grid-template-rows: 1fr }
.sbar-fold-in { min-height: 0; overflow: hidden; opacity: 0; transform: translateY(-4px); transition: opacity .25s ease, transform .3s ease }
.sbar-fold.open .sbar-fold-in { opacity: 1; transform: none; padding-top: 2px; padding-bottom: 6px }
.sbar-lock { margin-left: auto; display: grid; place-items: center; color: var(--sp-side-ink); opacity: .7 }
/* A SPACE IS THE BIGGER THING. It is set larger and heavier than one of the person's places, and the
   one being read carries a bar down its edge — so the column says at a glance where you are. */
/* a space that has a picture shows it; one without is its name, which reads perfectly well */
.sbar-space:has(.sbar-thumb) { grid-template-columns: auto minmax(0, 1fr) auto }
.sbar-thumb { width: 18px; height: 18px; border-radius: 5px; object-fit: cover; display: block }
.sbar-space { grid-template-columns: minmax(0, 1fr) auto; position: relative; font-size: 15px; font-weight: 650;
  padding-left: 13px; margin-bottom: 1px; color: color-mix(in srgb, var(--sp-side-ink) 92%, transparent) }
.sbar-space.on::before { content: ''; position: absolute; left: 3px; top: 7px; bottom: 7px; width: 3px;
  border-radius: 2px; background: var(--sp-badge) }
.sbar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sbar-more { color: var(--sp-dim, var(--ink3)); font-weight: 600 }
.sbar-more:hover { color: var(--sp-ink, var(--ink)) }
.sbar-badge { min-width: 18px; height: 18px; display: grid; place-items: center; font-style: normal;
  font-size: 11px; font-weight: 800; color: #fff; background: var(--sp-badge); border-radius: 999px; padding: 0 5px }
.sbar-pip { width: 7px; height: 7px; border-radius: 50%; background: color-mix(in srgb, #fff 70%, transparent) }
.sbar-none { margin: 0 14px; max-width: none; font-size: 12.5px; line-height: 1.5;
  color: color-mix(in srgb, var(--sp-side-ink) 55%, transparent) }
.sbar-find { width: calc(100% - 16px); margin: 8px 8px 0; font-size: 13.5px;
  color: color-mix(in srgb, var(--sp-side-ink) 70%, transparent) }
/* who you are, at the foot, where a workspace chat has always put it */
.sbar-foot { position: relative; padding: 7px 8px; border-top: 1px solid color-mix(in srgb, #fff 9%, transparent) }
.sbar-me { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 9px; width: 100%;
  font: inherit; font-size: 13.5px; font-weight: 600; text-align: left; cursor: pointer; color: #fff;
  background: transparent; border: 0; border-radius: 7px; padding: 5px 7px }
.sbar-me:hover { background: color-mix(in srgb, #fff 8%, transparent) }
.sbar-face { position: relative; display: block; width: 24px; height: 24px }
/* here, away, not now: filled, hollow, a bar through it — never colour alone */
.sbar-dot { position: absolute; right: -2px; bottom: -2px; width: 10px; height: 10px; border-radius: 50%;
  background: transparent; border: 2px solid var(--sp-rail);
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--sp-side-ink) 50%, transparent) }
.sbar-dot.is-active { background: #2bac76; box-shadow: none }
.sbar-dot.is-dnd { background: #d9a13d; box-shadow: none }
.sbar-menu { position: absolute; left: 8px; right: 8px; bottom: calc(100% + 4px); z-index: 20; list-style: none;
  margin: 0; padding: 4px; background: var(--paper); border: 1px solid var(--hair); border-radius: 9px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, .35); transform-origin: bottom left;
  animation: sbmenu .16s var(--sp-ease, ease) both }
@keyframes sbmenu { from { opacity: 0; transform: translateY(4px) scale(.98) } }
.sbar-menu button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit;
  font-size: 13.5px; color: var(--ink); background: transparent; border: 0; border-radius: 6px; padding: 6px 8px; cursor: pointer }
.sbar-menu button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent) }
.sbar-menu button.on { font-weight: 700 }
.sbar-menu .sbar-dot { position: static; border: 0; flex: none }
</style>
