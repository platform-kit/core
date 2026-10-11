<script setup>
/*
 * WHAT IS ON. The two things a community puts side by side and a chat app has no idea about: what
 * is HAPPENING — the Tuesday call, the first-Friday sit, an evening somebody is putting on — and
 * what can be BOOKED, an hour with a coach. They are different shapes and this draws them as two
 * shelves of one room, because the member is asking one question.
 *
 * An occurrence says when it is in the reader's own terms (today, tomorrow, Thursday, 14 Oct),
 * whether it is on right now, who is coming, and takes their answer. The strip form is what a
 * community's home shows; the full form is the calendar page.
 *
 * Words from spaces.md (## calendar).
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { whenWord, clockOf, untilWord, isOn, byDay, rsvp } from '@platform-kit/kit/lib/spaces/calendar.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({
  occurrences: { type: Array, default: () => [] },
  /* the booking types this space offers, from the records the sessions module already keeps */
  sessions: { type: Array, default: () => [] },
  /* a strip on a home, or the whole calendar */
  full: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'book', 'join'])
const W = computed(() => us('spaces').calendar.main)

/* the clock ticks so "in 5m" and "on now" are true while somebody is looking at them */
const now = ref(Date.now())
let tick = null
onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 30000) })
onBeforeUnmount(() => clearInterval(tick))

const shown = computed(() => (props.full ? props.occurrences : props.occurrences.slice(0, 4)))
const days = computed(() => byDay(shown.value))
const words = computed(() => ({ today: W.value.today, tomorrow: W.value.tomorrow }))
const untilWords = computed(() => ({ now: W.value['on-now'], mins: W.value['in-mins'], hours: W.value['in-hours'], days: W.value['in-days'] }))

const when = (o) => whenWord(o.starts_at, now.value, words.value)
const at = (o) => clockOf(o.starts_at)
const until = (o) => untilWord(new Date(o.starts_at).getTime(), now.value, untilWords.value)
const live = (o) => isOn(o, now.value)
const noRoom = (o) => !!o.capacity && Number(o.going) >= Number(o.capacity) && o.mine !== 'going'
const placeWord = (o) => {
  const p = o.place || {}
  if (p.kind === 'room') return W.value['in-a-room']
  if (p.kind === 'link') return W.value.online
  if (p.kind === 'place') return p.where || W.value['in-person']
  if (p.kind === 'phone') return W.value['by-phone']
  return ''
}

const busy = ref('')
async function say(o, state) {
  busy.value = o.id
  await rsvp(o.id, o.mine === state ? 'out' : state)
  busy.value = ''
}
</script>

<template>
  <section class="sc" :class="{ full }">
    <header v-if="!full" class="sc-head">
      <h3>{{ W.title }}</h3>
      <button v-if="occurrences.length > 4" type="button" class="sc-all" @click="emit('open')">{{ W['see-all'] }}</button>
    </header>

    <p v-if="loading && !occurrences.length" class="sc-none">{{ W.loading }}</p>
    <p v-else-if="!occurrences.length && !sessions.length" class="sc-none">{{ W.nothing }}</p>

    <div v-for="d in days" :key="d.day" class="sc-day">
      <h4 v-if="full" class="sc-date">{{ whenWord(d.at, now, words) }}</h4>
      <article v-for="o in d.items" :key="o.id" class="sc-item" :class="{ on: live(o), off: !!o.cancelled_at }">
        <!-- the time is the thing somebody scans for, so it leads and never moves -->
        <div class="sc-when">
          <b>{{ at(o) }}</b>
          <i v-if="!full">{{ when(o) }}</i>
          <em v-if="live(o)" class="sc-live">{{ W['on-now'] }}</em>
        </div>
        <div class="sc-what">
          <h5>{{ o.title }}</h5>
          <p v-if="o.sub" class="sc-sub">{{ o.sub }}</p>
          <p v-if="o.cancelled_at" class="sc-called-off">{{ o.note || W['called-off'] }}</p>
          <div class="sc-facts">
            <span v-if="placeWord(o)"><SpaceIcon :name="(o.place || {}).kind === 'room' ? 'video' : 'pin'" :size="12" />{{ placeWord(o) }}</span>
            <span v-if="!live(o) && !o.cancelled_at" class="sc-until">{{ until(o) }}</span>
            <span v-if="Number(o.going)" class="sc-going">{{ (Number(o.going) === 1 ? W['going-one'] : W['going-many']).replace('{n}', o.going) }}</span>
            <span v-if="o.capacity" class="sc-room-left">{{ (W.spaces || '').replace('{n}', Math.max(0, o.capacity - Number(o.going))) }}</span>
          </div>
          <ul v-if="full && (o.who || []).length" class="sc-faces">
            <li v-for="p in o.who" :key="p.id" :title="p.name"><SpaceAvatar :name="p.name" :size="24" /></li>
          </ul>
        </div>
        <div class="sc-do">
          <!-- when it is on, the only thing anybody wants is the way in -->
          <button v-if="live(o) && (o.place || {}).kind === 'room' && !o.cancelled_at" type="button" class="sc-join" @click="emit('join', o)">{{ W.join }}</button>
          <template v-else-if="o.rsvp && !o.cancelled_at">
            <button
              type="button" class="sc-rsvp" :class="{ on: o.mine === 'going' }"
              :disabled="busy === o.id || noRoom(o)"
              @click="say(o, 'going')">
              {{ o.mine === 'going' ? W.going : noRoom(o) ? W.full : W.go }}
            </button>
            <button
              v-if="o.mine !== 'going'" type="button" class="sc-maybe" :class="{ on: o.mine === 'interested' }"
              :disabled="busy === o.id" @click="say(o, 'interested')">{{ W.maybe }}</button>
          </template>
        </div>
      </article>
    </div>

    <!-- and what can be booked, which is not the same question and is not far from it -->
    <div v-if="sessions.length" class="sc-book">
      <h4>{{ W['to-book'] }}</h4>
      <article v-for="s in sessions" :key="s.slug" class="sc-offer">
        <div class="sc-what">
          <h5>{{ s.title }}</h5>
          <p v-if="s.sub" class="sc-sub">{{ s.sub }}</p>
        </div>
        <div class="sc-do">
          <span v-if="s.price" class="sc-price">{{ s.price }}</span>
          <button type="button" class="sc-rsvp" @click="emit('book', s)">{{ W.book }}</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements, so every rule here is on a class */
