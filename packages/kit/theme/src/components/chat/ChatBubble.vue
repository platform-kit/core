<script setup>
/*
 * One message. Mine on the right in the accent, the peer's on the left on
 * paper; a tail on the last of a run; the time and, on mine, the tick
 * (sending · sent · read). A reply carries what it answers above it, and a
 * click on that goes to the original. Reactions sit under the bubble as chips;
 * one's own is outlined. Hover (a pointer) or a long press (a finger) opens
 * the strip: the quick emoji, reply, and — on one's own — withdraw. A withdrawn
 * message stays as a placeholder. A file (the support chat's) shows inline when it is a
 * picture — so a gif moves — and as a chip to open otherwise; the row carries its url.
 * Words from content/app/ui/chat.md.
 */
import { ref, computed, watch } from 'vue'
import { attachmentUrl } from 'platformkit/lib/chat/audio.js'
import { us } from 'platformkit/lib/content.js'
import { tickOf, reactionChips, previewOf, timeOf, reactionSet } from 'platformkit/lib/chat/model.js'
import VoiceNote from './VoiceNote.vue'
import MessageText from './MessageText.vue'
import { messageBlocks } from 'platformkit/lib/chat/markup.js'

const props = defineProps({
  message: { type: Object, required: true },     /* with first/last from groupRuns */
  me: { type: String, default: '' },
  peerReadAt: { type: String, default: null },
  reactions: { type: Array, default: () => [] }, /* this message's */
  quoted: { type: Object, default: null },       /* the message it replies to */
  /* the name of whoever sent a quoted message */
  nameOf: { type: Function, default: () => '' },
  /* the reader may write (a lapsed member may not) */
  canWrite: { type: Boolean, default: true },
  /* which of the strip's actions this chat offers (the support chat: withdraw alone) */
  actions: { type: Array, default: () => ['react', 'reply', 'remove'] },
  flash: { type: Boolean, default: false },
})
const emit = defineEmits(['react', 'reply', 'remove', 'jump'])
const C = us('chat').composer.main
const T = us('chat').ticks.main

const saidIn = (m) => messageBlocks(m && m.body)
const own = computed(() => props.message.sender_id === props.me)
const tick = computed(() => tickOf(props.message, props.me, props.peerReadAt))
const chips = computed(() => reactionChips(props.reactions, props.me))
const gone = computed(() => !!props.message.deleted_at)
const quick = reactionSet(C.reactions)
const has = (a) => props.actions.includes(a)
const time = computed(() => timeOf(props.message.created_at))
const isImage = computed(() => props.message.kind === 'file' && /^image\//.test(String(props.message.attachment_type || '')))
/* WHERE THE FILE IS. The support chat's rows arrive with a signed url of their own; the coaching
   chat's carry a path into a private bucket, so it is fetched through the signed-in client the way
   a voice note is. One ref either way, so the template asks one question. */
const at = ref(props.message.url || null)
watch(() => [props.message.url, props.message.attachment_path], async () => {
  if (props.message.kind !== 'file') return
  at.value = props.message.url || (await attachmentUrl(props.message))
}, { immediate: true })
const sizeOf = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n ? n + ' B' : '')
const quotedText = computed(() => previewOf(props.quoted, C))

/* the strip: on hover through css; pinned open by a long press until a tap elsewhere */
const open = ref(false)
let press = null
function down(e) { if (e.pointerType === 'mouse' || gone.value) return; press = setTimeout(() => { open.value = true; press = null }, 420) }
function up() { if (press) { clearTimeout(press); press = null } }
function away() { open.value = false }
function act(fn) { fn(); open.value = false }
</script>

