<script setup>
/*
 * The open conversation: the other party at the top, the messages by day and
 * by run, the composer at the foot. The scroll holds at the bottom while the
 * reader is there — a message that arrives then is shown and marked read at
 * once — and stays put when they have scrolled up, with a pill offering the
 * way down. Reaching the top asks for the page before. The thread's data and
 * traffic are src/lib/chat/api.js; the rules are model.js.
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { us } from '@platform-kit/kit/lib/content.js'
import { say, titleOf } from '@platform-kit/kit/lib/provider.js'
import { thread, openThread, loadEarlier, closeThread, peerReadAt, sendText, sendVoice, sendFile, react, remove, setWantsRead, markRead } from '@platform-kit/kit/lib/chat/api.js'
import { daySections, groupRuns } from '@platform-kit/kit/lib/chat/model.js'
import ChatAvatar from './ChatAvatar.vue'
import ChatBubble from './ChatBubble.vue'
import ChatComposer from './ChatComposer.vue'

const props = defineProps({
  id: { type: String, required: true },
  me: { type: String, required: true },
  peer: { type: Object, default: null },
  canWrite: { type: Boolean, default: true },
  /* a name for any sender id in this thread */
  nameOf: { type: Function, required: true },
  /* on a phone the list is a screen behind this one */
  showBack: { type: Boolean, default: false },
})
const emit = defineEmits(['back'])
const P = us('chat').page.main
const V = us('chat').voice.main

const scroller = ref(null)
const top = ref(null)
const composer = ref(null)
const atBottom = ref(true)
const fresh = ref(0)          /* messages that arrived while scrolled up */
const replyTo = ref(null)
const flashId = ref(null)
const error = ref('')
const busy = ref(false)

const byId = computed(() => Object.fromEntries(thread.messages.map((m) => [m.id, m])))
const sections = computed(() => daySections(groupRuns(thread.messages), Date.now(), P).map((s) => ({ ...s })))
const readAt = computed(() => { void thread.members; return peerReadAt() })
const reactionsOf = (id) => thread.reactions.filter((r) => r.message_id === id)
const peerName = computed(() => (props.peer && props.peer.name) || (thread.peer && thread.peer.name) || '')
/* whether the other party answers as a coach is the ROLES they hold, not the one word the profile
   used to carry: this compared role === 'admin' and so called every coach a member, and drew MEMBER
   under a coach's own name at the head of their own thread. */
const peerIsCoach = computed(() => {
  const r = props.peer || thread.peer || {}
  const roles = Array.isArray(r.roles) ? r.roles : (r.role ? [r.role] : [])
  return roles.includes('provider') || roles.includes('coach') || roles.includes('admin')
})
/* their own title wins wherever we are naming THEM; the site's word is the fallback inside titleOf */
const role = computed(() => (peerIsCoach.value ? titleOf(props.peer) : P['member-role']))

const NEAR = 80
function onScroll() {
  const el = scroller.value
  if (!el) return
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR
  atBottom.value = near
  setWantsRead(near && document.visibilityState === 'visible')
  if (near) fresh.value = 0
}
function toBottom(smooth) {
  const el = scroller.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  fresh.value = 0
}

/* the page before, when the top comes into view; the scroll stays where it was */
useIntersectionObserver(top, async ([entry]) => {
  if (!entry.isIntersecting || thread.done || thread.loading || !thread.messages.length) return
  const el = scroller.value
  const before = el ? el.scrollHeight - el.scrollTop : 0
  await loadEarlier()
  await nextTick()
  if (el) el.scrollTop = el.scrollHeight - before
})

/* a new last message: follow it down if the reader was at the foot (or sent it), else count it */
watch(() => thread.messages.length && thread.messages[thread.messages.length - 1], async (last, prev) => {
  if (!last || (prev && last.id === prev.id)) return
  await nextTick()
  if (atBottom.value || last.sender_id === props.me) toBottom(!!prev)
  else fresh.value += 1
})

async function load() {
  fresh.value = 0; replyTo.value = null; error.value = ''
  await openThread(props.id)
  await nextTick()
  toBottom(false)
  atBottom.value = true
  setWantsRead(document.visibilityState === 'visible')
}
watch(() => props.id, load)
onMounted(load)
/* the content grows after it is drawn — a waveform decoding, chips landing, a
   textarea growing — and the foot stays the foot while the reader is there */
let ro = null, mo = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !scroller.value) return
  ro = new ResizeObserver(() => { if (atBottom.value) toBottom(false) })
  for (const el of scroller.value.children) ro.observe(el)
  mo = new MutationObserver(() => { for (const el of scroller.value.children) ro.observe(el) })
  mo.observe(scroller.value, { childList: true })
})
onBeforeUnmount(() => { if (ro) ro.disconnect(); if (mo) mo.disconnect() })
onBeforeUnmount(() => { setWantsRead(false); closeThread() })
function visible() { if (document.visibilityState === 'visible') { setWantsRead(atBottom.value); if (atBottom.value) markRead() } else setWantsRead(false) }
onMounted(() => document.addEventListener('visibilitychange', visible))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', visible))

