<script setup>
/*
 * THE SOCIAL LAYOUT'S NAVIGATION (community.layout: social) — two sections, as Circle and Skool keep
 * theirs. The first, with no heading: Home, Explore (where For You is on), Messages, Events,
 * Notifications; then Saved, Drafts and a customer's own tickets, each only while it holds something
 * and the site has not hidden it (community.hide); then Work for whoever answers a queue — one row,
 * one count for everything waiting, unfolding to a row per queue. The second: the spaces, each folded
 * to one row with its unread count unless the reader is in it or opened it themselves, and Browse
 * spaces at the foot. What is in it is lib/community/places.js — one pure list the
 * community-nav test holds for every kind of person; this draws it. On a phone the most used become a
 * bar along the bottom, and Spaces opens the rest. Words from spaces.md (rail) and network.md (shell).
 */
import { computed, ref, watch } from 'vue'
import site, { places as SITE_PLACES } from '#site'
import { us } from 'platformkit/lib/content.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import { admission, net } from 'platformkit/lib/network/api.js'
import { discover } from 'platformkit/lib/spaces/api.js'
import { unreadOf } from 'platformkit/lib/spaces/model.js'
import { socialPlaces, lockedPlaces, spaceOpen, roomsOf as roomsIn, foldOf, spaceItems } from 'platformkit/lib/community/places.js'
import SpaceIcon from '../spaces/SpaceIcon.vue'

const props = defineProps({
  view: { type: String, default: '' },
  network: { type: Boolean, default: false },
  events: { type: Boolean, default: true },
  spaces: { type: Array, default: () => [] },
  channels: { type: Array, default: () => [] },
  unread: { type: Array, default: () => [] },
  spaceId: { type: String, default: '' },
  channelId: { type: String, default: '' },
  /* the queues this reader answers, and what waits in each — exactly the chat layout's */
  work: { type: Array, default: () => [] },     /* [{ key, count }] */
  coachingUnread: { type: Number, default: 0 },
  dmUnread: { type: Number, default: 0 },
  mentions: { type: Number, default: 0 },
  netUnread: { type: Number, default: 0 },
  saved: { type: Number, default: 0 },
  drafts: { type: Number, default: 0 },
  myTickets: { type: Number, default: 0 },
  /* this reader has a coaching place in the community: its own row after Messages */
  coaching: { type: Boolean, default: false },
  /* the column, or (on a phone) the bar along the bottom — drawn apart, since the column slides in a drawer */
  part: { type: String, default: 'full' },
  /* the spaces with something coming up, and the ones this reader keeps: their Events and
     Moderation rows (a space of several rooms carries its places here rather than as tabs) */
  eventSpaces: { type: Array, default: () => [] },
  keeps: { type: Array, default: () => [] },
})
const emit = defineEmits(['view', 'space', 'open', 'place', 'drawer'])
const W = computed(() => us('spaces').rail.main)
const S = computed(() => us('network').shell.main)
const count = (n) => (n > 99 ? '99+' : n || '')
const C = (site && site.community) || {}

/* THE FIRST SECTION AND WORK, from the one list */
const places = computed(() => socialPlaces({
  network: props.network, events: props.events, forYou: !!C.forYou, hide: C.hide || [], signedIn: isSignedIn.value, coaching: props.coaching, places: SITE_PLACES || [],
  counts: { dms: props.dmUnread, coaching: props.coachingUnread, notes: props.netUnread, mentions: props.mentions, saved: props.saved, drafts: props.drafts, tickets: props.myTickets },
  work: props.work,
  /* what this reader may not enter: kept in the list, marked, opening on the join card */
  locked: isSignedIn.value ? lockedPlaces({ home: !(props.network && net.access.known && !net.access.read), admitted: net.places }) : [],
}))
const wordOf = (m) => (m.place ? W.value[m.word] || m.word : m.word === 'saved' || m.word === 'drafts' || m.word === 'my-tickets' || m.word === 'coaching' ? W.value[m.word] : S.value[m.word])
const QUEUE_ICON = { support: 'head', tickets: 'ticket', clients: 'people', comments: 'thread', 'social-comments': 'thread', 'social-dms': 'dm' }
const isOn = (key) => props.view === key || (key === 'net' && props.view === 'net' && !props.channelId)

