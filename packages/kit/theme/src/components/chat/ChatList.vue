<script setup>
/*
 * The left pane: the reader's conversations, latest first, each with the
 * other party, the last line and how many are unread. Below them, whoever
 * else can be written to — for a member, the coaches they have not yet
 * written to; for a coach, a "New message" that opens the members picker
 * (ChatNewMessage.vue, a modal with a search). Words from content/app/ui/chat.md (page).
 *
 * A coach's inbox also says what is owed: each thread whose last word is the
 * member's carries a badge — "Reply due in 4h", "Overdue by 2h" — against the
 * reply time that member's membership promises (chat-hours on the product files,
 * by their highest tier, or the paid session's for a week of chat), and the list
 * can be ordered by activity, by when a thread was made, or by who is waiting,
 * the longest wait first. The badges keep time on their own, once a minute.
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { say, titleOf } from 'platformkit/lib/provider.js'
import { products as PRODUCTS } from '#content'
import { tierRank } from 'platformkit/lib/storefront.js'
import { previewOf, whenOf, dueOf, spanOf, sortInbox } from 'platformkit/lib/chat/model.js'
import ChatAvatar from './ChatAvatar.vue'

const props = defineProps({
  coach: { type: Boolean, default: false },       /* the reader is a coach */
  conversations: { type: Array, default: () => [] },
  people: { type: Array, default: () => [] },     /* chat_people(): coaches + peers */
  activeId: { type: String, default: null },
  me: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['pick', 'start', 'new'])
const P = us('chat').page.main
const C = us('chat').composer.main

const withThread = computed(() => new Set(props.conversations.map((c) => c.peer && c.peer.id)))
/* a member's coaches not yet written to */
/* chat_people answers with each person's set of roles; a coach is somebody holding `coach` */
const isProviderOf = (p) => !!p && ((p.roles || []).includes('provider') || (p.roles || []).includes('coach'))
const coaches = computed(() => (props.coach ? [] : props.people.filter((p) => isProviderOf(p) && !withThread.value.has(p.id))))
const lastLine = (c) => (c.last ? (c.last.sender_id === props.me ? P.you + ': ' : '') + previewOf(c.last, C) : '')
function start(id) { emit('start', id) }

/* ---- the coach's view: the order, and what each member is owed ---- */
const ORDERS = ['activity', 'created', 'awaiting']
const order = ref((() => { try { return ORDERS.includes(localStorage.getItem('dl.chat.order')) ? localStorage.getItem('dl.chat.order') : 'activity' } catch (e) { return 'activity' } })())
function setOrder(o) { order.value = o; try { localStorage.setItem('dl.chat.order', o) } catch (e) { /* private mode */ } }
const rows = computed(() => (props.coach ? sortInbox(props.conversations, order.value) : props.conversations))
/* the reply time a member's membership promises: their highest tier's product, else the paid session's */
const HOURS = { tier: {}, session: 0 }
for (const p of PRODUCTS) { if (p['chat-hours'] > 0) { if (p.kind === 'membership' && p.tier) HOURS.tier[p.tier] = Math.max(HOURS.tier[p.tier] || 0, p['chat-hours']); if (p.kind === 'session') HOURS.session = HOURS.session ? Math.min(HOURS.session, p['chat-hours']) : p['chat-hours'] } }
const hoursFor = (peer) => {
  if (!peer) return 0
  const tiers = (peer.tiers || []).filter((t) => HOURS.tier[t]).sort((a, b) => tierRank(b) - tierRank(a))
  if (tiers.length) return HOURS.tier[tiers[0]]
  return peer.session_chat ? HOURS.session : 0
}
const now = ref(Date.now())
let tick = null
onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 60000) })
onBeforeUnmount(() => clearInterval(tick))
const owed = (c) => { if (!props.coach) return null; const d = dueOf(c, hoursFor(c.peer), now.value); return d ? { over: d.over, text: (d.over ? P['due-over'] : P['due-in']).replace('{span}', spanOf(d.left)) } : c.awaiting_since ? { over: false, text: P.awaiting, soft: true } : null }
</script>