<template>
  <div class="cb" :class="{ own, first: message.first, last: message.last, gone, open, flash, pending: message.pending, media: isImage }"
       :data-id="message.id" @pointerdown="down" @pointerup="up" @pointercancel="up" @pointerleave="up" @focusout="away">
    <div class="cb-row">
      <div class="cb-bubble">
        <button v-if="quoted" type="button" class="cb-quote" @click="emit('jump', quoted.id)">
          <b>{{ nameOf(quoted.sender_id) }}</b>
          <span>{{ quotedText }}</span>
        </button>
        <p v-if="gone" class="cb-gone">{{ C.deleted }}</p>
        <template v-else-if="message.kind === 'voice'">
          <VoiceNote :message="message" :own="own" />
          <p v-if="message.body" class="cb-said"><MessageText :blocks="saidIn(message)" /></p>
        </template>
        <a v-else-if="isImage" class="cb-img" :href="at" target="_blank" rel="noopener"><img :src="at" :alt="message.attachment_name || C.file" loading="lazy" /></a>
        <a v-else-if="message.kind === 'file'" class="cb-file" :href="at" target="_blank" rel="noopener" download>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h5l4 4v8a1.5 1.5 0 0 1-1.5 1.5h-7.5A1.5 1.5 0 0 1 4.5 15.5v-10.5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M11 3.5v4h4"/></svg>
          <span><b>{{ message.attachment_name || C.file }}</b><small v-if="message.attachment_size">{{ sizeOf(message.attachment_size) }}</small></span>
        </a>
        <p v-else class="cb-text"><MessageText :blocks="saidIn(message)" /></p>
      </div>
      <div v-if="!gone && canWrite && (has('react') || has('reply') || (own && has('remove')))" class="cb-acts" role="toolbar" :aria-label="C.actions">
        <template v-if="has('react')"><button v-for="e in quick" :key="e" type="button" class="cb-act cb-emoji" :aria-label="C.react + ' ' + e" @click="act(() => emit('react', e))">{{ e }}</button>
        <i class="cb-sep" aria-hidden="true" /></template>
        <button v-if="has('reply')" type="button" class="cb-act" :aria-label="C.reply" :title="C.reply" @click="act(() => emit('reply'))">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5L3.5 9.5 8 14"/><path d="M4 9.5h7a5 5 0 0 1 5 5V16"/></svg>
        </button>
        <button v-if="own && has('remove')" type="button" class="cb-act cb-del" :aria-label="C.delete" :title="C.delete" @click="act(() => emit('remove'))">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M6 6l.8 10h6.4L14 6"/></svg>
        </button>
      </div>
    </div>
    <div v-if="chips.length" class="cb-chips">
      <button v-for="c in chips" :key="c.emoji" type="button" class="cb-chip" :class="{ mine: c.mine }" :disabled="!canWrite"
              :aria-label="c.emoji + ' ' + c.count" @click="emit('react', c.emoji)">{{ c.emoji }}<b v-if="c.count > 1">{{ c.count }}</b></button>
    </div>
    <!-- the moment and the tick, under the last of a run; the rest say theirs on hover -->
    <span class="cb-meta" :class="{ always: message.last }" :title="time">
      <time :datetime="message.created_at">{{ time }}</time>
      <span v-if="tick && !gone" class="cb-tick" :class="tick" :aria-label="T[tick]" :title="T[tick]">
        <svg v-if="tick === 'pending'" viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6.5V10l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <svg v-else viewBox="0 0 24 20" width="15" height="12" aria-hidden="true"><path d="M2 10.5l4 4 8-8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 14.5l1 1 8-8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </span>
  </div>
</template>

