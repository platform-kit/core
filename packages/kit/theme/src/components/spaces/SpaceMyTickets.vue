<script setup>
/*
 * A PERSON'S OWN TICKETS. What they have asked the business to sort out, and where each one has
 * got to — no queue, no priorities, no assignees, none of the desk's own apparatus. The one
 * question a customer has about a ticket is "what is happening with it", and the answer is its
 * state and whatever anybody has said to them.
 *
 * The internal notes are not filtered out here; they never arrive. The read they come through
 * (support_ticket_mine) leaves them behind in the database, so no mistake in this file can show
 * somebody the team thinking out loud about them.
 *
 * Words from spaces.md (## tickets).
 */
import { computed, ref, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { mine, loadMyTickets, openMyTicket, ageOf } from 'platformkit/lib/desk/tickets.js'
import { stampOf } from 'platformkit/lib/spaces/model.js'
import { messageBlocks } from 'platformkit/lib/chat/markup.js'
import SpaceAvatar from './SpaceAvatar.vue'
import MessageText from '../chat/MessageText.vue'

const W = computed(() => us('spaces').tickets.main)
const now = ref(Date.now())
onMounted(loadMyTickets)

const open = computed(() => mine.open && mine.open.ticket)
const timeline = computed(() => (mine.open && mine.open.timeline) || [])
/* the states as the person who raised it reads them, not as the desk files them */
const stateWord = (s) => W.value['mine-' + s] || W.value['state-' + s] || s
const replies = (t) => (Number(t.replies) === 1 ? W.value['replies-one'] : (W.value['replies-many'] || '').replace('{n}', t.replies))
/* where it got to, rather than the desk's own book-keeping: "now Waiting on you" says the thing
   they want to know, and a from-and-to says the thing we want to know */
const said = (e) => {
  const to = e.kind === 'status' && e.data && e.data.to
  return to ? (W.value['said-now'] || '').replace('{to}', stateWord(to)) : ''
}
</script>

<template>
  <section class="mt">
    <div class="mt-list">
      <header class="mt-head"><h2>{{ W['mine-title'] }}</h2></header>
      <p class="mt-line">{{ W['mine-line'] }}</p>
      <div class="mt-rows">
        <p v-if="mine.loading && !mine.list.length" class="mt-empty">{{ W.loading }}</p>
        <template v-else-if="mine.list.length">
          <button
            v-for="t in mine.list" :key="t.id" type="button" class="mt-row"
            :class="{ on: open && open.id === t.id }" @click="openMyTicket(t.id)">
            <span class="mt-ref">{{ (W.ref || '#{n}').replace('{n}', t.ref) }}</span>
            <span class="mt-mid">
              <b>{{ t.title }}</b>
              <span class="mt-facts">
                <i class="mt-state" :class="t.status">{{ stateWord(t.status) }}</i>
                <i>{{ (W.opened || '').replace('{span}', ageOf(t, now)) }}</i>
                <i v-if="Number(t.replies)">{{ replies(t) }}</i>
              </span>
            </span>
          </button>
        </template>
        <div v-else class="mt-none">
          <p class="mt-empty-title">{{ W['empty-mine'] }}</p>
          <p class="mt-empty-line">{{ W['empty-mine-line'] }}</p>
        </div>
      </div>
    </div>

    <div class="mt-pane">
      <template v-if="open">
        <header class="mt-thead">
          <span class="mt-ref">{{ (W.ref || '#{n}').replace('{n}', open.ref) }}</span>
          <h3>{{ open.title }}</h3>
          <p class="mt-sub"><i class="mt-state" :class="open.status">{{ stateWord(open.status) }}</i> · {{ (W.opened || '').replace('{span}', ageOf(open, now)) }}</p>
        </header>
        <div class="mt-when">
          <p v-if="open.body" class="mt-body"><MessageText :blocks="messageBlocks(open.body)" /></p>
          <article v-for="e in timeline" :key="e.id" class="mt-event">
            <template v-if="e.body">
              <SpaceAvatar :name="e.by_contact ? W.you : (e.agent_name || W.someone)" :size="26" />
              <div class="mt-bubble">
                <header>
                  <b>{{ e.by_contact ? W.you : (e.agent_name || W.someone) }}</b>
                  <time :datetime="e.created_at">{{ stampOf(e.created_at, now) }}</time>
                </header>
                <p><MessageText :blocks="messageBlocks(e.body)" /></p>
              </div>
            </template>
            <p v-else-if="said(e)" class="mt-happened">{{ said(e) }}<time :datetime="e.created_at">{{ stampOf(e.created_at, now) }}</time></p>
          </article>
        </div>
      </template>
      <p v-else class="mt-empty mt-pick">{{ W.pick }}</p>
    </div>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; every rule here says what it wants instead */
.mt { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
  min-height: 0; height: 100%; margin: 0; padding: 0; background: var(--paper); overflow: hidden }
.mt-list { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--hair) }
.mt-head { margin: 0; padding: 14px 16px 0; border: 0 }
.mt-head h2 { margin: 0; font-family: var(--fd); font-weight: 800; font-size: 19px; color: var(--ink) }
.mt-line { margin: 4px 16px 10px; max-width: none; font-size: 13px; color: var(--ink3); border-bottom: 1px solid var(--hair); padding-bottom: 12px }
.mt-rows { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 10px 14px }
.mt-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; width: 100%;
  text-align: left; font: inherit; background: transparent; border: 0; border-radius: 10px; padding: 9px 8px; cursor: pointer }
