<script setup>
/*
 * WHAT IS ON — a space's events board.
 *
 * It has to read as the right page for a D&D group that normally plays on Discord AND for a yoga
 * studio that runs public classes, which rules out anything that leans on one of them: no ticket
 * chrome, no venue photography, no "register now". What both have is the same three facts — when,
 * what, and whether you are going — so those are what the page is made of, and everything else is
 * given room only when the event actually has it.
 *
 * NEXT UP IS A DIFFERENT SIZE. The thing happening soonest is what somebody came to find, so it is
 * a wide card with its date, its hosts and its RSVP in reach; the rest are a grid below it, grouped
 * by month. A page where every event is the same size makes the reader do the sorting.
 *
 * NO COVER, NO PROBLEM. An event without artwork gets a ground drawn from its own slug — stable, so
 * the same event is the same colour every time, and quiet enough that a real cover beside it does
 * not look like a mistake. A board of grey rectangles is what "we could not be bothered" looks like.
 *
 * Words: `## calendar / ### board` and `### main` in the spaces scope.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { loadCalendar, calendar, whenWord, clockOf, rsvp } from 'platformkit/lib/spaces/calendar.js'
import SpaceAvatar from './SpaceAvatar.vue'
import SpaceIcon from './SpaceIcon.vue'

const props = defineProps({ space: { type: Object, default: null } })
const emit = defineEmits(['open', 'join', 'book'])

const C = computed(() => us('spaces').calendar.main)
const B = computed(() => us('spaces').calendar.board)
const now = Date.now()
const showing = ref('upcoming')
const busy = ref('')

const load = () => props.space && loadCalendar(props.space.id, { days: 365, limit: 300 })
onMounted(load)
watch(() => props.space && props.space.id, load)

const all = computed(() => calendar.upcoming || [])
const upcoming = computed(() => all.value.filter((o) => new Date(o.starts_at).getTime() >= now))
const past = computed(() => all.value.filter((o) => new Date(o.starts_at).getTime() < now).reverse())
const shown = computed(() => (showing.value === 'past' ? past.value : upcoming.value))
const next = computed(() => (showing.value === 'upcoming' ? upcoming.value[0] || null : null))
const rest = computed(() => (showing.value === 'upcoming' ? upcoming.value.slice(1) : past.value))

/* grouped by month, because a calendar is read in months and a flat list of forty is not read */
const months = computed(() => {
  const out = []
  for (const o of rest.value) {
    const d = new Date(o.starts_at)
    const key = d.getFullYear() + '-' + d.getMonth()
    const label = d.toLocaleString(undefined, { month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
    const had = out.find((m) => m.key === key)
    if (had) had.items.push(o); else out.push({ key, label, items: [o] })
  }
  return out
})

const day = (iso) => new Date(iso).getDate()
const mon = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short' })
const dayWords = computed(() => ({ today: C.value.today, tomorrow: C.value.tomorrow }))
const placeWord = (o) => (o.place && o.place.kind === 'place' ? B.value['in-person'] : B.value.online)
const hostWord = (o) => {
  const h = o.hosts || []
  if (!h.length) return ''
  const name = h[0].name || h[0].email || h[0].role || ''
  return h.length === 1 ? String(B.value['host-one']).replace('{name}', name)
    : String(B.value['host-many']).replace('{name}', name).replace('{n}', h.length - 1)
}
/* a ground of its own, from the slug, so an event with no artwork still looks like something and
   looks like the SAME something every time */
const ground = (o) => {
  let n = 0
  for (const ch of String(o.slug || o.id || '')) n = (n * 31 + ch.charCodeAt(0)) % 360
  return { '--a': `hsl(${n} 52% 46%)`, '--b': `hsl(${(n + 42) % 360} 56% 38%)` }
}

async function going(o, state) {
  if (busy.value) return
  busy.value = o.id
  await rsvp(o.id, o.mine === state ? 'out' : state)
  busy.value = ''
}
</script>

<template>
  <div class="sv">
    <div class="sv-in">
      <!-- a div, not a header: the site's stylesheet gives every header a band of its own -->
      <div class="sv-top">
        <h1>{{ C.title }}</h1>
        <div class="sv-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="showing === 'upcoming'" :class="{ on: showing === 'upcoming' }" @click="showing = 'upcoming'">{{ B.upcoming }}</button>
          <button type="button" role="tab" :aria-selected="showing === 'past'" :class="{ on: showing === 'past' }" @click="showing = 'past'">{{ B.past }}</button>
        </div>
      </div>

      <p v-if="calendar.loading" class="sv-quiet">{{ C.loading }}</p>
      <div v-else-if="!shown.length" :key="showing" class="sv-empty">
        <span class="sv-empty-ic" aria-hidden="true"><SpaceIcon name="calendar" :size="28" /></span>
        <p>{{ showing === 'past' ? B['none-past'] : B['none-upcoming'] }}</p>
      </div>

      <!-- the thing happening soonest is what somebody came to find -->
      <article v-if="next" class="sv-next" :style="ground(next)">
        <button type="button" class="sv-cover" :class="{ art: next.cover }" :style="next.cover ? { backgroundImage: `url(${next.cover})` } : null"
          @click="emit('open', next.slug)" :aria-label="next.title">
          <span v-if="!next.cover" class="sv-glyph"><SpaceIcon name="clock" :size="30" /></span>
        </button>
        <div class="sv-nextbody">
          <span class="sv-eyebrow">{{ B.next }}</span>
          <h2><button type="button" @click="emit('open', next.slug)">{{ next.title }}</button></h2>
          <p v-if="next.sub" class="sv-sub">{{ next.sub }}</p>
          <dl class="sv-when">
            <div><dt><SpaceIcon name="clock" :size="14" /></dt><dd>{{ whenWord(next.starts_at, now, dayWords) }} · {{ clockOf(next.starts_at) }}</dd></div>
            <div><dt><SpaceIcon name="pin" :size="14" /></dt><dd>{{ placeWord(next) }}</dd></div>
            <div v-if="hostWord(next)"><dt><SpaceIcon name="people" :size="14" /></dt><dd>{{ hostWord(next) }}</dd></div>
          </dl>
          <div class="sv-act">
            <button v-if="next.rsvp && !next.cancelled_at" type="button" class="sv-go" :class="{ on: next.mine === 'going' }"
              :disabled="busy === next.id" @click="going(next, 'going')">{{ next.mine === 'going' ? B['going-you'] : C.go }}</button>
            <button type="button" class="sv-more" @click="emit('open', next.slug)">{{ C['see-all'] }}</button>
            <em v-if="next.cancelled_at" class="sv-off">{{ C['called-off'] }}</em>
            <em v-else-if="next.going" class="sv-count">{{ next.going === 1 ? C['going-one'] : C['going-many'].replace('{n}', next.going) }}</em>
          </div>
        </div>
      </article>

      <section v-for="m in months" :key="m.key" class="sv-month">
        <h3>{{ m.label }}</h3>
        <ol class="sv-grid">
          <li v-for="o in m.items" :key="o.id">
            <article class="sv-card" :class="{ off: o.cancelled_at }" :style="ground(o)">
              <button type="button" class="sv-top-art" :class="{ art: o.cover }" :style="o.cover ? { backgroundImage: `url(${o.cover})` } : null" @click="emit('open', o.slug)">
                <span class="sv-chip"><b>{{ day(o.starts_at) }}</b><small>{{ mon(o.starts_at) }}</small></span>
              </button>
              <div class="sv-card-body">
                <h4><button type="button" @click="emit('open', o.slug)">{{ o.title }}</button></h4>
                <p class="sv-cardwhen">{{ whenWord(o.starts_at, now, dayWords) }} · {{ clockOf(o.starts_at) }}</p>
                <p class="sv-cardwhere">{{ placeWord(o) }}<template v-if="o.going"> · {{ o.going === 1 ? C['going-one'] : C['going-many'].replace('{n}', o.going) }}</template></p>
                <div class="sv-cardact">
                  <button v-if="o.rsvp && !o.cancelled_at && showing === 'upcoming'" type="button" class="sv-go sm" :class="{ on: o.mine === 'going' }"
                    :disabled="busy === o.id" @click="going(o, 'going')">{{ o.mine === 'going' ? B['going-you'] : C.go }}</button>
                  <em v-if="o.cancelled_at" class="sv-off">{{ C['called-off'] }}</em>
                </div>
              </div>
            </article>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sv { min-height: 0; overflow-y: auto }
.sv-in { padding: 26px 26px 56px; max-width: 1000px; margin: 0 auto }

.sv-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 20px }
.sv-top h1 { font-family: var(--fd); font-size: 27px; font-weight: 750; letter-spacing: -.025em; margin: 0; color: var(--ink) }
.sv-tabs { display: inline-flex; padding: 3px; border-radius: 999px; background: color-mix(in srgb, var(--ink) 6%, transparent) }
.sv-tabs button { font: inherit; font-size: 13px; font-weight: 650; padding: 6px 14px; border: 0; border-radius: 999px;
  background: none; color: var(--ink2); cursor: pointer; transition: background .25s cubic-bezier(.2, .8, .2, 1), color .2s, box-shadow .25s }
.sv-tabs button.on { background: var(--paper); color: var(--ink); box-shadow: 0 1px 2px rgb(0 0 0 / .08) }
.sv-quiet { color: var(--ink2); font-size: 14.5px; margin: 28px 0 }
.sv-empty { display: grid; justify-items: center; gap: 14px; padding: 56px 20px; text-align: center; animation: sv-in .45s cubic-bezier(.2, .8, .2, 1) both }
.sv-empty p { margin: 0; max-width: 40ch; font-size: 15px; line-height: 1.55; color: var(--ink2) }
.sv-empty-ic { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 20px; color: var(--accent);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 16%, var(--paper)), color-mix(in srgb, var(--accent) 5%, var(--paper)));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent), 0 12px 28px -18px color-mix(in srgb, var(--accent) 80%, transparent) }
@keyframes sv-in { from { opacity: 0; transform: translateY(8px) } }
@media (prefers-reduced-motion: reduce) { .sv-empty { animation: none } }

