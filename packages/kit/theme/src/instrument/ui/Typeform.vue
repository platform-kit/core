<script setup lang="ts">
import type { PropType } from 'vue'
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import { VOICE } from 'platformkit/instrument/engine/voice.js'
import { us } from 'platformkit/lib/strings.js'
import ChoiceScreen from './screens/ChoiceScreen.vue'
import InfoScreen from './screens/InfoScreen.vue'
import LatencyScreen from './screens/LatencyScreen.vue'
import SpeakScreen from './screens/SpeakScreen.vue'
import BlankScreen from './screens/BlankScreen.vue'
import BooksScreen from './screens/BooksScreen.vue'
import PickScreen from './screens/PickScreen.vue'
/* a form's slide: its copy and its fields together (the forms module) — its chunk, with the logic engine, is fetched
   the first time a form is shown, so a reading's round and a site with forms off never carry it */
const FormScreen = defineAsyncComponent(() => import('./screens/form/FormScreen.vue'))

/*
 * The question runner. It knows nothing about areas, types, complexes or scoring —
 * it takes a list of screens and emits answers. That separation is what lets the
 * same component run the statements, the forced-choice pairs and the word list.
 */
const props = defineProps({
  screens: { type: Array as PropType<any[]>, required: true },
  title: { type: String, default: '' },
  /* A RUN BEING RECORDED (openspec: recorded-rounds): the recorder its host started (lib/recording.ts createRunRecorder),
     or none. The runner only marks it — each screen as shown and as answered, by the screen's `mark` (a statement shown
     on two screens is one chapter) or else its id — and offers Stop; the host started it and finishes it. */
  recorder: { type: Object as PropType<any>, default: null },
})
const RW = computed(() => ((us('recording').page || {}).main || {}))
const markOf = (s: any) => (s && (s.mark ?? s.id)) || ''
const emit = defineEmits(['answer', 'complete', 'label', 'progress'])

const KINDS: any = { choice: ChoiceScreen, info: InfoScreen, latency: LatencyScreen, speak: SpeakScreen, blank: BlankScreen, books: BooksScreen, pick: PickScreen, form: FormScreen }

const i = ref(0)
let answers: any = []

/* A new list is a new round. Without this the index survives the handover and the
   runner reports the round finished before its first question is on screen. */
watch(() => props.screens, () => { i.value = 0; answers = [] })

/* Some screens only earn their place depending on what came before — a speak
   screen when the microphone was declined, the second half of a recall pair when
   the first half was answered correctly. Skipping is resolved here rather than
   inside the screen so that nothing mounts only to unmount itself.

   A screen can carry skip(), a predicate read at the moment it would be shown,
   which is what lets it depend on an answer given seconds earlier. */
function skipped(s: { kind: string; skip: () => boolean }) {
  if (!s) return false
  if (s.kind === 'speak' && VOICE.mode === 'off') return true
  return typeof s.skip === 'function' && s.skip() === true
}
function settle(n: number) {
  let k = n
  while (k < props.screens.length && skipped(props.screens[k])) k++
  return k
}

const current = computed(() => props.screens[settle(i.value)] || null)
/* when the current screen appeared, so an answer can carry how long it took */
let shownAt = Date.now()
watch(current, (s) => { shownAt = Date.now(); if (props.recorder && s) props.recorder.mark(markOf(s), 'shown') }, { immediate: true })
const component = computed(() => (current.value ? KINDS[current.value.kind] || ChoiceScreen : null))

function report() {
  const at = settle(i.value)
  emit('progress', at / Math.max(props.screens.length, 1))
  emit('label', (current.value && current.value.label) || props.title || '')
  /* an empty list is a round that has not been handed over yet, not a finished
     one — completing on it would report an answer nobody gave */
  if (props.screens.length && at >= props.screens.length) emit('complete', answers)
}
watch(current, report, { immediate: true })

function onAnswer(value: any, extra?: any) {
  const s = current.value
  const ex = Object.assign({}, extra || {}, { ms: Date.now() - shownAt })
  answers.push({ id: s.id, value, extra: ex, meta: s.meta || null })
  if (props.recorder) props.recorder.mark(markOf(s), 'answered')
  emit('answer', s, value, ex)
  i.value = settle(i.value) + 1
}

/* back one screen — to the previous one that was shown (a skipped screen stays skipped), its answer
   taken off the list so it is given again; a form's slide controls use it, the readings never do */
function back() {
  let k = settle(i.value) - 1
  while (k >= 0 && skipped(props.screens[k])) k--
  if (k < 0) return false
  const s = props.screens[k]
  const at = answers.map((a: { id: any }) => a.id).lastIndexOf(s.id)
  if (at >= 0) answers.splice(at, 1)
  i.value = k
  return true
}

/* the number keys pick an option — the shell forwards them */
function key(n: number) {
  const s = current.value
  if (!s || !s.options || !s.options[n - 1]) return
  if (s.kind === 'pick') return   /* the pick screen takes its own keys: "other" opens a line, not an answer */
  onAnswer(s.options[n - 1].v)
}

defineExpose({ key, back, index: () => settle(i.value), total: () => props.screens.length })
</script>

<template>
  <div v-if="recorder && recorder.recording.value" class="tf-rec" role="status">
    <span class="tf-rec-dot" aria-hidden="true" />{{ RW.indicator }}
    <button type="button" class="tf-rec-stop" @click="recorder.finish()">{{ RW.stop }}</button>
  </div>
  <component
    :is="component"
    v-if="current"
    :key="settle(i)"
    :screen="current"
    @answer="onAnswer"
  />
</template>

<style scoped>
/* the one sign a run is being recorded, and the way to stop it; the run goes on either way */
.tf-rec { position: fixed; top: 76px; right: 16px; z-index: 30; display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px;
  border: 1px solid var(--hair, #0002); border-radius: 999px; background: var(--paper, #fff); color: var(--ink, #111); font-size: .85rem; box-shadow: 0 6px 18px -10px #0006 }
.tf-rec-dot { width: 8px; height: 8px; border-radius: 50%; background: #d92d20; animation: tf-rec-pulse 1.6s ease-in-out infinite }
.tf-rec-stop { padding: 3px 10px; border: 1px solid var(--hair, #0002); border-radius: 999px; background: transparent; font: inherit; color: inherit; cursor: pointer }
@keyframes tf-rec-pulse { 50% { opacity: .35 } }
@media (prefers-reduced-motion: reduce) { .tf-rec-dot { animation: none } }
</style>
