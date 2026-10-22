<script setup>
/*
 * ONE EVENT, ON ITS OWN PAGE — what it is, when it next runs, where, who is running it, who is
 * coming, and what people have said about it.
 *
 * It exists because an RSVP with nowhere to go is not an invitation. A line in a calendar card can
 * say "Thursday, 6pm"; it cannot say how to get in, what to bring, who is hosting, or answer the
 * question somebody wants to ask before they commit — and those are the things that decide whether
 * anybody comes.
 *
 * Comments are on the EVENT, not on one occurrence: a question about a weekly sit is a question
 * about the sit, and asking it again every week helps nobody.
 *
 * Words: `## calendar / ### page` in the spaces scope.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { eventPage, saySomething, unsay, rsvp, whenWord, clockOf } from 'platformkit/lib/spaces/calendar.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'
import MediaBlock from '../content/MediaBlock.vue'
import CommentThread from '../content/CommentThread.vue'
import { checkout } from 'platformkit/lib/commerce.js'

const props = defineProps({ slug: { type: String, required: true }, names: { type: Object, default: () => ({}) } })
const emit = defineEmits(['back', 'join'])

const W = computed(() => us('spaces').calendar.page)
const C = computed(() => us('spaces').calendar.main)
const row = ref(null)
const now = Date.now()
/* the card's own words for a day, so a date reads the same wherever it is shown */
const dayWords = computed(() => ({ today: C.value.today, tomorrow: C.value.tomorrow }))
const loading = ref(true)
const saying = ref('')
const busy = ref(false)

async function load() { loading.value = true; row.value = await eventPage(props.slug); loading.value = false }
onMounted(load)
watch(() => props.slug, load)

/* the next one that has not happened, which is what a page is about */
const next = computed(() => (row.value?.occurrences || []).find((o) => new Date(o.starts_at) > new Date()) || null)
const past = computed(() => !!row.value && !next.value)
const place = computed(() => row.value?.place || {})
const comments = computed(() => (row.value?.comments || []).filter((c) => !c.deleted_at))
const left = computed(() => {
  const cap = row.value?.capacity
  return cap && next.value ? Math.max(0, cap - (next.value.going || 0)) : null
})

/* ONLY THE ANSWERS THE FILE ALLOWS. A file naming none allows all three; one that names yes and no
   offers two buttons rather than three with one that does nothing. */
const may = (k) => { const a = row.value?.rsvp_answers || []; return !a.length || a.includes(k) }

/* WHAT IT COSTS, said in the reader's own money. The price is the file's; the currency is too. */
const money = (c) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: (c.currency || 'usd').toUpperCase() }).format(c.price) } catch (e) { return String(c.price) } }
/* buying one is buying anything else: the sku the file names, or the event's own */
async function buy() {
  if (!row.value?.cost || busy.value) return
  busy.value = true
  try { await checkout([{ sku: row.value.cost.sku || ('event-' + row.value.slug), quantity: 1 }]) } catch (e) { /* the store says why */ }
  busy.value = false
}

/* WHY SOMEBODY IS COMING, OR NOT, where the file asks. It rides on the answer rather than being a
   second thing to press: the rsvp is written again with the reason on it. */
const why = ref('')
watch(next, (o) => { why.value = (o && o.reason) || '' })
async function sayWhy() {
  if (!next.value || !next.value.mine || busy.value) return
  busy.value = true
  await rsvp(next.value.id, next.value.mine, why.value.trim() || null)
  busy.value = false
}

async function going(state) {
  if (!next.value || busy.value) return
  busy.value = true
  await rsvp(next.value.id, next.value.mine === state ? 'out' : state)
  await load()
  busy.value = false
}
async function say() {
  const body = saying.value.trim()
  if (!body || busy.value) return
  busy.value = true
  await saySomething(row.value.id, body)
  saying.value = ''
  await load()
  busy.value = false
}
async function remove(id) { busy.value = true; await unsay(id); await load(); busy.value = false }
</script>

