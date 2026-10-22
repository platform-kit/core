<script setup>
/*
 * Recording a voice note, in the composer's place: a red dot, the running
 * time, the live bars; stop, and it becomes a preview to hear back, with
 * discard and send. The recorder (src/lib/chat/recorder.js) encodes as it
 * goes; the parent uploads.
 *
 * While it records, the browser's own speech recognition listens too
 * (lib/speech/listen.js) and writes down what was said, so a voice note arrives
 * with a transcript: readable at a glance, searchable afterwards, and there for
 * anybody who cannot play sound where they are. The words are shown as they come
 * so nobody is surprised by what was kept, and the note says plainly that this
 * goes through the browser's own service. Where there is no recognition — Firefox
 * today — the note is simply a note, and nothing about it changes.
 * Words from content/app/ui/chat.md (composer, voice).
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { createRecorder } from 'platformkit/lib/chat/recorder.js'
import { createListener, listenUsable } from 'platformkit/lib/speech/listen.js'
import { clock } from 'platformkit/lib/chat/model.js'
import VoiceNote from './VoiceNote.vue'

const emit = defineEmits(['send', 'cancel'])
const C = us('chat').composer.main
const V = us('chat').voice.main

const rec = createRecorder()
const S = rec.state
const ear = createListener()
const E = ear.state
const heard = ref('')        /* what was written down, once stopped */
const take = ref(null)       /* { blob, seconds, transcript } once stopped */
const denied = ref(false)

onMounted(async () => {
  try { await rec.start() } catch (e) { denied.value = true; return }
  if (listenUsable()) ear.start()
})
onBeforeUnmount(() => { rec.cancel(); ear.stop() })

function stop() {
  heard.value = ear.stop()
  const t = rec.stop()
  take.value = { ...t, transcript: heard.value }
}
function discard() { rec.cancel(); ear.stop(); take.value = null; emit('cancel') }
function send() { if (take.value) emit('send', take.value) }
</script>

<template>
  <div class="vr" :class="{ live: S.recording, done: !!take, denied }">
    <template v-if="denied">
      <span class="vr-denied">{{ V.denied }}</span>
      <button type="button" class="vr-btn" @click="discard">{{ C.discard }}</button>
    </template>
    <template v-else-if="take">
      <button type="button" class="vr-icon vr-trash" :aria-label="C.discard" :title="C.discard" @click="discard">
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M6 6l.8 10h6.4L14 6"/></svg>
      </button>
      <div class="vr-preview">
        <VoiceNote :message="{ id: 'take', blob: take.blob, seconds: take.seconds }" />
        <p v-if="take.transcript" class="vr-said">{{ take.transcript }}</p>
      </div>
      <button type="button" class="vr-send" :aria-label="C['send-voice']" :title="C['send-voice']" @click="send">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M17 10L3 4l3.5 6L3 16z" fill="currentColor"/></svg>
      </button>
    </template>
    <template v-else>
      <button type="button" class="vr-icon vr-trash" :aria-label="C.discard" :title="C.discard" @click="discard">
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M6 6l.8 10h6.4L14 6"/></svg>
      </button>
      <span class="vr-dot" aria-hidden="true" />
      <span class="vr-time" :aria-label="V.recording">{{ clock(S.seconds) }}</span>
      <div class="vr-bars" aria-hidden="true">
        <i v-for="(l, i) in S.level" :key="i" :style="{ height: Math.max(8, Math.round(l * 100)) + '%' }" />
      </div>
      <p v-if="E.listening || E.text" class="vr-live" :title="V['heard-note']">{{ E.text || V.listening }}</p>
      <button type="button" class="vr-send vr-stop" :aria-label="C.stop" :title="C.stop" @click="stop">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="2" fill="currentColor"/></svg>
      </button>
    </template>
  </div>
</template>

<style scoped>
.vr { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 4px 4px 6px; border-radius: 999px;
  background: var(--card); border: 1px solid var(--hair) }
.vr-icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex: none;
  color: var(--ink3); background: none; border: 0; border-radius: 50%; cursor: pointer }
.vr-icon:hover { color: #e5484d; background: color-mix(in srgb, #e5484d 10%, transparent) }
.vr-dot { width: 10px; height: 10px; border-radius: 50%; background: #e5484d; flex: none; animation: vrblink 1.1s ease-in-out infinite }
@keyframes vrblink { 50% { opacity: .25 } }
@media (prefers-reduced-motion: reduce) { .vr-dot { animation: none } }
.vr-time { font-family: var(--m); font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; min-width: 38px }
.vr-bars { flex: 1; display: flex; align-items: center; gap: 2px; height: 28px; min-width: 0; overflow: hidden }
.vr-bars i { flex: 1; min-width: 2px; border-radius: 2px; background: var(--accent2); opacity: .8; transition: height .08s linear }
.vr-preview { flex: 1; min-width: 0; padding: 0 4px }
.vr-preview :deep(.vn) { width: 100% }
.vr-send { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: none;
  color: var(--paper); background: var(--accent2); border: 0; border-radius: 50%; cursor: pointer; transition: transform .12s }
.vr-send:hover { transform: scale(1.06) }
.vr-stop { background: var(--ink) }
.vr-denied { flex: 1; font-size: 13.5px; color: var(--ink2); padding-left: 10px }
.vr-btn { font: inherit; font-size: 13px; color: var(--ink2); background: none; border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px; cursor: pointer }
.vr-live { flex: 1; min-width: 0; margin: 0; max-width: none; font-size: 12px; line-height: 1.35;
  color: var(--ink3); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical }
.vr-said { margin: 4px 0 0; max-width: none; font-size: 12.5px; line-height: 1.4; color: var(--ink2) }
</style>