/* THE INBOX unfolds by hand, or while one of its rows is open; remembered per browser */
const readSet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
const writeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } }
const inbox = computed(() => places.value.first.find((m) => m.group) || null)
const inboxPinned = ref(readSet('pk.nav.inbox').length > 0)
const inboxOpen = computed(() => inboxPinned.value || !!(inbox.value && inbox.value.rows.some((r) => r.key === props.view)))
function toggleInbox() { inboxPinned.value = !inboxOpen.value; writeSet('pk.nav.inbox', inboxPinned.value ? [1] : []) }

/* THE SPACES fold unless the reader is in one or opened it themselves */
const opened = ref(readSet('pk.nav.open'))
const isOpen = (id) => spaceOpen(id, props.spaceId, opened.value)
function toggleSpace(id) {
  const next = opened.value.includes(id) ? opened.value.filter((x) => x !== id) : [...opened.value, id]
  /* folding the space being read means: not pinned open; it stays unfolded while it is read */
  opened.value = next; writeSet('pk.nav.open', next)
}
/* a space's rooms, its feed first; a space of one room has nothing to unfold, and its row opens it
   (the page opens a space on what it holds — places.js frontOf) */
const roomsOf = (id) => roomsIn(id, props.channels)
const foldsOf = (id) => foldOf(id, props.channels)
/* what a space of several rooms unfolds to: its rooms, then Events, People and Moderation */
const itemsOf = (id) => spaceItems(id, props.channels, { events: props.eventSpaces.includes(id), keeps: props.keeps.includes(id) })
const PLACE_ICON = { events: 'calendar', people: 'people', keeping: 'shield' }
const PLACE_WORD = { events: 'events', people: 'directory', keeping: 'keeping' }
const placeOn = (id, key) => props.spaceId === id && props.view === (key === 'events' ? 'space-events' : key)
/* a space of one room is lit while the reader is in it — never while one of the first section's places,
   the Inbox's rows, the index or Browse is open, though the page still remembers the space last read */
const spaceOnHere = (id) => props.spaceId === id && !foldsOf(id).length && !['index', 'discover'].includes(props.view)
  && !places.value.first.some((m) => m.key === props.view) && !(inbox.value && inbox.value.rows.some((r) => r.key === props.view))
const rowOf = (id) => props.unread.find((r) => r.channel === id) || null
const unreadIn = (id) => { const r = rowOf(id); return r ? unreadOf(r) : 0 }
const spaceUnread = (id) => roomsOf(id).reduce((n, c) => n + unreadIn(c.id), 0)

/* THE SPACES SECTION is for somebody with a space, or a space they could join: a reader in none, with
   none open to them (a members' community, seen by somebody who is not one), is not shown a heading and
   a page that says there is nothing here. Asked once, only while they are in none. */
const joinable = ref(0)
watch(() => [isSignedIn.value, props.spaces.length], async ([signed, n]) => {
  if (!signed || n) return
  try { const list = await discover(); joinable.value = Array.isArray(list) ? list.length : 0 } catch { joinable.value = 0 }
}, { immediate: true })
/* where the site sells its network, whether this reader may post: asked as the navigation mounts */
watch(() => [props.network, isSignedIn.value], ([on, signed]) => { if (on && signed) admission().catch(() => {}) }, { immediate: true })
</script>

