<script setup>
/*
 * A CHANNEL READ AS A BOARD — the index of its conversations, not a list of its first lines.
 *
 * The posts are the same messages a stream shows (a post is one with a title), so nothing was
 * copied to make this view and nothing is written when a channel changes which way it is read.
 * What this file is about is the READING of them, and three decisions carry it:
 *
 *   A board is an index, so a card says who is IN the conversation and when it last moved — a
 *   stack of the voices, and "Ada replied 20m ago" — rather than repeating the opening sentence
 *   in grey under the title. A row of identical cards showing first lines tells a reader nothing
 *   about which one to open; faces and a time tell them everything.
 *
 *   A board is read across, so it keeps a measure. This view owns the whole pane, and a card set
 *   across seventeen hundred pixels is a card nobody reads to the end of.
 *
 *   A board is chosen from, so it can be sorted and filtered — latest activity, newest, most
 *   replies; everything, unanswered, yours. Both are the reader's own and are remembered per
 *   channel, because whoever sorts by unanswered is answering, and will do it again tomorrow.
 *
 * Opening a post does NOT open a side panel: in a forum the post IS the content, and the board is
 * the index to it, so SpacesPage gives the whole pane over to SpacePost. Words: spaces.md channel.
 */
import { computed, ref, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { plainBody, saidBy, titleOf } from '@platform-kit/kit/lib/spaces/model.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  posts: { type: Array, default: () => [] },
  names: { type: Object, default: () => ({}) },
  flair: { type: Object, default: () => ({}) },
  faces: { type: Object, default: () => ({}) },
  me: { type: String, default: '' },
  channel: { type: String, default: '' },     /* its name, for the line an empty board says */
  channelId: { type: String, default: '' },   /* what the reader's sort is remembered against */
  /* a sealed board says so too: the stream says it where its timeline begins, and a forum has no
     timeline, so it says it above the posts. The same sentence either way, from the same words. */
  encrypted: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'new'])
const W = computed(() => us('spaces').channel.main)
const P = computed(() => us('spaces').page.main)
const EN = computed(() => us('spaces').encryption)

/* saidBy, not a bare names lookup: a bot has no author_id and carries its name on meta, so a lookup
   by id called every one of its posts "someone" while the thread beside it said The Scribe */
const named = (m) => saidBy(m, props.names, P.value.someone)
const who = (m) => (m.author_id && m.author_id === props.me ? P.value.you : named(m))
const nameOf = (id) => (id && id === props.me ? P.value.you : (props.names[id] || P.value.someone))
/* the name a FACE draws its initials from is always the person's own: initials of "You" is a Y, and
   that is nobody. "You" belongs in the sentence under the title, not on the avatar. */
const faceOf = (id) => props.names[id] || P.value.someone

/* HOW LONG AGO, in as few characters as it takes. A board is scanned, and "20m" is scanned; "20
   September 2026 at 14:03" is read, which is a different and slower thing. Anything older than a
   week is a date, because by then the exact hour has stopped mattering. */
