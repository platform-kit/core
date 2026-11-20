<script setup lang="ts">
/*
 * A PERSON'S OWN RECORDED RUNS (openspec: recorded-rounds): newest first, each with when, how long, how many statements,
 * opened in the player in place, or deleted; and Delete all. The host says what a recording is called (`title`) and
 * what each of its marks was (`chapters`), so the words are the site's. Shows nothing until there is somebody signed in.
 */
import type { PropType } from 'vue'
import { computed, ref, watch } from 'vue'
import { us } from 'platformkit/lib/strings.js'
import { user } from 'platformkit/lib/auth.js'
import { myRecordings, deleteRecording, type RecordingRow } from 'platformkit/lib/recording.js'
import RecordingPlayer from './RecordingPlayer.vue'

const props = defineProps({
  source: { type: String, default: 'instrument' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  empty: { type: String, default: '' },
  /* drawn inside the host's own section: no card and no heading of its own */
  bare: { type: Boolean, default: false },
  title: { type: Function as PropType<(r: RecordingRow) => string>, default: (r: RecordingRow) => r.ref },
  chapters: { type: Function as PropType<(r: RecordingRow) => Record<string, any>>, default: () => ({}) },
})
const W = computed(() => ((us('recording').page || {}).main || {}))
const rows = ref<RecordingRow[]>([])
const loaded = ref(false)
const open = ref('')
const asking = ref('')
const owner = computed(() => user.value?.id || '')
async function load() { if (!owner.value) return; rows.value = await myRecordings(props.source); loaded.value = true }
watch(owner, load, { immediate: true })

const when = (r: RecordingRow) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.started_at))
/* a recording cut short has no length of its own: the last moment it marked stands in */
const msOf = (r: RecordingRow) => r.duration_ms || Math.max(0, ...(r.marks || []).map((m) => Math.max(m.shown_ms || 0, m.answered_ms || 0)))
const length = (r: RecordingRow) => { const s = Math.round(msOf(r) / 1000); return s >= 60 ? String(W.value.minutes).replace('{n}', String(Math.round(s / 60))) : String(W.value.seconds).replace('{n}', String(s)) }
const count = (r: RecordingRow) => String(W.value.statements).replace('{n}', String(Object.keys(props.chapters(r)).filter((k) => (r.marks || []).some((m) => m.id === k)).length))

async function remove(r: RecordingRow) { await deleteRecording(r, owner.value); asking.value = ''; if (open.value === r.id) open.value = ''; await load() }
async function removeAll() { for (const r of rows.value) await deleteRecording(r, owner.value); asking.value = ''; open.value = ''; await load() }
</script>

<template>
  <section v-if="owner && loaded" class="rl" :class="{ 'rl-bare': bare }">
    <header v-if="!bare" class="rl-head">
      <h2 class="rl-h">{{ heading || W['list-title'] }}</h2>
      <p v-if="lead" class="rl-lead">{{ lead }}</p>
    </header>
    <p v-if="!rows.length" class="rl-empty">{{ empty || W['list-empty'] }}</p>
    <ul v-else class="rl-list">
      <li v-for="r in rows" :key="r.id" class="rl-item">
        <div class="rl-row">
          <div class="rl-what">
            <b>{{ title(r) }}</b>
            <span class="rl-meta">{{ when(r) }} · {{ W[r.kind] }} · {{ length(r) }} · {{ count(r) }}<template v-if="r.status !== 'complete'"> · {{ W.partial }}</template></span>
          </div>
          <div class="rl-acts">
            <button type="button" class="rl-btn rl-primary" :aria-expanded="open === r.id" @click="open = open === r.id ? '' : r.id">{{ open === r.id ? W.close : W.open }}</button>
            <button type="button" class="rl-quiet" @click="asking = r.id">{{ W.delete }}</button>
          </div>
        </div>
        <div v-if="asking === r.id" class="rl-ask" role="alertdialog">
          <span>{{ W['delete-confirm'] }}</span>
          <button type="button" class="rl-btn rl-danger" @click="remove(r)">{{ W.confirm }}</button>
          <button type="button" class="rl-btn" @click="asking = ''">{{ W.cancel }}</button>
        </div>
        <RecordingPlayer v-if="open === r.id" class="rl-player" :rec="r" :owner="owner" :chapters="chapters(r)" />
      </li>
    </ul>
    <div v-if="rows.length" class="rl-foot">
      <button v-if="asking !== '*'" type="button" class="rl-link" @click="asking = '*'">{{ W['delete-all'] }}</button>
      <div v-else class="rl-ask" role="alertdialog">
        <span>{{ W['delete-confirm'] }}</span>
        <button type="button" class="rl-btn rl-danger" @click="removeAll">{{ W.confirm }}</button>
        <button type="button" class="rl-btn" @click="asking = ''">{{ W.cancel }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rl { margin-top: 28px; padding: 28px; border: 1px solid var(--hair); border-radius: 18px; background: var(--card, var(--paper)) }
.rl-bare { margin: 0; padding: 0; border: 0; border-radius: 0; background: none }
.rl-bare .rl-empty, .rl-bare .rl-list { margin-top: 0 }
.rl-bare .rl-item:first-child { border-top: 0; padding-top: 0 }
.rl-h { margin: 0; font-size: clamp(1.3rem, 2.4vw, 1.6rem); color: var(--ink) }
.rl-lead { margin: 8px 0 0; color: var(--ink2); line-height: 1.5 }
.rl-empty { margin: 16px 0 0; color: var(--ink2) }
.rl-list { margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 12px }
.rl-item { border-top: 1px solid var(--hair); padding-top: 12px }
.rl-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px }
.rl-what { display: grid; gap: 2px; min-width: 0 }
.rl-meta { font-size: .88rem; color: var(--ink2) }
.rl-acts { display: flex; align-items: center; gap: 14px }
/* deleting is offered, not pushed: a quiet word beside the one real action, asked twice */
.rl-quiet { padding: 6px 2px; border: 0; background: none; font: inherit; font-size: .88rem; color: var(--ink3, var(--ink2)); cursor: pointer }
.rl-quiet:hover { color: #b42318 }
.rl-btn { padding: 8px 18px; border: 1px solid var(--hair); border-radius: 999px; background: transparent; color: var(--ink); font: inherit; font-size: .9rem; cursor: pointer }
.rl-primary { background: var(--ink); color: var(--paper); border-color: var(--ink) }
.rl-danger { border-color: #b42318; color: #b42318 }
.rl-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 10px; font-size: .92rem; color: var(--ink2) }
.rl-player { margin-top: 14px }
.rl-foot { margin-top: 18px }
.rl-link { padding: 0; border: 0; background: none; font: inherit; font-size: .9rem; color: var(--ink2); text-decoration: underline; cursor: pointer }
@media (max-width: 560px) { .rl { padding: 20px } }
</style>
