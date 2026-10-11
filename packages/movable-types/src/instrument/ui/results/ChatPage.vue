<script setup>
/*
 * The Chat tab of the results sheet, /app/chat — the coaching chat, where a business runs it here
 * rather than in the community (platformkit.config.js coaching.where; the tab itself is switched off
 * with it, so this page is only ever reached when it is on).
 *
 * Everything the chat IS lives in CoachingPanel: the two panes, the inbox, the thread, the picker,
 * who may write. This file is the sheet's own shell round it — the gates in front of it, a card on
 * the sheet's ground, and the height the viewport has left under the tabs, so the thread scrolls
 * and the page does not. The conversation in the address (/app/chat/<id>) is the open one, which is
 * what the panel's 'home' is for.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Gate from '../../../components/Gate.vue'
import CoachingPanel from '../../../components/chat/CoachingPanel.vue'
import { appPath } from '../../../router.js'

const HOME = appPath('chat')
const panel = ref(null)
const gate = computed(() => (panel.value ? panel.value.gate : null))
const ready = computed(() => !!panel.value && panel.value.ready)

const root = ref(null)
const height = ref(0)
function fit() {
  const el = root.value
  if (!el) return
  const stage = el.closest('.qzstage')
  if (stage) stage.scrollTop = 0
  const top = el.getBoundingClientRect().top
  height.value = Math.max(460, Math.round(window.innerHeight - top - 24))
}
onMounted(() => {
  window.addEventListener('resize', fit)
  fit(); setTimeout(fit, 450)   /* again once the sheet's entrance has settled */
})
onBeforeUnmount(() => { window.removeEventListener('resize', fit) })
</script>

<template>
  <div ref="root" class="chat" :style="{ height: height ? height + 'px' : null }">
    <div v-show="!ready" class="chat-wait" aria-busy="true" />
    <div v-if="ready && gate" class="chat-gate">
      <Gate kind="chat" :required="gate" />
    </div>
    <div v-show="ready && !gate" class="chat-panes">
      <CoachingPanel ref="panel" :home="HOME" />
    </div>
  </div>
</template>

<style scoped>
/* A panel on the sheet's ground, as tall as the viewport leaves under the tabs,
   every surface its own and solid: white (the page's cream read as the ground
   showing through), a warm side column for the list, soft bubbles for the other
   party and ink for one's own, a field for the composer; the dark set below.
   The site's --card is translucent, so the chat names its own here. */
.chat { --card: #ffffff; --paper: #ffffff; --chat-side: #faf9f5; --chat-peer: #f1efe8; --chat-field: #f3f1ea;
  --chat-own: linear-gradient(180deg, #2b2a28, #171716); --chat-own-ink: #ffffff;
  height: 70vh; box-sizing: border-box; display: flex; flex-direction: column; background: var(--paper);
  border-radius: 22px; overflow: hidden; margin-bottom: var(--s3, 16px);
  box-shadow: 0 1px 2px #0000000a, 0 2px 6px #0000000a, 0 30px 70px -40px #00000055 }
:root[data-theme='dark'] .chat { --card: #16243d; --paper: #111e33; --chat-side: #0d1829; --chat-peer: #1c2c47; --chat-field: #182640; --chat-own: linear-gradient(180deg, #3a4f78, #2a3d62); --chat-own-ink: #ffffff; box-shadow: 0 30px 70px -40px #000 }
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) .chat { --card: #16243d; --paper: #111e33; --chat-side: #0d1829; --chat-peer: #1c2c47; --chat-field: #182640; --chat-own: linear-gradient(180deg, #3a4f78, #2a3d62); --chat-own-ink: #ffffff; box-shadow: 0 30px 70px -40px #000 } }
.chat-wait, .chat-panes { flex: 1; min-height: 0 }
.chat-gate { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 18px }
.chat-gate > * { width: 100%; max-width: 560px }
@media (max-width: 819px) { .chat { border-radius: 16px } }
</style>