.sc { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0 }
.sc h4, .sc h5 { padding: 0; border: 0 }
.sc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 0 6px; padding: 0; border: 0 }
.sc-head h3 { margin: 0; font-family: var(--fd); font-weight: 700; font-size: 14px; color: var(--ink) }
.sc-all { font: inherit; font-size: 12.5px; color: var(--sp-link); background: transparent; border: 0; padding: 0; cursor: pointer }
.sc-all:hover { text-decoration: underline }
.sc-none { margin: 0; max-width: none; font-size: 13px; color: var(--ink3) }
.sc-date { margin: 14px 0 6px; padding: 0; font-family: var(--fd); font-weight: 700; font-size: 13px; color: var(--ink2) }
.sc.full .sc-date:first-child { margin-top: 0 }

.sc-item, .sc-offer { display: grid; grid-template-columns: 62px minmax(0, 1fr) auto; gap: 12px; align-items: start;
  padding: 10px 2px; border-top: 1px solid var(--hair) }
.sc-offer { grid-template-columns: minmax(0, 1fr) auto }
.sc-day:first-child .sc-item:first-child { border-top: 0 }
/* the one that is happening now is the only thing on the page that needs a colour */
.sc-item.on { background: color-mix(in srgb, var(--sp-link) 7%, transparent); border-radius: 8px; padding-left: 8px; padding-right: 8px }
.sc-item.off .sc-what h5 { text-decoration: line-through; color: var(--ink3) }

.sc-when { display: flex; flex-direction: column; gap: 1px }
.sc-when b { font-family: var(--m); font-size: 13px; font-weight: 700; color: var(--ink) }
.sc-when i { font-style: normal; font-size: 11.5px; color: var(--ink3) }
.sc-live { font-style: normal; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--sp-link) }

.sc-what { min-width: 0 }
.sc-what h5 { margin: 0; font-family: var(--fd); font-weight: 700; font-size: 14.5px; color: var(--ink) }
.sc-sub { margin: 1px 0 0; max-width: 56ch; font-size: 13px; line-height: 1.4; color: var(--ink2) }
.sc-called-off { margin: 3px 0 0; max-width: none; font-size: 12.5px; color: var(--ink3); font-style: italic }
.sc-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 4px; font-size: 12px; color: var(--ink3) }
.sc-facts span { display: inline-flex; align-items: center; gap: 4px }
.sc-faces { display: flex; gap: 3px; list-style: none; margin: 7px 0 0; padding: 0 }

.sc-do { display: flex; align-items: center; gap: 6px }
.sc-rsvp, .sc-maybe, .sc-join { font: inherit; font-size: 12.5px; font-weight: 600; white-space: nowrap;
  border-radius: 8px; padding: 5px 11px; cursor: pointer; border: 1px solid var(--hair); background: var(--paper); color: var(--ink) }
.sc-rsvp:hover, .sc-maybe:hover { background: color-mix(in srgb, var(--ink) 5%, transparent) }
.sc-rsvp.on { color: var(--paper); background: var(--sp-link); border-color: transparent }
.sc-maybe.on { border-color: var(--sp-link); color: var(--sp-link) }
.sc-rsvp:disabled { opacity: .5; cursor: default }
/* the way into something that is happening now is the one loud button in the room */
.sc-join { color: var(--paper); background: var(--sp-link); border-color: transparent }
.sc-price { font-size: 12.5px; color: var(--ink3) }
.sc-book { margin-top: 14px }
.sc-book h4 { margin: 0 0 2px; padding: 0; font-family: var(--fd); font-weight: 700; font-size: 13px; color: var(--ink2) }
@media (max-width: 640px) {
  .sc-item { grid-template-columns: 52px minmax(0, 1fr); grid-template-areas: 'when what' 'do do'; row-gap: 8px }
  .sc-when { grid-area: when } .sc-what { grid-area: what } .sc-do { grid-area: do; justify-content: flex-start }
}
</style>