/* the soonest thing, at a size that says so */
.sv-next { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 0; margin-bottom: 34px;
  border: 1px solid var(--hair); border-radius: 18px; overflow: hidden; background: var(--paper) }
.sv-cover { border: 0; padding: 0; cursor: pointer; min-height: 196px; position: relative;
  background: linear-gradient(145deg, var(--a), var(--b)); background-size: cover; background-position: center }
/* the cover is set inline (:style backgroundImage) on the same element — there was a
   `background-image: var(--art)` rule here reading a token nothing anywhere set, dead and
   overridden by that inline style, removed 2026-09-29 */
.sv-glyph { position: absolute; inset: 0; display: grid; place-items: center; color: rgb(255 255 255 / .55) }
.sv-nextbody { padding: 20px 22px; display: grid; align-content: center; gap: 6px }
.sv-eyebrow { font-size: 11px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; color: var(--sp-link) }
.sv-nextbody h2 { margin: 0; font-family: var(--fd); font-size: 21px; font-weight: 700; letter-spacing: -.015em }
.sv-nextbody h2 button, .sv-card h4 button { font: inherit; color: var(--ink); background: none; border: 0; padding: 0;
  text-align: left; cursor: pointer }
.sv-nextbody h2 button:hover, .sv-card h4 button:hover { color: var(--sp-link) }
.sv-sub { margin: 0; font-size: 14.5px; color: var(--ink2) }
.sv-when { display: grid; gap: 3px; margin: 8px 0 2px }
.sv-when > div { display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: center; gap: 6px }
.sv-when dt { margin: 0; color: var(--ink3); display: grid; place-items: center }
.sv-when dd { margin: 0; font-size: 14px; color: var(--ink) }
.sv-act { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px }
.sv-go { font: inherit; font-size: 14px; font-weight: 650; padding: 8px 18px; border-radius: 999px;
  border: 1px solid var(--hair); background: var(--paper); color: var(--ink); cursor: pointer }