<template>
  <nav v-if="part === 'full'" class="sn" :aria-label="S.label">
    <div class="sn-scroll">
      <!-- THE FIRST SECTION: no heading -->
      <ul class="sn-list">
        <li v-for="m in places.first" :key="m.key">
          <!-- THE INBOX: one row, one count; the queues and Direct Messages under it -->
          <template v-if="m.group">
            <button type="button" class="sn-i sn-work" :class="{ open: inboxOpen }" :aria-expanded="inboxOpen" @click="toggleInbox">
              <span class="sn-ic"><SpaceIcon name="inbox" :size="20" /></span>
              <span class="sn-w">{{ S.inbox }}</span>
              <!-- the total says what is folded away; open, each row says its own -->
              <em v-if="m.count && !inboxOpen" class="sn-c">{{ count(m.count) }}</em>
              <svg class="sn-chev" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
            </button>
            <div class="sn-fold" :class="{ open: inboxOpen }">
              <ul class="sn-list sn-fold-in sn-sub" :inert="!inboxOpen || null">
                <li v-for="r in m.rows" :key="r.key">
                  <button type="button" class="sn-i sn-small" :class="{ on: view === r.key }" :aria-current="view === r.key ? 'page' : null" @click="emit('view', r.key)">
                    <span class="sn-ic"><SpaceIcon :name="QUEUE_ICON[r.key] || 'dm'" :size="17" /></span>
                    <span class="sn-w">{{ r.key === 'dms' ? S.messages : W[r.key] }}</span>
                    <em v-if="r.count" class="sn-c">{{ count(r.count) }}</em>
                    <span v-else-if="r.locked" class="sn-lock" aria-hidden="true"><SpaceIcon name="lock" :size="14" /></span>
                  </button>
                </li>
              </ul>
            </div>
          </template>
          <button v-else type="button" class="sn-i" :class="{ on: isOn(m.key) }" :aria-current="isOn(m.key) ? 'page' : null" @click="emit('view', m.key)">
            <span class="sn-ic"><SpaceIcon :name="m.icon" :size="20" /></span>
            <span class="sn-w">{{ wordOf(m) }}</span>
            <em v-if="m.count" class="sn-c">{{ count(m.count) }}</em>
            <span v-else-if="m.locked" class="sn-lock" aria-hidden="true"><SpaceIcon name="lock" :size="14" /></span>
          </button>
        </li>
      </ul>

      <!-- THE SPACES: each one row until it is read or opened -->
      <div v-if="spaces.length || (isSignedIn && joinable > 0)" class="sn-sec">
        <button type="button" class="sn-head" :class="{ on: view === 'index' }" @click="emit('view', 'index')">{{ W.spaces }}</button>
        <ul class="sn-list">
          <li v-for="sp in spaces" :key="sp.id" class="sn-sp" :class="{ open: isOpen(sp.id) }">
            <div class="sn-sprow">
              <button type="button" class="sn-i sn-space" :class="{ on: spaceOnHere(sp.id) }" @click="emit('space', sp.id)">
                <span class="sn-mark" aria-hidden="true">{{ (sp.name || '?').slice(0, 1) }}</span>
                <span class="sn-w">{{ sp.name }}</span>
                <em v-if="(!isOpen(sp.id) || !foldsOf(sp.id).length) && spaceUnread(sp.id)" class="sn-c">{{ count(spaceUnread(sp.id)) }}</em>
              </button>
              <button v-if="foldsOf(sp.id).length" type="button" class="sn-fold-btn" :aria-expanded="isOpen(sp.id)" :aria-label="sp.name" @click="toggleSpace(sp.id)">
                <svg class="sn-chev" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
              </button>
            </div>
            <div v-if="foldsOf(sp.id).length" class="sn-fold" :class="{ open: isOpen(sp.id) }">
              <ul class="sn-rooms sn-fold-in" :inert="!isOpen(sp.id) || null">
                <li v-for="it in itemsOf(sp.id)" :key="it.key" :class="{ 'sn-place-first': it.kind === 'place' && it.key === itemsOf(sp.id).find((x) => x.kind === 'place').key }">
                  <button v-if="it.kind === 'room'" type="button" class="sn-room" :class="{ on: channelId === it.key && view === 'channel', bold: unreadIn(it.key) > 0 }" @click="emit('open', it.key)">
                    <SpaceIcon :name="it.room.mode === 'feed' ? 'feed' : it.room.visibility === 'private' ? 'lock' : 'hash'" :size="14" />
                    <span>{{ it.room.name }}</span>
                  </button>
                  <!-- the space's places, after its rooms: what is on, who is in it, keeping it -->
                  <button v-else type="button" class="sn-room sn-place" :class="{ on: placeOn(sp.id, it.key) }" @click="emit('place', sp.id, it.key)">
                    <SpaceIcon :name="PLACE_ICON[it.key]" :size="14" />
                    <span>{{ W[PLACE_WORD[it.key]] }}</span>
                  </button>
                </li>
              </ul>
            </div>
          </li>
          <li>
            <button type="button" class="sn-i sn-small sn-browse" :class="{ on: view === 'discover' }" @click="emit('view', 'discover')">
              <span class="sn-ic"><SpaceIcon name="plus" :size="17" /></span>
              <span class="sn-w">{{ W['browse-spaces'] }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </nav>

  <!-- ON A PHONE: the most used along the bottom; Spaces opens the rest -->
  <nav v-else class="sn-bottom" :aria-label="S.label">
      <button type="button" :class="{ on: isOn(network ? 'net' : 'index') }" :aria-label="S.home" @click="emit('view', network ? 'net' : 'index')"><SpaceIcon name="home" :size="22" /></button>
      <button v-if="places.first.some((m) => m.key === 'net-explore')" type="button" :class="{ on: view === 'net-explore' }" :aria-label="S.explore" @click="emit('view', 'net-explore')"><SpaceIcon name="search" :size="22" /></button>
      <button type="button" :aria-label="W.spaces" @click="emit('drawer')"><SpaceIcon name="people" :size="22" /></button>
      <button v-if="isSignedIn" type="button" :class="{ on: view === 'dms' }" :aria-label="S.messages" @click="emit('view', 'dms')"><SpaceIcon name="dm" :size="22" /><em v-if="dmUnread + coachingUnread" class="sn-n">{{ count(dmUnread + coachingUnread) }}</em></button>
      <button v-if="isSignedIn" type="button" :class="{ on: view === 'net-notes' || view === 'mentions' }" :aria-label="S.notifications" @click="emit('view', network ? 'net-notes' : 'mentions')"><SpaceIcon name="bell" :size="22" /><em v-if="network ? netUnread : mentions" class="sn-n">{{ count(network ? netUnread : mentions) }}</em></button>
      <button v-if="!isSignedIn" type="button" :class="{ on: view === 'events' }" :aria-label="S.events" @click="emit('view', 'events')"><SpaceIcon name="calendar" :size="22" /></button>
  </nav>
</template>

<style scoped>
/* ONE CURVE for the whole frame, the support chat's own */
.sn { --e: cubic-bezier(.2, .8, .2, 1); height: 100%; min-height: 0; border-right: 1px solid var(--hair); font-family: var(--fb, inherit);
  /* the page's own ground shows through: the navigation is part of the page, not a panel on it */
  background: transparent }
.sn-scroll { height: 100%; overflow-y: auto; padding: 14px 12px 24px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; scrollbar-width: thin }
.sn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px }
.sn-i { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 12px; border: 0; border-radius: 10px; background: transparent;
  font: inherit; font-size: 15px; font-weight: 500; color: var(--ink); text-align: left; text-decoration: none; cursor: pointer;
  transition: background .25s var(--e), color .25s var(--e) }