function ago(v) {
  const d = new Date(v)
  if (isNaN(d)) return ''
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (s < 60) return W.value['just-now']
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  if (s < 604800) return Math.floor(s / 86400) + 'd'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
const moved = (p) => p.last_reply_at || p.created_at
const replies = (p) => Number(p.reply_count) || 0

/* the line under the title: who spoke last and when, or who started it and when. Never both — a
   card with two dates on it makes a reader work out which one they are looking at. */
function line(p) {
  const n = replies(p)
  if (n && p.last_reply_by) return (W.value.replied || '').replace('{who}', nameOf(p.last_reply_by)).replace('{when}', ago(p.last_reply_at))
  /* nobody to name — the last word was a bot's, which carries no author. "someone replied" is worse
     than not saying who: it invents a person. Say when, and leave who out. */
  if (n) return (W.value['last-reply'] || '').replace('{when}', ago(p.last_reply_at))
  return (W.value.started || '').replace('{who}', who(p)).replace('{when}', ago(p.created_at))
}
/* the faces: the voices the row carries, the reader's own always last so the stack reads as other
   people. A post from before the board asked for voices has only its author, which is the truth. */
/* the faces: whoever has spoken in the post, most recent first. A BOT has no author_id — it carries
   its name on the row — so its post is drawn under its own face rather than off a blank gutter,
   which left every one of them indented by 36 pixels for nothing. */
const voices = (p) => {
  const ids = (Array.isArray(p.voices) ? p.voices : []).filter(Boolean)
  const all = ids.length ? ids : (p.author_id ? [p.author_id] : [])
  const out = [...new Set(all)].slice(0, 4).map((id) => ({ id, name: faceOf(id) }))
  return out.length ? out : [{ id: 'bot', name: named(p) }]
}
const countWord = (n) => (n === 1 ? W.value['replies-one'] : (W.value['replies-many'] || '').replace('{n}', n))

/* THE READER'S OWN ORDER, kept per channel: whoever sorts a board by what is unanswered is
   answering it, and will be back tomorrow to answer more. */
const SORTS = ['active', 'new', 'busy']
const SHOWS = ['all', 'open', 'mine']
const key = computed(() => 'dl.forum.' + (props.channelId || props.channel || ''))
const sort = ref('active')
const show = ref('all')
const menu = ref('')
function remember() { try { localStorage.setItem(key.value, sort.value + ':' + show.value) } catch (e) { /* private window */ } }
function recall() {
  try {
    const [a, b] = String(localStorage.getItem(key.value) || '').split(':')
    sort.value = SORTS.includes(a) ? a : 'active'
    show.value = SHOWS.includes(b) ? b : 'all'
  } catch (e) { sort.value = 'active'; show.value = 'all' }
}
watch(key, recall, { immediate: true })
function pick(what, v) { (what === 'sort' ? sort : show).value = v; menu.value = ''; remember() }

const shown = computed(() => {
  let list = props.posts.filter((p) => (show.value === 'open' ? !replies(p) : show.value === 'mine' ? p.author_id === props.me : true))
  const by = sort.value === 'new' ? (a, b) => new Date(b.created_at) - new Date(a.created_at)
    : sort.value === 'busy' ? (a, b) => replies(b) - replies(a) || new Date(moved(b)) - new Date(moved(a))
    : (a, b) => new Date(moved(b)) - new Date(moved(a))
  list = [...list].sort(by)
  /* what the room pinned stands above whatever the reader chose: it was pinned to be seen */
  return [...list.filter((p) => p.pinned), ...list.filter((p) => !p.pinned)]
})
</script>

<template>
  <div class="sf">
    <!-- …and a sealed board says so above everything, empty or not: it is a standing fact about
         the room, so it is there whether there is one post or two hundred. -->
    <div v-if="encrypted" class="sf-sealed">
      <p class="sf-sealed-head">{{ EN.room.sealed }}</p>
      <p>{{ EN.room['sealed-line'] }}</p>
      <p class="sf-sealed-why">{{ EN.room.history }} {{ EN.room['history-line'] }}</p>
    </div>
    <!-- A BOARD WITH NOTHING ON IT SAYS SO. It rendered a button and then a screenful of nothing,
         which reads as broken rather than as empty — and a new community's rooms are all empty on
         the day it opens, which is exactly when somebody is deciding whether the place is real. -->
    <div v-if="!posts.length" class="su-none">
      <h3>{{ W['forum-empty'] }}</h3>
      <p>{{ (W['forum-empty-line'] || '').replace('{channel}', channel) }}</p>
      <button type="button" @click="emit('new')">{{ W['forum-first'] }}</button>
    </div>

    <div v-else class="sf-in">
      <!-- the bar: what is here, how it is ordered, and the one way to add to it. It keeps the
           board's measure rather than the pane's, so the button lines up with the cards' edge. -->
      <header class="sf-bar">
        <span class="sf-n">{{ (W['posts-n'] || '').replace('{n}', posts.length) }}</span>
        <div class="sf-picks">
          <div class="sf-pick">
            <button type="button" class="sf-drop" :aria-expanded="menu === 'show'" @click="menu = menu === 'show' ? '' : 'show'">
              {{ W['show-' + show] }}<SpaceIcon name="chev" :size="11" />
            </button>
            <ul v-if="menu === 'show'" class="sf-menu">
              <li v-for="o in SHOWS" :key="o">
                <button type="button" :class="{ on: show === o }" @click="pick('show', o)">{{ W['show-' + o] }}</button>
              </li>
            </ul>
          </div>
          <div class="sf-pick">
            <button type="button" class="sf-drop" :aria-expanded="menu === 'sort'" @click="menu = menu === 'sort' ? '' : 'sort'">
              {{ W['sort-' + sort] }}<SpaceIcon name="chev" :size="11" />
            </button>
            <ul v-if="menu === 'sort'" class="sf-menu">
              <li v-for="o in SORTS" :key="o">
                <button type="button" :class="{ on: sort === o }" @click="pick('sort', o)">{{ W['sort-' + o] }}</button>
              </li>
            </ul>
          </div>
        </div>
        <button type="button" class="sf-new" @click="emit('new')">
          <SpaceIcon name="pencil" :size="13" />{{ W.post }}
        </button>
      </header>

      <p v-if="!shown.length" class="sf-nomatch">
        <b>{{ W['show-none'] }}</b><span>{{ W['show-none-line'] }}</span>
      </p>

      <ol v-else class="sf-list">
        <li v-for="p in shown" :key="p.id">
          <button type="button" class="sf-post" :class="{ pin: p.pinned }" @click="emit('open', p.id)">
            <!-- the faces first: a conversation is people before it is a subject -->
            <span class="sf-faces" :style="{ width: Math.max(22, 22 + (voices(p).length - 1) * 15) + 'px' }">
              <span v-for="(v, i) in voices(p)" :key="v.id || i" class="sf-face" :style="{ left: (i * 15) + 'px', zIndex: 5 - i }">
                <SpaceAvatar :name="v.name" :size="22" />
              </span>
            </span>
            <span class="sf-body">
              <span class="sf-top">
                <em v-if="p.pinned" class="sf-pinned"><SpaceIcon name="pin" :size="10" />{{ W['pinned-badge'] }}</em>
                <b class="sf-title">{{ p.title || titleOf(p, names) }}</b>
              </span>
              <span class="sf-line">{{ plainBody(p.body, names) }}</span>
              <span class="sf-meta">{{ line(p) }}</span>
            </span>
            <span class="sf-right">
              <!-- the count, always and in the same place: six rows saying "No replies yet" in
                   words is noise where a nought is a fact, and a column that appears and disappears
                   makes a board impossible to scan down. -->
              <em class="sf-count" :class="{ none: !replies(p) }" :title="countWord(replies(p))">
                <SpaceIcon name="thread" :size="12" />{{ replies(p) }}
              </em>
            </span>
          </button>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every class here says what it wants instead */
/* the pane's own .sp-scroll owns this element's padding (a scoped rule from the page applies to a
   child component's root), so the padding that makes the board readable goes on the inside. */
.sf { overflow-y: auto }
/* the same card the stream draws where its timeline begins (.sp-sealed), set here for a board */
.sf-sealed { margin: 14px 16px 0; padding: 12px 14px; border: 1px solid var(--hair);
  border-radius: 10px; background: var(--sp-tint, var(--wash)); max-width: 72ch }
.sf-sealed p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink3) }
.sf-sealed-head { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
  font-weight: 700; color: var(--ink2) !important; margin-bottom: 3px !important }