<style scoped>
.cb { display: flex; flex-direction: column; align-items: flex-start; max-width: min(72%, 520px); margin: 2px 0; position: relative }
.cb.own { align-self: flex-end; align-items: flex-end }
.cb.first { margin-top: 12px }
.cb-row { position: relative; display: flex; align-items: center; gap: 8px; max-width: 100% }
.cb.own .cb-row { flex-direction: row-reverse }
/* theirs: a soft warm shape, no line; mine: ink, the site's own primary */
.cb-bubble { position: relative; min-width: 0; max-width: 100%; padding: 9px 14px 10px; border-radius: 18px;
  background: var(--chat-peer, #f1efe8); color: var(--ink) }
.cb.own .cb-bubble { background: var(--chat-own, linear-gradient(180deg, #2b2a28, #171716)); color: var(--chat-own-ink, #fff);
  -webkit-font-smoothing: antialiased }
.cb.own .cb-text { font-weight: 500 }
.cb.last:not(.own) .cb-bubble { border-bottom-left-radius: 6px }
.cb.own.last .cb-bubble { border-bottom-right-radius: 6px }
.cb.pending .cb-bubble { opacity: .6 }
.cb-text { margin: 0; font-size: 15.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere }
/* a picture is the bubble: no padding, no ground, the shape's own corners */
.cb.media .cb-bubble { padding: 0; background: none; border-radius: 18px; overflow: hidden }
.cb-img { display: block; line-height: 0; border: 1px solid var(--hair); border-radius: 18px; overflow: hidden }
.cb-img img { display: block; width: 100%; height: auto; background: var(--paper) }
.cb.media { width: 100% }
.cb-file { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; min-width: 180px }
.cb-file span { display: flex; flex-direction: column; min-width: 0 } .cb-file b { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap } .cb-file small { font-family: var(--m); font-size: 10.5px; opacity: .7 }
.cb-gone { margin: 0; font-size: 14px; line-height: 1.45; font-style: italic; opacity: .6 }
/* the moment: under the last of a run; the others show theirs on hover */
.cb-meta { display: inline-flex; align-items: center; gap: 4px; margin: 3px 6px 0; height: 14px;
  font-family: var(--m); font-size: 10.5px; color: var(--ink3); font-variant-numeric: tabular-nums; line-height: 1;
  opacity: 0; transition: opacity .12s }
.cb-meta.always, .cb:hover .cb-meta { opacity: 1 }
.cb:not(.last) .cb-meta { position: absolute; bottom: -2px; left: 100%; margin: 0 0 0 8px; white-space: nowrap; pointer-events: none }
.cb.own:not(.last) .cb-meta { left: auto; right: 100%; margin: 0 8px 0 0 }
.cb-tick { display: inline-flex; color: var(--ink3) }
.cb-tick.read { color: var(--accent2) }
/* the quote, inside either shape */
.cb-quote { display: block; width: 100%; text-align: left; font: inherit; cursor: pointer; margin: 0 0 8px; padding: 6px 10px;
  border: 0; border-left: 3px solid var(--accent); border-radius: 8px; background: color-mix(in srgb, var(--ink) 6%, transparent); color: inherit }
.cb.own .cb-quote { background: color-mix(in srgb, #fff 14%, transparent); border-left-color: color-mix(in srgb, #fff 80%, transparent) }
.cb-quote b { display: block; font-family: var(--m); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--accent2); margin-bottom: 2px }
.cb.own .cb-quote b { color: #fff; opacity: .85 }
.cb-quote span { display: block; font-size: 13px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; opacity: .8 }
/* the strip */
.cb-acts { display: inline-flex; align-items: center; gap: 1px; padding: 3px; border-radius: 999px; flex: none;
  background: var(--paper); border: 1px solid var(--hair); box-shadow: 0 10px 24px -14px #0009;
  opacity: 0; transform: scale(.92); pointer-events: none; transition: opacity .12s, transform .12s }
.cb:hover .cb-acts, .cb:focus-within .cb-acts, .cb.open .cb-acts { opacity: 1; transform: none; pointer-events: auto }
@media (hover: none) { .cb:hover .cb-acts { opacity: 0; pointer-events: none } .cb.open .cb-acts { opacity: 1; transform: none; pointer-events: auto } }
@media (max-width: 640px) { .cb-acts { position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 3 } .cb.own .cb-acts { left: auto; right: 0 } .cb { max-width: 84% } }
.cb-act { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; font: inherit; font-size: 15px;
  color: var(--ink2); background: none; border: 0; border-radius: 50%; cursor: pointer; line-height: 1 }
.cb-act:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink) }
.cb-emoji:hover { transform: scale(1.2) }
.cb-del:hover { color: #e5484d }
.cb-sep { width: 1px; height: 16px; background: var(--hair); margin: 0 3px }
/* reactions, riding the bubble's foot */
.cb-chips { display: flex; flex-wrap: wrap; gap: 4px; margin: -9px 8px 0; position: relative; z-index: 1 }
.cb.own .cb-chips { justify-content: flex-end }
.cb-chip { display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 13px; line-height: 1; padding: 3px 7px;
  border-radius: 999px; background: var(--paper); border: 1px solid var(--hair); box-shadow: 0 1px 2px #0000000f; cursor: pointer; color: var(--ink2) }
.cb-chip b { font-family: var(--m); font-size: 10.5px; font-weight: 600 }
.cb-chip.mine { border-color: var(--accent2); color: var(--accent2) }
.cb-chip:disabled { cursor: default }
.cb-chips + .cb-meta, .cb-chips ~ .cb-meta { margin-top: 4px }
/* the flash when a quote is followed to it */
.cb.flash .cb-bubble { animation: cbflash 1.4s ease-out }
@keyframes cbflash { 0%, 30% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent) } 100% { box-shadow: none } }
/* what the browser wrote down while they spoke: their words, under their voice */
.cb-said { margin: 6px 0 0; max-width: none; font-size: 13px; line-height: 1.45; color: inherit; opacity: .78 }
</style>