<template>
  <div class="se">
    <div class="se-in">
    <button type="button" class="se-back" @click="emit('back')"><SpaceIcon name="back" :size="14" /> {{ W.back }}</button>

    <div v-if="loading" class="se-quiet">{{ C.loading }}</div>
    <div v-else-if="!row" class="se-quiet">{{ C.nothing }}</div>

    <template v-else>
      <!-- THE COVER. An event is a thing people decide to come to, and they decide on a picture
           before they decide on a paragraph. -->
      <img v-if="row.cover" class="se-cover" :src="row.cover" :alt="row.title" />

      <header class="se-head">
        <h1>{{ row.title }}</h1>
        <p v-if="row.sub" class="se-sub">{{ row.sub }}</p>
      </header>

      <p v-if="next && next.cancelled_at" class="se-note">{{ W.cancelled }}</p>
      <p v-else-if="past" class="se-note">{{ W.past }}</p>

      <dl class="se-facts">
        <div v-if="next">
          <dt>{{ W.when }}</dt>
          <dd>{{ whenWord(next.starts_at, now, dayWords) }} · {{ clockOf(next.starts_at) }}</dd>
        </div>
        <div v-if="place.kind">
          <dt>{{ W.where }}</dt>
          <dd>
            <template v-if="place.kind === 'link' || place.kind === 'room'">
              <span>{{ W.online }}</span>
              <button v-if="next && !next.cancelled_at" type="button" class="se-go" @click="emit('join', next)">{{ W['online-join'] }}</button>
            </template>
            <!-- BEHIND THE PAYWALL the read returns the kind and nothing else, so the row says what
                 sort of thing it is — which is part of deciding whether to come — and not a blank. -->
            <template v-else-if=place.locked>
              <span>{{ W['where-' + place.kind] || W['where-locked'] }}</span>
              <small class="se-detail">{{ W['where-after'] }}</small>
            </template>
            <template v-else>
              <span>{{ place.address }}</span>
              <small v-if="place.details" class="se-detail">{{ place.details }}</small>
              <a v-if="place.map" class="se-map" :href="place.map" target="_blank" rel="noopener">{{ W.directions }}</a>
            </template>
          </dd>
        </div>
        <div v-if="(row.hosts || []).length">
          <dt>{{ W.hosts }}</dt>
          <dd class="se-hosts">
            <span v-for="(h, i) in row.hosts" :key="i" class="se-host">
              <SpaceAvatar :name="h.name || h.email || h.role || ''" :size="22" />
              {{ h.name || h.email || h.role }}
            </span>
          </dd>
        </div>
      </dl>

      <!-- WHAT IT COSTS, where it costs anything. The address and the joining link are not on this
           page until it is theirs — the read withholds them, not the template, so a page that is
           not paid for never had them in the browser to begin with. -->
      <div v-if="row.cost && !row.paid" class="se-buy">
        <span class="se-price">{{ money(row.cost) }}</span>
        <button type="button" class="se-get" :disabled="busy" @click="buy">{{ W.buy }}</button>
        <small class="se-quiet">{{ W['buy-line'] }}</small>
      </div>
      <p v-else-if="row.cost && row.paid" class="se-have">{{ W.bought }}</p>

      <!-- ONLY THE ANSWERS THE FILE ALLOWS. A file that says yes and no offers two buttons, not
           three with one that does nothing. -->
      <div v-if="row.rsvp && next && !next.cancelled_at && (!row.cost || row.paid)" class="se-rsvp">
        <button v-if="may('going')" type="button" class="se-going" :class="{ on: next.mine === 'going' }" :disabled="busy || left === 0 && next.mine !== 'going'"
          @click="going('going')">{{ next.mine === 'going' ? C.going : C.go }}</button>
        <button v-if="may('interested')" type="button" class="se-maybe" :class="{ on: next.mine === 'interested' }" :disabled="busy" @click="going('interested')">{{ C.maybe }}</button>
        <button v-if="may('out')" type="button" class="se-maybe" :class="{ on: next.mine === 'out' }" :disabled="busy" @click="going('out')">{{ C.out }}</button>
        <small v-if="left === 0" class="se-quiet">{{ W['capacity-full'] }}</small>
        <small v-else-if="left != null" class="se-quiet">{{ W['capacity-left'].replace('{n}', left) }}</small>
        <small v-if="next.mine === 'going'" class="se-quiet">{{ W['reminder-on'] }}</small>
      </div>

      <!-- a reason, where the file asks for one: why you are coming, or why you are not -->
      <label v-if="row.rsvp_reason && next && next.mine" class="se-why">
        <span>{{ W.why }}</span>
        <input v-model="why" type="text" :placeholder="W['why-hint']" @change="sayWhy" />
      </label>

      <!-- WHO IS COMING, where the file says that is public. A first name and a last initial, from
           the read — never a full name, never an address. Somebody who says they are coming to a
           class has not agreed to be in a published list of the people who go to it. -->
      <div v-if="row.rsvp_list !== 'off' && next && (next.who || []).length" class="se-who">
        <h2>{{ (W['who-going'] || '').replace('{n}', next.going || (next.who || []).length) }}</h2>
        <ul>
          <li v-for="(n, i) in next.who" :key="i"><SpaceAvatar :name="n" :size="26" /><span>{{ n }}</span></li>
        </ul>
      </div>

      <!-- the gallery and whatever it carries — a film, a recording — drawn by the same blocks an
           article's are, because a picture of a room is a picture of a room wherever it is shown -->
      <section v-if="(row.gallery || []).length" class="se-gallery">
        <img v-for="(g, i) in row.gallery" :key="i" :src="typeof g === 'string' ? g : g.src" :alt="(g && g.alt) || ''" />
      </section>
      <section v-if="row.media" class="se-media"><MediaBlock :media="row.media" /></section>

      <section v-if="row.body" class="se-about">
        <h2>{{ W.about }}</h2>