.sf-sealed-why { margin-top: 6px !important; padding-top: 6px; border-top: 1px solid var(--hair) }
.su-none { padding: 8px 20px 28px }
/* THE MEASURE. This view owns the whole pane, and a card set across seventeen hundred pixels is a
   card nobody reads to the end of. The bar keeps the same one, so its button lines up with the
   cards' right edge rather than floating somewhere out beyond them. */
/* width said outright: the pane is a flex column and this block shrank to its widest child,
   which centred a 560px reading measure in an 814px pane and left the title hanging in mid-air. */
.sf-in { width: 100%; box-sizing: border-box; max-width: 880px; margin: 0 auto; padding: 18px 20px 28px }
/* padding said outright: the site's global stylesheet styles a bare <header> and gave this one
   70px of air above the board and 44 below it — a hole nobody could account for by reading this file. */
.sf-bar { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; padding: 0; border: 0; min-height: 34px }
.sf-n { font-family: var(--m); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3); white-space: nowrap }
.sf-picks { display: flex; align-items: center; gap: 6px; margin-left: auto }
.sf-pick { position: relative }
.sf-drop { display: inline-flex; align-items: center; gap: 5px; width: auto; font: inherit; font-size: 12.5px;
  color: var(--ink2); background: transparent; border: 1px solid var(--hair); border-radius: 999px;
  padding: 5px 10px 5px 12px; cursor: pointer; white-space: nowrap; transition: border-color .12s, color .12s }