.sn-i .sn-ic { transition: transform .3s var(--e) }
.sn-i:hover { background: color-mix(in srgb, var(--ink) 6%, transparent) }
.sn-i:hover .sn-ic { transform: scale(1.08) }
.sn-i:active .sn-ic { transform: scale(.94) }
.sn-i.on { font-weight: 700; background: color-mix(in srgb, var(--accent) 9%, transparent) }
.sn-i.on .sn-ic { color: var(--accent) }
.sn-i:focus-visible, .sn-room:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.sn-i.sub { padding-left: 46px; font-size: 15px }
.sn-small { font-size: 14px; padding: 7px 12px; gap: 11px }
.sn-sub { padding: 2px 0 4px 18px }
.sn-work .sn-c { margin-left: auto }
.sn-work .sn-chev { margin-left: 4px; color: var(--ink3); transition: transform .3s var(--e) }
.sn-work:not(:has(.sn-c)) .sn-chev { margin-left: auto }
.sn-work.open .sn-chev { transform: rotate(180deg) }
.sn-sprow { position: relative; display: flex; align-items: center }
.sn-sprow .sn-space { padding-right: 34px }
.sn-fold-btn { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 8px;
  background: transparent; color: var(--ink3); cursor: pointer; opacity: 0; transition: opacity .2s var(--e), background .2s var(--e) }
