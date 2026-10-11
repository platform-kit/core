<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { VOICE, MIC, micArm, micListen } from '@platform-kit/kit/instrument/engine/voice.js'
import { ug } from '../strings.js'
const LP = ug('quiz', 'latency').prompt || {}

/*
 * One word, timed. You cannot decide to be slow, which is the whole reason this
 * works — so the clock starts the moment the word is on screen and the input is
 * already focused. There is nothing to press first: pressing something would
 * measure a decision and a hand movement instead of the association.
 *
 * Two timings, not one:
 *   first  how long until anything arrived. Jung's measure — the hesitation.
 *   last   how long until it stopped. A long tail is a word being worked at
 *          rather than one that simply came.
 *
 * Speech, when it is on, is the same measurement by another route. The transcript
 * lands in the same input and the same two numbers come out of it — nothing to
 * press there either.
 */
const props = defineProps({ screen: { type: Object, required: true } })
const emit = defineEmits(['answer'])

const typed = ref('')
const input = ref(null)
const heard = ref(false)

let t0 = 0
let first = null      /* ms to the first character */
let last = null       /* ms to the most recent one */
let take = null
let sent = false
let source = 'typed'

function focus() { try { input.value && input.value.focus() } catch (e) { /* not mounted */ } }

function onInput() {
  const now = Math.round(performance.now() - t0)
  if (first === null && typed.value.trim()) first = now
  if (first !== null) last = now
}

function submit() {
  if (sent) return
  sent = true
  if (take) take.abort('answered')
  emit('answer', typed.value.trim(), { ms: first, firstMs: first, lastMs: last, source, hidden: hid })
}

/* ---------- speech ---------- */
function listen() {
  take = micListen({
    t0,
    onPartial(text) {
      /* straight into the same input, so the two routes are one measurement */
      if (!text) return
      heard.value = true
      source = 'spoken'
      typed.value = text
      onInput()
    },
    onDone(r) {
      if (sent) return
      if (r.onset === null) { take = null; return }   /* nothing said — carry on typing */
      source = 'spoken'
      first = r.onset
      last = r.dur === null ? r.onset : r.onset + r.dur
      if (r.text) typed.value = r.text
      submit()
    },
  })
}

let hid = false
const onVis = () => { if (document.hidden) hid = true }

onMounted(() => {
  /* Stamp onset at paint, not at mount: the gap to the painted word is a frame
     or more and varies, which is pure noise on a ~400ms signal. Double rAF is
     the standard browser-experiment pattern (jsPsych does the same). */
  t0 = performance.now()
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!sent) t0 = performance.now() }))
  /* a hidden tab throttles the clock; the trial's timing cannot be trusted */
  document.addEventListener('visibilitychange', onVis)
  focus()
  setTimeout(focus, 30)          /* some browsers hand focus back a tick late */
  if (VOICE.mode === 'off') return
  if (MIC.stream) return listen()
  micArm().then((ok) => { if (ok && !sent) { t0 = performance.now(); listen() } })
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVis)
  if (take) take.abort('left')
})
</script>

<template>
  <div class="qzin">
    <span v-if="screen.eyebrow" class="eyeb" v-html="screen.eyebrow" />

    <div class="qword">{{ screen.word }}</div>

    <div class="qsay">
      <template v-if="screen.prompt"><span v-html="screen.prompt" /></template>
      <template v-else-if="heard">{{ LP['heard-pre'] }} <b>{{ LP.key }}</b>{{ LP['heard-post'] }}</template>
      <template v-else-if="VOICE.mode !== 'off'">{{ LP['voice-pre'] }} <b>{{ LP.key }}</b>{{ LP['voice-post'] }}</template>
      <template v-else>{{ LP['typed-pre'] }} <b>{{ LP.key }}</b>{{ LP['typed-post'] }}</template>
    </div>

    <input
      ref="input"
      v-model="typed"
      class="qwordin"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :aria-label="LP.aria"
      @input="onInput"
      @keydown.enter.prevent="submit"
    />
  </div>
</template>
