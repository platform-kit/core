<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { inline } from '../inline.js'

/*
 * A sentence with a blank in it, timed. The clock starts when the sentence is
 * painted and the input already has focus — there is nothing to press first, so
 * what is measured is how long it takes for something to come, not a decision to
 * begin. Two times go back with the words: to the first character (the
 * hesitation — the measurement the engine grades on) and to the last (a phrase
 * being worked at rather than one that simply came). The slot in the sentence
 * fills as the reader types, so the sentence is finished on the page, not in a box.
 *
 * A blank cannot be sent empty unless the area allows a skip (screen.skip is the
 * skip's label when it does). Every word here is the screen's own (questions.js
 * reads them from content/app/ui/quiz.md).
 */
const props = defineProps({ screen: { type: Object, required: true } })
const emit = defineEmits(['answer'])

const typed = ref('')
const input = ref(null)
let t0 = 0, first = null, last = null, sent = false, hid = false, armed = false

/* the sentence around its slot, each side with its marks (inline.js) */
const parts = computed(() => { const t = String(props.screen.headline || ''); const i = t.indexOf('____')
  return i < 0 ? { pre: inline(t), post: '' } : { pre: inline(t.slice(0, i)), post: inline(t.slice(i + 4)) } })
const ready = computed(() => typed.value.trim().length > 0)

function focus() { try { input.value && input.value.focus() } catch (e) { /* not mounted */ } }
function onInput() {
  /* the keystroke that answered the screen before this one can land here as a
     character (keydown answers, the input event follows into the fresh focus):
     nothing typed before the paint is the reader's */
  if (!armed) { typed.value = ''; return }
  const now = Math.round(performance.now() - t0)
  if (first === null && typed.value.trim()) first = now
  if (first !== null) last = now
}
function send(text) {
  if (sent) return
  sent = true
  emit('answer', text, { firstMs: first, lastMs: last, hidden: hid })
}
function submit() { if (ready.value) send(typed.value.trim()) }
function skip() { if (props.screen.skip) send('') }

const onVis = () => { if (document.hidden) hid = true }
onMounted(() => {
  /* onset at paint, not at mount — the same double rAF the word test uses */
  t0 = performance.now()
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!sent) t0 = performance.now(); typed.value = ''; armed = true }))
  document.addEventListener('visibilitychange', onVis)
  focus(); setTimeout(focus, 30)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVis))
</script>

<template>
  <div class="qzin qblank">
    <span v-if="screen.eyebrow" class="eyeb" v-html="screen.eyebrow" />
    <h3 class="qh"><span v-html="parts.pre" /><span class="qslot" :class="{ filled: ready }">{{ typed.trim() || ' ' }}</span><span v-html="parts.post" /></h3>
    <div v-if="screen.sub" class="qsay" v-html="screen.sub" />

    <input
      ref="input"
      v-model="typed"
      class="qwordin qblankin"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :placeholder="screen.placeholder"
      :aria-label="screen.placeholder"
      @input="onInput"
      @keydown.enter.prevent="submit"
    />
    <div class="qblank-act">
      <button type="button" class="qbtn" :disabled="!ready" @click="submit">{{ screen.submit }}</button>
      <button v-if="screen.skip" type="button" class="qblank-skip" @click="skip">{{ screen.skip }}</button>
    </div>
  </div>
</template>

<style scoped>
/* the slot: an underline the length of what is written, never shorter than a word */
.qslot { display: inline-block; min-width: 4.5ch; max-width: 100%; vertical-align: baseline; white-space: pre-wrap;
  color: var(--accent2, var(--qink)); border-bottom: 3px solid var(--qhair); padding: 0 .12em; line-height: 1.05;
  transition: border-color .2s }
.qslot.filled { border-bottom-color: var(--accent2, var(--qink)) }
.qz .qblankin { width: 100%; max-width: 560px; margin-top: 0 }
.qblank-act { display: flex; align-items: center; gap: 18px; margin-top: 18px }
.qbtn:disabled { opacity: .35; cursor: default }
.qblank-skip { font: inherit; font-size: 14px; color: var(--qink3); background: none; border: 0; padding: 0;
  cursor: pointer; text-decoration: underline; text-underline-offset: 3px }
.qblank-skip:hover { color: var(--qink) }
</style>