<div class="se-body" v-text="(row.body || '').trim()" />
      </section>

      <!-- THE SAME COMMENTS EVERYTHING ELSE HAS. This page had a list of its own, written when
           comments only existed for events; it is the platform's one thread now, so an event, a
           book and a product are commented on by the same component under the same policies — and
           where the event's file names a channel, the conversation is a post there too. -->
      <CommentThread kind="event" :subject="slug" />
    </template>
    </div>
  </div>
</template>

<style scoped>
/* the root is a scroller and nothing else: the page puts class="sp-plain" on it, which sets
   padding: 0 and wins on order, so anything visual here would be silently dropped */
.se { min-height: 0; overflow-y: auto }
.se-in { padding: 20px 22px 48px; max-width: 720px; margin: 0 auto }
.se-back { font: inherit; font-size: 13px; font-weight: 600; color: var(--sp-link); background: none; border: 0;
  padding: 0; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; margin-bottom: 14px }
.se-head h1 { font-family: var(--fd); font-size: 27px; font-weight: 750; letter-spacing: -.02em; margin: 0 0 4px; color: var(--ink) }
.se-sub { margin: 0 0 16px; color: var(--ink2); font-size: 15px }
.se-note { margin: 0 0 14px; padding: 8px 12px; border-radius: 8px; font-size: 13.5px;
  background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink2) }
.se-facts { display: grid; gap: 12px; margin: 0 0 18px; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 12px }
.se-facts > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px; align-items: start }
.se-facts dt { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3) }
.se-facts dd { margin: 0; font-size: 14.5px; color: var(--ink); display: grid; gap: 3px }
.se-detail, .se-quiet { color: var(--ink2); font-size: 13px }
.se-map, .se-go { font: inherit; font-size: 13px; font-weight: 600; color: var(--sp-link); background: none; border: 0;
  padding: 0; text-align: left; cursor: pointer; justify-self: start }