.mt-row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent) }
.mt-row.on { background: color-mix(in srgb, var(--ink) 7%, transparent) }
.mt-ref { font-family: var(--m); font-size: 11.5px; color: var(--ink3) }
.mt-mid { display: flex; flex-direction: column; gap: 3px; min-width: 0 }
.mt-mid b { font-family: var(--fd); font-weight: 700; font-size: 14px; color: var(--ink) }
.mt-facts { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11.5px; color: var(--ink3) }
.mt-facts i { font-style: normal }
.mt-state { font-weight: 600 }
.mt-state.doing { color: var(--sp-link) }
.mt-state.resolved, .mt-state.closed { color: var(--ink3) }
.mt-none { padding: 26px 12px; text-align: center }
.mt-empty-title { margin: 0; max-width: none; font-family: var(--fd); font-weight: 700; font-size: 14px; color: var(--ink2) }
.mt-empty-line { margin: 4px auto 0; max-width: 34ch; font-size: 13px; color: var(--ink3) }
.mt-empty { margin: 0; padding: 20px; max-width: none; font-size: 13.5px; color: var(--ink3) }
.mt-pick { display: grid; place-items: center; height: 100%; text-align: center }
.mt-pane { display: flex; flex-direction: column; min-height: 0 }
.mt-thead { margin: 0; padding: 16px 18px 12px; border: 0; border-bottom: 1px solid var(--hair) }
.mt-thead h3 { margin: 2px 0 0; font-family: var(--fd); font-weight: 800; font-size: 18px; color: var(--ink) }
.mt-sub { margin: 4px 0 0; max-width: none; font-size: 12.5px; color: var(--ink3) }
.mt-when { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 18px }
.mt-body { margin: 0 0 14px; max-width: 72ch; font-size: 14.5px; line-height: 1.5; color: var(--ink) }
.mt-event { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 9px; align-items: start; margin-bottom: 12px }
.mt-bubble header { display: flex; align-items: baseline; gap: 8px; margin: 0 0 2px; padding: 0; border: 0 }
.mt-bubble header b { font-family: var(--fd); font-weight: 700; font-size: 13.5px; color: var(--ink) }
.mt-bubble header time { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }
.mt-bubble p { margin: 0; max-width: 72ch; font-size: 14px; line-height: 1.5; color: var(--ink) }
.mt-happened { grid-column: 1 / -1; display: flex; gap: 7px; margin: 0; max-width: none; font-size: 12.5px; color: var(--ink3) }
.mt-happened time { font-family: var(--m); font-size: 10.5px }
@media (max-width: 900px) { .mt { grid-template-columns: minmax(0, 1fr) } .mt-pane { display: none } }
</style>
