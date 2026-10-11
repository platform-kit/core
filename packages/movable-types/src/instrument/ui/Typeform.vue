<script setup>
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import { VOICE } from '@platform-kit/kit/instrument/engine/voice.js'
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
  screens: { type: Array, required: true },
  title: { type: String, default: '' },
})
const emit = defineEmits(['answer', 'complete', 'label', 'progress'])

const KINDS = { choice: ChoiceScreen, info: InfoScreen, latency: LatencyScreen, speak: SpeakScreen, blank: BlankScreen, books: BooksScreen, pick: PickScreen, form: FormScreen }

const i = ref(0)
let answers = []

/* A new list is a new round. Without this the index survives the handover and the
   runner reports the round finished before its first question is on screen. */
watch(() => props.screens, () => { i.value = 0; answers = [] })

/* Some screens only earn their place depending on what came before — a speak
   screen when the microphone was declined, the second half of a recall pair when
   the first half was answered correctly. Skipping is resolved here rather than
   inside the screen so that nothing mounts only to unmount itself.

   A screen can carry skip(), a predicate read at the moment it would be shown,
   which is what lets it depend on an answer given seconds earlier. */
function skipped(s) {
  if (!s) return false
  if (s.kind === 'speak' && VOICE.mode === 'off') return true
  return typeof s.skip === 'function' && s.skip() === true
}
function settle(n) {
  let k = n
  while (k < props.screens.length && skipped(props.screens[k])) k++
  return k
}

const current = computed(() => props.screens[settle(i.value)] || null)
/* when the current screen appeared, so an answer can carry how long it took */
let shownAt = Date.now()
watch(current, () => { shownAt = Date.now() })
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

function onAnswer(value, extra) {
  const s = current.value
  const ex = Object.assign({}, extra || {}, { ms: Date.now() - shownAt })
  answers.push({ id: s.id, value, extra: ex, meta: s.meta || null })
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
  const at = answers.map((a) => a.id).lastIndexOf(s.id)
  if (at >= 0) answers.splice(at, 1)
  i.value = k
  return true
}

/* the number keys pick an option — the shell forwards them */
function key(n) {
  const s = current.value
  if (!s || !s.options || !s.options[n - 1]) return
  if (s.kind === 'pick') return   /* the pick screen takes its own keys: "other" opens a line, not an answer */
  onAnswer(s.options[n - 1].v)
}

defineExpose({ key, back, index: () => settle(i.value), total: () => props.screens.length })
</script>

<template>
  <component
    :is="component"
    v-if="current"
    :key="settle(i)"
    :screen="current"
    @answer="onAnswer"
  />
</template>