.sn-sprow:hover .sn-fold-btn, .sn-fold-btn:focus-visible, .sn-sp.open .sn-fold-btn { opacity: 1 }
.sn-fold-btn:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink) }
.sn-fold-btn .sn-chev { transition: transform .3s var(--e) }
.sn-sp.open .sn-fold-btn .sn-chev { transform: rotate(180deg) }
.sn-sp .sn-space .sn-c { margin-left: auto }
.sn-browse { color: var(--ink2) }
.sn-ic { position: relative; display: grid; place-items: center; line-height: 0 }
.sn-n { position: absolute; top: -7px; right: -10px; min-width: 18px; padding: 0 5px; border-radius: 999px; border: 2px solid var(--paper);
  background: var(--accent); color: var(--paper); font-style: normal; font-size: 11px; font-weight: 700; line-height: 15px; text-align: center;
  animation: sn-pop .4s var(--e) }
@keyframes sn-pop { from { transform: scale(.4); opacity: 0 } }
.sn-c { margin-left: auto; min-width: 20px; padding: 1px 7px; border-radius: 999px; font-style: normal; font-size: 12px; font-weight: 700; text-align: center;
  color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent) }
.sn-w { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
/* a place this reader may not enter: the row stays, quiet, with a small lock where a count would be */
.sn-lock { margin-left: auto; display: grid; place-items: center; color: var(--ink3); opacity: .7 }
.sn-sec { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--hair) }
.sn-head, .sn-label { display: block; margin: 0 0 6px; padding: 2px 12px; border: 0; background: transparent; font: inherit; font-size: 11.5px; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); text-align: left; cursor: pointer; transition: color .2s var(--e) }
.sn-label { cursor: default }
.sn-head.on, .sn-head:hover { color: var(--ink) }
.sn-space { font-size: 15px; padding: 6px 12px 6px 8px; gap: 11px }
.sn-mark { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; font-size: 12.5px; color: #fff; font-weight: 800; font-size: 14px; text-transform: uppercase;
  background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 70%, #fff) 0%, var(--accent) 55%, color-mix(in srgb, var(--accent) 80%, #000) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .25), 0 2px 6px -2px color-mix(in srgb, var(--accent) 60%, transparent) }
.sn-rooms { list-style: none; margin: 2px 0 8px 27px; padding: 0 0 0 10px; border-left: 1.5px solid var(--hair) }
.sn-room { position: relative; display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 12px; border: 0; border-radius: 10px; background: transparent;
  font: inherit; font-size: 14.5px; color: var(--ink2); text-align: left; cursor: pointer; transition: background .2s var(--e), color .2s var(--e) }
.sn-room:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink) }
.sn-room.on { background: color-mix(in srgb, var(--accent) 11%, transparent); color: var(--ink); font-weight: 700 }
/* the places after the rooms, a breath apart */
.sn-place-first { margin-top: 6px }
.sn-room.on::before { content: ''; position: absolute; left: -11.5px; top: 7px; bottom: 7px; width: 2.5px; border-radius: 2px; background: var(--accent) }
.sn-room.bold { color: var(--ink); font-weight: 700 }
.sn-room span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
/* Work and the spaces fold their lists in and out by height, not by appearing */
.sn-fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .35s var(--e) }
.sn-fold.open { grid-template-rows: 1fr }
.sn-fold-in { min-height: 0; overflow: hidden; opacity: 0; transform: translateY(-4px); transition: opacity .25s var(--e), transform .3s var(--e) }
.sn-fold.open .sn-fold-in { opacity: 1; transform: none; padding: 2px 0 6px 12px }
.sn-bottom { display: none }
@media (max-width: 700px) {
  .sn-bottom { --e: cubic-bezier(.2, .8, .2, 1); position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; display: flex; justify-content: space-around;
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom)); border-top: 1px solid var(--hair);
    background: color-mix(in srgb, var(--paper) 86%, transparent); backdrop-filter: blur(18px) saturate(1.6); -webkit-backdrop-filter: blur(18px) saturate(1.6) }
  .sn-bottom > * { position: relative; display: grid; place-items: center; width: 52px; height: 44px; border: 0; border-radius: 14px; background: transparent; color: var(--ink3);
    transition: color .2s var(--e), background .2s var(--e), transform .2s var(--e) }
  .sn-bottom > *:active { transform: scale(.92) }
  .sn-bottom > .on { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent) }
  .sn-bottom .sn-n { top: 3px; right: 6px }
}
@media (prefers-reduced-motion: reduce) {
  .sn-i, .sn-i .sn-ic, .sn-fold, .sn-fold-in, .sn-chev, .sn-n, .sn-bottom > * { transition: none; animation: none }
}
</style>