.sf-drop:hover { color: var(--ink); border-color: color-mix(in srgb, var(--ink) 28%, transparent) }
.sf-menu { position: absolute; z-index: 20; top: calc(100% + 5px); right: 0; min-width: 150px; list-style: none;
  margin: 0; padding: 5px; background: var(--card); border: 1px solid var(--hair); border-radius: 10px;
  box-shadow: 0 12px 30px -12px rgb(0 0 0 / .3) }
.sf-menu button { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px; color: var(--ink2);
  background: transparent; border: 0; border-radius: 6px; padding: 6px 9px; cursor: pointer }
.sf-menu button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink) }
.sf-menu button.on { color: var(--ink); font-weight: 650 }
/* the global stylesheet gives a bare button the block's whole width; a pill says it is a pill */
.sf-new { display: inline-flex; align-items: center; gap: 6px; width: auto; font: inherit; font-size: 13px;
  font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px;
  padding: 7px 14px; cursor: pointer; white-space: nowrap }
.sf-new:hover { opacity: .88 }

/* the list is a COLUMN. It was once caught by a rule meant for the bar and inherited
   justify-content: space-between and align-items: center from it, which centred the last card and
   shrank it to its own words — the single most visible thing wrong with this view. */
.sf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;
  align-items: stretch; justify-content: flex-start; gap: 0;
  background: var(--card); border: 1px solid var(--hair); border-radius: 14px; overflow: hidden }
.sf-list > li + li { border-top: 1px solid var(--hair) }
/* one surface with hairlines between, not a stack of separate boxes: a board reads as a table of
   conversations, and eight bordered cards with eight shadows reads as eight unrelated things. */
/* the faces align with the TITLE, not with the middle of a card whose height depends on how long
   the opening sentence is: a column of avatars that wanders up and down the page is a column that
   reads as broken. */
.sf-post { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 14px;
  width: 100%; text-align: left; font: inherit; background: transparent; border: 0; padding: 14px 18px;
  cursor: pointer; transition: background .12s }
.sf-post:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.sf-post.pin { background: color-mix(in srgb, var(--accent) 5%, transparent) }
.sf-post.pin:hover { background: color-mix(in srgb, var(--accent) 9%, transparent) }

.sf-faces { position: relative; height: 22px; flex: none; margin-top: 1px }
.sf-face { position: absolute; top: 0; border-radius: 999px; box-shadow: 0 0 0 2px var(--card) }
.sf-post.pin .sf-face { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 5%, var(--card)) }

.sf-body { display: flex; flex-direction: column; gap: 3px; min-width: 0 }
.sf-top { display: flex; align-items: baseline; gap: 8px; min-width: 0 }
.sf-pinned { display: inline-flex; align-items: center; gap: 3px; flex: none; font-family: var(--m); font-style: normal;
  font-size: 9px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--accent) }
.sf-title { font-family: var(--fd); font-weight: 650; font-size: 15.5px; line-height: 1.3; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sf-post:hover .sf-title { text-decoration: underline; text-underline-offset: 3px }
.sf-line { font-size: 13px; line-height: 1.4; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.sf-meta { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }

.sf-right { display: flex; align-items: center; flex: none; margin-top: 1px }
.sf-count { display: inline-flex; align-items: center; gap: 5px; font-family: var(--m); font-style: normal;
  font-size: 12px; font-weight: 600; color: var(--ink2); background: color-mix(in srgb, var(--ink) 6%, transparent);
  border-radius: 999px; padding: 4px 10px }
.sf-count.none { color: var(--ink3); background: transparent; box-shadow: inset 0 0 0 1px var(--hair) }

.sf-nomatch { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 34px 18px; text-align: center }
.sf-nomatch b { font-family: var(--fd); font-weight: 650; font-size: 15px; color: var(--ink) }
.sf-nomatch span { font-size: 13px; color: var(--ink3) }

/* on a phone the faces and the count are what go: the title and who last spoke are the whole point */
@media (max-width: 640px) {
  .sf-in { padding: 14px 12px 22px }
  /* the count goes and the row wraps: at 390 the button was off the edge of the screen */
  .sf-bar { flex-wrap: wrap; gap: 8px }
  .sf-n { display: none }
  .sf-picks { margin-left: 0; flex: 1 1 auto }
  .sf-drop { font-size: 12px; padding: 5px 8px 5px 10px }
  .sf-post { grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 12px 14px }
  .sf-faces { display: none }
  .sf-line { display: none }
}
</style>
