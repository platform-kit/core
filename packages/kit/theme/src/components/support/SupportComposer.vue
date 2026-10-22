<script setup>
/*
 * Where a support message is written: a textarea that grows with it (Enter sends, Shift+Enter
 * breaks a line), a clip for a file (a picture shows inline in the thread — a gif moves), the
 * mic for a voice note — which turns the whole thing into the coaching chat's recorder until
 * the note is sent or dropped (fetched only then, so the widget stays light) — and the send
 * button once there is something to send. Words from content/app/ui/support.md (widget →
 * composer), or whatever the caller says.
 */
import { ref, computed, nextTick, onMounted, defineAsyncComponent } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { micUsable } from 'platformkit/lib/chat/recorder.js'

const VoiceRecorder = defineAsyncComponent(() => import('../chat/VoiceRecorder.vue'))

const props = defineProps({
  placeholder: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  autofocus: { type: Boolean, default: false },
  /* what the clip takes */
  accept: { type: String, default: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain' },
})
const emit = defineEmits(['send', 'file', 'voice', 'typing'])
const W = us('support').widget.composer
const text = ref('')
const box = ref(null)
const picker = ref(null)
const recording = ref(false)
const mic = ref(false)
const canSend = computed(() => text.value.trim().length > 0 && !props.busy)

onMounted(async () => { mic.value = await micUsable() })

function grow() { const el = box.value; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(140, el.scrollHeight) + 'px' }
function key(e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() } }
function send() { const t = text.value.trim(); if (!t || props.busy) return; emit('send', t); text.value = ''; nextTick(grow) }
function picked(e) { const f = e.target.files && e.target.files[0]; if (f) emit('file', f); e.target.value = '' }
function voice({ blob, seconds, transcript }) { recording.value = false; emit('voice', { blob, seconds, transcript }) }
function focus() { if (box.value) box.value.focus() }
/* a canned reply, put into the box for the agent to send or change */
function insert(t) { text.value = (text.value ? text.value.replace(/\s+$/, '') + '\n' : '') + String(t || ''); nextTick(() => { grow(); focus() }) }
defineExpose({ focus, insert })
</script>

<template>
  <VoiceRecorder v-if="recording" @send="voice" @cancel="recording = false" />
  <div v-else class="sc">
    <input ref="picker" type="file" class="sc-pick" :accept="accept" @change="picked" />
    <button type="button" class="sc-clip" :aria-label="W.attach" :title="W.attach" :disabled="busy" @click="picker && picker.click()">
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8.5 8.2 13.8a2.2 2.2 0 0 1-3.1-3.1l6-6a3.5 3.5 0 0 1 5 5l-6.3 6.3a4.8 4.8 0 0 1-6.8-6.8L9 3.3"/></svg>
    </button>
    <textarea ref="box" v-model="text" class="sc-in" rows="1" :placeholder="placeholder || W.placeholder" :aria-label="placeholder || W.placeholder"
              :autofocus="autofocus" enterkeyhint="send" @input="grow(); emit('typing')" @keydown="key" />
    <button v-if="canSend" type="button" class="sc-send on" :aria-label="W.send" :title="W.send" @click="send">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M17 10L3 4l3.5 6L3 16z" fill="currentColor"/></svg>
    </button>
    <button v-else-if="mic" type="button" class="sc-send" :aria-label="W.mic" :title="W.mic" :disabled="busy" @click="recording = true">
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="7" y="2.5" width="6" height="9.5" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.5 17.5h5"/></svg>
    </button>
    <button v-else type="button" class="sc-send" :disabled="true" :aria-label="W.send">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M17 10L3 4l3.5 6L3 16z" fill="currentColor"/></svg>
    </button>
  </div>
</template>

<style scoped>
.sc { display: flex; align-items: flex-end; gap: 4px; padding: 5px 5px 5px 6px; border-radius: 24px;
  background: var(--chat-field, color-mix(in srgb, var(--ink) 5%, var(--paper))); border: 1px solid transparent; transition: border-color .12s, background .12s, box-shadow .12s }
.sc:focus-within { border-color: var(--hair); background: var(--paper); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 5%, transparent) }
.sc-pick { display: none }
.sc-in { flex: 1; min-width: 0; font: inherit; font-size: 15px; line-height: 1.45; color: var(--ink); background: none; border: 0; outline: none; resize: none; padding: 8px 4px; max-height: 140px }
.sc-in::placeholder { color: var(--ink3) }
.sc-clip, .sc-send { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex: none; border: 0; border-radius: 50%; cursor: pointer;
  color: var(--ink3); background: none; transition: transform .12s, background .12s, color .12s }
.sc-clip:hover, .sc-send:hover:not(:disabled) { color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent) }
.sc-send.on { color: var(--paper); background: var(--ink) }
.sc-send.on:hover { transform: scale(1.06); color: var(--paper); background: var(--ink) }
.sc-send:disabled, .sc-clip:disabled { cursor: default; opacity: .6 }
</style>
