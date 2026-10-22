<script setup>
/*
 * Where a message is written: a textarea that grows with it (Enter sends,
 * Shift+Enter breaks a line), the message being answered above it, and the
 * mic — which turns the whole thing into the recorder until the note is sent
 * or dropped. The send button shows once there is something to send. A reader
 * who may not write (a lapsed member) sees the reason and where to renew
 * instead. Words from content/app/ui/chat.md (composer, page).
 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { us } from 'platformkit/lib/content.js'
import { STORE_ON } from '../../router.js'
import { previewOf } from 'platformkit/lib/chat/model.js'
import { micUsable } from 'platformkit/lib/chat/recorder.js'
import VoiceRecorder from './VoiceRecorder.vue'

const props = defineProps({
  canWrite: { type: Boolean, default: true },
  replyTo: { type: Object, default: null },
  nameOf: { type: Function, default: () => '' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['send', 'voice', 'file', 'cancel-reply'])
const C = us('chat').composer.main
const P = us('chat').page.main

const text = ref('')
const box = ref(null)
const recording = ref(false)
const mic = ref(false)
const canSend = computed(() => text.value.trim().length > 0 && !props.busy)

onMounted(async () => { mic.value = await micUsable() })

function grow() {
  const el = box.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(160, el.scrollHeight) + 'px'
}
function key(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
  if (e.key === 'Escape' && props.replyTo) emit('cancel-reply')
}
function send() {
  const t = text.value.trim()
  if (!t || props.busy) return
  emit('send', t)
  text.value = ''
  nextTick(grow)
}
function voice({ blob, seconds, transcript }) { recording.value = false; emit('voice', { blob, seconds, transcript }) }

/* A FILE. The table has taken one since the support desk's did; what the coaching chat lacked was
   the button — so a coach could be sent a screenshot and could not send one back. */
const clip = ref(null)
function chose(e) { const f = e.target.files && e.target.files[0]; if (f) emit('file', f); e.target.value = '' }

/* THE MARKS, the same three every other surface here offers: a selection wrapped, or the marks
   dropped where the cursor is. Nothing else — a chat is not a document. */
function wrap(mark) {
  const el = box.value
  if (!el) return
  const s = el.selectionStart, e = el.selectionEnd
  const before = text.value.slice(0, s), mid = text.value.slice(s, e), after = text.value.slice(e)
  text.value = before + mark + mid + mark + after
  nextTick(() => { el.focus(); const at = s + mark.length + mid.length; el.setSelectionRange(mid ? at : s + mark.length, mid ? at : s + mark.length) })
}
function focus() { if (box.value) box.value.focus() }
defineExpose({ focus })
watch(() => props.replyTo, (r) => { if (r) nextTick(focus) })
</script>

<template>
  <div class="cc" :class="{ locked: !canWrite }">
    <div v-if="!canWrite" class="cc-locked">
      <span>{{ P['upsell-line'] }}</span>
      <a v-if="STORE_ON" class="cc-renew" href="/store">{{ P['upsell-cta'] }}</a>
    </div>
    <template v-else>
      <div v-if="replyTo" class="cc-reply">
        <div class="cc-reply-in">
          <b>{{ C['replying-to'] }} {{ nameOf(replyTo.sender_id) }}</b>
          <span>{{ previewOf(replyTo, C) }}</span>
        </div>
        <button type="button" class="cc-x" :aria-label="C['cancel-reply']" :title="C['cancel-reply']" @click="emit('cancel-reply')">
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
      </div>
      <p v-if="error" class="cc-err">{{ error }}</p>
      <VoiceRecorder v-if="recording" @send="voice" @cancel="recording = false" />
      <div v-else class="cc-row">
        <textarea ref="box" v-model="text" class="cc-in" rows="1" :placeholder="C.placeholder" :aria-label="C.placeholder"
                  enterkeyhint="send" @input="grow" @keydown="key" />
        <!-- the marks and the clip: the same three marks and the same one file every other chat
             surface on this site offers, because a coach reaching for either should not have to
             remember which window they are in -->
        <button type="button" class="cc-mark" :aria-label="C.bold" :title="C.bold" @click="wrap('**')"><b>B</b></button>
        <button type="button" class="cc-mark" :aria-label="C.italic" :title="C.italic" @click="wrap('*')"><i>I</i></button>
        <button type="button" class="cc-mark" :aria-label="C.attach" :title="C.attach" @click="clip.click()">
          <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M13.5 7.5l-5 5a2.1 2.1 0 0 0 3 3l5.5-5.5a4 4 0 0 0-5.7-5.7L5 10.6a6 6 0 0 0 8.5 8.5"/></svg>
        </button>
        <input ref="clip" type="file" class="cc-file" @change="chose" />
        <button v-if="canSend" type="button" class="cc-send" :aria-label="C.send" :title="C.send" @click="send">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M17 10L3 4l3.5 6L3 16z" fill="currentColor"/></svg>
        </button>
        <button v-else-if="mic" type="button" class="cc-mic" :aria-label="C.mic" :title="C.mic" @click="recording = true">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="7" y="2.5" width="6" height="9.5" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7.5 17.5h5"/></svg>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cc { display: flex; flex-direction: column; gap: 8px }
.cc-row { display: flex; align-items: flex-end; gap: 6px; padding: 5px 5px 5px 16px; border-radius: 24px;
  background: var(--chat-field, #f3f1ea); border: 1px solid transparent; transition: border-color .12s, background .12s }
.cc-row:focus-within { border-color: var(--hair); background: var(--paper); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 5%, transparent) }
.cc-in { flex: 1; min-width: 0; font: inherit; font-size: 15.5px; line-height: 1.45; color: var(--ink); background: none; border: 0; outline: none;
  resize: none; padding: 9px 0; max-height: 160px }
.cc-in::placeholder { color: var(--ink3) }
/* the marks and the clip sit quietly beside the box: they are there when wanted and never the
   first thing the eye lands on, which is the send button */
.cc-mark { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 34px; flex: none;
  font: inherit; font-size: 14px; color: var(--ink3); background: none; border: 0; cursor: pointer; border-radius: 8px }
.cc-mark:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 7%, transparent) }
.cc-mark b { font-weight: 800 }
.cc-mark i { font-family: var(--fd); font-style: italic; font-weight: 700 }
.cc-file { display: none }
.cc-send, .cc-mic { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: none;
  border: 0; border-radius: 50%; cursor: pointer; transition: transform .12s, background .12s, color .12s }
.cc-send { color: var(--paper); background: var(--ink) }
.cc-send:hover { transform: scale(1.06) }
.cc-mic { color: var(--ink2); background: none }
.cc-mic:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent) }
.cc-reply { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-radius: 14px;
  background: var(--chat-field, #f3f1ea); border-left: 3px solid var(--accent) }
.cc-reply-in { flex: 1; min-width: 0 }
.cc-reply-in b { display: block; font-family: var(--m); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--accent2) }
.cc-reply-in span { display: block; font-size: 13px; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.cc-x { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: none; color: var(--ink3);
  background: none; border: 0; border-radius: 50%; cursor: pointer }
.cc-x:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent) }
.cc-err { margin: 0; font-size: 13px; color: #e5484d; padding: 0 14px }
.cc-locked { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 16px; padding: 12px 18px; border-radius: 16px;
  background: var(--chat-field, #f3f1ea); font-size: 14px; color: var(--ink2); text-align: center }
.cc-renew { font-weight: 600; font-size: 13.5px; color: var(--paper); background: var(--ink); border-radius: 999px; padding: 7px 14px; text-decoration: none }
</style>
