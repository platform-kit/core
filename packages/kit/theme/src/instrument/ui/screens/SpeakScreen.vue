<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { VOICE, MIC, micArm, micListen } from 'platformkit/instrument/engine/voice.js'

/*
 * Say the sentence. The clock starts the moment it is on screen — the interval
 * worth reading is between seeing it and saying it, and a button in the middle of
 * that would measure a decision and a hand movement instead.
 *
 * Nothing is recorded. The level drives the ring and is discarded frame by frame.
 */
const props = defineProps({ screen: { type: Object, required: true } })
const emit = defineEmits(['answer'])

const state = ref('Listening.')
const partial = ref('')
const dot = ref('')            /* '' | 'live' | 'done' */
const scale = ref(1)
let t0 = 0, spoke = false, take = null, gone = false

function settle(r) {
  if (gone) return
  if (r.why === 'nomic') { VOICE.mode = 'off'; emit('answer', 'nomic', r); return }
  if (r.onset === null) {
    state.value = 'Nothing came through. Carry on and answer below.'
    dot.value = ''
    setTimeout(() => { if (!gone) emit('answer', 'silent', r) }, 900)
    return
  }
  dot.value = 'done'
  state.value = 'Got it.'
  setTimeout(() => { if (!gone) emit('answer', 'spoken', r) }, 380)
}

function begin() {
  take = micListen({
    t0, target: props.screen.meta.item.t,
    onLevel(v) {
      scale.value = 1 + v * 0.9
      if (!spoke && v > 0.25) { spoke = true; dot.value = 'live'
        state.value = 'Take your time. It stops when you do.' }
    },
    onPartial(t) { partial.value = t },
    onDone: settle,
  })
}

onMounted(() => {
  t0 = performance.now()
  if (MIC.stream) return begin()
  state.value = 'Turning the microphone on…'
  micArm().then((ok) => {
    if (gone) return
    if (!ok) return settle({ onset: null, dur: null, breaks: 0, text: '', why: 'nomic' })
    /* the clock restarts here: we can only time from the moment we could hear */
    t0 = performance.now()
    state.value = 'Listening.'
    begin()
  })
})

onBeforeUnmount(() => { gone = true; if (take) take.abort('left') })

function skip() {
  if (take) take.abort('skipped')
  else emit('answer', 'skipped', { onset: null, dur: null, breaks: 0, text: '', why: 'skipped' })
}
</script>

<template>
  <div class="qzin">
    <span v-if="screen.eyebrow" class="eyeb" v-html="screen.eyebrow" />
    <h3 class="qh">{{ screen.headline }}</h3>
    <div v-if="screen.sub" class="qsay" v-html="screen.sub" />

    <div class="spk">
      <span class="spkdot" :class="dot">
        <span class="spkring" :style="{ transform: `scale(${scale.toFixed(3)})` }" />
      </span>
      <div class="spkstate">{{ state }}</div>
      <div class="spktx">{{ partial }}</div>
      <button class="spkskip" @click="skip">I would rather not say this one</button>
    </div>
  </div>
</template>