async function onSend(text) {
  error.value = ''
  try { await sendText(text, replyTo.value && replyTo.value.id); replyTo.value = null } catch (e) { error.value = (e && e.message) || 'failed' }
}
async function onVoice({ blob, seconds, transcript }) {
  error.value = ''; busy.value = true
  try { await sendVoice(blob, seconds, replyTo.value && replyTo.value.id, transcript); replyTo.value = null } catch (e) { error.value = V.failed }
  busy.value = false
}
/* A FILE: the same path a voice note takes — the bytes under the message's own id, then the row.
   Ten megabytes is the bucket's own limit; anything over it is refused here rather than half sent. */
const MAX_FILE = 10 * 1024 * 1024
async function onFile(file) {
  if (!file) return
  if (file.size > MAX_FILE) { error.value = V['too-big']; return }
  error.value = ''; busy.value = true
  try { await sendFile(file, replyTo.value && replyTo.value.id); replyTo.value = null } catch (e) { error.value = V['file-failed'] }
  busy.value = false
}
function jump(id) {
  const el = scroller.value && scroller.value.querySelector('[data-id="' + id + '"]')
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flashId.value = id
  setTimeout(() => { if (flashId.value === id) flashId.value = null }, 1500)
}
function reply(m) { replyTo.value = m; if (composer.value) composer.value.focus() }
</script>

<template>
  <div class="ct" role="region" :aria-label="peerName">
    <div class="ct-head">
      <button v-if="showBack" type="button" class="ct-back" :aria-label="P.back" :title="P.back" @click="emit('back')">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l-6 6 6 6"/></svg>
      </button>
      <ChatAvatar :name="peerName" :size="36" :coach="peerIsCoach" />
      <div class="ct-who">
        <b>{{ peerName }}</b>
        <span>{{ role }}</span>
      </div>
    </div>

    <div ref="scroller" class="ct-scroll" @scroll.passive="onScroll">
      <div ref="top" class="ct-top" aria-hidden="true" />
      <p v-if="thread.loading && !thread.messages.length" class="ct-note">{{ P.loading }}</p>
      <p v-else-if="!thread.done && thread.messages.length" class="ct-note ct-earlier">{{ P['load-earlier'] }}</p>
      <template v-for="s in sections" :key="s.key">
        <div class="ct-day"><span>{{ s.label }}</span></div>
        <ChatBubble v-for="m in s.messages" :key="m.id" :message="m" :me="me" :peer-read-at="readAt" :reactions="reactionsOf(m.id)"
                    :quoted="m.reply_to ? byId[m.reply_to] || null : null" :name-of="nameOf" :can-write="canWrite" :flash="flashId === m.id"
                    @react="(e) => react(m.id, e)" @reply="reply(m)" @remove="remove(m.id)" @jump="jump" />
      </template>
      <p v-if="!thread.loading && !thread.messages.length && !thread.error" class="ct-note ct-empty">{{ P['empty-thread-open'] }}</p>
    </div>

    <button v-if="fresh > 0" type="button" class="ct-fresh" @click="toBottom(true)">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4v12M5 11l5 5 5-5"/></svg>
      {{ P['new-below'] }}<b>{{ fresh }}</b>
    </button>

    <div class="ct-foot">
      <ChatComposer ref="composer" :can-write="canWrite" :reply-to="replyTo" :name-of="nameOf" :busy="busy" :error="error"
                    @send="onSend" @voice="onVoice" @file="onFile" @cancel-reply="replyTo = null" />
    </div>
  </div>
</template>

<style scoped>
.ct { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; min-height: 0; position: relative; background: var(--paper) }
.ct-head { display: flex; align-items: center; gap: 12px; padding: 12px 20px; min-height: 64px; border-bottom: 1px solid var(--hair); background: var(--paper); z-index: 2 }
.ct-back { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; margin-left: -8px; color: var(--ink2);
  background: none; border: 0; border-radius: 50%; cursor: pointer }
.ct-back:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 8%, transparent) }
.ct-who { min-width: 0; display: flex; flex-direction: column; line-height: 1.25 }
.ct-who b { font-family: var(--fd); font-weight: 600; font-size: 17px; letter-spacing: -.01em; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ct-who span { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); margin-top: 2px }
.ct-scroll { overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; padding: 10px 22px 16px; scroll-padding-bottom: 20px }
.ct-top { height: 1px; flex: none }
.ct-note { font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); text-align: center; margin: 8px 0 }
.ct-empty { margin-top: auto; margin-bottom: auto; font-family: var(--f); font-size: 14.5px; letter-spacing: 0; text-transform: none; color: var(--ink3) }
.ct-day { display: flex; justify-content: center; margin: 18px 0 4px }
.ct-day span { font-family: var(--m); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3) }
.ct-fresh { position: absolute; left: 50%; bottom: 92px; transform: translateX(-50%); z-index: 3; display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--paper); background: var(--ink); border: 0; border-radius: 999px; padding: 8px 14px;
  cursor: pointer; box-shadow: 0 10px 24px -12px #000a }
.ct-fresh b { font-family: var(--m); font-size: 11px; background: var(--accent); color: #fff; border-radius: 999px; padding: 1px 6px }
.ct-foot { padding: 10px 16px calc(14px + env(safe-area-inset-bottom, 0px)); background: var(--paper) }
@media (max-width: 640px) { .ct-scroll { padding: 8px 12px 12px } .ct-foot { padding: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px)) } .ct-head { padding: 10px 14px; min-height: 58px } }
</style>