.sv-go.on { background: var(--sp-link); border-color: transparent; color: var(--paper) }
.sv-go.sm { font-size: 13px; padding: 6px 13px }
.sv-go:disabled { opacity: .55; cursor: default }
.sv-more { font: inherit; font-size: 13.5px; font-weight: 600; color: var(--sp-link); background: none; border: 0; cursor: pointer }
.sv-count, .sv-off { font-style: normal; font-size: 12.5px; color: var(--ink3) }

.sv-month { margin-bottom: 26px }
.sv-month h3 { font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
  color: var(--ink3); margin: 0 0 10px }
.sv-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)) }
.sv-card { border: 1px solid var(--hair); border-radius: 14px; overflow: hidden; background: var(--paper);
  display: grid; grid-template-rows: 104px auto; transition: border-color .15s ease, transform .15s ease }
.sv-card:hover { border-color: color-mix(in srgb, var(--ink) 18%, transparent); transform: translateY(-2px) }
.sv-card.off { opacity: .6 }
/* CROPPED FROM THE TOP, not the middle. A card's cover strip is wide and short, and a picture
   made for somewhere else is usually TALL — a space's own thumb is 2:3. Covering a 300×110 strip
   with a 400×600 artwork shows a 110px band out of 450, and centred that band lands in the middle
   of the design, which is where a wordmark tends to be: the result is a giant fragment of type
   running under the date. The top of a composed picture is the part that survives a crop.
   (A cover made FOR this slot is landscape and none of this applies.) */
