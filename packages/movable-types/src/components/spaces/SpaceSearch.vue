<script setup>
/*
 * Search: a box for the words, and who, where and when as CONTROLS beside it. There is no query
 * syntax and there is never going to be one — nobody types `from:`, no placeholder teaches a
 * grammar, and a search cannot be got wrong by mistyping it. Each chosen narrowing shows as a chip
 * that can be dropped. Words from spaces.md (search).
 */
import { computed, ref, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { blankQuery, RANGES, chipsOf, describeQuery, emptyQuery, narrowingCount } from '@platform-kit/kit/lib/spaces/query.js'
import { plainBody } from '@platform-kit/kit/lib/spaces/model.js'

const props = defineProps({
  people: { type: Array, default: () => [] },
  channels: { type: Array, default: () => [] },
  names: { type: Object, default: () => ({}) },
  results: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  /* how many of this person's rooms are sealed, and so could not be looked in */
  sealed: { type: Number, default: 0 },
})
const emit = defineEmits(['search', 'open', 'close'])
const W = computed(() => us('spaces').search.main)
/*
 * WHAT SEARCH COULD NOT LOOK IN, said beside what it found.
 *
 * A sealed room leaves nothing in the index, so it is missed for free — and a person who knows a
 * thing was written, searches for it and finds nothing will conclude the search is broken, or that
 * nobody ever wrote it. The line is HERE, beside the count, and still there when they look again:
 * a toast would be gone by the time they had read the results.
 */
const E = computed(() => us('spaces').encryption.refused)
/* …and what a sealed room is called, for the rooms the "In" list cannot search */
const EN = computed(() => us('spaces').encryption)
const sealedNote = computed(() => {
  if (!props.sealed) return ''
  return props.sealed === 1 ? E.value['search-one'] : (E.value['search-many'] || '').replace('{n}', props.sealed)
})
const q = ref(blankQuery())
const more = ref(false)
const labels = computed(() => {
  const out = {}
  for (const p of props.people) out[p.id] = p.name
  for (const c of props.channels) out[c.id] = '#' + c.name
  return out
})
const chips = computed(() => chipsOf(q.value, W.value, labels.value))
const said = computed(() => describeQuery(q.value, W.value, labels.value))
const n = computed(() => narrowingCount(q.value))
const channelOf = (id) => (props.channels.find((c) => c.id === id) || {}).name || ''
const drop = (chip) => { q.value = { ...q.value, ...chip.clear }; go() }
const go = () => { if (!emptyQuery(q.value)) emit('search', { ...q.value }) }
let t = null
watch(q, () => { clearTimeout(t); t = setTimeout(go, 250) }, { deep: true })
</script>

<template>
  <section class="ss">
    <header class="ss-head">
      <h3>{{ W.title }}</h3>
      <button type="button" :aria-label="W.clear" @click="emit('close')">×</button>
    </header>

    <div class="ss-box">
      <input v-model="q.text" type="search" :placeholder="W.placeholder" :aria-label="W.placeholder" />
      <button type="button" class="ss-more" :class="{ on: more || n }" @click="more = !more">
        {{ W.narrow }}<em v-if="n">{{ n }}</em>
      </button>
    </div>

    <div v-if="more" class="ss-fields">
      <label>
        <span>{{ W.who }}</span>
        <select v-model="q.from">
          <option :value="null">{{ W['who-any'] }}</option>
          <option v-for="p in people" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label>
        <span>{{ W.where }}</span>
        <select v-model="q.in">
          <option :value="null">{{ W['where-any'] }}</option>
          <!-- A SEALED ROOM STAYS IN THE LIST AND CANNOT BE CHOSEN. Dropping it would leave a
               reader hunting for a room they know is there; offering it would let them search a
               room that is guaranteed to find nothing and read that as the search being broken.
               A select carries no glyph, so the reason is in the label. -->
          <option v-for="c in channels" :key="c.id" :value="c.id" :disabled="!!c.encrypted">
            {{ c.encrypted ? c.name + ' — ' + EN.room.sealed : c.name }}
          </option>
        </select>
      </label>
      <label>
        <span>{{ W.when }}</span>
        <select v-model="q.range">
          <option v-for="r in RANGES" :key="r" :value="r">{{ W['range-' + r] || r }}</option>
        </select>
      </label>
      <template v-if="q.range === 'custom'">
        <label><span>{{ W['range-today'] }}</span><input v-model="q.after" type="date" /></label>
        <label><span>{{ W['range-yesterday'] }}</span><input v-model="q.before" type="date" /></label>
      </template>
    </div>

    <ul v-if="chips.length" class="ss-chips">
      <li v-for="c in chips" :key="c.key">
        <button type="button" @click="drop(c)">{{ c.label }} <i aria-hidden="true">×</i></button>
      </li>
    </ul>
    <p v-if="said" class="ss-said">{{ said }}</p>

    <p v-if="busy" class="ss-note">{{ W.searching }}</p>
    <p v-else-if="!results.length && !emptyQuery(q)" class="ss-note">{{ W['results-none'] }}</p>
    <p v-else-if="results.length" class="ss-note">
      {{ results.length === 1 ? W['results-one'] : (W['results-many'] || '').replace('{n}', results.length) }}
    </p>
    <!-- …and what it could not look in, under the count and not instead of it: both are true -->
    <p v-if="sealedNote && !busy && !emptyQuery(q)" class="ss-note ss-sealed">{{ sealedNote }}</p>

    <ol class="ss-list">
      <li v-for="r in results" :key="r.id">
        <button type="button" @click="emit('open', r)">
          <b v-if="names[r.author_id]">{{ names[r.author_id] }}</b>
          <em>#{{ channelOf(r.channel_id) }}</em>
          <span>{{ r.title ? r.title + ' — ' : '' }}{{ plainBody(r.body, names) }}</span>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; these say what they want instead */
.ss { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; overflow-y: auto;
  padding: 14px 16px 20px; background: var(--paper); border-left: 1px solid var(--hair) }
.ss-head { display: flex; align-items: center; justify-content: space-between; padding: 0; border: 0 }
.ss-head h3 { margin: 0; font-family: var(--fd); font-weight: 650; font-size: 15px; color: var(--ink) }
.ss-head button { font: inherit; font-size: 17px; line-height: 1; color: var(--ink3); background: transparent; border: 0; cursor: pointer }
.ss-box { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px }
.ss-box input { font: inherit; font-size: 13.5px; color: var(--ink); background: var(--card);
  border: 1px solid var(--hair); border-radius: 9px; padding: 8px 10px }
.ss-more { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12.5px; color: var(--ink2);
  background: var(--card); border: 1px solid var(--hair); border-radius: 9px; padding: 0 11px; cursor: pointer }
.ss-more.on { color: var(--paper); background: var(--ink); border-color: var(--ink) }
.ss-more em { font-family: var(--m); font-style: normal; font-size: 10px }
.ss-fields { display: flex; flex-direction: column; gap: 7px }
.ss-fields label { display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink3) }
.ss-fields select, .ss-fields input { font: inherit; font-size: 13px; color: var(--ink); background: var(--card);
  border: 1px solid var(--hair); border-radius: 8px; padding: 6px 8px }