.se-hosts { display: flex; flex-wrap: wrap; gap: 10px }
.se-host { display: inline-flex; align-items: center; gap: 6px; font-size: 14px }
.se-rsvp { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 20px }
.se-going, .se-maybe { font: inherit; font-size: 14px; font-weight: 650; padding: 8px 16px; border-radius: 999px;
  border: 1px solid var(--hair); background: var(--paper); color: var(--ink); cursor: pointer }
.se-going.on { background: var(--sp-link); border-color: transparent; color: var(--paper) }
.se-going:disabled, .se-maybe:disabled { opacity: .5; cursor: default }
.se-about h2, .se-said h2 { font-family: var(--fd); font-size: 16px; font-weight: 700; margin: 0 0 8px; color: var(--ink) }
/* the file's own paragraphs, kept — but its leading and trailing blank lines are the file's
   formatting rather than the writer's meaning, and pre-wrap would show every one of them */
.se-body { font-size: 15px; line-height: 1.65; color: var(--ink); white-space: pre-wrap; margin: 0 0 22px }
.se-about { margin-top: 4px }
.se-said { margin-top: 4px }
.se-list { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 12px }
.se-list li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: start }
.se-list b { font-size: 13.5px; font-weight: 700; color: var(--ink) }
.se-list p { margin: 2px 0 0; font-size: 14.5px; line-height: 1.55; color: var(--ink); white-space: pre-wrap }
.se-x { font: inherit; font-size: 12px; color: var(--ink3); background: none; border: 0; cursor: pointer }
.se-say { display: grid; gap: 8px; justify-items: start }
.se-say textarea { width: 100%; font: inherit; font-size: 14.5px; padding: 10px 12px; border: 1px solid var(--hair);
  border-radius: 10px; background: var(--paper); color: var(--ink); resize: vertical }
.se-say button { font: inherit; font-size: 14px; font-weight: 650; padding: 7px 16px; border-radius: 999px;
  border: 0; background: var(--sp-link); color: var(--paper); cursor: pointer }
.se-say button:disabled { opacity: .5; cursor: default }
/* the cover: an event is decided on a picture before it is decided on a paragraph */
.se-cover { display: block; width: 100%; aspect-ratio: 16 / 7; object-fit: cover; border-radius: 14px; margin: 0 0 20px }
.se-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin: 0 0 22px }
.se-gallery img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; display: block }
.se-media { margin: 0 0 22px }

/* what it costs, and the line that says what paying buys: the details, not the listing */
.se-buy { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 20px; padding: 14px 16px;
  background: var(--card); border: 1px solid var(--hair); border-radius: 12px }
.se-price { font-family: var(--fd); font-size: 20px; font-weight: 750; color: var(--ink) }
.se-get { font: inherit; font-size: 14px; font-weight: 650; padding: 8px 18px; border-radius: 999px;
  color: var(--paper); background: var(--sp-link); border: 0; cursor: pointer }
.se-get:disabled { opacity: .5; cursor: default }
.se-have { margin: 0 0 18px; font-size: 13.5px; color: var(--sp-link); font-weight: 600 }

.se-why { display: grid; gap: 5px; margin: 0 0 20px; max-width: 30em }
.se-why span { font-family: var(--m); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink3) }
.se-why input { font: inherit; font-size: 14px; color: var(--ink); background: var(--card);
  border: 1px solid var(--hair); border-radius: 9px; padding: 8px 11px }

/* who is coming — a first name and a last initial, which is all the read returns */
.se-who { margin: 0 0 24px }
.se-who h2 { font-family: var(--m); font-size: 10.5px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--ink3); margin: 0 0 10px }
.se-who ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 14px }
.se-who li { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink2) }

@media (max-width: 640px) { .se { padding: 16px 14px 40px } .se-facts > div { grid-template-columns: 1fr; gap: 2px } }
</style>