<template>
  <nav class="cl" :aria-label="P.conversations">
    <div class="cl-head">
      <span class="cl-eyebrow">{{ say(P.eyebrow) }}</span>
      <h1 class="cl-h">{{ P.heading }}</h1>
      <button v-if="coach" type="button" class="cl-new" @click="emit('new')">
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>
        {{ P['new-message'] }}
      </button>
    </div>

    <!-- a coach orders the inbox -->
    <div v-if="coach && conversations.length > 1" class="cl-order" role="radiogroup" :aria-label="P['sort-label']">
      <button v-for="o in ORDERS" :key="o" type="button" role="radio" :aria-checked="order === o" :class="{ on: order === o }" @click="setOrder(o)">{{ P['sort-' + o] }}</button>
    </div>
    <div class="cl-list">
      <p v-if="loading && !conversations.length" class="cl-empty">{{ P.loading }}</p>
      <p v-else-if="!conversations.length && !coaches.length" class="cl-empty">{{ P['empty-list'] }}</p>
      <TransitionGroup name="cl-move">
      <button v-for="c in rows" :key="c.id" type="button" class="cl-row" :class="{ on: c.id === activeId, unread: c.unread > 0, owed: !!owed(c), over: owed(c) && owed(c).over }"
              :aria-current="c.id === activeId ? 'true' : null" @click="emit('pick', c.id)">
        <ChatAvatar :name="c.peer ? c.peer.name : ''" :size="44" :coach="isProviderOf(c.peer)" />
        <span class="cl-body">
          <span class="cl-line1"><b>{{ c.peer ? c.peer.name : '' }}</b><time :datetime="c.last_message_at || c.created_at">{{ whenOf(c.last_message_at || c.created_at, now, P) }}</time></span>
          <span class="cl-line2"><span class="cl-last">{{ lastLine(c) || (isProviderOf(c.peer) ? titleOf(c.peer) : P['member-role']) }}</span><i v-if="c.unread > 0" class="cl-n">{{ c.unread }}</i></span>
          <!-- what is owed: the deadline the membership promises, or just that they are waiting -->
          <span v-if="owed(c)" class="cl-due" :class="{ over: owed(c).over, soft: owed(c).soft }"><i aria-hidden="true" /> {{ owed(c).text }}</span>
        </span>
      </button>
      </TransitionGroup>

      <template v-if="coaches.length">
        <span class="cl-sub">{{ P.coaches }}</span>
        <button v-for="p in coaches" :key="p.id" type="button" class="cl-row cl-person" @click="start(p.id)">
          <ChatAvatar :name="p.name" :size="44" coach />
          <span class="cl-body"><b>{{ p.name }}</b><span>{{ P.start }}</span></span>
        </button>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.cl { display: grid; grid-template-rows: auto auto minmax(0, 1fr); height: 100%; min-height: 0; background: var(--chat-side, #faf9f5) }
.cl-list { grid-row: 3 }
.cl-head { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; align-items: center; column-gap: 10px; padding: 18px 18px 6px 20px }
.cl-eyebrow { grid-column: 1; font-family: var(--m); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3) }
.cl-h { grid-column: 1; margin: 2px 0 0; font-family: var(--fd); font-weight: 600; font-size: 24px; letter-spacing: -.02em; color: var(--ink) }
.cl-new { grid-column: 2; grid-row: 1 / span 2; display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600;
  color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 9px 14px; cursor: pointer; white-space: nowrap; transition: transform .12s }
.cl-new:hover { transform: translateY(-1px) }
.cl-list { overflow-y: auto; padding: 0 10px 14px }
/* the order: three quiet radios in a row under the head */
.cl-order { display: flex; gap: 2px; margin: 6px 18px 8px 20px; padding: 3px; border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); border-radius: 999px; width: max-content; max-width: calc(100% - 38px) }
.cl-order button { font: inherit; font-size: 12px; color: var(--ink3); background: transparent; border: 0; border-radius: 999px; padding: 5px 11px; cursor: pointer; white-space: nowrap; transition: background .15s, color .15s }
.cl-order button.on { color: var(--paper); background: var(--ink) }
/* what is owed: a small line under the preview, red past its time */
.cl-due { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; margin-top: 2px; font-family: var(--m); font-size: 10.5px; letter-spacing: .04em; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 6%, transparent); border-radius: 999px; padding: 2px 8px 2px 6px }
.cl-due i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink3) }
.cl-due.soft { color: var(--ink3); background: transparent; padding-left: 0 }
.cl-due.over { color: #fff; background: var(--accent) }
.cl-due.over i { background: #fff; animation: cl-pulse 1.4s ease-in-out infinite }
@keyframes cl-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
.cl-move-move { transition: transform .3s cubic-bezier(.2,.8,.3,1) }
@media (prefers-reduced-motion: reduce) { .cl-due.over i { animation: none } .cl-move-move { transition: none } }
.cl-sub { display: block; font-family: var(--m); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); padding: 16px 10px 6px }
.cl-empty { font-size: 14px; color: var(--ink3); padding: 18px 12px; margin: 0 }
.cl-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font: inherit; color: var(--ink); background: none; border: 0;
  border-radius: 14px; padding: 11px 12px; cursor: pointer; transition: background .1s }
.cl-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.cl-row.on { background: var(--paper); box-shadow: 0 1px 2px #0000000a, 0 8px 20px -16px #0006 }
.cl-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px }
.cl-line1, .cl-line2 { display: flex; align-items: baseline; justify-content: space-between; gap: 8px }
.cl-row b { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.cl-row time { font-family: var(--m); font-size: 10.5px; color: var(--ink3); white-space: nowrap; flex: none }
.cl-row.unread time { color: var(--accent2) }
.cl-last { font-size: 13.5px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.cl-row.unread .cl-last { color: var(--ink); font-weight: 500 }
.cl-n { flex: none; font-family: var(--m); font-style: normal; font-size: 10.5px; font-weight: 600; color: #fff; background: var(--accent);
  border-radius: 999px; min-width: 19px; height: 19px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center }
.cl-person .cl-body span { font-size: 13px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
</style>