.ss-chips { display: flex; flex-wrap: wrap; gap: 5px; list-style: none; margin: 0; padding: 0 }
.ss-chips button { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; color: var(--ink2);
  background: color-mix(in srgb, var(--ink) 7%, transparent); border: 0; border-radius: 999px; padding: 3px 9px; cursor: pointer }
.ss-chips i { font-style: normal; color: var(--ink3) }
.ss-said { margin: 0; max-width: none; font-size: 12px; color: var(--ink3) }
.ss-note { margin: 0; max-width: none; font-family: var(--m); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3) }
/* the sealed line is a sentence rather than a count, so it is set as one: not uppercase, not
   letter-spaced, and wrapping rather than running off the side of a narrow panel */
.ss-sealed { margin-top: 4px; font-family: inherit; font-size: 12px; letter-spacing: 0; text-transform: none; line-height: 1.4 }
.ss-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px }
.ss-list button { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; font: inherit;
  background: var(--card); border: 1px solid var(--hair); border-radius: 10px; padding: 9px 11px; cursor: pointer }
.ss-list button:hover { border-color: color-mix(in srgb, var(--ink) 24%, transparent) }
.ss-list b { font-family: var(--fd); font-weight: 650; font-size: 13px; color: var(--ink) }
.ss-list em { font-family: var(--m); font-style: normal; font-size: 10px; color: var(--ink3) }
/* a hit needs enough of the line to be judged by: one line clipped mid-word is a result you have
   to open to find out whether it is the one you meant */
.ss-list span { font-size: 13px; line-height: 1.5; color: var(--ink2); overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3 }
</style>