.sv-top-art { border: 0; padding: 0; cursor: pointer; position: relative;
  background: linear-gradient(145deg, var(--a), var(--b)); background-size: cover; background-position: top center }
.sv-chip { position: absolute; left: 10px; bottom: -14px; width: 44px; display: grid; justify-items: center;
  padding: 4px 0 5px; border-radius: 10px; background: var(--paper); box-shadow: 0 2px 6px rgb(0 0 0 / .14) }
.sv-chip b { font-size: 16px; font-weight: 750; line-height: 1.05; color: var(--ink) }
.sv-chip small { font-size: 9.5px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; color: var(--ink3) }
.sv-card-body { padding: 22px 14px 14px }
.sv-card h4 { margin: 0 0 3px; font-family: var(--fd); font-size: 15px; font-weight: 700; letter-spacing: -.01em }
.sv-cardwhen { margin: 0; font-size: 13px; font-weight: 600; color: var(--ink) }
.sv-cardwhere { margin: 1px 0 0; font-size: 12.5px; color: var(--ink3) }
.sv-cardact { margin-top: 10px; display: flex; align-items: center; gap: 8px }

@media (max-width: 760px) {
  .sv-in { padding: 18px 14px 44px }
  .sv-next { grid-template-columns: minmax(0, 1fr) }
  .sv-cover { min-height: 132px }
  .sv-grid { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px }
}
@media (max-width: 480px) {
  /* one to a row. auto-fill still reserves two 168px tracks at 390, so a month with one event drew
     a card down the left and half a screen of nothing beside it. */
  .sv-grid { grid-template-columns: minmax(0, 1fr) }
  .sv-cover { min-height: 148px }
}
@media (prefers-reduced-motion: reduce) { .sv-card, .sv-card:hover { transform: none; transition: none } }
</style>
